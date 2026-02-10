import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

if (process.env.NODE_ENV !== "production") {
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const shouldLogBody = process.env.LOG_API_BODY === "true";
        if (shouldLogBody) {
          // Still guard against megabyte-scale payload logs.
          let serialized = "";
          try {
            serialized = JSON.stringify(capturedJsonResponse);
          } catch {
            serialized = "[unserializable json]";
          }
          const limit = 2000;
          logLine += ` :: ${
            serialized.length > limit
              ? `${serialized.slice(0, limit)}... (${serialized.length} chars)`
              : serialized
          }`;
        } else {
          const body = capturedJsonResponse as any;
          const summary: Record<string, unknown> = {};

          if (typeof body.success === "boolean") summary.success = body.success;
          if (typeof body.error === "string") summary.error = body.error;
          if (typeof body.message === "string") summary.message = body.message;
          if (typeof body.captureId === "string") summary.captureId = body.captureId;
          if (typeof body.streaming === "boolean") summary.streaming = body.streaming;
          if (typeof body.running === "boolean") summary.running = body.running;
          if (typeof body.tickCount === "number") summary.tickCount = body.tickCount;
          if (typeof body.count === "number") summary.count = body.count;

          if (Array.isArray(body.plugins)) {
            summary.pluginsCount = body.plugins.length;
          }

          if (Array.isArray(body.streams)) {
            summary.streamsCount = body.streams.length;
            summary.streams = body.streams
              .map((s: any) => (s && typeof s.captureId === "string" ? s.captureId : "?"))
              .slice(0, 8);
          }

          if (Array.isArray(body.series)) {
            summary.seriesCount = body.series.length;
            summary.pointsCount = body.series.reduce((acc: number, entry: any) => {
              if (entry && Array.isArray(entry.points)) {
                return acc + entry.points.length;
              }
              return acc;
            }, 0);
          }

          if (Object.keys(summary).length > 0) {
            logLine += ` :: ${JSON.stringify(summary)}`;
          }
        }
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT.
  // Default to 5050 if not specified.
  // This serves both the API and the client.
  const port = parseInt(process.env.PORT || "5050", 10);
  const host = process.env.HOST || "127.0.0.1";
  const reusePort = process.env.REUSE_PORT === "true";
  httpServer.listen(
    {
      port,
      host,
      reusePort,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
