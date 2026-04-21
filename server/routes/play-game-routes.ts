import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";

type PlayPair = [number, number];

type PlayGameRouteRecord = {
  id: string;
  label: string;
  description?: string;
  moduleFile: string;
  modulePath: string;
  frameAspect: PlayPair;
  grid: PlayPair;
  updatedAt: string;
  moduleUrl: string;
};

type RegisterPlayGameRoutesOptions = {
  app: Express;
  projectRoot: string;
};

const PLAY_GAME_CATALOG_ENV = "METRICS_UI_PLAY_GAME_CATALOG_FILE";
const DEFAULT_PLAY_GAME_CATALOG_FILE = path.join("examples", "play", "play-game-catalog.json");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePair(value: unknown, fallback: PlayPair): PlayPair {
  if (!Array.isArray(value) || value.length < 2) {
    return fallback;
  }
  const first = Number(value[0]);
  const second = Number(value[1]);
  return Number.isFinite(first) && Number.isFinite(second) && first > 0 && second > 0
    ? [first, second]
    : fallback;
}

function isSafeGameId(id: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

function isInsideDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePlayGameCatalogFile(projectRoot: string): string {
  const configuredFile = process.env[PLAY_GAME_CATALOG_ENV];
  if (configuredFile?.trim()) {
    return path.isAbsolute(configuredFile)
      ? configuredFile.trim()
      : path.resolve(projectRoot, configuredFile.trim());
  }
  return path.resolve(projectRoot, DEFAULT_PLAY_GAME_CATALOG_FILE);
}

function buildModuleUrl(gameId: string, modulePath: string): string {
  const stat = fs.statSync(modulePath);
  return `/api/play/games/${encodeURIComponent(gameId)}/module?v=${Math.floor(stat.mtimeMs)}`;
}

function readPlayGames(projectRoot: string): { catalogFile: string; games: PlayGameRouteRecord[] } {
  const catalogFile = resolvePlayGameCatalogFile(projectRoot);
  const catalogDir = path.dirname(catalogFile);
  if (!fs.existsSync(catalogFile)) {
    return { catalogFile, games: [] };
  }

  const parsed = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as unknown;
  const catalog = asRecord(parsed);
  const rawGames = Array.isArray(catalog?.games) ? catalog.games : [];
  const seenIds = new Set<string>();
  const games: PlayGameRouteRecord[] = [];

  for (const rawGame of rawGames) {
    const game = asRecord(rawGame);
    const id = normalizeText(game?.id);
    const moduleFile = normalizeText(game?.moduleFile);
    if (!id || !moduleFile || !isSafeGameId(id) || seenIds.has(id)) {
      continue;
    }

    const modulePath = path.resolve(catalogDir, moduleFile);
    if (
      !isInsideDirectory(catalogDir, modulePath)
      || path.extname(modulePath) !== ".mjs"
      || !fs.existsSync(modulePath)
    ) {
      continue;
    }

    const frameAspect = normalizePair(game?.frameAspect, [9, 6]);
    const grid = normalizePair(game?.grid, frameAspect);
    const stat = fs.statSync(modulePath);
    games.push({
      id,
      label: normalizeText(game?.label) ?? id,
      description: normalizeText(game?.description) ?? undefined,
      moduleFile,
      modulePath,
      frameAspect,
      grid,
      updatedAt: stat.mtime.toISOString(),
      moduleUrl: buildModuleUrl(id, modulePath),
    });
    seenIds.add(id);
  }

  return { catalogFile, games };
}

function rewriteGameModuleImports(source: string): string {
  return source
    .replace(/from\s+(['"])three\/addons\/([^'"]+)\1/g, "from '/api/visualization/libs/three/addons/$2'")
    .replace(/from\s+(['"])three\1/g, "from '/api/visualization/libs/three'");
}

export function registerPlayGameRoutes({ app, projectRoot }: RegisterPlayGameRoutesOptions) {
  app.get("/api/play/games", (_req, res) => {
    try {
      const { games } = readPlayGames(projectRoot);
      return res.json({
        games: games.map(({ modulePath: _modulePath, ...game }) => game),
      });
    } catch (error) {
      console.error("Failed to read Play game catalog:", error);
      return res.status(500).json({ error: "Play game catalog is not available." });
    }
  });

  app.get("/api/play/games/:gameId/module", (req, res) => {
    try {
      const gameId = typeof req.params.gameId === "string" ? req.params.gameId : "";
      if (!isSafeGameId(gameId)) {
        return res.status(400).json({ error: "Invalid game id." });
      }

      const { games } = readPlayGames(projectRoot);
      const game = games.find((candidate) => candidate.id === gameId);
      if (!game) {
        return res.status(404).json({ error: "Play game not found." });
      }

      const source = fs.readFileSync(game.modulePath, "utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.type("application/javascript").send(rewriteGameModuleImports(source));
    } catch (error) {
      console.error("Failed to serve Play game module:", error);
      return res.status(500).json({ error: "Play game module is not available." });
    }
  });
}
