import type { Express } from "express";

type LiveStreamRouteState = {
  captureId: string;
  source: string;
  pollIntervalMs: number;
  frameCount: number;
  lastTick: number | null;
  lineOffset: number;
  lastError: string | null;
  startedAt: string;
};

type EndedCaptureState = {
  captureId: string;
  reason: string;
  detail: string | null;
  endedAt: string;
};

type RegisterLiveDebugRoutesOptions = {
  app: Express;
  liveStreamStates: Map<string, LiveStreamRouteState>;
  buildEndedCaptures: () => EndedCaptureState[];
  buildDebugCaptures: () => { captures: unknown[]; pendingIds: string[] };
  buildDebugState: () => {
    frontendConnected: boolean;
    stateSource: "live" | "persisted" | "empty";
    lastVisualizationStateAt: string | null;
    persistedDashboardStateAt: string | null;
    state: unknown;
  };
  probeCaptureSource: (
    source: string,
    signal: AbortSignal,
  ) => Promise<{ ok: boolean; error?: string }>;
  inferFilename: (source: string) => string;
  startLiveStream: (options: {
    source: string;
    pollIntervalMs: number;
    captureId: string;
    filename: string;
  }) => LiveStreamRouteState;
  stopLiveStream: (captureId: string, reason?: string, detail?: string) => LiveStreamRouteState | null;
  stopAllLiveStreams: (reason?: string, detail?: string) => LiveStreamRouteState[];
  scheduleShutdown: (source: "signal" | "socket" | "api") => void;
  isShuttingDown: () => boolean;
};

export function registerLiveDebugRoutes({
  app,
  liveStreamStates,
  buildEndedCaptures,
  buildDebugCaptures,
  buildDebugState,
  probeCaptureSource,
  inferFilename,
  startLiveStream,
  stopLiveStream,
  stopAllLiveStreams,
  scheduleShutdown,
  isShuttingDown,
}: RegisterLiveDebugRoutesOptions) {
  app.get("/api/live/status", (_req, res) => {
    const streams = Array.from(liveStreamStates.values()).map((state) => ({
      captureId: state.captureId,
      source: state.source,
      pollIntervalMs: state.pollIntervalMs,
      frameCount: state.frameCount,
      lastTick: state.lastTick,
      lineOffset: state.lineOffset,
      lastError: state.lastError,
      startedAt: state.startedAt,
    }));
    const ended = buildEndedCaptures();
    if (streams.length === 0) {
      return res.json({ running: false, streams: [], ended });
    }
    const response: Record<string, unknown> = {
      running: true,
      streams,
      count: streams.length,
      ended,
    };
    if (streams.length === 1) {
      Object.assign(response, streams[0]);
    }
    return res.json(response);
  });

  app.get("/api/debug/captures", (_req, res) => {
    res.json(buildDebugCaptures());
  });

  app.get("/api/debug/state", (_req, res) => {
    res.json(buildDebugState());
  });

  app.post("/api/live/start", async (req, res) => {
    try {
      const source = typeof req.body?.source === "string"
        ? req.body.source
        : typeof req.body?.file === "string"
          ? req.body.file
          : typeof req.body?.endpoint === "string"
            ? req.body.endpoint
            : "";
      const pollIntervalMs = Number(req.body?.pollIntervalMs ?? req.body?.pollInterval ?? 2000);
      let captureId = typeof req.body?.captureId === "string"
        ? req.body.captureId
        : `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const filename = typeof req.body?.filename === "string"
        ? req.body.filename
        : inferFilename(source);

      if (!source.trim()) {
        return res.status(400).json({ error: "Capture file source is required." });
      }
      if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        return res.status(400).json({ error: "Invalid pollIntervalMs value." });
      }
      const sourceCheck = await probeCaptureSource(source.trim(), new AbortController().signal);
      if (!sourceCheck.ok) {
        return res.status(400).json({
          error: sourceCheck.error || "Capture source is not reachable.",
          source: source.trim(),
        });
      }
      if (liveStreamStates.has(captureId)) {
        return res.status(409).json({ error: "Live stream already running for captureId." });
      }

      while (liveStreamStates.has(captureId)) {
        captureId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const state = startLiveStream({
        source: source.trim(),
        pollIntervalMs,
        captureId,
        filename,
      });

      return res.json({
        success: true,
        captureId: state.captureId,
        source: state.source,
        pollIntervalMs: state.pollIntervalMs,
      });
    } catch (error) {
      console.error("Live start error:", error);
      return res.status(500).json({ error: "Failed to start live stream." });
    }
  });

  app.post("/api/live/stop", (req, res) => {
    const captureId = typeof req.body?.captureId === "string" ? req.body.captureId : null;
    if (captureId) {
      const stopped = stopLiveStream(captureId, "live_stop_manual");
      const running = liveStreamStates.size > 0;
      return res.json({
        success: true,
        running,
        captureId: stopped?.captureId ?? null,
        stopped: stopped ? [stopped.captureId] : [],
        notFound: stopped ? [] : [captureId],
      });
    }

    const stopped = stopAllLiveStreams("live_stop_manual");
    const running = liveStreamStates.size > 0;
    return res.json({
      success: true,
      running,
      captureId: stopped[0]?.captureId ?? null,
      stopped: stopped.map((state) => state.captureId),
    });
  });

  app.post("/api/shutdown", (_req, res) => {
    res.status(isShuttingDown() ? 202 : 200).json({ success: true, shuttingDown: true });
    if (!isShuttingDown()) {
      scheduleShutdown("api");
    }
  });
}
