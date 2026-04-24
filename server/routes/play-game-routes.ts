import type { Express, Response } from "express";
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

function encodePathSegments(filePath: string): string {
  return filePath
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildModuleUrl(gameId: string, catalogDir: string, modulePath: string): string {
  const stat = fs.statSync(modulePath);
  const moduleFilePath = encodePathSegments(path.relative(catalogDir, modulePath));
  return `/api/play/games/${encodeURIComponent(gameId)}/files/${moduleFilePath}?v=${Math.floor(stat.mtimeMs)}`;
}

function collectMjsFiles(directoryPath: string, files: Set<string>) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return;
  }

  fs.readdirSync(directoryPath, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      collectMjsFiles(entryPath, files);
      return;
    }
    if (entry.isFile() && path.extname(entryPath) === ".mjs") {
      files.add(entryPath);
    }
  });
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
      moduleUrl: buildModuleUrl(id, catalogDir, modulePath),
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

function findPlayGame(projectRoot: string, gameId: string) {
  const { catalogFile, games } = readPlayGames(projectRoot);
  const game = games.find((candidate) => candidate.id === gameId);
  return game ? { catalogFile, game } : null;
}

function servePlayGameModuleFile({
  projectRoot,
  gameId,
  requestedFile,
  res,
}: {
  projectRoot: string;
  gameId: string;
  requestedFile: string;
  res: Response;
}) {
  const match = findPlayGame(projectRoot, gameId);
  if (!match) {
    return res.status(404).json({ error: "Play game not found." });
  }

  const catalogDir = path.dirname(match.catalogFile);
  const filePath = path.resolve(catalogDir, requestedFile);
  if (
    !isInsideDirectory(catalogDir, filePath)
    || path.extname(filePath) !== ".mjs"
    || !fs.existsSync(filePath)
    || !fs.statSync(filePath).isFile()
  ) {
    return res.status(404).json({ error: "Play game module file not found." });
  }

  const source = fs.readFileSync(filePath, "utf-8");
  res.setHeader("Cache-Control", "no-cache");
  return res.type("application/javascript").send(rewriteGameModuleImports(source));
}

export function getPlayGameWatchFiles(projectRoot: string): string[] {
  const catalogFile = resolvePlayGameCatalogFile(projectRoot);
  const files = new Set<string>([catalogFile]);

  try {
    const { games } = readPlayGames(projectRoot);
    const catalogDirs = new Set<string>();
    games.forEach((game) => {
      files.add(game.modulePath);
      catalogDirs.add(path.dirname(game.modulePath));
    });
    catalogDirs.forEach((catalogDir) => collectMjsFiles(catalogDir, files));
  } catch {
    // Keep watching the catalog file even while it is temporarily invalid during edits.
  }

  return Array.from(files);
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

      const match = findPlayGame(projectRoot, gameId);
      if (!match) {
        return res.status(404).json({ error: "Play game not found." });
      }

      return res.redirect(307, match.game.moduleUrl);
    } catch (error) {
      console.error("Failed to serve Play game module:", error);
      return res.status(500).json({ error: "Play game module is not available." });
    }
  });

  app.get("/api/play/games/:gameId/files/*", (req, res) => {
    try {
      const gameId = typeof req.params.gameId === "string" ? req.params.gameId : "";
      if (!isSafeGameId(gameId)) {
        return res.status(400).json({ error: "Invalid game id." });
      }

      const wildcardParams = req.params as Record<string, string | undefined>;
      const requestedFile = typeof wildcardParams[0] === "string" ? wildcardParams[0] : "";
      return servePlayGameModuleFile({
        projectRoot,
        gameId,
        requestedFile,
        res,
      });
    } catch (error) {
      console.error("Failed to serve Play game module:", error);
      return res.status(500).json({ error: "Play game module is not available." });
    }
  });
}
