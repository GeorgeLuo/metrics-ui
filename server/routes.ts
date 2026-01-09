import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import type { ComponentNode, ControlCommand, ControlResponse } from "@shared/schema";
import { compactEntities, compactValue, DEFAULT_MAX_NUMERIC_DEPTH } from "@shared/compact";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

interface CaptureRecord {
  tick: number;
  entities: Record<string, Record<string, unknown>>;
}

function buildTree(
  obj: Record<string, unknown>,
  parentPath: string[],
  parentId: string,
): ComponentNode[] {
  const result: ComponentNode[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = [...parentPath, key];
    const id = parentId ? `${parentId}.${key}` : key;

    let valueType: ComponentNode["valueType"] = "null";
    let children: ComponentNode[] = [];

    if (value === null || value === undefined) {
      valueType = "null";
    } else if (typeof value === "number") {
      valueType = "number";
    } else if (typeof value === "string") {
      valueType = "string";
    } else if (typeof value === "boolean") {
      valueType = "boolean";
    } else if (Array.isArray(value)) {
      valueType = "array";
      if (value.length > 0 && typeof value[0] === "object") {
        children = buildTree(value[0] as Record<string, unknown>, path, id);
      }
    } else if (typeof value === "object") {
      valueType = "object";
      children = buildTree(value as Record<string, unknown>, path, id);
    }

    result.push({
      id,
      label: key,
      path,
      children,
      isLeaf: children.length === 0,
      valueType,
    });
  }

  return result;
}

function buildComponentTreeFromEntities(
  entities: Record<string, unknown>,
): ComponentNode[] {
  const nodes: ComponentNode[] = [];

  Object.entries(entities).forEach(([entityId, components]) => {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      return;
    }
    const componentTree = buildTree(components as Record<string, unknown>, [entityId], entityId);
    nodes.push({
      id: entityId,
      label: entityId,
      path: [entityId],
      children: componentTree,
      isLeaf: false,
      valueType: "object",
    });
  });

  return nodes;
}

function mergeValueType(
  existing: ComponentNode["valueType"],
  incoming: ComponentNode["valueType"],
) {
  if (incoming === "null" && existing !== "null") {
    return existing;
  }
  return incoming;
}

function mergeComponentTrees(existing: ComponentNode[], incoming: ComponentNode[]): ComponentNode[] {
  const existingMap = new Map(existing.map((node) => [node.id, node]));
  const merged: ComponentNode[] = [];

  incoming.forEach((node) => {
    const current = existingMap.get(node.id);
    existingMap.delete(node.id);
    if (!current) {
      merged.push(node);
      return;
    }
    const mergedChildren = mergeComponentTrees(current.children, node.children);
    merged.push({
      ...current,
      ...node,
      valueType: mergeValueType(current.valueType, node.valueType),
      children: mergedChildren,
      isLeaf: mergedChildren.length === 0,
    });
  });

  existingMap.forEach((node) => merged.push(node));
  return merged;
}

function mergeEntities(
  target: Record<string, Record<string, unknown>>,
  source: Record<string, Record<string, unknown>>,
) {
  Object.entries(source).forEach(([entityId, components]) => {
    if (!target[entityId]) {
      target[entityId] = {};
    }
    Object.entries(components).forEach(([componentId, componentValue]) => {
      target[entityId][componentId] = componentValue;
    });
  });
}

function parseJSONL(content: string): { records: CaptureRecord[]; components: ComponentNode[] } {
  const lines = content.trim().split('\n');
  const frames = new Map<number, CaptureRecord>();
  let components: ComponentNode[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      if (
        Number.isFinite(parsed.tick) &&
        parsed.entities &&
        typeof parsed.entities === "object" &&
        !Array.isArray(parsed.entities)
      ) {
        const rawComponents = buildComponentTreeFromEntities(parsed.entities);
        components = mergeComponentTrees(components, rawComponents);
        const entities = compactEntities(parsed.entities, DEFAULT_MAX_NUMERIC_DEPTH);
        const frame = frames.get(parsed.tick) ?? { tick: parsed.tick, entities: {} };
        mergeEntities(frame.entities, entities);
        frames.set(parsed.tick, frame);
        continue;
      }

      if (
        Number.isFinite(parsed.tick) &&
        typeof parsed.entityId === "string" &&
        typeof parsed.componentId === "string"
      ) {
        const rawEntities: Record<string, Record<string, unknown>> = {
          [parsed.entityId]: {
            [parsed.componentId]: parsed.value,
          },
        };
        const rawComponents = buildComponentTreeFromEntities(rawEntities);
        components = mergeComponentTrees(components, rawComponents);
        const compactedValue = compactValue(parsed.value, 1, DEFAULT_MAX_NUMERIC_DEPTH);
        if (compactedValue === undefined) {
          continue;
        }
        const frame = frames.get(parsed.tick) ?? { tick: parsed.tick, entities: {} };
        if (!frame.entities[parsed.entityId]) {
          frame.entities[parsed.entityId] = {};
        }
        frame.entities[parsed.entityId][parsed.componentId] = compactedValue;
        frames.set(parsed.tick, frame);
      }
    } catch (e) {
      console.error("Failed to parse line:", e);
    }
  }

  return {
    records: Array.from(frames.values()).sort((a, b) => a.tick - b.tick),
    components,
  };
}

const agentClients = new Set<WebSocket>();
let frontendClient: WebSocket | null = null;
const pendingClients = new Map<WebSocket, boolean>();

interface LiveStreamState {
  captureId: string;
  filename: string;
  source: string;
  pollIntervalMs: number;
  controller: AbortController;
  timer: NodeJS.Timeout | null;
  startedAt: string;
  frameCount: number;
  lastTick: number | null;
  lineOffset: number;
  lastError: string | null;
  isPolling: boolean;
}

let liveStreamState: LiveStreamState | null = null;

function broadcastToAgents(message: ControlResponse) {
  const data = JSON.stringify(message);
  agentClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function sendToFrontend(command: ControlCommand): boolean {
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    return false;
  }
  frontendClient.send(JSON.stringify(command));
  return true;
}

function normalizeEntities(value: unknown): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }
  for (const [entityId, components] of Object.entries(value as Record<string, unknown>)) {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      continue;
    }
    result[entityId] = { ...(components as Record<string, unknown>) };
  }
  return result;
}

function parseLineToFrame(line: string): CaptureRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const tick = (parsed as { tick?: number }).tick;
  if (!Number.isFinite(tick)) {
    return null;
  }
  const entities = (parsed as { entities?: unknown }).entities;
  if (entities && typeof entities === "object" && !Array.isArray(entities)) {
    return { tick, entities: normalizeEntities(entities) };
  }
  const entityId = (parsed as { entityId?: unknown }).entityId;
  const componentId = (parsed as { componentId?: unknown }).componentId;
  if (typeof entityId === "string" && typeof componentId === "string") {
    return {
      tick,
      entities: {
        [entityId]: {
          [componentId]: (parsed as { value?: unknown }).value,
        },
      },
    };
  }
  return null;
}

function splitCaptureLines(content: string) {
  const lines = content.split("\n");
  if (lines.length === 0) {
    return { lines, completeCount: 0 };
  }
  let completeCount = lines.length;
  const last = lines[lines.length - 1];
  if (!last || last.trim() === "") {
    completeCount -= 1;
  } else {
    try {
      JSON.parse(last);
    } catch {
      completeCount -= 1;
    }
  }
  return { lines, completeCount: Math.max(0, completeCount) };
}

async function loadCaptureContent(source: string, signal: AbortSignal): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Capture file source is required.");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const response = await fetch(trimmed, { signal });
    if (!response.ok) {
      throw new Error(`Capture fetch failed (${response.status})`);
    }
    return response.text();
  }
  const filePath = resolveLocalCapturePath(trimmed);
  return fs.promises.readFile(filePath, "utf-8");
}

function resolveLocalCapturePath(source: string) {
  if (source.startsWith("file://")) {
    return fileURLToPath(source);
  }
  if (path.isAbsolute(source)) {
    return source;
  }

  const cwdPath = path.resolve(process.cwd(), source);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  const parentPath = path.resolve(process.cwd(), "..", source);
  if (fs.existsSync(parentPath)) {
    return parentPath;
  }

  return cwdPath;
}

async function probeCaptureSource(source: string, signal: AbortSignal) {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, error: "Capture file source is required." };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const response = await fetch(trimmed, { method: "HEAD", signal });
      if (response.ok) {
        const size = Number(response.headers.get("content-length"));
        return {
          ok: true,
          status: response.status,
          size: Number.isFinite(size) ? size : undefined,
        };
      }

      if (response.status === 405 || response.status === 501) {
        const rangeResponse = await fetch(trimmed, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal,
        });
        if (rangeResponse.ok || rangeResponse.status === 206) {
          const size = Number(rangeResponse.headers.get("content-length"));
          return {
            ok: true,
            status: rangeResponse.status,
            size: Number.isFinite(size) ? size : undefined,
          };
        }
      }

      return {
        ok: false,
        status: response.status,
        error: `Capture source not reachable (${response.status})`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const filePath = resolveLocalCapturePath(trimmed);
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      return { ok: false, error: "Capture source is not a file." };
    }
    return {
      ok: true,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      path: filePath,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pollLiveCapture(state: LiveStreamState) {
  if (!liveStreamState || liveStreamState.captureId !== state.captureId) {
    return;
  }
  if (state.isPolling) {
    return;
  }
  state.isPolling = true;

  try {
    const content = await loadCaptureContent(state.source, state.controller.signal);
    if (!liveStreamState || liveStreamState.captureId !== state.captureId) {
      return;
    }
    const { lines, completeCount } = splitCaptureLines(content);
    if (completeCount < state.lineOffset) {
      state.lineOffset = 0;
      state.frameCount = 0;
      state.lastTick = null;
      sendToFrontend({
        type: "capture_init",
        captureId: state.captureId,
        filename: state.filename,
      });
    }

    for (let i = state.lineOffset; i < completeCount; i += 1) {
      const frame = parseLineToFrame(lines[i] ?? "");
      if (!frame) {
        continue;
      }
      state.frameCount += 1;
      state.lastTick = frame.tick;
      sendToFrontend({ type: "capture_append", captureId: state.captureId, frame });
    }
    state.lineOffset = completeCount;
    state.lastError = null;
  } catch (error) {
    if (!(state.controller.signal.aborted && (error as Error).name === "AbortError")) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    state.isPolling = false;
    if (liveStreamState?.captureId === state.captureId) {
      state.timer = setTimeout(() => {
        pollLiveCapture(state).catch((pollError) => {
          console.error("[live] Poll error:", pollError);
        });
      }, state.pollIntervalMs);
    }
  }
}

function inferFilename(source: string) {
  try {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      const url = new URL(source);
      const base = path.basename(url.pathname);
      return base || "live-capture.jsonl";
    }
    if (source.startsWith("file://")) {
      const base = path.basename(fileURLToPath(source));
      return base || "live-capture.jsonl";
    }
  } catch {
    // ignore
  }
  const base = path.basename(source);
  return base || "live-capture.jsonl";
}

function startLiveStream({
  source,
  captureId,
  filename,
  pollIntervalMs,
}: {
  source: string;
  captureId: string;
  filename: string;
  pollIntervalMs: number;
}) {
  if (liveStreamState) {
    throw new Error("Live stream already running.");
  }
  const controller = new AbortController();
  const state: LiveStreamState = {
    captureId,
    filename,
    source,
    pollIntervalMs,
    controller,
    timer: null,
    startedAt: new Date().toISOString(),
    frameCount: 0,
    lastTick: null,
    lineOffset: 0,
    lastError: null,
    isPolling: false,
  };
  if (!sendToFrontend({ type: "capture_init", captureId, filename })) {
    throw new Error("Frontend not connected.");
  }
  liveStreamState = state;
  pollLiveCapture(state).catch((error) => {
    console.error("[live] Poll error:", error);
  });
  return state;
}

function stopLiveStream() {
  if (!liveStreamState) {
    return null;
  }
  const state = liveStreamState;
  state.controller.abort();
  if (state.timer) {
    clearTimeout(state.timer);
  }
  liveStreamState = null;
  sendToFrontend({ type: "capture_end", captureId: state.captureId });
  return state;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use((_req, res, next) => {
    res.setHeader("X-Metrics-UI-Agent-WS", "/ws/control");
    res.setHeader("X-Metrics-UI-Agent-Docs", "/USAGE.md");
    res.setHeader(
      "X-Metrics-UI-Agent-Register",
      "{\"type\":\"register\",\"role\":\"agent\"}",
    );
    next();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/control")) {
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    pendingClients.set(ws, true);
    console.log("[ws] New connection, awaiting registration");

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "register") {
          pendingClients.delete(ws);
          if (message.role === "frontend") {
            frontendClient = ws;
            console.log("[ws] Frontend registered");
            ws.send(JSON.stringify({ type: "ack", payload: "registered as frontend" }));
          } else {
            agentClients.add(ws);
            console.log("[ws] Agent registered, total agents:", agentClients.size);
            ws.send(JSON.stringify({ type: "ack", payload: "registered as agent" }));
          }
          return;
        }

        if (pendingClients.has(ws)) {
          ws.send(JSON.stringify({ 
            type: "error", 
            error: "Must register first with {type:'register', role:'frontend'|'agent'}",
            request_id: message.request_id,
          } as ControlResponse));
          return;
        }

        const isFrontend = ws === frontendClient;
        
        if (isFrontend) {
          broadcastToAgents(message as ControlResponse);
        } else if (!isFrontend) {
          if (frontendClient && frontendClient.readyState === WebSocket.OPEN) {
            frontendClient.send(JSON.stringify(message));
          } else {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: "Frontend not connected",
              request_id: message.request_id,
            } as ControlResponse));
          }
        }
      } catch (e) {
        ws.send(JSON.stringify({ 
          type: "error", 
          error: "Invalid message format" 
        } as ControlResponse));
      }
    });

    ws.on("close", () => {
      pendingClients.delete(ws);
      if (ws === frontendClient) {
        frontendClient = null;
        if (liveStreamState) {
          stopLiveStream();
        }
        console.log("[ws] Frontend disconnected");
      } else {
        agentClients.delete(ws);
        console.log("[ws] Agent disconnected, remaining:", agentClients.size);
      }
    });

    ws.on("error", (err) => {
      console.error("[ws] Error:", err);
    });
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  function findUsageMd(): string | null {
    const possiblePaths = [
      path.resolve(__dirname, 'USAGE.md'),
      path.resolve(__dirname, '..', 'USAGE.md'),
      path.join(process.cwd(), 'USAGE.md'),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  app.get('/api/docs', (_req, res) => {
    try {
      const usageMdPath = findUsageMd();
      if (usageMdPath) {
        const content = fs.readFileSync(usageMdPath, 'utf-8');
        res.json({ content });
      } else {
        res.status(404).json({ error: 'Documentation file not found' });
      }
    } catch (error) {
      console.error('Failed to read USAGE.md:', error);
      res.status(500).json({ error: 'Documentation not available' });
    }
  });

  app.get('/USAGE.md', (_req, res) => {
    try {
      const usageMdPath = findUsageMd();
      if (usageMdPath) {
        const content = fs.readFileSync(usageMdPath, 'utf-8');
        res.type('text/markdown').send(content);
      } else {
        res.status(404).send('Documentation file not found');
      }
    } catch (error) {
      console.error('Failed to read USAGE.md:', error);
      res.status(500).send('Documentation not available');
    }
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const content = req.file.buffer.toString('utf-8');
      const { records, components } = parseJSONL(content);
      
      if (records.length === 0) {
        return res.status(400).json({ error: 'No valid records found in file' });
      }

      const tickCount = records.length;
      const entityIdSet = new Set<string>();
      const componentIdSet = new Set<string>();
      records.forEach((record) => {
        Object.entries(record.entities).forEach(([entityId, components]) => {
          entityIdSet.add(entityId);
          if (components && typeof components === "object") {
            Object.keys(components).forEach((componentId) => {
              componentIdSet.add(componentId);
            });
          }
        });
      });
      const entityIds = [...entityIdSet];
      const componentIds = [...componentIdSet];

      res.json({
        success: true,
        filename: req.file.originalname,
        size: req.file.size,
        tickCount,
        records,
        components,
        entityIds,
        componentIds,
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to process file' });
    }
  });

  app.post("/api/source/check", async (req, res) => {
    const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
    if (!source) {
      return res.status(400).json({ ok: false, error: "Capture file source is required." });
    }

    const result = await probeCaptureSource(source, new AbortController().signal);
    return res.json({ ...result, source });
  });

  app.post("/api/source/load", async (req, res) => {
    try {
      const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
      if (!source) {
        return res.status(400).json({ error: "Capture file source is required." });
      }

      const content = await loadCaptureContent(source, new AbortController().signal);
      const { records, components } = parseJSONL(content);

      if (records.length === 0) {
        return res.status(400).json({ error: "No valid records found in file" });
      }

      const tickCount = records.length;
      const entityIdSet = new Set<string>();
      const componentIdSet = new Set<string>();
      records.forEach((record) => {
        Object.entries(record.entities).forEach(([entityId, components]) => {
          entityIdSet.add(entityId);
          if (components && typeof components === "object") {
            Object.keys(components).forEach((componentId) => {
              componentIdSet.add(componentId);
            });
          }
        });
      });
      const entityIds = [...entityIdSet];
      const componentIds = [...componentIdSet];

      res.json({
        success: true,
        filename: inferFilename(source),
        size: Buffer.byteLength(content, "utf-8"),
        tickCount,
        records,
        components,
        entityIds,
        componentIds,
      });
    } catch (error) {
      console.error("Source load error:", error);
      res.status(500).json({ error: "Failed to load capture source." });
    }
  });

  app.get("/api/live/status", (_req, res) => {
    if (!liveStreamState) {
      return res.json({ running: false });
    }
    return res.json({
      running: true,
      captureId: liveStreamState.captureId,
      source: liveStreamState.source,
      pollIntervalMs: liveStreamState.pollIntervalMs,
      frameCount: liveStreamState.frameCount,
      lastTick: liveStreamState.lastTick,
      lineOffset: liveStreamState.lineOffset,
      lastError: liveStreamState.lastError,
      startedAt: liveStreamState.startedAt,
    });
  });

  app.post("/api/live/start", (req, res) => {
    try {
      const source = typeof req.body?.source === "string"
        ? req.body.source
        : typeof req.body?.file === "string"
          ? req.body.file
          : typeof req.body?.endpoint === "string"
            ? req.body.endpoint
            : "";
      const pollIntervalMs = Number(req.body?.pollIntervalMs ?? req.body?.pollInterval ?? 2000);
      const captureId =
        typeof req.body?.captureId === "string"
          ? req.body.captureId
          : `live-${Date.now()}`;
      const filename =
        typeof req.body?.filename === "string"
          ? req.body.filename
          : inferFilename(source);

      if (!source.trim()) {
        return res.status(400).json({ error: "Capture file source is required." });
      }
      if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        return res.status(400).json({ error: "Invalid pollIntervalMs value." });
      }
      if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
        return res.status(409).json({ error: "Frontend not connected." });
      }
      if (liveStreamState) {
        return res.status(409).json({ error: "Live stream already running." });
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

  app.post("/api/live/stop", (_req, res) => {
    if (!liveStreamState) {
      return res.json({ success: true, running: false });
    }
    const stopped = stopLiveStream();
    return res.json({
      success: true,
      running: false,
      captureId: stopped?.captureId ?? null,
    });
  });

  return httpServer;
}
