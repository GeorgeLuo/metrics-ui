import type { Express } from "express";
import { createServer, type Server } from "http";
import type { Socket } from "net";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import type { CaptureAppendFrame, ComponentNode, ControlCommand, ControlResponse } from "@shared/schema";
import { compactEntities, compactValue, DEFAULT_MAX_NUMERIC_DEPTH } from "@shared/compact";
import { buildComponentTreeFromEntities, mergeComponentTrees, pruneComponentTree } from "@shared/component-tree";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";
import crypto from "crypto";

const UPLOAD_ROOT = path.join(os.homedir(), ".simeval", "metrics-ui", "uploads");
const UPLOAD_INDEX_FILE = path.join(UPLOAD_ROOT, "index.json");
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(UPLOAD_ROOT, { recursive: true }, (error) => {
        cb(error ?? null, UPLOAD_ROOT);
      });
    },
    filename: (_req, file, cb) => {
      const baseName = path.basename(file.originalname || "capture.jsonl");
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      cb(null, `${suffix}-${baseName}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
});
const LIVE_INACTIVITY_MIN_MS = 15000;
const LIVE_INACTIVITY_MULTIPLIER = 5;

interface CaptureRecord {
  tick: number;
  entities: Record<string, Record<string, unknown>>;
}

type UploadIndexEntry = {
  path: string;
  size: number;
  filename?: string;
  createdAt: string;
};

type UploadIndex = Record<string, UploadIndexEntry>;

function loadUploadIndex(): UploadIndex {
  try {
    const raw = fs.readFileSync(UPLOAD_INDEX_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as UploadIndex;
  } catch (error) {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function saveUploadIndex(index: UploadIndex) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  fs.writeFileSync(UPLOAD_INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
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

function applyParsedCaptureRecord(
  parsed: Record<string, unknown>,
  frames: Map<number, CaptureRecord>,
  components: ComponentNode[],
) {
  if (
    Number.isFinite(parsed.tick) &&
    parsed.entities &&
    typeof parsed.entities === "object" &&
    !Array.isArray(parsed.entities)
  ) {
    const rawComponents = buildComponentTreeFromEntities(parsed.entities as Record<string, unknown>);
    const nextComponents = mergeComponentTrees(components, rawComponents);
    const entities = compactEntities(
      parsed.entities as Record<string, Record<string, unknown>>,
      DEFAULT_MAX_NUMERIC_DEPTH,
    );
    const frame = frames.get(parsed.tick as number) ?? { tick: parsed.tick as number, entities: {} };
    mergeEntities(frame.entities, entities);
    frames.set(parsed.tick as number, frame);
    return nextComponents;
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
    const nextComponents = mergeComponentTrees(components, rawComponents);
    const compactedValue = compactValue(parsed.value, 1, DEFAULT_MAX_NUMERIC_DEPTH);
    if (compactedValue === undefined) {
      return nextComponents;
    }
    const frame = frames.get(parsed.tick as number) ?? { tick: parsed.tick as number, entities: {} };
    if (!frame.entities[parsed.entityId]) {
      frame.entities[parsed.entityId] = {};
    }
    frame.entities[parsed.entityId][parsed.componentId] = compactedValue;
    frames.set(parsed.tick as number, frame);
    return nextComponents;
  }

  return components;
}

function parseJSONL(content: string): { records: CaptureRecord[]; components: ComponentNode[] } {
  const lines = content.trim().split("\n");
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
      components = applyParsedCaptureRecord(parsed as Record<string, unknown>, frames, components);
    } catch (e) {
      console.error("Failed to parse line:", e);
    }
  }

  return {
    records: Array.from(frames.values()).sort((a, b) => a.tick - b.tick),
    components,
  };
}

type LineConsumerResult = {
  bytesRead: number;
  lineCount: number;
  remainder: string;
};

function createAbortError() {
  const error = new Error("AbortError");
  error.name = "AbortError";
  return error;
}

async function consumeLineStream(options: {
  readable: Readable;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
}): Promise<LineConsumerResult> {
  const { readable, signal, onLine } = options;
  let remainder = options.initialRemainder ?? "";
  let bytesRead = 0;
  let lineCount = 0;
  const abortHandler = () => {
    readable.destroy(createAbortError());
  };

  if (signal) {
    if (signal.aborted) {
      abortHandler();
    } else {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  try {
    for await (const chunk of readable) {
      const chunkText = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
      bytesRead += Buffer.byteLength(chunkText, "utf-8");
      const combined = remainder + chunkText;
      const parts = combined.split("\n");
      remainder = parts.pop() ?? "";
      for (const part of parts) {
        lineCount += 1;
        onLine(part);
      }
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  }

  return { bytesRead, lineCount, remainder };
}

async function streamLinesFromFile(options: {
  filePath: string;
  startOffset: number;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
}): Promise<LineConsumerResult> {
  const stream = fs.createReadStream(options.filePath, {
    start: options.startOffset,
    encoding: "utf-8",
  });
  return consumeLineStream({
    readable: stream,
    initialRemainder: options.initialRemainder,
    signal: options.signal,
    onLine: options.onLine,
  });
}

async function streamLinesFromResponse(options: {
  response: Response;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
}): Promise<LineConsumerResult> {
  if (!options.response.body) {
    const text = await options.response.text();
    const readable = Readable.from([text], { encoding: "utf-8" });
    return consumeLineStream({
      readable,
      initialRemainder: options.initialRemainder,
      signal: options.signal,
      onLine: options.onLine,
    });
  }

  const readable = Readable.fromWeb(options.response.body as unknown as ReadableStream<Uint8Array>);
  return consumeLineStream({
    readable,
    initialRemainder: options.initialRemainder,
    signal: options.signal,
    onLine: options.onLine,
  });
}

async function parseJSONLFromSource(source: string, signal: AbortSignal) {
  const frames = new Map<number, CaptureRecord>();
  let components: ComponentNode[] = [];
  const onLine = (line: string) => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      components = applyParsedCaptureRecord(parsed as Record<string, unknown>, frames, components);
    } catch (error) {
      console.error("Failed to parse line:", error);
    }
  };

  let sizeBytes = 0;
  const trimmed = source.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const response = await fetch(trimmed, { signal });
    if (!response.ok) {
      throw new Error(`Capture fetch failed (${response.status})`);
    }
    const result = await streamLinesFromResponse({
      response,
      signal,
      onLine,
    });
    sizeBytes = result.bytesRead;
  } else {
    const filePath = resolveLocalCapturePath(trimmed);
    const result = await streamLinesFromFile({
      filePath,
      startOffset: 0,
      initialRemainder: "",
      signal,
      onLine,
    });
    sizeBytes = result.bytesRead;
  }

  return {
    records: Array.from(frames.values()).sort((a, b) => a.tick - b.tick),
    components,
    sizeBytes,
  };
}

function normalizePathInput(pathInput: unknown): string[] | null {
  if (Array.isArray(pathInput)) {
    const filtered = pathInput.filter((item) => typeof item === "string") as string[];
    return filtered.length > 0 ? filtered : null;
  }
  if (typeof pathInput === "string" && pathInput.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(pathInput);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((item) => typeof item === "string") as string[];
        return filtered.length > 0 ? filtered : null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function getValueAtPath(source: unknown, path: string[]): unknown {
  let current: unknown = source;
  for (const part of path) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

async function extractSeriesFromSource(options: {
  source: string;
  path: string[];
  signal: AbortSignal;
}) {
  const pointsByTick = new Map<number, number | null>();
  const { source, path, signal } = options;

  const onLine = (line: string) => {
    if (!line.trim()) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const tick = (parsed as { tick?: number }).tick;
    if (!Number.isFinite(tick)) {
      return;
    }
    const numericTick = tick as number;

    const entities = (parsed as { entities?: unknown }).entities;
    if (entities && typeof entities === "object" && !Array.isArray(entities)) {
      const rawValue = getValueAtPath(entities, path);
      const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
      pointsByTick.set(numericTick, value);
      return;
    }

    const entityId = (parsed as { entityId?: unknown }).entityId;
    const componentId = (parsed as { componentId?: unknown }).componentId;
    if (typeof entityId === "string" && typeof componentId === "string") {
      if (path.length >= 2 && path[0] === entityId && path[1] === componentId) {
        const valueSource = (parsed as { value?: unknown }).value;
        const rawValue =
          path.length === 2 ? valueSource : getValueAtPath(valueSource, path.slice(2));
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
        pointsByTick.set(numericTick, value);
      }
    }
  };

  const trimmed = source.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const response = await fetch(trimmed, { signal });
    if (!response.ok) {
      throw new Error(`Capture fetch failed (${response.status})`);
    }
    await streamLinesFromResponse({ response, signal, onLine });
  } else {
    const filePath = resolveLocalCapturePath(trimmed);
    await streamLinesFromFile({ filePath, startOffset: 0, initialRemainder: "", signal, onLine });
  }

  const points = Array.from(pointsByTick.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tickValue, value]) => ({ tick: tickValue, value }));

  const numericCount = points.reduce(
    (total, point) => total + (typeof point.value === "number" ? 1 : 0),
    0,
  );
  const lastTick = points.length > 0 ? points[points.length - 1].tick : null;
  return { points, numericCount, lastTick, tickCount: points.length };
}

function extractRawComponents(
  parsed: Record<string, unknown>,
  entityIdSet: Set<string>,
  componentIdSet: Set<string>,
): ComponentNode[] {
  if (
    Number.isFinite(parsed.tick) &&
    parsed.entities &&
    typeof parsed.entities === "object" &&
    !Array.isArray(parsed.entities)
  ) {
    const entities = parsed.entities as Record<string, unknown>;
    const rawComponents = buildComponentTreeFromEntities(entities);
    Object.entries(entities).forEach(([entityId, entityComponents]) => {
      entityIdSet.add(entityId);
      if (entityComponents && typeof entityComponents === "object" && !Array.isArray(entityComponents)) {
        Object.keys(entityComponents).forEach((componentId) => componentIdSet.add(componentId));
      }
    });
    return rawComponents;
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
    entityIdSet.add(parsed.entityId);
    componentIdSet.add(parsed.componentId);
    return rawComponents;
  }

  return [];
}

function applyParsedComponents(
  parsed: Record<string, unknown>,
  components: ComponentNode[],
  entityIdSet: Set<string>,
  componentIdSet: Set<string>,
) {
  const rawComponents = extractRawComponents(parsed, entityIdSet, componentIdSet);
  if (rawComponents.length === 0) {
    return components;
  }
  return mergeComponentTrees(components, rawComponents);
}

const COMPONENT_SCAN_EMIT_MS = 300;

async function scanComponentsFromSource(
  source: string,
  signal: AbortSignal,
  options: {
    onComponents?: (components: ComponentNode[]) => void;
  } = {},
) {
  let components: ComponentNode[] = [];
  const entityIdSet = new Set<string>();
  const componentIdSet = new Set<string>();
  let pendingComponents: ComponentNode[] = [];
  let pendingTimer: NodeJS.Timeout | null = null;

  const flushPending = () => {
    if (!options.onComponents || pendingComponents.length === 0) {
      return;
    }
    options.onComponents(pendingComponents);
    pendingComponents = [];
  };

  const queueEmit = (rawComponents: ComponentNode[]) => {
    if (!options.onComponents || rawComponents.length === 0) {
      return;
    }
    pendingComponents =
      pendingComponents.length > 0
        ? mergeComponentTrees(pendingComponents, rawComponents)
        : rawComponents;
    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        flushPending();
      }, COMPONENT_SCAN_EMIT_MS);
    }
  };

  const onLine = (line: string) => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      const rawComponents = extractRawComponents(
        parsed as Record<string, unknown>,
        entityIdSet,
        componentIdSet,
      );
      if (rawComponents.length > 0) {
        components = mergeComponentTrees(components, rawComponents);
        queueEmit(rawComponents);
      }
    } catch (error) {
      console.error("Failed to parse line:", error);
    }
  };

  const trimmed = source.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const response = await fetch(trimmed, { signal });
    if (!response.ok) {
      throw new Error(`Capture fetch failed (${response.status})`);
    }
    await streamLinesFromResponse({ response, signal, onLine });
  } else {
    const filePath = resolveLocalCapturePath(trimmed);
    await streamLinesFromFile({ filePath, startOffset: 0, initialRemainder: "", signal, onLine });
  }

  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  flushPending();

  return {
    components,
    entityIds: [...entityIdSet],
    componentIds: [...componentIdSet],
  };
}

const agentClients = new Set<WebSocket>();
let frontendClient: WebSocket | null = null;
const pendingClients = new Map<WebSocket, boolean>();
const activeSockets = new Set<Socket>();
let shuttingDown = false;
const queuedAgentCommands: ControlCommand[] = [];
const MAX_QUEUED_COMMANDS = 500;
const MAX_PENDING_CAPTURE_FRAMES = 5000;
const MAX_PENDING_TOTAL_FRAMES = 50000;
const QUEUEABLE_COMMANDS = new Set<ControlCommand["type"]>([
  "toggle_capture",
  "remove_capture",
  "select_metric",
  "deselect_metric",
  "clear_selection",
  "clear_captures",
  "play",
  "pause",
  "stop",
  "seek",
  "set_speed",
  "set_window_size",
  "set_window_start",
  "set_window_end",
  "set_window_range",
  "set_auto_scroll",
  "add_annotation",
  "remove_annotation",
  "clear_annotations",
  "jump_annotation",
  "add_subtitle",
  "remove_subtitle",
  "clear_subtitles",
  "set_source_mode",
  "set_live_source",
  "live_start",
  "live_stop",
]);
const RESPONSE_REQUIRED_COMMANDS = new Set<ControlCommand["type"]>([
  "hello",
  "get_state",
  "list_captures",
  "get_display_snapshot",
  "get_series_window",
  "query_components",
  "get_render_table",
  "get_memory_stats",
  "get_metric_coverage",
]);

type PendingCapture = {
  captureId: string;
  filename?: string;
  components?: ComponentNode[];
  frames: CaptureAppendFrame[];
  ended: boolean;
};

const pendingCaptureBuffers = new Map<string, PendingCapture>();

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
  byteOffset: number;
  partialLine: string;
  lastError: string | null;
  isPolling: boolean;
  idleSince: number | null;
}

const liveStreamStates = new Map<string, LiveStreamState>();
const captureSources = new Map<string, string>();
const captureMetadata = new Map<string, { filename?: string; source?: string }>();
const captureComponentState = new Map<
  string,
  {
    components: ComponentNode[];
    sentCount: number;
  }
>();

function countComponentNodes(nodes: ComponentNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.children.length > 0) {
      count += countComponentNodes(node.children);
    }
  }
  return count;
}

function componentsFromFrame(frame: CaptureAppendFrame): ComponentNode[] {
  if (!frame || typeof frame !== "object") {
    return [];
  }

  if (
    "entities" in frame &&
    frame.entities &&
    typeof frame.entities === "object" &&
    !Array.isArray(frame.entities)
  ) {
    return buildComponentTreeFromEntities(frame.entities as Record<string, unknown>);
  }

  if (
    "entityId" in frame &&
    "componentId" in frame &&
    typeof frame.entityId === "string" &&
    typeof frame.componentId === "string"
  ) {
    const rawEntities: Record<string, Record<string, unknown>> = {
      [frame.entityId]: {
        [frame.componentId]: frame.value,
      },
    };
    return buildComponentTreeFromEntities(rawEntities);
  }

  return [];
}

function updateCaptureComponents(
  captureId: string,
  rawComponents: ComponentNode[],
  options: { emit?: boolean } = {},
) {
  if (!captureId || rawComponents.length === 0) {
    return;
  }
  const emit = options.emit ?? true;
  const state = captureComponentState.get(captureId) ?? { components: [], sentCount: 0 };
  const merged = mergeComponentTrees(state.components, rawComponents);
  const pruned = pruneComponentTree(merged);
  const nodeCount = countComponentNodes(pruned);
  const shouldSend = nodeCount > state.sentCount;
  captureComponentState.set(captureId, {
    components: pruned,
    sentCount: shouldSend ? nodeCount : state.sentCount,
  });
  if (emit && shouldSend) {
    sendCaptureComponents(captureId, pruned);
  }
}

function broadcastToAgents(message: ControlResponse) {
  const data = JSON.stringify(message);
  agentClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function sendToFrontend(command: ControlCommand | ControlResponse): boolean {
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    return false;
  }
  frontendClient.send(JSON.stringify(command));
  return true;
}

function sendCaptureComponents(captureId: string, components: ComponentNode[]) {
  if (!components || components.length === 0) {
    return;
  }
  const command: ControlCommand = { type: "capture_components", captureId, components };
  if (!sendToFrontend(command)) {
    bufferCaptureFrame(command);
  }
}

function registerCaptureSource(options: {
  captureId: string;
  filename?: string;
  source: string;
}) {
  const { captureId, filename, source } = options;
  if (!captureId) {
    throw new Error("captureId is required.");
  }
  captureSources.set(captureId, source);
  captureMetadata.set(captureId, { filename, source });
  captureComponentState.set(captureId, { components: [], sentCount: 0 });
  const command: ControlCommand = {
    type: "capture_init",
    captureId,
    filename,
    source,
  };
  if (!sendToFrontend(command)) {
    bufferCaptureFrame(command);
  }
}

function scheduleComponentScan(captureId: string, source: string) {
  const controller = new AbortController();
  scanComponentsFromSource(source, controller.signal, {
    onComponents: (components) => {
      updateCaptureComponents(captureId, components);
    },
  })
    .then((result) => {
      updateCaptureComponents(captureId, result.components);
    })
    .catch((error) => {
      if (controller.signal.aborted && (error as Error).name === "AbortError") {
        return;
      }
      console.error("[components] Scan error:", error);
    });
}

function clearCaptureState() {
  pendingCaptureBuffers.clear();
  captureComponentState.clear();
  captureSources.clear();
  captureMetadata.clear();
  stopAllLiveStreams();
}

function removeCaptureState(captureId: string) {
  if (!captureId) {
    return;
  }
  pendingCaptureBuffers.delete(captureId);
  captureComponentState.delete(captureId);
  captureSources.delete(captureId);
  captureMetadata.delete(captureId);
  stopLiveStream(captureId);
}

function enqueueCommand(command: ControlCommand) {
  if (command.type === "clear_captures") {
    clearCaptureState();
    queuedAgentCommands.length = 0;
  }
  queuedAgentCommands.push(command);
  if (queuedAgentCommands.length > MAX_QUEUED_COMMANDS) {
    queuedAgentCommands.shift();
  }
}

function flushQueuedCommands() {
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    return;
  }
  const pendingIds = new Set(pendingCaptureBuffers.keys());
  flushPendingCaptures();
  sendKnownCaptures({ excludeIds: pendingIds });
  while (queuedAgentCommands.length > 0) {
    const command = queuedAgentCommands.shift();
    if (!command) {
      continue;
    }
    frontendClient.send(JSON.stringify(command));
  }
}

function flushPendingCaptures() {
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    return;
  }
  for (const pending of pendingCaptureBuffers.values()) {
    frontendClient.send(
      JSON.stringify({ type: "capture_init", captureId: pending.captureId, filename: pending.filename }),
    );
    if (pending.components && pending.components.length > 0) {
      frontendClient.send(
        JSON.stringify({
          type: "capture_components",
          captureId: pending.captureId,
          components: pending.components,
        }),
      );
    }
    for (const frame of pending.frames) {
      frontendClient.send(
        JSON.stringify({ type: "capture_append", captureId: pending.captureId, frame }),
      );
    }
    if (pending.ended) {
      frontendClient.send(
        JSON.stringify({ type: "capture_end", captureId: pending.captureId }),
      );
    }
  }
  pendingCaptureBuffers.clear();
}

function sendKnownCaptures(options: { excludeIds?: Set<string> } = {}) {
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    return;
  }
  const excludeIds = options.excludeIds ?? new Set<string>();
  const captureIds = new Set<string>();
  for (const captureId of captureMetadata.keys()) {
    captureIds.add(captureId);
  }
  for (const captureId of captureSources.keys()) {
    captureIds.add(captureId);
  }
  for (const captureId of captureComponentState.keys()) {
    captureIds.add(captureId);
  }
  for (const captureId of liveStreamStates.keys()) {
    captureIds.add(captureId);
  }

  for (const captureId of captureIds) {
    if (excludeIds.has(captureId)) {
      continue;
    }
    const meta = captureMetadata.get(captureId);
    const source = meta?.source ?? captureSources.get(captureId);
    const filename =
      meta?.filename ??
      (source ? inferFilename(source) : undefined) ??
      `${captureId}.jsonl`;
    sendToFrontend({
      type: "capture_init",
      captureId,
      filename,
      source,
    });
    const state = captureComponentState.get(captureId);
    if (state && state.components.length > 0) {
      sendToFrontend({
        type: "capture_components",
        captureId,
        components: state.components,
      });
    }
  }
}

function bufferCaptureFrame(command: ControlCommand) {
  if (
    command.type !== "capture_init" &&
    command.type !== "capture_append" &&
    command.type !== "capture_end" &&
    command.type !== "capture_components"
  ) {
    return;
  }

  const captureId = "captureId" in command ? String(command.captureId ?? "") : "";
  if (!captureId) {
    return;
  }

  let pending = pendingCaptureBuffers.get(captureId);
  if (!pending) {
    pending = { captureId, frames: [], ended: false };
    pendingCaptureBuffers.set(captureId, pending);
  }

  if (command.type === "capture_init") {
    pending.filename = command.filename;
    pending.components = undefined;
    pending.frames = [];
    pending.ended = false;
    return;
  }

  if (command.type === "capture_components") {
    pending.components = command.components;
    return;
  }

  if (command.type === "capture_end") {
    pending.ended = true;
    return;
  }

  if (command.type === "capture_append") {
    pending.frames.push(command.frame);
    while (pending.frames.length > MAX_PENDING_CAPTURE_FRAMES) {
      pending.frames.shift();
    }
    if (totalPendingFrames() > MAX_PENDING_TOTAL_FRAMES) {
      trimPendingFrames();
    }
  }
}

function totalPendingFrames() {
  let total = 0;
  for (const pending of pendingCaptureBuffers.values()) {
    total += pending.frames.length;
  }
  return total;
}

function trimPendingFrames() {
  const entries = Array.from(pendingCaptureBuffers.values());
  let total = totalPendingFrames();
  for (const pending of entries) {
    while (pending.frames.length > 0 && total > MAX_PENDING_TOTAL_FRAMES) {
      pending.frames.shift();
      total -= 1;
    }
    if (total <= MAX_PENDING_TOTAL_FRAMES) {
      break;
    }
  }
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
  const normalizedTick = tick as number;
  const entities = (parsed as { entities?: unknown }).entities;
  if (entities && typeof entities === "object" && !Array.isArray(entities)) {
    return { tick: normalizedTick, entities: normalizeEntities(entities) };
  }
  const entityId = (parsed as { entityId?: unknown }).entityId;
  const componentId = (parsed as { componentId?: unknown }).componentId;
  if (typeof entityId === "string" && typeof componentId === "string") {
    return {
      tick: normalizedTick,
      entities: {
        [entityId]: {
          [componentId]: (parsed as { value?: unknown }).value,
        },
      },
    };
  }
  return null;
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
  const current = liveStreamStates.get(state.captureId);
  if (!current || current !== state) {
    return;
  }
  if (state.isPolling) {
    return;
  }
  state.isPolling = true;
  let appendedFrames = 0;

  try {
    const trimmed = state.source.trim();
    if (!trimmed) {
      throw new Error("Capture file source is required.");
    }

    const onLine = (line: string) => {
      const frame = parseLineToFrame(line);
      if (!frame) {
        return;
      }
      state.frameCount += 1;
      appendedFrames += 1;
      state.lastTick = frame.tick;
      const rawComponents = componentsFromFrame(frame);
      updateCaptureComponents(state.captureId, rawComponents);
      sendToFrontend({ type: "capture_append", captureId: state.captureId, frame });
    };

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const wantsRange = state.byteOffset > 0;
      const headers: Record<string, string> = {};
      if (wantsRange) {
        headers.Range = `bytes=${state.byteOffset}-`;
      }
      const response = await fetch(trimmed, { signal: state.controller.signal, headers });
      if (!response.ok) {
        throw new Error(`Capture fetch failed (${response.status})`);
      }
      const usedRange = wantsRange && response.status === 206;
      let didReset = false;
      if (wantsRange && !usedRange) {
        state.lineOffset = 0;
        state.frameCount = 0;
        state.lastTick = null;
        state.byteOffset = 0;
        state.partialLine = "";
        didReset = true;
        sendToFrontend({
          type: "capture_init",
          captureId: state.captureId,
          filename: state.filename,
          reset: true,
        });
      }
      const result = await streamLinesFromResponse({
        response,
        initialRemainder: usedRange ? state.partialLine : "",
        signal: state.controller.signal,
        onLine: (line) => {
          state.lineOffset += 1;
          onLine(line);
        },
      });
      if (usedRange) {
        state.byteOffset += result.bytesRead;
      } else {
        state.byteOffset = result.bytesRead;
        if (didReset) {
          state.lineOffset = result.lineCount;
        }
      }
      state.partialLine = result.remainder;
    } else {
      const filePath = resolveLocalCapturePath(trimmed);
      const stat = await fs.promises.stat(filePath);
      let startOffset = state.byteOffset;
      let didReset = false;
      if (stat.size < state.byteOffset) {
        state.lineOffset = 0;
        state.frameCount = 0;
        state.lastTick = null;
        state.byteOffset = 0;
        state.partialLine = "";
        didReset = true;
        startOffset = 0;
        sendToFrontend({
          type: "capture_init",
          captureId: state.captureId,
          filename: state.filename,
          reset: true,
        });
      }
      if (stat.size > startOffset) {
        const result = await streamLinesFromFile({
          filePath,
          startOffset,
          initialRemainder: didReset ? "" : state.partialLine,
          signal: state.controller.signal,
          onLine: (line) => {
            state.lineOffset += 1;
            onLine(line);
          },
        });
        state.byteOffset = startOffset + result.bytesRead;
        if (didReset) {
          state.lineOffset = result.lineCount;
        }
        state.partialLine = result.remainder;
      }
    }

    state.lastError = null;
  } catch (error) {
    if (!(state.controller.signal.aborted && (error as Error).name === "AbortError")) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    state.isPolling = false;
    const now = Date.now();
    if (appendedFrames > 0) {
      state.idleSince = null;
    } else if (state.idleSince === null) {
      state.idleSince = now;
    }

    if (state.idleSince !== null) {
      const inactivityLimitMs = Math.max(
        LIVE_INACTIVITY_MIN_MS,
        state.pollIntervalMs * LIVE_INACTIVITY_MULTIPLIER,
      );
      if (now - state.idleSince >= inactivityLimitMs) {
        stopLiveStream(state.captureId);
        return;
      }
    }

    if (liveStreamStates.get(state.captureId) === state) {
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
  if (liveStreamStates.has(captureId)) {
    throw new Error("Live stream already running for captureId.");
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
    byteOffset: 0,
    partialLine: "",
    lastError: null,
    isPolling: false,
    idleSince: null,
  };
  if (!sendToFrontend({ type: "capture_init", captureId, filename })) {
    throw new Error("Frontend not connected.");
  }
  captureSources.set(captureId, source);
  captureMetadata.set(captureId, { filename, source });
  liveStreamStates.set(captureId, state);
  const cachedComponents = captureComponentState.get(captureId)?.components;
  if (cachedComponents && cachedComponents.length > 0) {
    sendToFrontend({ type: "capture_components", captureId, components: cachedComponents });
  }
  pollLiveCapture(state).catch((error) => {
    console.error("[live] Poll error:", error);
  });
  return state;
}

function stopLiveStream(captureId: string) {
  const state = liveStreamStates.get(captureId);
  if (!state) {
    return null;
  }
  state.controller.abort();
  if (state.timer) {
    clearTimeout(state.timer);
  }
  liveStreamStates.delete(captureId);
  sendToFrontend({ type: "capture_end", captureId: state.captureId });
  return state;
}

function stopAllLiveStreams() {
  const stopped: LiveStreamState[] = [];
  for (const captureId of Array.from(liveStreamStates.keys())) {
    const state = stopLiveStream(captureId);
    if (state) {
      stopped.push(state);
    }
  }
  return stopped;
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

  httpServer.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });

  const scheduleShutdown = (reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopAllLiveStreams();

    const shutdown = () => {
      for (const client of wss.clients) {
        try {
          client.close(1001, "server shutdown");
        } catch {
          // ignore close errors
        }
      }
      wss.close();
      for (const socket of activeSockets) {
        try {
          socket.destroy();
        } catch {
          // ignore destroy errors
        }
      }
      httpServer.close(() => {
        console.log(`[shutdown] UI server stopped (${reason})`);
        process.exit(0);
      });
      const fallback = setTimeout(() => {
        console.warn(`[shutdown] forcing exit (${reason})`);
        process.exit(0);
      }, 2000);
      fallback.unref();
    };

    const timer = setTimeout(shutdown, 100);
    timer.unref();
  };

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
            flushQueuedCommands();
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
          if (message.type === "clear_captures") {
            clearCaptureState();
          } else if (message.type === "remove_capture") {
            const targetId = String(message.captureId ?? "");
            removeCaptureState(targetId);
          }
          broadcastToAgents(message as ControlResponse);
          return;
        }

        const command = message as ControlCommand;
        const captureId = "captureId" in command ? String(command.captureId ?? "") : "";
        if (command.type === "clear_captures") {
          clearCaptureState();
        }
        if (command.type === "remove_capture" && captureId) {
          removeCaptureState(captureId);
        }
        if (command.type === "capture_init" && captureId) {
          captureComponentState.set(captureId, { components: [], sentCount: 0 });
          if (typeof (command as { source?: unknown }).source === "string") {
            captureSources.set(captureId, (command as { source: string }).source);
          }
          captureMetadata.set(captureId, {
            filename: (command as { filename?: string }).filename,
            source:
              typeof (command as { source?: unknown }).source === "string"
                ? (command as { source: string }).source
                : undefined,
          });
        }
        if (command.type === "capture_components" && captureId && command.components) {
          updateCaptureComponents(captureId, command.components, { emit: false });
        }
        if (command.type === "capture_append" && captureId) {
          const rawComponents = componentsFromFrame(command.frame);
          updateCaptureComponents(captureId, rawComponents);
        }
        const requiresResponse = RESPONSE_REQUIRED_COMMANDS.has(command.type);
        const canQueue = QUEUEABLE_COMMANDS.has(command.type);

        const isCaptureCommand =
          command.type === "capture_init" ||
          command.type === "capture_append" ||
          command.type === "capture_end" ||
          command.type === "capture_components";

        if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
          if (requiresResponse) {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: "Frontend not connected",
              request_id: command.request_id,
            } as ControlResponse));
            return;
          }
          if (isCaptureCommand) {
            bufferCaptureFrame(command);
            ws.send(JSON.stringify({
              type: "ack",
              payload: "buffered",
              request_id: command.request_id,
            } as ControlResponse));
            if (command.type === "capture_end" && captureId) {
              const state = captureComponentState.get(captureId);
              if (!state || state.sentCount === 0) {
                const error =
                  "No components discovered for capture. Include entities in capture_append or send capture_components.";
                ws.send(
                  JSON.stringify({
                    type: "error",
                    error,
                    request_id: command.request_id,
                  } as ControlResponse),
                );
                ws.send(
                  JSON.stringify({
                    type: "ui_error",
                    error,
                    request_id: command.request_id,
                    payload: { context: { captureId } },
                  } as ControlResponse),
                );
              }
            }
            return;
          }
          if (canQueue) {
            enqueueCommand(command);
            ws.send(JSON.stringify({
              type: "ack",
              payload: "queued",
              request_id: command.request_id,
            } as ControlResponse));
            return;
          }
          ws.send(JSON.stringify({ 
            type: "error", 
            error: "Frontend not connected",
            request_id: command.request_id,
          } as ControlResponse));
          return;
        }

        if (canQueue && command.request_id) {
          ws.send(JSON.stringify({
            type: "ack",
            payload: "forwarded",
            request_id: command.request_id,
          } as ControlResponse));
        }
        frontendClient.send(JSON.stringify(command));

        if (command.type === "capture_end" && captureId) {
          const state = captureComponentState.get(captureId);
          if (!state || state.sentCount === 0) {
            const error = "No components discovered for capture. Include entities in capture_append or send capture_components.";
            ws.send(JSON.stringify({
              type: "error",
              error,
              request_id: command.request_id,
            } as ControlResponse));
            ws.send(JSON.stringify({
              type: "ui_error",
              error,
              request_id: command.request_id,
              payload: { context: { captureId } },
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
        stopAllLiveStreams();
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

  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const captureId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const filename = req.file.originalname || path.basename(req.file.path);
      const filePath = req.file.path;
      const size = req.file.size;

      let sourcePath = filePath;
      let deduped = false;
      try {
        const hash = await hashFile(filePath);
        const index = loadUploadIndex();
        const existing = index[hash];
        if (existing?.path && fs.existsSync(existing.path)) {
          if (existing.path !== filePath) {
            fs.unlinkSync(filePath);
          }
          sourcePath = existing.path;
          deduped = true;
        } else {
          index[hash] = {
            path: filePath,
            size,
            filename,
            createdAt: new Date().toISOString(),
          };
          saveUploadIndex(index);
        }
      } catch (error) {
        console.warn("[upload] Failed to hash file for dedupe:", error);
      }

      registerCaptureSource({
        source: sourcePath,
        captureId,
        filename,
      });
      scheduleComponentScan(captureId, sourcePath);

      res.json({
        success: true,
        streaming: true,
        captureId,
        filename,
        size,
        deduped,
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

      const parsed = await parseJSONLFromSource(source, new AbortController().signal);
      const { records, components } = parsed;

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
        size: parsed.sizeBytes,
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

  app.post("/api/series", async (req, res) => {
    try {
      const captureId = typeof req.body?.captureId === "string" ? req.body.captureId : "";
      if (!captureId.trim()) {
        return res.status(400).json({ error: "captureId is required." });
      }
      const path = normalizePathInput(req.body?.path);
      if (!path) {
        return res.status(400).json({ error: "path must be a JSON array of strings." });
      }

      const source =
        captureSources.get(captureId) ?? liveStreamStates.get(captureId)?.source ?? "";
      if (!source) {
        return res.status(404).json({ error: "Capture source not found for captureId." });
      }

      const result = await extractSeriesFromSource({
        source,
        path,
        signal: new AbortController().signal,
      });

      return res.json({
        success: true,
        captureId,
        path,
        fullPath: path.join("."),
        points: result.points,
        tickCount: result.tickCount,
        numericCount: result.numericCount,
        lastTick: result.lastTick,
      });
    } catch (error) {
      console.error("Series load error:", error);
      return res.status(500).json({ error: "Failed to load series." });
    }
  });

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
    if (streams.length === 0) {
      return res.json({ running: false, streams: [] });
    }
    const response: Record<string, unknown> = {
      running: true,
      streams,
      count: streams.length,
    };
    if (streams.length === 1) {
      Object.assign(response, streams[0]);
    }
    return res.json(response);
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
      let captureId =
        typeof req.body?.captureId === "string"
          ? req.body.captureId
          : `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
      scheduleComponentScan(state.captureId, state.source);

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
    const captureId =
      typeof req.body?.captureId === "string" ? req.body.captureId : null;
    if (captureId) {
      const stopped = stopLiveStream(captureId);
      const running = liveStreamStates.size > 0;
      return res.json({
        success: true,
        running,
        captureId: stopped?.captureId ?? null,
        stopped: stopped ? [stopped.captureId] : [],
        notFound: stopped ? [] : [captureId],
      });
    }

    const stopped = stopAllLiveStreams();
    const running = liveStreamStates.size > 0;
    return res.json({
      success: true,
      running,
      captureId: stopped[0]?.captureId ?? null,
      stopped: stopped.map((state) => state.captureId),
    });
  });

  app.post("/api/shutdown", (_req, res) => {
    res.status(shuttingDown ? 202 : 200).json({ success: true, shuttingDown: true });
    if (!shuttingDown) {
      scheduleShutdown("api");
    }
  });

  return httpServer;
}
