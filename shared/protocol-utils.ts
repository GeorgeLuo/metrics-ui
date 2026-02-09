import type {
  Annotation,
  SubtitleOverlay,
  CaptureRecord,
  CaptureSession,
  ComponentNode,
  PlaybackState,
  SelectedMetric,
  RenderDebugResponse,
} from "./schema";

export interface SeriesSummary {
  last: number | null;
  min: number | null;
  max: number | null;
  nulls: number;
}

export interface MetricCoverage {
  captureId: string;
  path: string[];
  fullPath: string;
  label: string;
  numericCount: number;
  total: number;
  lastTick: number | null;
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
  windowStart: number;
  windowEnd: number;
  autoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  currentTick: number;
  seriesSummary: Array<{
    captureId: string;
    path: string[];
    fullPath: string;
    label: string;
    summary: SeriesSummary;
  }>;
  metricCoverage: MetricCoverage[];
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

function buildWindowRange({
  currentTick,
  windowSize,
  windowStart,
  windowEnd,
}: {
  currentTick: number;
  windowSize: number;
  windowStart?: number;
  windowEnd?: number;
}) {
  const size = Math.max(1, Math.floor(windowSize));
  const resolvedStart = isFiniteNumber(windowStart) ? Math.max(1, Math.floor(windowStart)) : null;
  const resolvedEnd = isFiniteNumber(windowEnd) ? Math.max(1, Math.floor(windowEnd)) : null;
  let end =
    resolvedEnd ??
    (resolvedStart !== null ? resolvedStart + size - 1 : Math.max(1, Math.floor(currentTick)));
  let start = resolvedStart ?? Math.max(1, end - size + 1);
  if (start > end) {
    [start, end] = [end, start];
  }
  return { start, end };
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

function summarizeCoverage(records: CaptureRecord[], path: string[]) {
  const total = records.length;
  let numericCount = 0;
  let lastTick: number | null = null;

  records.forEach((record) => {
    const value = getNumericValueAtPath(record, path);
    if (isFiniteNumber(value)) {
      numericCount += 1;
      lastTick = record.tick;
    }
  });

  return { total, numericCount, lastTick };
}

export function buildSeriesWindow({
  records,
  path,
  currentTick,
  windowSize,
  windowStart,
  windowEnd,
  captureId = "unknown",
}: {
  records: CaptureRecord[];
  path: string[];
  currentTick: number;
  windowSize: number;
  windowStart?: number;
  windowEnd?: number;
  captureId?: string;
}): SeriesWindow {
  const { start, end } = buildWindowRange({
    currentTick,
    windowSize,
    windowStart,
    windowEnd,
  });
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
  windowStart,
  windowEnd,
  autoScroll,
  annotations,
  subtitles,
  captureId,
}: {
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  playback: PlaybackState;
  windowSize: number;
  windowStart: number;
  windowEnd: number;
  autoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
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
        windowStart,
        windowEnd,
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
  const metricCoverage = buildMetricCoverage({
    captures,
    metrics: selectedMetrics,
    captureId: capture?.id,
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
    windowStart,
    windowEnd,
    autoScroll,
    annotations,
    subtitles,
    currentTick,
    seriesSummary: summary,
    metricCoverage,
  };
}

export function buildMetricCoverage({
  captures,
  metrics,
  captureId,
}: {
  captures: CaptureSession[];
  metrics: SelectedMetric[];
  captureId?: string;
}): MetricCoverage[] {
  const filteredMetrics = captureId
    ? metrics.filter((metric) => metric.captureId === captureId)
    : metrics;
  const byCapture = new Map<string, SelectedMetric[]>();

  filteredMetrics.forEach((metric) => {
    const list = byCapture.get(metric.captureId);
    if (list) {
      list.push(metric);
    } else {
      byCapture.set(metric.captureId, [metric]);
    }
  });

  const coverage: MetricCoverage[] = [];
  byCapture.forEach((captureMetrics, targetCaptureId) => {
    const targetCapture = captures.find((item) => item.id === targetCaptureId);
    const records = targetCapture?.records ?? [];
    captureMetrics.forEach((metric) => {
      const summary = summarizeCoverage(records, metric.path);
      coverage.push({
        captureId: metric.captureId,
        path: metric.path,
        fullPath: metric.fullPath,
        label: metric.label,
        numericCount: summary.numericCount,
        total: summary.total,
        lastTick: summary.lastTick,
      });
    });
  });

  return coverage;
}

export function buildRenderTable({
  records,
  metrics,
  currentTick,
  windowSize,
  windowStart,
  windowEnd,
  captureId = "unknown",
}: {
  records: CaptureRecord[];
  metrics: SelectedMetric[];
  currentTick: number;
  windowSize: number;
  windowStart?: number;
  windowEnd?: number;
  captureId?: string;
}): RenderTable {
  const { start, end } = buildWindowRange({
    currentTick,
    windowSize,
    windowStart,
    windowEnd,
  });
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

export function buildRenderDebug({
  captures,
  selectedMetrics,
  playback,
  windowSize,
  windowStart,
  windowEnd,
  autoScroll,
  captureId,
}: {
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  playback: PlaybackState;
  windowSize: number;
  windowStart?: number;
  windowEnd?: number;
  autoScroll: boolean;
  captureId?: string;
}): RenderDebugResponse {
  const { start, end } = buildWindowRange({
    currentTick: playback.currentTick,
    windowSize,
    windowStart,
    windowEnd,
  });

  const activeCaptures = captures.filter((capture) => capture.isActive);
  const activeCaptureIds = new Set(activeCaptures.map((capture) => capture.id));
  const selectedMetricCounts = selectedMetrics.reduce((acc, metric) => {
    acc.set(metric.captureId, (acc.get(metric.captureId) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  const metrics = selectedMetrics.map((metric) => {
    const capture = captures.find((item) => item.id === metric.captureId);
    const records = capture?.records ?? [];
    const windowRecords = records.filter((record) => record.tick >= start && record.tick <= end);
    let numericCount = 0;
    let firstTick: number | null = null;
    let lastTick: number | null = null;
    windowRecords.forEach((record) => {
      const value = getNumericValueAtPath(record, metric.path);
      if (typeof value === "number") {
        numericCount += 1;
        if (firstTick === null) firstTick = record.tick;
        lastTick = record.tick;
      }
    });
    const startRecord = records.find((record) => record.tick === start);
    const endRecord = records.find((record) => record.tick === end);
    const startValue = startRecord ? getNumericValueAtPath(startRecord, metric.path) : null;
    const endValue = endRecord ? getNumericValueAtPath(endRecord, metric.path) : null;
    return {
      captureId: metric.captureId,
      path: metric.path,
      fullPath: metric.fullPath,
      label: metric.label,
      active: activeCaptureIds.has(metric.captureId),
      windowNumericCount: numericCount,
      windowTotal: windowRecords.length,
      startValue,
      endValue,
      firstTick,
      lastTick,
    };
  });

  const windowTicks = new Set<number>();
  activeCaptures.forEach((capture) => {
    capture.records.forEach((record) => {
      if (record.tick >= start && record.tick <= end) {
        windowTicks.add(record.tick);
      }
    });
  });

  const captureSummaries = captures.map((capture) => {
    const windowRecordCount = capture.records.filter(
      (record) => record.tick >= start && record.tick <= end,
    ).length;
    const selectedMetricCount = selectedMetricCounts.get(capture.id) ?? 0;
    return {
      id: capture.id,
      filename: capture.filename,
      isActive: capture.isActive,
      recordCount: capture.records.length,
      tickCount: capture.tickCount,
      componentNodes: countComponentNodes(capture.components),
      windowRecordCount,
      selectedMetricCount,
      storesRecords: selectedMetricCount > 0,
    };
  });

  return {
    captureId: captureId ?? null,
    windowStart: start,
    windowEnd: end,
    windowSize: Math.max(1, end - start + 1),
    autoScroll,
    currentTick: playback.currentTick,
    captures: captureSummaries,
    selectedMetrics,
    metrics,
    windowPoints: windowTicks.size,
  };
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return {
    protocolVersion: "1.0.0",
    commands: [
      "hello",
      "get_state",
      "list_captures",
      "toggle_capture",
      "remove_capture",
      "select_metric",
      "deselect_metric",
      "clear_selection",
      "select_analysis_metric",
      "deselect_analysis_metric",
      "clear_analysis_metrics",
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
      "set_fullscreen",
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
      "capture_init",
      "capture_components",
      "capture_append",
      "capture_tick",
      "capture_end",
      "get_display_snapshot",
      "get_series_window",
      "query_components",
      "get_render_table",
      "get_render_debug",
      "get_ui_debug",
      "get_memory_stats",
      "get_metric_coverage",
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
      "render_debug",
      "ui_debug",
      "ui_notice",
      "ui_error",
      "memory_stats",
      "metric_coverage",
    ],
  };
}
