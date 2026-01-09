import type {
  CaptureRecord,
  CaptureSession,
  ComponentNode,
  PlaybackState,
  SelectedMetric,
} from "./schema";

export interface SeriesSummary {
  last: number | null;
  min: number | null;
  max: number | null;
  nulls: number;
}

export interface SeriesPoint {
  tick: number;
  value: number | null;
}

export interface SeriesWindow {
  captureId: string;
  path: string[];
  fullPath: string;
  windowStart: number;
  windowEnd: number;
  points: SeriesPoint[];
  summary: SeriesSummary;
}

export interface ComponentsListItem {
  captureId: string;
  path: string[];
  fullPath: string;
  label: string;
}

export interface ComponentsList {
  captureId: string | null;
  total: number;
  items: ComponentsListItem[];
}

export interface DisplaySnapshot {
  captureId: string | null;
  captures: Array<{
    id: string;
    filename: string;
    tickCount: number;
    isActive: boolean;
  }>;
  selectedMetrics: SelectedMetric[];
  playback: PlaybackState;
  windowSize: number;
  currentTick: number;
  seriesSummary: Array<{
    captureId: string;
    path: string[];
    fullPath: string;
    label: string;
    summary: SeriesSummary;
  }>;
}

export interface RenderTable {
  captureId: string | null;
  windowStart: number;
  windowEnd: number;
  columns: string[];
  rows: Array<Array<number | string | null>>;
}

export interface CapabilitiesPayload {
  protocolVersion: string;
  commands: string[];
  responses: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getNumericValueAtPath(
  record: CaptureRecord,
  path: string[],
): number | null {
  let value: unknown = record.entities;
  for (const part of path) {
    if (value && typeof value === "object" && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }

  return isFiniteNumber(value) ? value : null;
}

function buildWindowRange(currentTick: number, windowSize: number) {
  const size = Math.max(1, Math.floor(windowSize));
  const end = Math.max(1, Math.floor(currentTick));
  const start = Math.max(1, end - size + 1);
  return { start, end };
}

function summarizeSeries(points: SeriesPoint[]): SeriesSummary {
  let min: number | null = null;
  let max: number | null = null;
  let nulls = 0;

  points.forEach((point) => {
    if (point.value === null || !isFiniteNumber(point.value)) {
      nulls += 1;
      return;
    }
    min = min === null ? point.value : Math.min(min, point.value);
    max = max === null ? point.value : Math.max(max, point.value);
  });

  const lastPoint = points[points.length - 1];
  const last = lastPoint ? lastPoint.value : null;

  return { last, min, max, nulls };
}

export function buildSeriesWindow({
  records,
  path,
  currentTick,
  windowSize,
  captureId = "unknown",
}: {
  records: CaptureRecord[];
  path: string[];
  currentTick: number;
  windowSize: number;
  captureId?: string;
}): SeriesWindow {
  const { start, end } = buildWindowRange(currentTick, windowSize);
  const sorted = [...records].sort((a, b) => a.tick - b.tick);
  const windowRecords = sorted.filter(
    (record) => record.tick >= start && record.tick <= end,
  );

  const points: SeriesPoint[] = windowRecords.map((record) => ({
    tick: record.tick,
    value: getNumericValueAtPath(record, path),
  }));

  return {
    captureId,
    path,
    fullPath: path.join("."),
    windowStart: start,
    windowEnd: end,
    points,
    summary: summarizeSeries(points),
  };
}

function flattenComponentTree(
  nodes: ComponentNode[],
  captureId: string,
  items: ComponentsListItem[],
) {
  nodes.forEach((node) => {
    if (node.valueType === "number" && node.isLeaf) {
      items.push({
        captureId,
        path: node.path,
        fullPath: node.id,
        label: node.label,
      });
    }
    if (node.children.length > 0) {
      flattenComponentTree(node.children, captureId, items);
    }
  });
}

export function buildComponentsList({
  components,
  captureId = "unknown",
  search,
  limit = 200,
}: {
  components: ComponentNode[];
  captureId?: string;
  search?: string;
  limit?: number;
}): ComponentsList {
  const items: ComponentsListItem[] = [];
  flattenComponentTree(components, captureId, items);

  const query = search?.trim().toLowerCase();
  const filtered = query
    ? items.filter((item) => {
        const haystack = `${item.fullPath} ${item.label}`.toLowerCase();
        return haystack.includes(query);
      })
    : items;

  return {
    captureId,
    total: filtered.length,
    items: filtered.slice(0, limit),
  };
}

function resolveCapture({
  captures,
  captureId,
  selectedMetrics,
}: {
  captures: CaptureSession[];
  captureId?: string;
  selectedMetrics: SelectedMetric[];
}): CaptureSession | undefined {
  if (captureId) {
    return captures.find((capture) => capture.id === captureId);
  }
  if (selectedMetrics.length > 0) {
    const selectedCaptureId = selectedMetrics[0].captureId;
    return captures.find((capture) => capture.id === selectedCaptureId);
  }
  return captures.find((capture) => capture.isActive) ?? captures[0];
}

export function buildDisplaySnapshot({
  captures,
  selectedMetrics,
  playback,
  windowSize,
  captureId,
}: {
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  playback: PlaybackState;
  windowSize: number;
  captureId?: string;
}): DisplaySnapshot {
  const capture = resolveCapture({ captures, captureId, selectedMetrics });
  const currentTick = playback.currentTick;
  const summary = selectedMetrics
    .filter((metric) => !capture || metric.captureId === capture.id)
    .map((metric) => {
      const targetCapture =
        captures.find((item) => item.id === metric.captureId) ?? capture;
      if (!targetCapture) {
        return {
          captureId: metric.captureId,
          path: metric.path,
          fullPath: metric.fullPath,
          label: metric.label,
          summary: { last: null, min: null, max: null, nulls: 0 },
        };
      }
      const series = buildSeriesWindow({
        records: targetCapture.records,
        path: metric.path,
        currentTick,
        windowSize,
        captureId: targetCapture.id,
      });
      return {
        captureId: metric.captureId,
        path: metric.path,
        fullPath: metric.fullPath,
        label: metric.label,
        summary: series.summary,
      };
    });

  return {
    captureId: capture?.id ?? null,
    captures: captures.map((item) => ({
      id: item.id,
      filename: item.filename,
      tickCount: item.tickCount,
      isActive: item.isActive,
    })),
    selectedMetrics,
    playback,
    windowSize,
    currentTick,
    seriesSummary: summary,
  };
}

export function buildRenderTable({
  records,
  metrics,
  currentTick,
  windowSize,
  captureId = "unknown",
}: {
  records: CaptureRecord[];
  metrics: SelectedMetric[];
  currentTick: number;
  windowSize: number;
  captureId?: string;
}): RenderTable {
  const { start, end } = buildWindowRange(currentTick, windowSize);
  const sorted = [...records].sort((a, b) => a.tick - b.tick);
  const windowRecords = sorted.filter(
    (record) => record.tick >= start && record.tick <= end,
  );

  const columns = ["tick", ...metrics.map((metric) => metric.fullPath)];
  const rows = windowRecords.map((record) => {
    const row: Array<number | string | null> = [record.tick];
    metrics.forEach((metric) => {
      row.push(getNumericValueAtPath(record, metric.path));
    });
    return row;
  });

  return { captureId, windowStart: start, windowEnd: end, columns, rows };
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return {
    protocolVersion: "1.0.0",
    commands: [
      "hello",
      "get_state",
      "list_captures",
      "toggle_capture",
      "select_metric",
      "deselect_metric",
      "clear_selection",
      "play",
      "pause",
      "stop",
      "seek",
      "set_speed",
      "set_source_mode",
      "set_live_source",
      "live_start",
      "live_stop",
      "capture_init",
      "capture_append",
      "capture_end",
      "get_display_snapshot",
      "get_series_window",
      "query_components",
      "get_render_table",
      "get_memory_stats",
    ],
    responses: [
      "ack",
      "error",
      "state_update",
      "capabilities",
      "display_snapshot",
      "series_window",
      "components_list",
      "render_table",
      "ui_notice",
      "ui_error",
      "capture_progress",
      "memory_stats",
    ],
  };
}
