import { z } from "zod";

export const captureRecordSchema = z.object({
  tick: z.number(),
  entities: z.record(z.record(z.unknown())),
});

export type CaptureRecord = z.infer<typeof captureRecordSchema>;

export interface CaptureRecordLine {
  tick: number;
  entityId: string;
  componentId: string;
  value: unknown;
}

export type CaptureAppendFrame = CaptureRecord | CaptureRecordLine;
export type CaptureTick = { tick: number };

export interface CaptureSession {
  id: string;
  filename: string;
  fileSize: number;
  tickCount: number;
  records: CaptureRecord[];
  components: ComponentNode[];
  isActive: boolean;
}

export interface ParsedCapture {
  records: CaptureRecord[];
  tickCount: number;
  components: ComponentNode[];
  entityIds: string[];
  componentIds: string[];
}

export interface ComponentNode {
  id: string;
  label: string;
  path: string[];
  children: ComponentNode[];
  isLeaf: boolean;
  valueType: "number" | "string" | "object" | "array" | "boolean" | "null";
}

export interface SelectedMetric {
  captureId: string;
  path: string[];
  fullPath: string;
  label: string;
  color: string;
}

export interface DataPoint {
  tick: number;
  [key: string]: number | string | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTick: number;
  speed: number;
  totalTicks: number;
}

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

export interface Annotation {
  id: string;
  tick: number;
  label?: string;
  color?: string;
}

export interface SubtitleOverlay {
  id: string;
  startTick: number;
  endTick: number;
  text: string;
  color?: string;
}

export interface SeriesWindowResponse {
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

export interface ComponentsListResponse {
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

export interface RenderTableResponse {
  captureId: string | null;
  windowStart: number;
  windowEnd: number;
  columns: string[];
  rows: Array<Array<number | string | null>>;
}

export interface RenderDebugResponse {
  captureId: string | null;
  windowStart: number;
  windowEnd: number;
  windowSize: number;
  autoScroll: boolean;
  currentTick: number;
  captures: Array<{
    id: string;
    filename: string;
    isActive: boolean;
    recordCount: number;
    tickCount: number;
    componentNodes: number;
    windowRecordCount: number;
    selectedMetricCount: number;
    storesRecords: boolean;
  }>;
  selectedMetrics: SelectedMetric[];
  metrics: Array<{
    captureId: string;
    path: string[];
    fullPath: string;
    label: string;
    active: boolean;
    windowNumericCount: number;
    windowTotal: number;
    startValue: number | null;
    endValue: number | null;
    firstTick: number | null;
    lastTick: number | null;
  }>;
  windowPoints: number;
}

export interface UiDebugResponse {
  generatedAt: string;
  state: Record<string, unknown>;
  refs: Record<string, unknown>;
  localStorage?: Record<string, unknown>;
}

export interface CapabilitiesResponse {
  protocolVersion: string;
  commands: string[];
  responses: string[];
}

export interface ComponentTreeStats {
  nodes: number;
  leaves: number;
  numericLeaves: number;
  stringLeaves: number;
  booleanLeaves: number;
  nullLeaves: number;
  arrayNodes: number;
  objectNodes: number;
  maxDepth: number;
  pathSegments: number;
  pathChars: number;
  idChars: number;
  labelChars: number;
}

export interface ChartDataStats {
  points: number;
  totalObjectProps: number;
  totalMetricKeys: number;
  uniqueMetricKeys: number;
  keysPerPointMin: number;
  keysPerPointMax: number;
  keysPerPointAvg: number;
  numericValues: number;
  nullValues: number;
  nonNumericValues: number;
}

export interface SelectedMetricsStats {
  total: number;
  active: number;
  byCapture: Array<{ captureId: string; count: number }>;
}

export interface MemoryStatsEstimates {
  recordStoreBytes: number | null;
  chartDataBytes: number | null;
  effectiveBytesPerObjectProp: number;
  effectiveBytesPerSeriesPoint: number;
  estimateSource: "performance" | "default";
}

export interface SeriesMetricStats {
  fullPath: string;
  numericCount: number;
  estBytes: number;
}

export interface MemoryStatsCapture {
  captureId: string;
  filename: string;
  records: number;
  tickCount: number;
  componentNodes: number;
  componentTree: ComponentTreeStats;
  objectProps: number;
  leafValues: number;
  numeric: number;
  string: number;
  boolean: number;
  nulls: number;
  arrays: number;
  arrayValues: number;
  objects: number;
  stringChars: number;
  estimatedRecordBytes: number | null;
  seriesPoints: number;
  seriesBytes: number | null;
  seriesMetrics: SeriesMetricStats[];
}

export interface MemoryStatsTotals {
  captures: number;
  records: number;
  tickCountMax: number;
  componentNodes: number;
  objectProps: number;
  leafValues: number;
  numeric: number;
  string: number;
  boolean: number;
  nulls: number;
  arrays: number;
  arrayValues: number;
  objects: number;
  stringChars: number;
  estimatedRecordBytes: number | null;
  seriesPoints: number;
  seriesBytes: number | null;
}

export interface PerfSampleStats {
  samples: number;
  avgMs: number | null;
  maxMs: number | null;
  p95Ms: number | null;
}

export interface LongTaskStats {
  count: number;
  totalMs: number;
  maxMs: number;
  lastStart: number | null;
  lastDurationMs: number | null;
}

export interface UiLagStats {
  eventLoop: PerfSampleStats;
  frame: PerfSampleStats & { fps: number | null; avgFrameMs: number | null };
  longTasks: LongTaskStats;
  sampleWindow: {
    maxSamples: number;
    intervalMs: number;
  };
}

export interface ComponentUpdateStats {
  samples: number;
  avgMs: number | null;
  maxMs: number | null;
  p95Ms: number | null;
  lastMs: number | null;
  lastAt: number | null;
  lastNodes: number | null;
  throttled: number;
}

export interface MemoryStatsResponse {
  performanceMemoryAvailable: boolean;
  baselineHeap: number | null;
  usedHeap: number | null;
  totalHeap: number | null;
  heapLimit: number | null;
  heapDelta: number | null;
  bytesPerObjectProp: number | null;
  bytesPerLeafValue: number | null;
  chartData: ChartDataStats;
  selectedMetrics: SelectedMetricsStats;
  componentTreeTotals: ComponentTreeStats;
  estimates: MemoryStatsEstimates;
  captures: MemoryStatsCapture[];
  totals: MemoryStatsTotals;
  uiLag: UiLagStats;
  componentUpdates: ComponentUpdateStats;
}

export const uploadResponseSchema = z.union([
  z.object({
    success: z.boolean(),
    tickCount: z.number(),
    components: z.array(z.unknown()),
    entityIds: z.array(z.string()),
    componentIds: z.array(z.string()),
  }),
  z.object({
    success: z.boolean(),
    streaming: z.boolean(),
    captureId: z.string(),
    filename: z.string().optional(),
    size: z.number().optional(),
  }),
]);

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

type ControlRequestBase = { request_id?: string };

export type ControlCommand =
  | ({ type: "hello" } & ControlRequestBase)
  | ({ type: "get_state" } & ControlRequestBase)
  | ({ type: "list_captures" } & ControlRequestBase)
  | ({ type: "toggle_capture"; captureId: string } & ControlRequestBase)
  | ({ type: "remove_capture"; captureId: string } & ControlRequestBase)
  | ({ type: "select_metric"; captureId: string; path: string[] } & ControlRequestBase)
  | ({ type: "deselect_metric"; captureId: string; fullPath: string } & ControlRequestBase)
  | ({ type: "clear_selection" } & ControlRequestBase)
  | ({ type: "select_analysis_metric"; captureId: string; path: string[] } & ControlRequestBase)
  | ({ type: "deselect_analysis_metric"; captureId: string; fullPath: string } & ControlRequestBase)
  | ({ type: "clear_analysis_metrics" } & ControlRequestBase)
  | ({ type: "clear_captures" } & ControlRequestBase)
  | ({ type: "play" } & ControlRequestBase)
  | ({ type: "pause" } & ControlRequestBase)
  | ({ type: "stop" } & ControlRequestBase)
  | ({ type: "seek"; tick: number } & ControlRequestBase)
  | ({ type: "set_speed"; speed: number } & ControlRequestBase)
  | ({ type: "set_window_size"; windowSize: number } & ControlRequestBase)
  | ({ type: "set_window_start"; windowStart: number } & ControlRequestBase)
  | ({ type: "set_window_end"; windowEnd: number } & ControlRequestBase)
  | ({ type: "set_window_range"; windowStart: number; windowEnd: number } & ControlRequestBase)
  | ({ type: "set_auto_scroll"; enabled: boolean } & ControlRequestBase)
  | ({ type: "set_fullscreen"; enabled: boolean } & ControlRequestBase)
  | ({ type: "set_stream_mode"; captureId: string; mode: "lite" | "full" } & ControlRequestBase)
  | ({ type: "add_annotation"; tick: number; label?: string; color?: string; id?: string } & ControlRequestBase)
  | ({ type: "remove_annotation"; id?: string; tick?: number } & ControlRequestBase)
  | ({ type: "clear_annotations" } & ControlRequestBase)
  | ({ type: "jump_annotation"; direction: "next" | "previous" } & ControlRequestBase)
  | ({
      type: "add_subtitle";
      startTick: number;
      endTick: number;
      text: string;
      color?: string;
      id?: string;
    } & ControlRequestBase)
  | ({
      type: "remove_subtitle";
      id?: string;
      startTick?: number;
      endTick?: number;
      text?: string;
    } & ControlRequestBase)
  | ({ type: "clear_subtitles" } & ControlRequestBase)
  | ({ type: "set_source_mode"; mode: "file" | "live" } & ControlRequestBase)
  | ({ type: "set_live_source"; source: string; captureId?: string } & ControlRequestBase)
  | ({
      type: "state_sync";
      captures?: { captureId: string; lastTick?: number | null }[];
    } & ControlRequestBase)
  | ({
      type: "live_start";
      source?: string;
      pollIntervalMs?: number;
      captureId?: string;
      filename?: string;
    } & ControlRequestBase)
  | ({ type: "live_stop"; captureId?: string } & ControlRequestBase)
  | ({
      type: "capture_init";
      captureId: string;
      filename?: string;
      source?: string;
      reset?: boolean;
    } & ControlRequestBase)
  | ({ type: "capture_components"; captureId: string; components: ComponentNode[] } & ControlRequestBase)
  | ({ type: "capture_append"; captureId: string; frame: CaptureAppendFrame } & ControlRequestBase)
  | ({ type: "capture_tick"; captureId: string; tick: number } & ControlRequestBase)
  | ({ type: "capture_end"; captureId: string } & ControlRequestBase)
  | ({
      type: "get_display_snapshot";
      captureId?: string;
      windowSize?: number;
      windowStart?: number;
      windowEnd?: number;
    } & ControlRequestBase)
  | ({
      type: "get_series_window";
      captureId: string;
      path: string[];
      windowSize?: number;
      windowStart?: number;
      windowEnd?: number;
    } & ControlRequestBase)
  | ({ type: "query_components"; captureId?: string; search?: string; limit?: number } & ControlRequestBase)
  | ({
      type: "get_render_table";
      captureId?: string;
      windowSize?: number;
      windowStart?: number;
      windowEnd?: number;
    } & ControlRequestBase)
  | ({
      type: "get_render_debug";
      captureId?: string;
      windowSize?: number;
      windowStart?: number;
      windowEnd?: number;
    } & ControlRequestBase)
  | ({ type: "get_ui_debug" } & ControlRequestBase)
  | ({ type: "get_memory_stats" } & ControlRequestBase)
  | ({ type: "get_metric_coverage"; captureId?: string } & ControlRequestBase);

export interface ControlResponse {
  type:
    | "state_update"
    | "captures_list"
    | "error"
    | "ack"
    | "capabilities"
    | "display_snapshot"
    | "series_window"
    | "components_list"
    | "render_table"
    | "render_debug"
    | "ui_debug"
    | "ui_notice"
    | "ui_error"
    | "memory_stats"
    | "metric_coverage";
  request_id?: string;
  payload?: unknown;
  error?: string;
}

export interface VisualizationState {
  captures: Array<{
    id: string;
    filename: string;
    tickCount: number;
    isActive: boolean;
  }>;
  selectedMetrics: SelectedMetric[];
  analysisMetrics: SelectedMetric[];
  playback: PlaybackState;
  windowSize: number;
  windowStart: number;
  windowEnd: number;
  autoScroll: boolean;
  isFullscreen: boolean;
  viewport?: {
    width: number;
    height: number;
    chartWidth?: number;
    chartHeight?: number;
    devicePixelRatio?: number;
  };
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
}

export interface User {
  id: string;
  username: string;
  password: string;
}

export type InsertUser = Omit<User, "id">;
