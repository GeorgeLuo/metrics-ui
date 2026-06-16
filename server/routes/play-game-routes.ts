import type { Express, Response } from "express";
import { transformSync } from "esbuild";
import * as fs from "fs";
import * as path from "path";
import {
  normalizePlayGameCatalog,
  type PlayPair,
} from "@shared/play-catalog";
import { registerPlayChaseActorViewImageRoute } from "./play-chase-actor-view-image";

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
const PLAY_GAME_RUNTIME_MODULE_EXTENSIONS = new Set([".mjs", ".ts"]);

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

function isPlayGameRuntimeModule(filePath: string): boolean {
  return PLAY_GAME_RUNTIME_MODULE_EXTENSIONS.has(path.extname(filePath));
}

function collectPlayGameRuntimeModules(directoryPath: string, files: Set<string>) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return;
  }

  fs.readdirSync(directoryPath, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      collectPlayGameRuntimeModules(entryPath, files);
      return;
    }
    if (entry.isFile() && isPlayGameRuntimeModule(entryPath)) {
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
  const rawGames = normalizePlayGameCatalog(parsed, { moduleField: "moduleFile" });
  const seenIds = new Set<string>();
  const games: PlayGameRouteRecord[] = [];

  for (const rawGame of rawGames) {
    const id = rawGame.id;
    const moduleFile = rawGame.moduleFile;
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

    const stat = fs.statSync(modulePath);
    games.push({
      id,
      label: rawGame.label,
      description: rawGame.description,
      moduleFile,
      modulePath,
      frameAspect: rawGame.frameAspect,
      grid: rawGame.grid,
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

function buildServedGameModuleSource(filePath: string, source: string): string {
  const rewrittenSource = rewriteGameModuleImports(source);
  if (path.extname(filePath) !== ".ts") {
    return rewrittenSource;
  }

  return transformSync(rewrittenSource, {
    format: "esm",
    loader: "ts",
    sourcefile: filePath,
    target: "es2020",
  }).code;
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
    || !isPlayGameRuntimeModule(filePath)
    || !fs.existsSync(filePath)
    || !fs.statSync(filePath).isFile()
  ) {
    return res.status(404).json({ error: "Play game module file not found." });
  }

  const source = fs.readFileSync(filePath, "utf-8");
  res.setHeader("Cache-Control", "no-cache");
  return res.type("application/javascript").send(buildServedGameModuleSource(filePath, source));
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
    catalogDirs.forEach((catalogDir) => collectPlayGameRuntimeModules(catalogDir, files));
  } catch {
    // Keep watching the catalog file even while it is temporarily invalid during edits.
  }

  return Array.from(files);
}

export function registerPlayGameRoutes({ app, projectRoot }: RegisterPlayGameRoutesOptions) {
  registerPlayChaseActorViewImageRoute({ app, projectRoot });

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
