import { type Express } from "express";
import { createServer as createViteServer, createLogger, type ViteDevServer } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getPlayGameWatchFiles } from "./routes/play-game-routes";

const viteLogger = createLogger();
const PLAY_GAME_RELOAD_DEBOUNCE_MS = 75;

function normalizeWatchPath(filePath: string): string {
  return path.resolve(filePath);
}

function setupPlayGameReloadWatcher(vite: ViteDevServer) {
  const watchedFiles = new Set<string>();
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshWatchedFiles = () => {
    const files = getPlayGameWatchFiles(process.cwd()).map(normalizeWatchPath);
    files.forEach((file) => watchedFiles.add(file));
    vite.watcher.add(files);
  };

  const handlePlayGameFileChange = (filePath: string) => {
    const normalizedFilePath = normalizeWatchPath(filePath);
    if (!watchedFiles.has(normalizedFilePath)) {
      return;
    }

    refreshWatchedFiles();
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      vite.ws.send({ type: "full-reload" });
    }, PLAY_GAME_RELOAD_DEBOUNCE_MS);
  };

  refreshWatchedFiles();
  vite.watcher.on("change", handlePlayGameFileChange);
  vite.watcher.on("unlink", handlePlayGameFileChange);
}

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Keep the dev server alive. Vite can surface many recoverable errors (HMR, runtime overlays,
        // transient filesystem/network issues) and exiting the whole UI server makes the UX brittle.
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  setupPlayGameReloadWatcher(vite);

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
