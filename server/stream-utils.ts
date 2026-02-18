import * as fs from "fs";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";
import type { ComponentNode } from "@shared/schema";
import { compactEntities, compactValue, DEFAULT_MAX_NUMERIC_DEPTH } from "@shared/compact";
import { buildComponentTreeFromEntities, mergeComponentTrees } from "@shared/component-tree";

export type CaptureRecord = {
  tick: number;
  entities: Record<string, Record<string, unknown>>;
};

export function mergeEntities(
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

export function applyParsedCaptureRecord(
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

export function parseJSONL(content: string): { records: CaptureRecord[]; components: ComponentNode[] } {
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

export type LineConsumerResult = {
  bytesRead: number;
  lineCount: number;
  remainder: string;
};

export function yieldToEventLoop(delayMs = 0): Promise<void> {
  const normalizedDelay = Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0;
  return new Promise((resolve) => setTimeout(resolve, normalizedDelay));
}

export function createAbortError() {
  const error = new Error("AbortError");
  error.name = "AbortError";
  return error;
}

export async function consumeLineStream(options: {
  readable: Readable;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
  maxLines?: number;
  yieldEveryLines?: number;
}): Promise<LineConsumerResult> {
  const { readable, signal, onLine } = options;
  let remainder = options.initialRemainder ?? "";
  let bytesRead = 0;
  let lineCount = 0;
  const maxLines = Number.isFinite(options.maxLines) ? Math.max(1, options.maxLines as number) : null;
  const yieldEveryLines =
    Number.isInteger(options.yieldEveryLines) && (options.yieldEveryLines as number) > 0
      ? (options.yieldEveryLines as number)
      : 0;
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
        if (yieldEveryLines > 0 && lineCount % yieldEveryLines === 0) {
          await yieldToEventLoop();
        }
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

export async function streamLinesFromFile(options: {
  filePath: string;
  startOffset: number;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
  maxLines?: number;
  yieldEveryLines?: number;
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
    yieldEveryLines: options.yieldEveryLines,
  });
}

export async function streamLinesFromResponse(options: {
  response: Response;
  initialRemainder?: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
  maxLines?: number;
  yieldEveryLines?: number;
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
      yieldEveryLines: options.yieldEveryLines,
    });
  }

  const readable = Readable.fromWeb(options.response.body as unknown as ReadableStream<Uint8Array>);
  return consumeLineStream({
    readable,
    initialRemainder: options.initialRemainder,
    signal: options.signal,
    onLine: options.onLine,
    maxLines: options.maxLines,
    yieldEveryLines: options.yieldEveryLines,
  });
}

export function normalizePathInput(pathInput: unknown): string[] | null {
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

export function getValueAtPath(source: unknown, path: string[]): unknown {
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

export function extractSeriesFromFrames(frames: CaptureRecord[], path: string[]) {
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

export function extractSeriesFromFramesBatch(frames: CaptureRecord[], paths: string[][]) {
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
