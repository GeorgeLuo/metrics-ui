import { z } from "zod";

export const captureRecordSchema = z.object({
  tick: z.number(),
  entities: z.record(z.record(z.unknown())),
});

export type CaptureRecord = z.infer<typeof captureRecordSchema>;

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

export interface SeriesPoint {
  tick: number;
  value: number | null;
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
  currentTick: number;
  seriesSummary: Array<{
    captureId: string;
    path: string[];
    fullPath: string;
    label: string;
    summary: SeriesSummary;
  }>;
}

export interface RenderTableResponse {
  captureId: string | null;
  windowStart: number;
  windowEnd: number;
  columns: string[];
  rows: Array<Array<number | string | null>>;
}

export interface CapabilitiesResponse {
  protocolVersion: string;
  commands: string[];
  responses: string[];
}

export interface CaptureProgress {
  captureId: string;
  received: number;
  kept: number;
  dropped: number;
  lastTick?: number | null;
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
}

export const uploadResponseSchema = z.object({
  success: z.boolean(),
  tickCount: z.number(),
  components: z.array(z.unknown()),
  entityIds: z.array(z.string()),
  componentIds: z.array(z.string()),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

type ControlRequestBase = { request_id?: string };

export type ControlCommand =
  | ({ type: "hello" } & ControlRequestBase)
  | ({ type: "get_state" } & ControlRequestBase)
  | ({ type: "list_captures" } & ControlRequestBase)
  | ({ type: "toggle_capture"; captureId: string } & ControlRequestBase)
  | ({ type: "select_metric"; captureId: string; path: string[] } & ControlRequestBase)
  | ({ type: "deselect_metric"; captureId: string; fullPath: string } & ControlRequestBase)
  | ({ type: "clear_selection" } & ControlRequestBase)
  | ({ type: "play" } & ControlRequestBase)
  | ({ type: "pause" } & ControlRequestBase)
  | ({ type: "stop" } & ControlRequestBase)
  | ({ type: "seek"; tick: number } & ControlRequestBase)
  | ({ type: "set_speed"; speed: number } & ControlRequestBase)
  | ({ type: "capture_init"; captureId: string; filename?: string } & ControlRequestBase)
  | ({ type: "capture_append"; captureId: string; frame: CaptureRecord } & ControlRequestBase)
  | ({ type: "capture_end"; captureId: string } & ControlRequestBase)
  | ({ type: "get_display_snapshot"; captureId?: string; windowSize?: number } & ControlRequestBase)
  | ({ type: "get_series_window"; captureId: string; path: string[]; windowSize?: number } & ControlRequestBase)
  | ({ type: "query_components"; captureId?: string; search?: string; limit?: number } & ControlRequestBase)
  | ({ type: "get_render_table"; captureId?: string; windowSize?: number } & ControlRequestBase)
  | ({ type: "get_memory_stats" } & ControlRequestBase);

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
    | "ui_notice"
    | "ui_error"
    | "capture_progress"
    | "memory_stats";
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
  playback: PlaybackState;
}
