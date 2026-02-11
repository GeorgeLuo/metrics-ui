import type { Express } from "express";
import { createServer, type Server } from "http";
import type { Socket } from "net";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import type {
  CaptureAppendFrame,
  ComponentNode,
  ControlCommand,
  ControlResponse,
  DerivationGroup,
  SelectedMetric,
  VisualizationState,
} from "@shared/schema";
import { compactEntities, compactValue, DEFAULT_MAX_NUMERIC_DEPTH } from "@shared/compact";
import { buildComponentTreeFromEntities, mergeComponentTrees, pruneComponentTree } from "@shared/component-tree";
import {
  ComponentManager,
  EntityManager,
  System,
  SystemManager,
  TimeComponent,
  type ComponentType,
  type SystemContext,
} from "@georgeluo/ecs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";
import crypto from "crypto";
import { createRequire } from "module";

const UPLOAD_ROOT = path.join(os.homedir(), ".simeval", "metrics-ui", "uploads");
const UPLOAD_INDEX_FILE = path.join(UPLOAD_ROOT, "index.json");
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
const DERIVATION_PLUGIN_ROOT = path.join(os.homedir(), ".simeval", "metrics-ui", "derivation-plugins");
const DERIVATION_PLUGIN_INDEX_FILE = path.join(DERIVATION_PLUGIN_ROOT, "plugins.json");
const MAX_DERIVATION_PLUGIN_SIZE_BYTES = 5 * 1024 * 1024;
const CAPTURE_SOURCES_FILE = path.join(os.homedir(), ".simeval", "metrics-ui", "capture-sources.json");

const requireFromServer = createRequire(
  typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url),
);

function resolveServerNodeModulesDir(): string | null {
  const fromCwd = path.resolve(process.cwd(), "node_modules");
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  try {
    const ecsPkg = requireFromServer.resolve("@georgeluo/ecs/package.json");
    return path.resolve(ecsPkg, "..", "..", "..");
  } catch {
    return null;
  }
}

function ensureDerivationPluginNodeModulesLink() {
  const target = resolveServerNodeModulesDir();
  if (!target) {
    return;
  }
  try {
    fs.mkdirSync(DERIVATION_PLUGIN_ROOT, { recursive: true });
    const linkPath = path.join(DERIVATION_PLUGIN_ROOT, "node_modules");
    if (fs.existsSync(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        return;
      }
      const existing = fs.readlinkSync(linkPath);
      const resolvedExisting = path.resolve(DERIVATION_PLUGIN_ROOT, existing);
      if (resolvedExisting === target) {
        return;
      }
      fs.unlinkSync(linkPath);
    }
    fs.symlinkSync(target, linkPath, "dir");
  } catch (error) {
    console.warn("[derivations] Failed to ensure derivation plugin node_modules link:", error);
  }
}

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

const derivationPluginUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DERIVATION_PLUGIN_SIZE_BYTES },
});
const LIVE_INACTIVITY_MIN_MS = 15000;
const LIVE_INACTIVITY_MULTIPLIER = 5;
const LIVE_RETRYABLE_FILE_ERRORS = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EBUSY"]);

type CaptureRecord = {
  tick: number;
  entities: Record<string, Record<string, unknown>>;
};

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
  maxLines?: number;
}): Promise<LineConsumerResult> {
  const { readable, signal, onLine } = options;
  let remainder = options.initialRemainder ?? "";
  let bytesRead = 0;
  let lineCount = 0;
  const maxLines = Number.isFinite(options.maxLines) ? Math.max(1, options.maxLines as number) : null;
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
    outer: for await (const chunk of readable) {
      const chunkText = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
      bytesRead += Buffer.byteLength(chunkText, "utf-8");
      const combined = remainder + chunkText;
      const parts = combined.split("\n");
      const trailingRemainder = parts.pop() ?? "";
      remainder = trailingRemainder;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        lineCount += 1;
        onLine(part);
        if (maxLines && lineCount >= maxLines) {
          const remaining = parts.slice(index + 1).join("\n");
          if (remaining) {
            remainder = `${remaining}\n${trailingRemainder}`;
          } else {
            remainder = trailingRemainder;
          }
          readable.destroy();
          break outer;
        }
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
  maxLines?: number;
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
    maxLines: options.maxLines,
  });
}

async function streamLinesFromResponse(options: {
  response: Response;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
  maxLines?: number;
}): Promise<LineConsumerResult> {
  if (!options.response.body) {
    const text = await options.response.text();
    const readable = Readable.from([text], { encoding: "utf-8" });
    return consumeLineStream({
      readable,
      initialRemainder: options.initialRemainder,
      signal: options.signal,
      onLine: options.onLine,
      maxLines: options.maxLines,
    });
  }

  const readable = Readable.fromWeb(options.response.body as unknown as ReadableStream<Uint8Array>);
  return consumeLineStream({
    readable,
    initialRemainder: options.initialRemainder,
    signal: options.signal,
    onLine: options.onLine,
    maxLines: options.maxLines,
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

function extractSeriesFromFrames(frames: CaptureRecord[], path: string[]) {
  const pointsByTick = new Map<number, number | null>();
  frames.forEach((frame) => {
    if (!frame || typeof frame.tick !== "number") {
      return;
    }
    const rawValue = getValueAtPath(frame.entities, path);
    const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
    pointsByTick.set(frame.tick, value);
  });

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

function extractSeriesFromFramesBatch(frames: CaptureRecord[], paths: string[][]) {
  const pointsByTickList = paths.map(() => new Map<number, number | null>());
  frames.forEach((frame) => {
    if (!frame || typeof frame.tick !== "number") {
      return;
    }
    const entities = frame.entities;
    if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
      return;
    }
    paths.forEach((path, index) => {
      const rawValue = getValueAtPath(entities, path);
      const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
      pointsByTickList[index].set(frame.tick, value);
    });
  });

  return pointsByTickList.map((pointsByTick) => {
    const points = Array.from(pointsByTick.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([tickValue, value]) => ({ tick: tickValue, value }));
    const numericCount = points.reduce(
      (total, point) => total + (typeof point.value === "number" ? 1 : 0),
      0,
    );
    const lastTick = points.length > 0 ? points[points.length - 1].tick : null;
    return { points, numericCount, lastTick, tickCount: points.length };
  });
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

async function extractSeriesBatchFromSource(options: {
  source: string;
  paths: string[][];
  signal: AbortSignal;
}) {
  const { source, paths, signal } = options;
  const pointsByTickList = paths.map(() => new Map<number, number | null>());
  const componentLookup = new Map<string, Array<{ index: number; rest: string[] }>>();

  paths.forEach((path, index) => {
    if (path.length >= 2) {
      const key = `${path[0]}::${path[1]}`;
      const rest = path.slice(2);
      const list = componentLookup.get(key);
      if (list) {
        list.push({ index, rest });
      } else {
        componentLookup.set(key, [{ index, rest }]);
      }
    }
  });

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
      paths.forEach((path, index) => {
        const rawValue = getValueAtPath(entities, path);
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
        pointsByTickList[index].set(numericTick, value);
      });
      return;
    }

    const entityId = (parsed as { entityId?: unknown }).entityId;
    const componentId = (parsed as { componentId?: unknown }).componentId;
    if (typeof entityId === "string" && typeof componentId === "string") {
      const list = componentLookup.get(`${entityId}::${componentId}`);
      if (!list) {
        return;
      }
      const valueSource = (parsed as { value?: unknown }).value;
      list.forEach(({ index, rest }) => {
        const rawValue = rest.length === 0 ? valueSource : getValueAtPath(valueSource, rest);
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
        pointsByTickList[index].set(numericTick, value);
      });
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

  return pointsByTickList.map((pointsByTick) => {
    const points = Array.from(pointsByTick.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([tickValue, value]) => ({ tick: tickValue, value }));
    const numericCount = points.reduce(
      (total, point) => total + (typeof point.value === "number" ? 1 : 0),
      0,
    );
    const lastTick = points.length > 0 ? points[points.length - 1].tick : null;
    return { points, numericCount, lastTick, tickCount: points.length };
  });
}

const agentClients = new Set<WebSocket>();
let frontendClient: WebSocket | null = null;
const clientRoles = new Map<WebSocket, "frontend" | "agent">();
const pendingClients = new Map<WebSocket, boolean>();
const activeSockets = new Set<Socket>();
let shuttingDown = false;
let lastVisualizationState: VisualizationState | null = null;
let lastVisualizationStateAt: string | null = null;
const queuedAgentCommands: ControlCommand[] = [];
const MAX_QUEUED_COMMANDS = 500;
const MAX_PENDING_CAPTURE_FRAMES = 5000;
const MAX_PENDING_TOTAL_FRAMES = 50000;
const LIVE_MAX_LINES_PER_POLL = 2000;
const LIVE_FAST_POLL_MS = 100;
const LITE_BUFFER_MAX_FRAMES = 50;
const ENABLE_FRAME_CACHE = true;
const MAX_FRAME_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_CACHE_TAIL_FRAMES = 200;
const QUEUEABLE_COMMANDS = new Set<ControlCommand["type"]>([
  "toggle_capture",
  "remove_capture",
  "select_metric",
  "deselect_metric",
  "clear_selection",
  "select_analysis_metric",
  "deselect_analysis_metric",
  "clear_analysis_metrics",
  "create_derivation_group",
  "delete_derivation_group",
  "set_active_derivation_group",
  "update_derivation_group",
  "set_display_derivation_group",
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
  "set_stream_mode",
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
  "get_ui_debug",
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
const captureStreamModes = new Map<string, "lite" | "full">();
const liteFrameBuffers = new Map<string, CaptureAppendFrame[]>();
const captureLastTicks = new Map<string, number>();
const captureEnded = new Set<string>();

type PersistedCaptureSource = {
  captureId: string;
  source: string;
  filename?: string;
  pollIntervalMs?: number;
  updatedAt: string;
};

const persistedCaptureSources = new Map<string, PersistedCaptureSource>();

function loadPersistedCaptureSources() {
  persistedCaptureSources.clear();
  try {
    if (!fs.existsSync(CAPTURE_SOURCES_FILE)) {
      return;
    }
    const raw = fs.readFileSync(CAPTURE_SOURCES_FILE, "utf-8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? // tolerate older keys if present
          (Array.isArray((parsed as { sources?: unknown }).sources)
            ? (parsed as { sources: unknown[] }).sources
            : Array.isArray((parsed as { captures?: unknown }).captures)
              ? (parsed as { captures: unknown[] }).captures
              : Array.isArray((parsed as { liveStreams?: unknown }).liveStreams)
                ? (parsed as { liveStreams: unknown[] }).liveStreams
                : [])
        : [];

    const now = new Date().toISOString();
    for (const entry of list) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const captureId =
        "captureId" in entry && typeof (entry as { captureId?: unknown }).captureId === "string"
          ? (entry as { captureId: string }).captureId
          : "id" in entry && typeof (entry as { id?: unknown }).id === "string"
            ? (entry as { id: string }).id
            : "";
      const source =
        "source" in entry && typeof (entry as { source?: unknown }).source === "string"
          ? (entry as { source: string }).source
          : "";
      if (!captureId || !source.trim()) {
        continue;
      }
      const filename =
        "filename" in entry && typeof (entry as { filename?: unknown }).filename === "string"
          ? (entry as { filename: string }).filename
          : undefined;
      const pollIntervalMsRaw =
        "pollIntervalMs" in entry ? Number((entry as { pollIntervalMs?: unknown }).pollIntervalMs) : NaN;
      const pollIntervalMs =
        Number.isFinite(pollIntervalMsRaw) && pollIntervalMsRaw > 0 ? pollIntervalMsRaw : undefined;
      const updatedAt =
        "updatedAt" in entry && typeof (entry as { updatedAt?: unknown }).updatedAt === "string"
          ? (entry as { updatedAt: string }).updatedAt
          : now;

      persistedCaptureSources.set(captureId, {
        captureId,
        source,
        filename,
        pollIntervalMs,
        updatedAt,
      });

      // Seed in-memory metadata so sources show up after server restart.
      if (!captureSources.has(captureId)) {
        captureSources.set(captureId, source);
      }
      const meta = captureMetadata.get(captureId) ?? {};
      if (!meta.source) {
        meta.source = source;
      }
      if (!meta.filename && filename) {
        meta.filename = filename;
      }
      captureMetadata.set(captureId, meta);
      if (!captureStreamModes.has(captureId)) {
        captureStreamModes.set(captureId, "lite");
      }
    }
  } catch (error) {
    console.warn("[persist] Failed to load capture sources:", error);
  }
}

function savePersistedCaptureSources() {
  try {
    fs.mkdirSync(path.dirname(CAPTURE_SOURCES_FILE), { recursive: true });
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sources: Array.from(persistedCaptureSources.values()).sort((a, b) =>
        a.captureId.localeCompare(b.captureId),
      ),
    };
    const tmpFile = `${CAPTURE_SOURCES_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
    fs.renameSync(tmpFile, CAPTURE_SOURCES_FILE);
  } catch (error) {
    console.warn("[persist] Failed to save capture sources:", error);
  }
}

function syncPersistedCaptureSources(
  sources: Array<{ captureId: string; source: string; filename?: string; pollIntervalMs?: number }>,
  options?: { replace?: boolean },
) {
  const replace = Boolean(options?.replace);
  const next = new Map<string, PersistedCaptureSource>(
    replace ? [] : Array.from(persistedCaptureSources.entries()),
  );

  const now = new Date().toISOString();
  for (const entry of sources) {
    const captureId = typeof entry?.captureId === "string" ? entry.captureId : "";
    const source = typeof entry?.source === "string" ? entry.source : "";
    if (!captureId || !source.trim()) {
      continue;
    }
    const existing = next.get(captureId);
    const pollIntervalMsRaw =
      entry?.pollIntervalMs === undefined ? NaN : Number(entry.pollIntervalMs);
    const pollIntervalMs =
      Number.isFinite(pollIntervalMsRaw) && pollIntervalMsRaw > 0
        ? pollIntervalMsRaw
        : existing?.pollIntervalMs;
    next.set(captureId, {
      captureId,
      source,
      filename: entry.filename ?? existing?.filename,
      pollIntervalMs,
      updatedAt: now,
    });

    // Keep in-memory metadata aligned.
    captureSources.set(captureId, source);
    const meta = captureMetadata.get(captureId) ?? {};
    meta.source = source;
    if (entry.filename) {
      meta.filename = entry.filename;
    }
    captureMetadata.set(captureId, meta);
    if (!captureStreamModes.has(captureId)) {
      captureStreamModes.set(captureId, "lite");
    }
  }

  if (replace) {
    // When the browser reconnects it sends `sync_capture_sources` with `replace: true` based on its
    // localStorage. If we don't actively remove stale captures here, they can reappear on refresh
    // even after the user deleted them (because the server still has old capture state in memory).
    for (const captureId of persistedCaptureSources.keys()) {
      if (!next.has(captureId)) {
        removeCaptureState(captureId, { persist: false });
      }
    }
  }

  persistedCaptureSources.clear();
  for (const [captureId, entry] of next.entries()) {
    persistedCaptureSources.set(captureId, entry);
  }
  savePersistedCaptureSources();
}

function removePersistedCaptureSource(captureId: string) {
  if (!captureId) {
    return;
  }
  if (!persistedCaptureSources.delete(captureId)) {
    return;
  }
  savePersistedCaptureSources();
}

function clearPersistedCaptureSources() {
  if (persistedCaptureSources.size === 0) {
    return;
  }
  persistedCaptureSources.clear();
  savePersistedCaptureSources();
}

loadPersistedCaptureSources();

type DerivationJobStatus = "running" | "completed" | "failed" | "stopped";
type DerivationKind = "moving_average" | "diff" | "plugin";
type DerivationJob = {
  jobId: string;
  kind: DerivationKind;
  groupId: string;
  outputCaptureId: string;
  startedAt: string;
  status: DerivationJobStatus;
  error: string | null;
  controller: AbortController;
};

const derivationJobs = new Map<string, DerivationJob>();

type DerivationPluginOutput = { key: string; label?: string };
type DerivationPluginManifest = {
  id: string;
  name: string;
  description?: string;
  minInputs?: number;
  maxInputs?: number;
  outputs: DerivationPluginOutput[];
  createSystems: (context: {
    entity: number;
    inputs: Array<{ metric: SelectedMetric; component: ComponentType<number | null>; index: number }>;
    outputs: Record<string, ComponentType<number | null>>;
    params?: unknown;
  }) => unknown;
};

type DerivationPluginRecord = {
  id: string;
  name: string;
  description?: string;
  minInputs: number;
  maxInputs: number | null;
  outputs: DerivationPluginOutput[];
  filePath: string;
  hash: string;
  uploadedAt: string;
  valid: boolean;
  error: string | null;
};

const derivationPlugins = new Map<string, DerivationPluginRecord>();

function loadDerivationPluginIndex(): DerivationPluginRecord[] {
  try {
    const raw = fs.readFileSync(DERIVATION_PLUGIN_INDEX_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as DerivationPluginRecord[];
  } catch (error) {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function saveDerivationPluginIndex(records: DerivationPluginRecord[]) {
  fs.mkdirSync(DERIVATION_PLUGIN_ROOT, { recursive: true });
  fs.writeFileSync(DERIVATION_PLUGIN_INDEX_FILE, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}

function isSafeDerivationOutputKey(key: string) {
  return /^[A-Za-z0-9_]+$/.test(key);
}

async function loadDerivationPluginFromFile(filePath: string): Promise<{
  record: Omit<DerivationPluginRecord, "filePath" | "hash" | "uploadedAt">;
  manifest: DerivationPluginManifest | null;
}> {
  ensureDerivationPluginNodeModulesLink();
  const moduleUrl = pathToFileURL(filePath).href;
  let mod: any;
  try {
    mod = await import(moduleUrl);
  } catch (error) {
    return {
      record: {
        id: path.basename(filePath),
        name: path.basename(filePath),
        minInputs: 1,
        maxInputs: null,
        outputs: [],
        valid: false,
        error: error instanceof Error ? error.message : "Failed to import plugin module.",
      },
      manifest: null,
    };
  }

  const exported = mod?.default ?? mod?.createDerivationPlugin ?? mod?.createPlugin ?? null;
  const manifest: unknown = typeof exported === "function" ? await exported() : exported;

  if (!manifest || typeof manifest !== "object") {
    return {
      record: {
        id: path.basename(filePath),
        name: path.basename(filePath),
        minInputs: 1,
        maxInputs: null,
        outputs: [],
        valid: false,
        error: "Plugin must export a manifest object (default export) or a factory that returns one.",
      },
      manifest: null,
    };
  }

  const id = typeof (manifest as any).id === "string" ? (manifest as any).id.trim() : "";
  const name = typeof (manifest as any).name === "string" ? (manifest as any).name.trim() : "";
  const description =
    typeof (manifest as any).description === "string" ? (manifest as any).description : undefined;
  const minInputs =
    Number.isInteger((manifest as any).minInputs) && (manifest as any).minInputs >= 0
      ? (manifest as any).minInputs
      : 1;
  const maxInputs =
    Number.isInteger((manifest as any).maxInputs) && (manifest as any).maxInputs >= minInputs
      ? (manifest as any).maxInputs
      : null;
  const outputsRaw = Array.isArray((manifest as any).outputs) ? (manifest as any).outputs : [];
  const outputs: DerivationPluginOutput[] = outputsRaw
    .map((entry: any): DerivationPluginOutput => ({
      key: typeof entry?.key === "string" ? entry.key.trim() : "",
      label: typeof entry?.label === "string" ? entry.label : undefined,
    }))
    .filter((entry: DerivationPluginOutput) => entry.key.length > 0);

  const createSystems =
    typeof (manifest as any).createSystems === "function"
      ? (manifest as any).createSystems
      : typeof (manifest as any).createSystem === "function"
        ? (ctx: any) => [(manifest as any).createSystem(ctx)]
        : null;

  if (!id || !name) {
    return {
      record: {
        id: id || path.basename(filePath),
        name: name || id || path.basename(filePath),
        description,
        minInputs,
        maxInputs,
        outputs,
        valid: false,
        error: "Plugin manifest must include non-empty string fields: id, name.",
      },
      manifest: null,
    };
  }

  if (!Array.isArray(outputs) || outputs.length === 0) {
    return {
      record: {
        id,
        name,
        description,
        minInputs,
        maxInputs,
        outputs,
        valid: false,
        error: "Plugin manifest must include outputs: [{ key: string }...].",
      },
      manifest: null,
    };
  }

  const badKey = outputs.find((entry) => !isSafeDerivationOutputKey(entry.key));
  if (badKey) {
    return {
      record: {
        id,
        name,
        description,
        minInputs,
        maxInputs,
        outputs,
        valid: false,
        error: `Output key '${badKey.key}' is invalid. Use only letters, numbers, and underscores.`,
      },
      manifest: null,
    };
  }

  const outputKeys = outputs.map((entry) => entry.key);
  const uniqueKeys = new Set(outputKeys);
  if (uniqueKeys.size !== outputKeys.length) {
    return {
      record: {
        id,
        name,
        description,
        minInputs,
        maxInputs,
        outputs,
        valid: false,
        error: "Output keys must be unique within a plugin.",
      },
      manifest: null,
    };
  }

  if (!createSystems) {
    return {
      record: {
        id,
        name,
        description,
        minInputs,
        maxInputs,
        outputs,
        valid: false,
        error: "Plugin manifest must include createSystems(ctx) or createSystem(ctx).",
      },
      manifest: null,
    };
  }

  const typedManifest: DerivationPluginManifest = {
    id,
    name,
    description,
    minInputs,
    maxInputs: maxInputs ?? undefined,
    outputs,
    createSystems,
  };

  // Lightweight verification: instantiate systems and execute a few cycles.
  try {
    const entities = new EntityManager();
    const components = new ComponentManager();
    const systems = new SystemManager(entities, components);
    const root = entities.create();

    const inputs = Array.from({ length: Math.max(typedManifest.minInputs ?? 1, 1) }, (_, index) => {
      const component = numberOrNullComponent(`verify.in.${index}`);
      const metric: SelectedMetric = {
        captureId: "verify",
        path: ["0", "verify", `in_${index}`],
        fullPath: `0.verify.in_${index}`,
        label: `in_${index}`,
        color: "#000000",
      };
      return { metric, component, index };
    });
    const outputsMap: Record<string, ComponentType<number | null>> = {};
    typedManifest.outputs.forEach((output) => {
      outputsMap[output.key] = numberOrNullComponent(`verify.out.${output.key}`);
    });

    const created = typedManifest.createSystems({
      entity: root,
      inputs,
      outputs: outputsMap,
      params: {},
    });
    const systemList = Array.isArray(created) ? created : [created];
    systemList.forEach((system) => {
      if (!system || typeof (system as any).update !== "function") {
        throw new Error("createSystems must return System-like objects with an update(context) method.");
      }
      if (typeof (system as any).initialize !== "function") {
        (system as any).initialize = () => {};
      }
      if (typeof (system as any).destroy !== "function") {
        (system as any).destroy = () => {};
      }
      systems.addSystem(system as any);
    });

    for (let tick = 1; tick <= 3; tick += 1) {
      components.addComponent(root, (TimeComponent as any), { tick });
      inputs.forEach((input) => {
        components.addComponent(root, input.component, tick * 10 + input.index);
      });
      systems.runCycle();
      typedManifest.outputs.forEach((output) => {
        const payload = components.getComponent(root, outputsMap[output.key])?.payload ?? null;
        if (payload !== null && !isFiniteNumber(payload)) {
          throw new Error(`Output '${output.key}' must be a number or null.`);
        }
      });
    }
  } catch (error) {
    return {
      record: {
        id,
        name,
        description,
        minInputs,
        maxInputs,
        outputs,
        valid: false,
        error: error instanceof Error ? error.message : "Plugin verification failed.",
      },
      manifest: null,
    };
  }

  return {
    record: {
      id,
      name,
      description,
      minInputs,
      maxInputs,
      outputs,
      valid: true,
      error: null,
    },
    manifest: typedManifest,
  };
}

function bootstrapDerivationPluginsFromDisk() {
  const records = loadDerivationPluginIndex();
  records.forEach((record) => {
    if (record && typeof record.id === "string") {
      derivationPlugins.set(record.id, record);
    }
  });
}
bootstrapDerivationPluginsFromDisk();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNullComponent(id: string): ComponentType<number | null> {
  return {
    id,
    validate: (payload: unknown): payload is number | null =>
      payload === null || isFiniteNumber(payload),
  };
}

class DiffSystem extends System {
  constructor(
    private readonly entity: number,
    private readonly left: ComponentType<number | null>,
    private readonly right: ComponentType<number | null>,
    private readonly out: ComponentType<number | null>,
  ) {
    super();
  }

  update({ componentManager }: SystemContext) {
    const left = componentManager.getComponent(this.entity, this.left)?.payload ?? null;
    const right = componentManager.getComponent(this.entity, this.right)?.payload ?? null;
    const value = left === null || right === null ? null : right - left;
    componentManager.addComponent(this.entity, this.out, value);
  }
}

class MovingAverageSystem extends System {
  private readonly window: number[];
  private sum: number;

  constructor(
    private readonly entity: number,
    private readonly input: ComponentType<number | null>,
    private readonly out: ComponentType<number | null>,
    private readonly windowSize: number,
  ) {
    super();
    this.window = [];
    this.sum = 0;
  }

  update({ componentManager }: SystemContext) {
    const next = componentManager.getComponent(this.entity, this.input)?.payload ?? null;
    if (next === null) {
      componentManager.addComponent(this.entity, this.out, null);
      return;
    }

    this.window.push(next);
    this.sum += next;
    if (this.window.length > this.windowSize) {
      const removed = this.window.shift();
      if (typeof removed === "number") {
        this.sum -= removed;
      }
    }
    const denom = this.window.length || 1;
    componentManager.addComponent(this.entity, this.out, this.sum / denom);
  }
}

function getCaptureSourceForId(captureId: string): string {
  return captureSources.get(captureId) ?? liveStreamStates.get(captureId)?.source ?? "";
}

function getDerivationGroup(groupId: string): DerivationGroup | null {
  if (!lastVisualizationState) {
    return null;
  }
  const groups = Array.isArray(lastVisualizationState.derivationGroups)
    ? lastVisualizationState.derivationGroups
    : [];
  return groups.find((group) => group && typeof group.id === "string" && group.id === groupId) ?? null;
}

async function streamMetricValuesFromSource(options: {
  source: string;
  metrics: SelectedMetric[];
  signal: AbortSignal;
  onValue: (event: { metric: SelectedMetric; tick: number; value: number | null }) => void;
}) {
  const { source, metrics, signal, onValue } = options;
  const componentLookup = new Map<string, Array<{ metric: SelectedMetric; rest: string[] }>>();
  const componentIdNeedles = new Set<string>();

  metrics.forEach((metric) => {
    if (metric.path.length >= 2) {
      const key = `${metric.path[0]}::${metric.path[1]}`;
      const rest = metric.path.slice(2);
      componentIdNeedles.add(metric.path[1]);
      const list = componentLookup.get(key);
      if (list) {
        list.push({ metric, rest });
      } else {
        componentLookup.set(key, [{ metric, rest }]);
      }
    }
  });

  const onLine = (line: string) => {
    if (!line.trim()) {
      return;
    }
    // Performance: avoid JSON.parse for lines that cannot possibly match our metric component ids.
    // This is critical for large JSONL captures where only a tiny fraction of lines contain the
    // component ids we care about.
    if (!line.includes("\"entities\"") && componentIdNeedles.size > 0) {
      let maybeRelevant = false;
      for (const needle of componentIdNeedles) {
        if (line.includes(needle)) {
          maybeRelevant = true;
          break;
        }
      }
      if (!maybeRelevant) {
        return;
      }
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
      metrics.forEach((metric) => {
        const rawValue = getValueAtPath(entities, metric.path);
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
        onValue({ metric, tick: numericTick, value });
      });
      return;
    }

    const entityId = (parsed as { entityId?: unknown }).entityId;
    const componentId = (parsed as { componentId?: unknown }).componentId;
    if (typeof entityId === "string" && typeof componentId === "string") {
      const list = componentLookup.get(`${entityId}::${componentId}`);
      if (!list) {
        return;
      }
      const valueSource = (parsed as { value?: unknown }).value;
      list.forEach(({ metric, rest }) => {
        const rawValue = rest.length === 0 ? valueSource : getValueAtPath(valueSource, rest);
        const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
        onValue({ metric, tick: numericTick, value });
      });
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
}

function safeInt(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? (value as number) : fallback;
}

function buildDerivationOutputComponents(outputKey: string) {
  return buildDerivationOutputComponentsFromKeys([outputKey]);
}

function buildDerivationOutputComponentsFromKeys(outputKeys: string[]) {
  const derivations: Record<string, number> = {};
  outputKeys.forEach((key) => {
    derivations[key] = 0;
  });
  const dummyFrame: CaptureRecord = {
    tick: 1,
    entities: {
      "0": {
        derivations: {
          ...derivations,
        },
      },
    },
  };
  return componentsFromFrame(dummyFrame);
}

async function runDerivationFromCommand(command: ControlCommand, ws: WebSocket) {
  const kind = (command as { kind?: unknown }).kind;
  const groupId = String((command as { groupId?: unknown }).groupId ?? "");
  const window = safeInt((command as { window?: unknown }).window, 20);
  const outputCaptureId =
    typeof (command as { outputCaptureId?: unknown }).outputCaptureId === "string"
      ? String((command as { outputCaptureId: string }).outputCaptureId)
      : "";
  const inputIndex = safeInt((command as { inputIndex?: unknown }).inputIndex, 0);
  const leftIndex = safeInt((command as { leftIndex?: unknown }).leftIndex, 0);
  const rightIndex = safeInt((command as { rightIndex?: unknown }).rightIndex, 1);

  if (kind !== "moving_average" && kind !== "diff") {
    throw new Error(`Unknown derivation kind: ${String(kind)}`);
  }
  if (!groupId.trim()) {
    throw new Error("groupId is required.");
  }
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    throw new Error("Frontend not connected.");
  }

  const group = getDerivationGroup(groupId);
  if (!group) {
    throw new Error(`Derivation group not found: ${groupId}`);
  }

  const metrics = Array.isArray(group.metrics) ? group.metrics : [];
  if (kind === "diff" && metrics.length < 2) {
    throw new Error(`Diff derivation requires at least 2 metrics (group ${groupId} has ${metrics.length}).`);
  }
  if (kind === "moving_average" && metrics.length < 1) {
    throw new Error(`Moving average derivation requires at least 1 metric (group ${groupId} has ${metrics.length}).`);
  }
  if (kind === "moving_average" && (!Number.isInteger(window) || window <= 0)) {
    throw new Error(`window must be a positive integer (got ${window}).`);
  }

  const derivedCaptureId =
    outputCaptureId.trim()
      ? outputCaptureId.trim()
      : kind === "moving_average"
        ? `derive-${groupId}-moving_average-${window}`
        : `derive-${groupId}-diff`;
  const outputKey =
    kind === "moving_average" ? `moving_avg_${window}` : "diff";

  // Stop any in-flight job targeting the same output capture id.
  for (const job of derivationJobs.values()) {
    if (job.outputCaptureId === derivedCaptureId && job.status === "running") {
      job.controller.abort();
      job.status = "stopped";
    }
  }

  resetFrameCache(derivedCaptureId);
  captureEnded.delete(derivedCaptureId);
  captureSources.delete(derivedCaptureId);
  captureMetadata.set(derivedCaptureId, { filename: `${derivedCaptureId}.jsonl`, source: undefined });
  captureComponentState.set(derivedCaptureId, { components: [], sentCount: 0 });
  captureStreamModes.set(derivedCaptureId, "full");
  captureLastTicks.delete(derivedCaptureId);
  liteFrameBuffers.delete(derivedCaptureId);

  const jobId = `derive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const controller = new AbortController();
  const job: DerivationJob = {
    jobId,
    kind,
    groupId,
    outputCaptureId: derivedCaptureId,
    startedAt: new Date().toISOString(),
    status: "running",
    error: null,
    controller,
  };
  derivationJobs.set(jobId, job);

  // Initialize the derived capture and ensure outputs are selectable immediately.
  sendToFrontend({ type: "capture_init", captureId: derivedCaptureId, filename: `${derivedCaptureId}.jsonl`, reset: true });
  updateCaptureComponents(derivedCaptureId, buildDerivationOutputComponents(outputKey));
  sendToFrontend({ type: "select_metric", captureId: derivedCaptureId, path: ["0", "derivations", outputKey] });

  const selectedInputs =
    kind === "moving_average"
      ? [metrics[Math.max(0, Math.min(metrics.length - 1, inputIndex))]]
      : [
          metrics[Math.max(0, Math.min(metrics.length - 1, leftIndex))],
          metrics[Math.max(0, Math.min(metrics.length - 1, rightIndex))],
        ];

  const entities = new EntityManager();
  const components = new ComponentManager();
  const systems = new SystemManager(entities, components);
  const root = entities.create();

  const entityId = "0";
  const componentId = "derivations";

  if (kind === "diff") {
    const leftMetric = selectedInputs[0];
    const rightMetric = selectedInputs[1];
    const leftKey = `${leftMetric.captureId}::${leftMetric.fullPath}`;
    const rightKey = `${rightMetric.captureId}::${rightMetric.fullPath}`;
    const leftSeries = new Map<number, number | null>();
    const rightSeries = new Map<number, number | null>();
    const emitted = new Set<number>();
    let maxTickLeft = 0;
    let maxTickRight = 0;

    const leftType = numberOrNullComponent("derive.in.left");
    const rightType = numberOrNullComponent("derive.in.right");
    const outType = numberOrNullComponent("derive.out.diff");
    systems.addSystem(new DiffSystem(root, leftType, rightType, outType));

    const emitDiff = (tick: number) => {
      if (emitted.has(tick)) {
        return;
      }
      const left = leftSeries.get(tick) ?? null;
      const right = rightSeries.get(tick) ?? null;
      components.addComponent(root, leftType, left);
      components.addComponent(root, rightType, right);
      systems.runCycle();
      const diff = components.getComponent(root, outType)?.payload ?? null;
      sendCaptureAppend(derivedCaptureId, {
        tick,
        entityId,
        componentId,
        value: { [outputKey]: diff },
      });
      emitted.add(tick);
    };

    const byCapture = new Map<string, SelectedMetric[]>();
    selectedInputs.forEach((metric) => {
      const list = byCapture.get(metric.captureId);
      if (list) {
        list.push(metric);
      } else {
        byCapture.set(metric.captureId, [metric]);
      }
    });

    const streamPromises = Array.from(byCapture.entries()).map(async ([captureId, captureMetrics]) => {
      const source = getCaptureSourceForId(captureId);
      if (!source.trim()) {
        throw new Error(`No capture source found for captureId ${captureId}`);
      }
      await streamMetricValuesFromSource({
        source,
        metrics: captureMetrics,
        signal: controller.signal,
        onValue: ({ metric, tick, value }) => {
          if (controller.signal.aborted) {
            return;
          }
          const metricKey = `${metric.captureId}::${metric.fullPath}`;
          if (metricKey === leftKey) {
            leftSeries.set(tick, value);
            if (tick > maxTickLeft) {
              maxTickLeft = tick;
            }
            if (rightSeries.has(tick)) {
              emitDiff(tick);
            }
            return;
          }
          if (metricKey === rightKey) {
            rightSeries.set(tick, value);
            if (tick > maxTickRight) {
              maxTickRight = tick;
            }
            if (leftSeries.has(tick)) {
              emitDiff(tick);
            }
          }
        },
      });
    });

    await Promise.all(streamPromises);

    const tickEnd = Math.max(1, maxTickLeft, maxTickRight);
    for (let tick = 1; tick <= tickEnd; tick += 1) {
      if (controller.signal.aborted) {
        job.status = "stopped";
        sendCaptureEnd(derivedCaptureId);
        return;
      }
      if (emitted.has(tick)) {
        continue;
      }
      emitDiff(tick);
    }
  } else {
    const inputMetric = selectedInputs[0];
    let lastTickEmitted = 0;

    const inType = numberOrNullComponent("derive.in.value");
    const outType = numberOrNullComponent("derive.out.moving_avg");
    systems.addSystem(new MovingAverageSystem(root, inType, outType, window));

    const source = getCaptureSourceForId(inputMetric.captureId);
    if (!source.trim()) {
      throw new Error(`No capture source found for captureId ${inputMetric.captureId}`);
    }

    await streamMetricValuesFromSource({
      source,
      metrics: [inputMetric],
      signal: controller.signal,
      onValue: ({ tick, value }) => {
        if (controller.signal.aborted) {
          return;
        }
        if (tick <= lastTickEmitted) {
          return;
        }
        while (lastTickEmitted + 1 < tick) {
          const gapTick = lastTickEmitted + 1;
          components.addComponent(root, inType, null);
          systems.runCycle();
          const ma = components.getComponent(root, outType)?.payload ?? null;
          sendCaptureAppend(derivedCaptureId, {
            tick: gapTick,
            entityId,
            componentId,
            value: { [outputKey]: ma },
          });
          lastTickEmitted = gapTick;
        }

        components.addComponent(root, inType, value);
        systems.runCycle();
        const ma = components.getComponent(root, outType)?.payload ?? null;
        sendCaptureAppend(derivedCaptureId, {
          tick,
          entityId,
          componentId,
          value: { [outputKey]: ma },
        });
        lastTickEmitted = tick;
      },
    });
  }

  sendCaptureEnd(derivedCaptureId);
  job.status = "completed";

  ws.send(JSON.stringify({
    type: "ui_notice",
    payload: {
      message: "Derivation complete",
      context: { jobId, kind, groupId, outputCaptureId: derivedCaptureId },
    },
    request_id: command.request_id,
  } as ControlResponse));
}

function toUniqueCaptureId(base: string) {
  const trimmed = base.trim() || `derive-${Date.now()}`;
  if (
    !captureMetadata.has(trimmed) &&
    !captureSources.has(trimmed) &&
    !captureComponentState.has(trimmed) &&
    !liveStreamStates.has(trimmed)
  ) {
    return trimmed;
  }
  let counter = 2;
  while (counter < 1000) {
    const candidate = `${trimmed}-${counter}`;
    if (
      !captureMetadata.has(candidate) &&
      !captureSources.has(candidate) &&
      !captureComponentState.has(candidate) &&
      !liveStreamStates.has(candidate)
    ) {
      return candidate;
    }
    counter += 1;
  }
  return `${trimmed}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function runDerivationPluginFromCommand(command: ControlCommand, ws: WebSocket) {
  const pluginId = String((command as { pluginId?: unknown }).pluginId ?? "").trim();
  const groupId = String((command as { groupId?: unknown }).groupId ?? "").trim();
  const params = (command as { params?: unknown }).params;
  const outputCaptureId =
    typeof (command as { outputCaptureId?: unknown }).outputCaptureId === "string"
      ? String((command as { outputCaptureId: string }).outputCaptureId)
      : "";

  if (!pluginId) {
    throw new Error("pluginId is required.");
  }
  if (!groupId) {
    throw new Error("groupId is required.");
  }
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    throw new Error("Frontend not connected.");
  }

  const pluginRecord = derivationPlugins.get(pluginId);
  if (!pluginRecord) {
    throw new Error(`Derivation plugin not found: ${pluginId}`);
  }
  if (!pluginRecord.valid) {
    throw new Error(`Derivation plugin is invalid: ${pluginId}${pluginRecord.error ? ` (${pluginRecord.error})` : ""}`);
  }

  const loaded = await loadDerivationPluginFromFile(pluginRecord.filePath);
  const manifest = loaded.manifest;
  if (!manifest) {
    throw new Error(`Failed to load derivation plugin: ${pluginId}${loaded.record.error ? ` (${loaded.record.error})` : ""}`);
  }

  const group = getDerivationGroup(groupId);
  if (!group) {
    throw new Error(`Derivation group not found: ${groupId}`);
  }
  const metrics = Array.isArray(group.metrics) ? group.metrics : [];
  const minInputs = Number.isInteger(manifest.minInputs) ? (manifest.minInputs as number) : 1;
  const maxInputs =
    Number.isInteger(manifest.maxInputs) && (manifest.maxInputs as number) >= minInputs
      ? (manifest.maxInputs as number)
      : null;
  if (metrics.length < minInputs) {
    throw new Error(`Plugin ${pluginId} requires at least ${minInputs} input metrics (group ${groupId} has ${metrics.length}).`);
  }
  if (maxInputs !== null && metrics.length > maxInputs) {
    throw new Error(`Plugin ${pluginId} allows at most ${maxInputs} input metrics (group ${groupId} has ${metrics.length}).`);
  }

  const outputKeys = manifest.outputs.map((output) => output.key);
  const trimmedOutputCaptureId = outputCaptureId.trim();
  const derivedBase = trimmedOutputCaptureId ? trimmedOutputCaptureId : `derive-${groupId}-${pluginId}`;
  // For replay/restore flows we want a stable output id. Only uniquify when the caller didn't specify one.
  const derivedCaptureId = trimmedOutputCaptureId ? derivedBase : toUniqueCaptureId(derivedBase);

  // Stop any in-flight job targeting the same output capture id.
  for (const existing of derivationJobs.values()) {
    if (existing.outputCaptureId === derivedCaptureId && existing.status === "running") {
      existing.controller.abort();
      existing.status = "stopped";
    }
  }

  const jobId = `derive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const controller = new AbortController();
  const job: DerivationJob = {
    jobId,
    kind: "plugin",
    groupId,
    outputCaptureId: derivedCaptureId,
    startedAt: new Date().toISOString(),
    status: "running",
    error: null,
    controller,
  };
  derivationJobs.set(jobId, job);

  resetFrameCache(derivedCaptureId);
  captureEnded.delete(derivedCaptureId);
  captureSources.delete(derivedCaptureId);
  captureMetadata.set(derivedCaptureId, { filename: `${derivedCaptureId}.jsonl`, source: undefined });
  captureComponentState.set(derivedCaptureId, { components: [], sentCount: 0 });
  captureStreamModes.set(derivedCaptureId, "full");
  captureLastTicks.delete(derivedCaptureId);
  liteFrameBuffers.delete(derivedCaptureId);

  sendToFrontend({ type: "capture_init", captureId: derivedCaptureId, filename: `${derivedCaptureId}.jsonl`, reset: true });
  updateCaptureComponents(derivedCaptureId, buildDerivationOutputComponentsFromKeys(outputKeys));
  outputKeys.forEach((key) => {
    sendToFrontend({ type: "select_metric", captureId: derivedCaptureId, path: ["0", "derivations", key] });
  });

  const entities = new EntityManager();
  const components = new ComponentManager();
  const systems = new SystemManager(entities, components);
  const root = entities.create();

  const inputTypes = metrics.map((_metric, index) => numberOrNullComponent(`derive.in.${index}`));
  const outputsMap: Record<string, ComponentType<number | null>> = {};
  outputKeys.forEach((key) => {
    outputsMap[key] = numberOrNullComponent(`derive.out.${key}`);
  });

  const created = manifest.createSystems({
    entity: root,
    inputs: metrics.map((metric, index) => ({ metric, component: inputTypes[index]!, index })),
    outputs: outputsMap,
    params,
  });
  const systemList = Array.isArray(created) ? created : [created];
  systemList.forEach((system) => {
    if (!system || typeof (system as any).update !== "function") {
      throw new Error("createSystems must return System-like objects with an update(context) method.");
    }
    if (typeof (system as any).initialize !== "function") {
      (system as any).initialize = () => {};
    }
    if (typeof (system as any).destroy !== "function") {
      (system as any).destroy = () => {};
    }
    systems.addSystem(system as any);
  });

  const totalInputs = metrics.length;
  const metricIndexByKey = new Map<string, number>();
  metrics.forEach((metric, index) => {
    metricIndexByKey.set(`${metric.captureId}::${metric.fullPath}`, index);
  });

  const UNSET = Symbol("unset");
  type TickEntry = { values: Array<number | null | typeof UNSET>; count: number };
  const tickBuffer = new Map<number, TickEntry>();
  const firstTickByIndex: Array<number | null> = Array.from({ length: totalInputs }, () => null);
  let startTick: number | null = null;
  let nextTick: number | null = null;
  let maxTickObserved = 0;

  const ensureEntry = (tick: number): TickEntry => {
    const existing = tickBuffer.get(tick);
    if (existing) {
      return existing;
    }
    const entry: TickEntry = { values: Array.from({ length: totalInputs }, () => UNSET), count: 0 };
    tickBuffer.set(tick, entry);
    return entry;
  };

  const setValue = (index: number, tick: number, value: number | null) => {
    const entry = ensureEntry(tick);
    if (entry.values[index] === UNSET) {
      entry.count += 1;
    }
    entry.values[index] = value;
  };

  const runTick = (tick: number, values: Array<number | null>) => {
    components.addComponent(root, TimeComponent, { tick });
    values.forEach((value, index) => {
      components.addComponent(root, inputTypes[index]!, value);
    });
    systems.runCycle();
    const outValue: Record<string, number | null> = {};
    outputKeys.forEach((key) => {
      const payload = components.getComponent(root, outputsMap[key]!)?.payload ?? null;
      outValue[key] = payload === null || isFiniteNumber(payload) ? payload : null;
    });
    sendCaptureAppend(derivedCaptureId, {
      tick,
      entityId: "0",
      componentId: "derivations",
      value: outValue,
    });
  };

  const trySetStartTick = () => {
    if (startTick !== null) {
      return;
    }
    if (firstTickByIndex.some((entry) => entry === null)) {
      return;
    }
    const ticks = firstTickByIndex.filter((entry): entry is number => typeof entry === "number");
    if (ticks.length === 0) {
      return;
    }
    startTick = Math.min(...ticks);
    nextTick = startTick;
  };

  const tryEmit = () => {
    if (startTick === null || nextTick === null) {
      return;
    }
    while (nextTick !== null) {
      const entry = tickBuffer.get(nextTick);
      if (!entry || entry.count < totalInputs) {
        return;
      }
      const values = entry.values.map((value) => (value === UNSET ? null : value)) as Array<number | null>;
      tickBuffer.delete(nextTick);
      runTick(nextTick, values);
      nextTick += 1;
    }
  };

  const byCapture = new Map<string, SelectedMetric[]>();
  metrics.forEach((metric) => {
    const list = byCapture.get(metric.captureId);
    if (list) {
      list.push(metric);
    } else {
      byCapture.set(metric.captureId, [metric]);
    }
  });

  const streamPromises = Array.from(byCapture.entries()).map(async ([captureId, captureMetrics]) => {
    const source = getCaptureSourceForId(captureId);
    if (!source.trim()) {
      throw new Error(`No capture source found for captureId ${captureId}`);
    }
    await streamMetricValuesFromSource({
      source,
      metrics: captureMetrics,
      signal: controller.signal,
      onValue: ({ metric, tick, value }) => {
        if (controller.signal.aborted) {
          return;
        }
        maxTickObserved = Math.max(maxTickObserved, tick);
        const index = metricIndexByKey.get(`${metric.captureId}::${metric.fullPath}`);
        if (typeof index !== "number") {
          return;
        }
        if (firstTickByIndex[index] === null) {
          firstTickByIndex[index] = tick;
        }
        setValue(index, tick, value);
        trySetStartTick();
        tryEmit();
      },
    });
  });

  await Promise.all(streamPromises);

  const tickEnd = Array.from(byCapture.keys()).reduce((acc, captureId) => {
    const last = captureLastTicks.get(captureId) ?? liveStreamStates.get(captureId)?.lastTick ?? null;
    return typeof last === "number" ? Math.max(acc, last) : acc;
  }, Math.max(1, maxTickObserved));

  if (startTick === null || nextTick === null) {
    startTick = 1;
    nextTick = 1;
  }

  for (let tick = nextTick; tick <= tickEnd; tick += 1) {
    if (controller.signal.aborted) {
      job.status = "stopped";
      sendCaptureEnd(derivedCaptureId);
      return;
    }
    const entry = tickBuffer.get(tick);
    const values = entry
      ? (entry.values.map((value) => (value === UNSET ? null : value)) as Array<number | null>)
      : Array.from({ length: totalInputs }, () => null);
    runTick(tick, values);
  }

  sendCaptureEnd(derivedCaptureId);
  job.status = "completed";

  ws.send(
    JSON.stringify({
      type: "ui_notice",
      payload: {
        message: "Derivation plugin complete",
        context: { jobId, pluginId, groupId, outputCaptureId: derivedCaptureId },
      },
      request_id: command.request_id,
    } as ControlResponse),
  );
}
type CachedFrame = {
  frame: CaptureRecord;
  index: number;
  bytes: number;
};
const captureFrameSamples = new Map<string, CachedFrame[]>();
const captureFrameTail = new Map<string, CachedFrame[]>();
const captureFrameSampleBytes = new Map<string, number>();
const captureFrameTailBytes = new Map<string, number>();
const captureFrameCacheStats = new Map<
  string,
  { totalFrames: number; totalBytes: number; sampleEvery: number; tailCount: number }
>();
const captureFrameCacheDisabled = new Set<string>();
let lastCacheBudgetCount = 0;
const captureComponentState = new Map<
  string,
  {
    components: ComponentNode[];
    sentCount: number;
    lastSentAt?: number;
  }
>();
const CAPTURE_COMPONENT_SEND_INTERVAL_MS = 1000;

function resetFrameCache(captureId: string) {
  captureFrameSamples.delete(captureId);
  captureFrameTail.delete(captureId);
  captureFrameSampleBytes.delete(captureId);
  captureFrameTailBytes.delete(captureId);
  captureFrameCacheStats.delete(captureId);
  captureFrameCacheDisabled.delete(captureId);
}

function canCacheSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    return false;
  }
  return !trimmed.startsWith("http://") && !trimmed.startsWith("https://");
}

function cacheCaptureFrame(options: {
  captureId: string;
  source: string;
  frame: CaptureRecord;
  rawLine: string;
}) {
  const { captureId, source, frame, rawLine } = options;
  if (!ENABLE_FRAME_CACHE) {
    return;
  }
  if (captureFrameCacheDisabled.has(captureId)) {
    return;
  }
  if (!canCacheSource(source)) {
    return;
  }
  const lineBytes = Buffer.byteLength(rawLine, "utf8");
  if (lineBytes > MAX_FRAME_CACHE_BYTES) {
    captureFrameCacheDisabled.add(captureId);
    return;
  }

  const stats =
    captureFrameCacheStats.get(captureId) ?? {
      totalFrames: 0,
      totalBytes: 0,
      sampleEvery: 1,
      tailCount: DEFAULT_CACHE_TAIL_FRAMES,
    };
  stats.totalFrames += 1;
  stats.totalBytes += lineBytes;
  captureFrameCacheStats.set(captureId, stats);

  const activeCount = Math.max(1, captureFrameCacheStats.size);
  const perCaptureBudget = Math.floor(MAX_FRAME_CACHE_BYTES / activeCount);
  const averageBytes = Math.max(1, Math.floor(stats.totalBytes / stats.totalFrames));
  const maxFramesForBudget = Math.max(1, Math.floor(perCaptureBudget / averageBytes));
  const nextTailCount = Math.max(1, Math.min(DEFAULT_CACHE_TAIL_FRAMES, maxFramesForBudget));
  const desiredSampleCount = Math.max(1, maxFramesForBudget - nextTailCount);
  const nextSampleEvery = Math.max(1, Math.ceil(stats.totalFrames / desiredSampleCount));

  const resample = nextSampleEvery > stats.sampleEvery || nextTailCount < stats.tailCount;
  stats.sampleEvery = nextSampleEvery;
  stats.tailCount = nextTailCount;

  if (resample) {
    const samples = captureFrameSamples.get(captureId) ?? [];
    const filtered = samples.filter((item) => item.index % stats.sampleEvery === 0);
    captureFrameSamples.set(captureId, filtered);
    captureFrameSampleBytes.set(
      captureId,
      filtered.reduce((sum, item) => sum + item.bytes, 0),
    );
    const tail = captureFrameTail.get(captureId) ?? [];
    if (tail.length > stats.tailCount) {
      const trimmed = tail.slice(tail.length - stats.tailCount);
      captureFrameTail.set(captureId, trimmed);
      captureFrameTailBytes.set(
        captureId,
        trimmed.reduce((sum, item) => sum + item.bytes, 0),
      );
    }
  }

  const frameEntry: CachedFrame = {
    frame,
    index: stats.totalFrames,
    bytes: lineBytes,
  };

  if (frameEntry.index % stats.sampleEvery === 0) {
    const samples = captureFrameSamples.get(captureId) ?? [];
    samples.push(frameEntry);
    captureFrameSamples.set(captureId, samples);
    captureFrameSampleBytes.set(
      captureId,
      (captureFrameSampleBytes.get(captureId) ?? 0) + frameEntry.bytes,
    );
  }

  const tail = captureFrameTail.get(captureId) ?? [];
  tail.push(frameEntry);
  if (tail.length > stats.tailCount) {
    const removed = tail.splice(0, tail.length - stats.tailCount);
    const removedBytes = removed.reduce((sum, item) => sum + item.bytes, 0);
    captureFrameTailBytes.set(
      captureId,
      Math.max(0, (captureFrameTailBytes.get(captureId) ?? 0) - removedBytes),
    );
  }
  captureFrameTail.set(captureId, tail);
  captureFrameTailBytes.set(
    captureId,
    (captureFrameTailBytes.get(captureId) ?? 0) + frameEntry.bytes,
  );

  if (captureFrameCacheStats.size !== lastCacheBudgetCount) {
    lastCacheBudgetCount = captureFrameCacheStats.size;
    const updatedActiveCount = Math.max(1, lastCacheBudgetCount);
    const updatedBudget = Math.floor(MAX_FRAME_CACHE_BYTES / updatedActiveCount);
    captureFrameCacheStats.forEach((existingStats, existingId) => {
      const avgBytes = Math.max(1, Math.floor(existingStats.totalBytes / existingStats.totalFrames));
      const maxFrames = Math.max(1, Math.floor(updatedBudget / avgBytes));
      const tailCount = Math.max(1, Math.min(DEFAULT_CACHE_TAIL_FRAMES, maxFrames));
      const desiredCount = Math.max(1, maxFrames - tailCount);
      const sampleEvery = Math.max(1, Math.ceil(existingStats.totalFrames / desiredCount));
      if (sampleEvery > existingStats.sampleEvery || tailCount < existingStats.tailCount) {
        existingStats.sampleEvery = sampleEvery;
        existingStats.tailCount = tailCount;
        captureFrameCacheStats.set(existingId, existingStats);
        const samples = captureFrameSamples.get(existingId) ?? [];
        const filtered = samples.filter((item) => item.index % existingStats.sampleEvery === 0);
        captureFrameSamples.set(existingId, filtered);
        captureFrameSampleBytes.set(
          existingId,
          filtered.reduce((sum, item) => sum + item.bytes, 0),
        );
        const tailFrames = captureFrameTail.get(existingId) ?? [];
        if (tailFrames.length > existingStats.tailCount) {
          const trimmed = tailFrames.slice(tailFrames.length - existingStats.tailCount);
          captureFrameTail.set(existingId, trimmed);
          captureFrameTailBytes.set(
            existingId,
            trimmed.reduce((sum, item) => sum + item.bytes, 0),
          );
        }
      }
    });
  }
}

function getCachedFramesForSeries(captureId: string): CaptureRecord[] {
  const samples = captureFrameSamples.get(captureId) ?? [];
  const tail = captureFrameTail.get(captureId) ?? [];
  if (samples.length === 0 && tail.length === 0) {
    return [];
  }
  const byTick = new Map<number, CaptureRecord>();
  samples.forEach((entry) => {
    byTick.set(entry.frame.tick, entry.frame);
  });
  tail.forEach((entry) => {
    byTick.set(entry.frame.tick, entry.frame);
  });
  return Array.from(byTick.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, frame]) => frame);
}

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
  const state = captureComponentState.get(captureId) ?? { components: [], sentCount: 0, lastSentAt: 0 };
  const merged = mergeComponentTrees(state.components, rawComponents);
  const pruned = pruneComponentTree(merged);
  const nodeCount = countComponentNodes(pruned);
  const now = Date.now();
  const shouldSend =
    nodeCount > state.sentCount &&
    (state.sentCount === 0 || now - (state.lastSentAt ?? 0) >= CAPTURE_COMPONENT_SEND_INTERVAL_MS);
  captureComponentState.set(captureId, {
    components: pruned,
    sentCount: shouldSend ? nodeCount : state.sentCount,
    lastSentAt: shouldSend ? now : state.lastSentAt,
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

function sendCaptureAppend(captureId: string, frame: CaptureAppendFrame) {
  captureLastTicks.set(captureId, frame.tick);
  const command: ControlCommand = { type: "capture_append", captureId, frame };
  if (!sendToFrontend(command)) {
    bufferCaptureFrame(command);
  }
}

function bufferLiteFrame(captureId: string, frame: CaptureAppendFrame) {
  const buffer = liteFrameBuffers.get(captureId) ?? [];
  buffer.push(frame);
  if (buffer.length > LITE_BUFFER_MAX_FRAMES) {
    buffer.splice(0, buffer.length - LITE_BUFFER_MAX_FRAMES);
  }
  liteFrameBuffers.set(captureId, buffer);
}

function flushLiteFrameBuffer(captureId: string) {
  const buffer = liteFrameBuffers.get(captureId);
  if (!buffer || buffer.length === 0) {
    return;
  }
  buffer.forEach((frame) => sendCaptureAppend(captureId, frame));
  liteFrameBuffers.delete(captureId);
}

function sendLiteAppendTick(captureId: string, tick: number) {
  captureLastTicks.set(captureId, tick);
  const frame: CaptureAppendFrame = { tick, entities: {} };
  const command: ControlCommand = { type: "capture_append", captureId, frame };
  sendToFrontend(command);
}

function sendCaptureTick(captureId: string, tick: number) {
  captureLastTicks.set(captureId, tick);
  const command: ControlCommand = { type: "capture_tick", captureId, tick };
  sendToFrontend(command);
}

function getStreamMode(captureId: string) {
  return captureStreamModes.get(captureId) ?? "lite";
}

function shouldStreamFrames(captureId: string) {
  if (getStreamMode(captureId) === "full") {
    return true;
  }
  const source = captureSources.get(captureId) ?? captureMetadata.get(captureId)?.source;
  return !source;
}

function sendCaptureEnd(captureId: string) {
  captureEnded.add(captureId);
  const command: ControlCommand = { type: "capture_end", captureId };
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
  captureEnded.delete(captureId);
  resetFrameCache(captureId);
  captureSources.set(captureId, source);
  captureMetadata.set(captureId, { filename, source });
  captureComponentState.set(captureId, { components: [], sentCount: 0 });
  captureStreamModes.set(captureId, "lite");
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

async function streamCaptureFromSource(captureId: string, source: string) {
  const controller = new AbortController();
  const onLine = (line: string) => {
    const frame = parseLineToFrame(line);
    if (!frame) {
      return;
    }
    cacheCaptureFrame({ captureId, source, frame, rawLine: line });
    updateCaptureComponents(captureId, componentsFromFrame(frame));
    if (shouldStreamFrames(captureId)) {
      sendCaptureAppend(captureId, frame);
    } else {
      bufferLiteFrame(captureId, frame);
      sendLiteAppendTick(captureId, frame.tick);
    }
  };
  try {
    const trimmed = source.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const response = await fetch(trimmed, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Capture fetch failed (${response.status})`);
      }
      await streamLinesFromResponse({ response, signal: controller.signal, onLine });
    } else {
      const filePath = resolveLocalCapturePath(trimmed);
      await streamLinesFromFile({
        filePath,
        startOffset: 0,
        initialRemainder: "",
        signal: controller.signal,
        onLine,
      });
    }
    sendCaptureEnd(captureId);
  } catch (error) {
    if (controller.signal.aborted && (error as Error).name === "AbortError") {
      return;
    }
    console.error("[upload] stream error:", error);
    sendCaptureEnd(captureId);
  }
}

function clearCaptureState() {
  clearPersistedCaptureSources();
  pendingCaptureBuffers.clear();
  captureComponentState.clear();
  captureSources.clear();
  captureMetadata.clear();
  captureStreamModes.clear();
  captureLastTicks.clear();
  liteFrameBuffers.clear();
  captureFrameSamples.clear();
  captureFrameTail.clear();
  captureFrameSampleBytes.clear();
  captureFrameTailBytes.clear();
  captureFrameCacheStats.clear();
  captureFrameCacheDisabled.clear();
  lastCacheBudgetCount = 0;
  stopAllLiveStreams();
  captureEnded.clear();
}

function removeCaptureState(captureId: string, options?: { persist?: boolean }) {
  if (!captureId) {
    return;
  }
  const persist = options?.persist !== false;
  if (persist) {
    removePersistedCaptureSource(captureId);
  }
  pendingCaptureBuffers.delete(captureId);
  captureComponentState.delete(captureId);
  captureSources.delete(captureId);
  captureMetadata.delete(captureId);
  captureStreamModes.delete(captureId);
  captureLastTicks.delete(captureId);
  liteFrameBuffers.delete(captureId);
  resetFrameCache(captureId);
  stopLiveStream(captureId);
  captureEnded.delete(captureId);
}

function isCaptureEmpty(captureId: string): boolean {
  if (!captureId) {
    return true;
  }
  if (liveStreamStates.has(captureId)) {
    return false;
  }
  if (captureSources.has(captureId)) {
    return false;
  }
  if (captureMetadata.get(captureId)?.source) {
    return false;
  }
  if (persistedCaptureSources.has(captureId)) {
    return false;
  }
  const pending = pendingCaptureBuffers.get(captureId);
  if (pending) {
    if (pending.frames.length > 0) {
      return false;
    }
  }
  const lastTick = captureLastTicks.get(captureId);
  if (typeof lastTick === "number") {
    return false;
  }
  return true;
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

  const syncIds = new Set<string>();
  for (const captureId of captureMetadata.keys()) {
    syncIds.add(captureId);
  }
  for (const captureId of captureSources.keys()) {
    syncIds.add(captureId);
  }
  for (const captureId of captureComponentState.keys()) {
    syncIds.add(captureId);
  }
  for (const captureId of captureLastTicks.keys()) {
    syncIds.add(captureId);
  }
  for (const captureId of liveStreamStates.keys()) {
    syncIds.add(captureId);
  }
  const captures = Array.from(syncIds).map((captureId) => ({
    captureId,
    lastTick:
      captureLastTicks.get(captureId) ?? liveStreamStates.get(captureId)?.lastTick ?? null,
  }));
  frontendClient.send(
    JSON.stringify({ type: "state_sync", captures } satisfies ControlCommand),
  );
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
    const lastTick = captureLastTicks.get(pending.captureId);
    const lastBufferedTick =
      pending.frames.length > 0 ? pending.frames[pending.frames.length - 1]?.tick ?? null : null;
    for (const frame of pending.frames) {
      frontendClient.send(
        JSON.stringify({ type: "capture_append", captureId: pending.captureId, frame }),
      );
    }
    if (typeof lastTick === "number") {
      if (lastBufferedTick === null || lastTick > lastBufferedTick) {
        frontendClient.send(
          JSON.stringify({
            type: "capture_append",
            captureId: pending.captureId,
            frame: { tick: lastTick, entities: {} },
          }),
        );
      }
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
    if (isCaptureEmpty(captureId)) {
      removeCaptureState(captureId);
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
    const lastTick = captureLastTicks.get(captureId);
    if (typeof lastTick === "number") {
      sendLiteAppendTick(captureId, lastTick);
    }
    // Capture completion is session-based in the browser (it only knows a capture finished after
    // seeing a capture_end). On refresh/reconnect, replay capture_end for captures that already
    // ended so the UI can show a stable state.
    if (captureEnded.has(captureId) && !liveStreamStates.has(captureId)) {
      sendToFrontend({ type: "capture_end", captureId });
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
    captureEnded.delete(captureId);
    return;
  }

  if (command.type === "capture_components") {
    pending.components = command.components;
    return;
  }

  if (command.type === "capture_end") {
    pending.ended = true;
    captureEnded.add(captureId);
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

function isRecoverableLiveFileError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && LIVE_RETRYABLE_FILE_ERRORS.has(code);
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
  let readBytes = 0;
  let recoverableIdle = false;

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
      cacheCaptureFrame({ captureId: state.captureId, source: state.source, frame, rawLine: line });
      state.frameCount += 1;
      appendedFrames += 1;
      state.lastTick = frame.tick;
      const rawComponents = componentsFromFrame(frame);
      updateCaptureComponents(state.captureId, rawComponents);
      if (shouldStreamFrames(state.captureId)) {
        captureLastTicks.set(state.captureId, frame.tick);
        sendToFrontend({ type: "capture_append", captureId: state.captureId, frame });
      } else {
        bufferLiteFrame(state.captureId, frame);
        sendLiteAppendTick(state.captureId, frame.tick);
      }
    };

    const isRemote = trimmed.startsWith("http://") || trimmed.startsWith("https://");
    if (isRemote) {
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
        resetFrameCache(state.captureId);
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
        maxLines: LIVE_MAX_LINES_PER_POLL,
        onLine: (line) => {
          state.lineOffset += 1;
          onLine(line);
        },
      });
      readBytes = result.bytesRead;
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
        resetFrameCache(state.captureId);
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
          maxLines: LIVE_MAX_LINES_PER_POLL,
          onLine: (line) => {
            state.lineOffset += 1;
            onLine(line);
          },
        });
        readBytes = result.bytesRead;
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
      if (isRecoverableLiveFileError(error)) {
        recoverableIdle = true;
      }
    }
  } finally {
    state.isPolling = false;
    const now = Date.now();
    const hasActivity = appendedFrames > 0 || readBytes > 0;
    if (recoverableIdle) {
      state.idleSince = null;
    } else if (hasActivity) {
      state.idleSince = null;
    } else if (state.idleSince === null) {
      state.idleSince = now;
    }

    if (!recoverableIdle && state.idleSince !== null) {
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
      const nextDelayMs =
        hasActivity && !recoverableIdle
          ? Math.min(state.pollIntervalMs, LIVE_FAST_POLL_MS)
          : state.pollIntervalMs;
      state.timer = setTimeout(() => {
        pollLiveCapture(state).catch((pollError) => {
          console.error("[live] Poll error:", pollError);
        });
      }, nextDelayMs);
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

function captureNeedsBootstrap(captureId: string) {
  if (!captureId) {
    return false;
  }
  if (liveStreamStates.has(captureId)) {
    return false;
  }
  const pending = pendingCaptureBuffers.get(captureId);
  if (pending && pending.frames.length > 0) {
    return false;
  }
  if (captureLastTicks.has(captureId)) {
    return false;
  }
  const componentState = captureComponentState.get(captureId);
  if (componentState && componentState.components.length > 0) {
    return false;
  }
  return true;
}

function ensurePersistedCaptureSourcesRunning() {
  if (!frontendClient || frontendClient.readyState !== WebSocket.OPEN) {
    return;
  }
  for (const entry of persistedCaptureSources.values()) {
    if (!entry.captureId || !entry.source.trim()) {
      continue;
    }
    if (!captureNeedsBootstrap(entry.captureId)) {
      continue;
    }
    if (liveStreamStates.has(entry.captureId)) {
      continue;
    }
    const pollIntervalMs =
      typeof entry.pollIntervalMs === "number" && Number.isFinite(entry.pollIntervalMs)
        ? entry.pollIntervalMs
        : 2000;
    const filename = entry.filename ?? inferFilename(entry.source);
    try {
      startLiveStream({
        source: entry.source,
        captureId: entry.captureId,
        filename,
        pollIntervalMs,
      });
    } catch (error) {
      console.warn("[persist] Failed to start persisted capture source:", entry.captureId, error);
    }
  }
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
  captureEnded.delete(captureId);
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
  if (!sendToFrontend({ type: "capture_init", captureId, filename, reset: true })) {
    throw new Error("Frontend not connected.");
  }
  captureSources.set(captureId, source);
  captureMetadata.set(captureId, { filename, source });
  syncPersistedCaptureSources(
    [{ captureId, source, filename, pollIntervalMs }],
    { replace: false },
  );
  captureStreamModes.set(captureId, "lite");
  liveStreamStates.set(captureId, state);
  captureComponentState.set(captureId, { components: [], sentCount: 0 });
  captureLastTicks.delete(captureId);
  liteFrameBuffers.delete(captureId);
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
  sendCaptureEnd(state.captureId);
  if (state.frameCount === 0 && isCaptureEmpty(state.captureId)) {
    removeCaptureState(state.captureId);
  }
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
            const previous = frontendClient;
            if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) {
              // Single-client assumption: replacing the frontend should close the old session.
              try {
                previous.close(1000, "frontend replaced");
              } catch {
                // ignore close errors
              }
            }
            frontendClient = ws;
            clientRoles.set(ws, "frontend");
            console.log("[ws] Frontend registered");
            ws.send(JSON.stringify({ type: "ack", payload: "registered as frontend" }));
            ensurePersistedCaptureSourcesRunning();
            flushQueuedCommands();
          } else {
            agentClients.add(ws);
            clientRoles.set(ws, "agent");
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
          if (message.type === "state_update") {
            const payload = (message as { payload?: unknown }).payload;
            if (payload && typeof payload === "object") {
              lastVisualizationState = payload as VisualizationState;
              lastVisualizationStateAt = new Date().toISOString();
            }
          }
          if (message.type === "sync_capture_sources") {
            const rawSources = (message as { sources?: unknown }).sources;
            const replace = Boolean((message as { replace?: unknown }).replace);
            const list = Array.isArray(rawSources) ? rawSources : [];
            const sources = list
              .map((entry) => {
                if (!entry || typeof entry !== "object") {
                  return null;
                }
                const captureId =
                  "captureId" in entry && typeof (entry as { captureId?: unknown }).captureId === "string"
                    ? (entry as { captureId: string }).captureId
                    : "id" in entry && typeof (entry as { id?: unknown }).id === "string"
                      ? (entry as { id: string }).id
                      : "";
                const source =
                  "source" in entry && typeof (entry as { source?: unknown }).source === "string"
                    ? (entry as { source: string }).source
                    : "";
                if (!captureId || !source.trim()) {
                  return null;
                }
                const filename =
                  "filename" in entry && typeof (entry as { filename?: unknown }).filename === "string"
                    ? (entry as { filename: string }).filename
                    : undefined;
                const pollIntervalMsRaw =
                  "pollIntervalMs" in entry ? Number((entry as { pollIntervalMs?: unknown }).pollIntervalMs) : NaN;
                const pollIntervalMs =
                  Number.isFinite(pollIntervalMsRaw) && pollIntervalMsRaw > 0 ? pollIntervalMsRaw : undefined;
                const next: { captureId: string; source: string; filename?: string; pollIntervalMs?: number } = {
                  captureId,
                  source,
                };
                if (filename) {
                  next.filename = filename;
                }
                if (pollIntervalMs !== undefined) {
                  next.pollIntervalMs = pollIntervalMs;
                }
                return next;
              })
              .filter((entry): entry is { captureId: string; source: string; filename?: string; pollIntervalMs?: number } =>
                Boolean(entry),
              );
            syncPersistedCaptureSources(sources, { replace });
            ensurePersistedCaptureSourcesRunning();
            return;
          }
          if (message.type === "run_derivation") {
            const command = message as ControlCommand;
            runDerivationFromCommand(command, ws).catch((error) => {
              console.error("[derivation] run error:", error);
              ws.send(JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Failed to run derivation.",
                request_id: command.request_id,
              } as ControlResponse));
            });
            ws.send(JSON.stringify({
              type: "ack",
              payload: { command: "run_derivation" },
              request_id: command.request_id,
            } as ControlResponse));
            return;
          }
          if (message.type === "run_derivation_plugin") {
            const command = message as ControlCommand;
            runDerivationPluginFromCommand(command, ws).catch((error) => {
              console.error("[derivation-plugin] run error:", error);
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: error instanceof Error ? error.message : "Failed to run derivation plugin.",
                  request_id: command.request_id,
                } as ControlResponse),
              );
            });
            ws.send(
              JSON.stringify({
                type: "ack",
                payload: { command: "run_derivation_plugin" },
                request_id: command.request_id,
              } as ControlResponse),
            );
            return;
          }
          if (message.type === "set_stream_mode") {
            const captureId = String(message.captureId ?? "");
            const mode = message.mode === "full" ? "full" : "lite";
            if (captureId) {
              captureStreamModes.set(captureId, mode);
              if (mode === "full") {
                flushLiteFrameBuffer(captureId);
              }
            }
          }
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
        if (command.type === "get_derivation_plugins") {
          ws.send(
            JSON.stringify({
              type: "derivation_plugins",
              payload: { plugins: Array.from(derivationPlugins.values()) },
              request_id: command.request_id,
            } as ControlResponse),
          );
          return;
        }
        if (command.type === "sync_capture_sources") {
          const sources = Array.isArray(command.sources) ? command.sources : [];
          syncPersistedCaptureSources(sources, { replace: Boolean(command.replace) });
          ensurePersistedCaptureSourcesRunning();
          ws.send(
            JSON.stringify({
              type: "ack",
              payload: { command: "sync_capture_sources", count: sources.length },
              request_id: command.request_id,
            } as ControlResponse),
          );
          return;
        }
        if (command.type === "run_derivation") {
          runDerivationFromCommand(command, ws).catch((error) => {
            console.error("[derivation] run error:", error);
            ws.send(JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Failed to run derivation.",
              request_id: command.request_id,
            } as ControlResponse));
          });
          ws.send(JSON.stringify({
            type: "ack",
            payload: { command: "run_derivation" },
            request_id: command.request_id,
          } as ControlResponse));
          return;
        }
        if (command.type === "run_derivation_plugin") {
          runDerivationPluginFromCommand(command, ws).catch((error) => {
            console.error("[derivation-plugin] run error:", error);
            ws.send(
              JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Failed to run derivation plugin.",
                request_id: command.request_id,
              } as ControlResponse),
            );
          });
          ws.send(
            JSON.stringify({
              type: "ack",
              payload: { command: "run_derivation_plugin" },
              request_id: command.request_id,
            } as ControlResponse),
          );
          return;
        }
        if (command.type === "clear_captures") {
          clearCaptureState();
        }
        if (command.type === "remove_capture" && captureId) {
          removeCaptureState(captureId);
        }
        if (command.type === "capture_init" && captureId) {
          captureEnded.delete(captureId);
          captureComponentState.set(captureId, { components: [], sentCount: 0 });
          captureStreamModes.set(captureId, "lite");
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
          captureLastTicks.set(captureId, command.frame.tick);
          const rawComponents = componentsFromFrame(command.frame);
          updateCaptureComponents(captureId, rawComponents);
        }
        if (command.type === "set_stream_mode" && captureId) {
          const mode = command.mode === "full" ? "full" : "lite";
          captureStreamModes.set(captureId, mode);
          if (mode === "full") {
            flushLiteFrameBuffer(captureId);
          }
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
      const role = clientRoles.get(ws);
      clientRoles.delete(ws);
      if (role === "frontend") {
        if (ws === frontendClient) {
          frontendClient = null;
        }
        console.log("[ws] Frontend disconnected");
        return;
      }
      if (role === "agent") {
        agentClients.delete(ws);
        console.log("[ws] Agent disconnected, remaining:", agentClients.size);
        return;
      }
      if (ws === frontendClient) {
        frontendClient = null;
        console.log("[ws] Frontend disconnected");
        return;
      }
      agentClients.delete(ws);
      console.log("[ws] Agent disconnected, remaining:", agentClients.size);
    });

    ws.on("error", (err) => {
      console.error("[ws] Error:", err);
    });
  });

  const resolvedFilename =
    typeof __filename !== "undefined"
      ? __filename
      : fileURLToPath(import.meta.url);
  const resolvedDirname = path.dirname(resolvedFilename);
  
  function findUsageMd(): string | null {
    const possiblePaths = [
      path.resolve(resolvedDirname, "USAGE.md"),
      path.resolve(resolvedDirname, "..", "USAGE.md"),
      path.join(process.cwd(), "USAGE.md"),
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

  app.get("/api/derivations/plugins", (_req, res) => {
    const plugins = Array.from(derivationPlugins.values()).sort((a, b) =>
      b.uploadedAt.localeCompare(a.uploadedAt),
    );
    return res.json({ plugins });
  });

  app.get("/api/derivations/plugins/:pluginId/source", (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }

    const record = derivationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }

    const resolvedRoot = path.resolve(DERIVATION_PLUGIN_ROOT);
    const resolvedPath = path.resolve(record.filePath);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      return res.status(400).json({ error: "Invalid plugin path." });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "Plugin source file missing." });
    }

    // Avoid accidentally loading huge files into memory; truncation is explicit in the response.
    const MAX_SOURCE_BYTES = 512 * 1024;
    const buffer = fs.readFileSync(resolvedPath);
    const truncated = buffer.length > MAX_SOURCE_BYTES;
    const source = truncated ? buffer.subarray(0, MAX_SOURCE_BYTES).toString("utf-8") : buffer.toString("utf-8");

    return res.json({
      pluginId: record.id,
      name: record.name,
      filename: path.basename(record.filePath),
      bytes: buffer.length,
      truncated,
      source,
    });
  });

  app.post(
    "/api/derivations/plugins/upload",
    derivationPluginUpload.single("file"),
    async (req, res) => {
      try {
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ error: "No plugin file uploaded." });
        }
        const buffer: Buffer = req.file.buffer as Buffer;
        const hash = crypto.createHash("sha256").update(buffer).digest("hex");
        fs.mkdirSync(DERIVATION_PLUGIN_ROOT, { recursive: true });
        const filePath = path.join(DERIVATION_PLUGIN_ROOT, `${hash}.mjs`);
        const existed = fs.existsSync(filePath);
        if (!existed) {
          fs.writeFileSync(filePath, buffer);
        }

        const loaded = await loadDerivationPluginFromFile(filePath);
        const uploadedAt = new Date().toISOString();
        if (!loaded.record.valid || !loaded.manifest) {
          if (!existed) {
            try {
              fs.unlinkSync(filePath);
            } catch (error) {
              console.warn("[derivations] Failed to cleanup invalid plugin file:", error);
            }
          }
          return res.status(400).json({
            error: loaded.record.error ?? "Derivation plugin failed validation.",
            plugin: {
              ...loaded.record,
              filePath,
              hash,
              uploadedAt,
            },
          });
        }
        const record: DerivationPluginRecord = {
          ...loaded.record,
          filePath,
          hash,
          uploadedAt,
        };
        derivationPlugins.set(record.id, record);
        saveDerivationPluginIndex(Array.from(derivationPlugins.values()));

        const plugins = Array.from(derivationPlugins.values()).sort((a, b) =>
          b.uploadedAt.localeCompare(a.uploadedAt),
        );
        sendToFrontend({ type: "derivation_plugins", payload: { plugins } } as ControlResponse);
        return res.json({ success: true, plugin: record, plugins });
      } catch (error) {
        console.error("[derivations] Plugin upload error:", error);
        return res.status(500).json({ error: "Failed to upload derivation plugin." });
      }
    },
  );

  app.delete("/api/derivations/plugins/:pluginId", (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }
    const record = derivationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }
    derivationPlugins.delete(pluginId);
    saveDerivationPluginIndex(Array.from(derivationPlugins.values()));

    const stillReferenced = Array.from(derivationPlugins.values()).some(
      (entry) => entry.filePath === record.filePath,
    );
    if (!stillReferenced) {
      try {
        if (fs.existsSync(record.filePath)) {
          fs.unlinkSync(record.filePath);
        }
      } catch (error) {
        console.warn("[derivations] Failed to delete plugin file:", error);
      }
    }

    const plugins = Array.from(derivationPlugins.values()).sort((a, b) =>
      b.uploadedAt.localeCompare(a.uploadedAt),
    );
    sendToFrontend({ type: "derivation_plugins", payload: { plugins } } as ControlResponse);
    return res.json({ success: true, pluginId });
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
      streamCaptureFromSource(captureId, sourcePath).catch((error) => {
        console.error("[upload] stream error:", error);
      });

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

      const cachedFrames = getCachedFramesForSeries(captureId);
      const cacheStats = captureFrameCacheStats.get(captureId);
      const isSampled = cacheStats ? cacheStats.sampleEvery > 1 : false;
      const preferCache = req.body?.preferCache !== false;
      const isLive = liveStreamStates.has(captureId);
      const allowSampledCache = isLive;
      const usedCache =
        cachedFrames.length > 0 && preferCache && (allowSampledCache || !isSampled);
      const result =
        usedCache
          ? extractSeriesFromFrames(cachedFrames, path)
          : await extractSeriesFromSource({
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
        partial: usedCache && (isSampled || isLive),
      });
    } catch (error) {
      console.error("Series load error:", error);
      return res.status(500).json({ error: "Failed to load series." });
    }
  });

  app.post("/api/series/batch", async (req, res) => {
    try {
      const captureId = typeof req.body?.captureId === "string" ? req.body.captureId : "";
      if (!captureId.trim()) {
        return res.status(400).json({ error: "captureId is required." });
      }
      const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];
      const paths = rawPaths
        .map((path: unknown) => normalizePathInput(path))
        .filter((path: string[] | null): path is string[] => Array.isArray(path));
      if (paths.length === 0) {
        return res.status(400).json({ error: "paths must be an array of JSON string arrays." });
      }

      const source =
        captureSources.get(captureId) ?? liveStreamStates.get(captureId)?.source ?? "";
      if (!source) {
        return res.status(404).json({ error: "Capture source not found for captureId." });
      }

      const cachedFrames = getCachedFramesForSeries(captureId);
      const cacheStats = captureFrameCacheStats.get(captureId);
      const isSampled = cacheStats ? cacheStats.sampleEvery > 1 : false;
      const preferCache = req.body?.preferCache !== false;
      const isLive = liveStreamStates.has(captureId);
      const allowSampledCache = isLive;
      const usedCache =
        cachedFrames.length > 0 && preferCache && (allowSampledCache || !isSampled);
      const results =
        usedCache
          ? extractSeriesFromFramesBatch(cachedFrames, paths)
          : await extractSeriesBatchFromSource({
              source,
              paths,
              signal: new AbortController().signal,
            });

      const series = paths.map((path: string[], index: number) => {
        const result = results[index] ?? { points: [], numericCount: 0, lastTick: null, tickCount: 0 };
        return {
          path,
          fullPath: path.join("."),
          points: result.points,
          tickCount: result.tickCount,
          numericCount: result.numericCount,
          lastTick: result.lastTick,
          partial: usedCache && (isSampled || isLive),
        };
      });

      return res.json({ success: true, captureId, series });
    } catch (error) {
      console.error("Series batch load error:", error);
      return res.status(500).json({ error: "Failed to load series batch." });
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

  app.get("/api/debug/captures", (_req, res) => {
    const ids = new Set<string>();
    for (const captureId of captureMetadata.keys()) {
      ids.add(captureId);
    }
    for (const captureId of captureSources.keys()) {
      ids.add(captureId);
    }
    for (const captureId of captureComponentState.keys()) {
      ids.add(captureId);
    }
    for (const captureId of captureLastTicks.keys()) {
      ids.add(captureId);
    }
    for (const captureId of liveStreamStates.keys()) {
      ids.add(captureId);
    }
    const pendingIds = Array.from(pendingCaptureBuffers.keys());
    const captures = Array.from(ids).map((captureId) => ({
      captureId,
      lastTick: captureLastTicks.get(captureId) ?? null,
      ended: captureEnded.has(captureId),
      hasMetadata: captureMetadata.has(captureId),
      hasSource: captureSources.has(captureId),
      hasComponents: captureComponentState.has(captureId),
      hasLive: liveStreamStates.has(captureId),
      streamMode: captureStreamModes.get(captureId) ?? "lite",
      cachedFrames:
        (captureFrameSamples.get(captureId)?.length ?? 0) +
        (captureFrameTail.get(captureId)?.length ?? 0),
      cacheBytes:
        (captureFrameSampleBytes.get(captureId) ?? 0) +
        (captureFrameTailBytes.get(captureId) ?? 0),
      cacheDisabled: captureFrameCacheDisabled.has(captureId),
    }));
    res.json({ captures, pendingIds });
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
