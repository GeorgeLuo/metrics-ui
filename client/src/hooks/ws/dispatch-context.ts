import type {
  Annotation,
  CaptureSession,
  ComponentNode,
  ControlCommand,
  ControlResponse,
  MemoryStatsResponse,
  PlaybackState,
  SelectedMetric,
  SubtitleOverlay,
  UiDebugResponse,
} from "@shared/schema";

export type RestoreStateCommand = Extract<ControlCommand, { type: "restore_state" }>;

export type UiNotice = {
  message: string;
  context?: Record<string, unknown>;
  requestId?: string;
};

export type UiError = {
  error: string;
  context?: Record<string, unknown>;
  requestId?: string;
};

export interface WsCommandDispatchContext {
  sendMessage: (message: ControlResponse | ControlCommand) => boolean;
  sendAck: (requestId: string | undefined, command: string) => void;
  sendError: (
    requestId: string | undefined,
    error: string,
    context?: Record<string, unknown>,
  ) => void;
  sendState: (requestId?: string) => void;
  markBootstrapped: () => void;
  resolveCapture: (captureId?: string) => CaptureSession | undefined;
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  playbackState: PlaybackState;
  windowSize: number;
  windowStart: number;
  windowEnd: number;
  autoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  isWindowed: boolean;
  onRestoreState?: (command: RestoreStateCommand) => void;
  onToggleCapture: (captureId: string) => void;
  onRemoveCapture: (captureId: string) => void;
  onSelectMetric: (captureId: string, path: string[], groupId?: string) => void;
  onSetMetricAxis: (captureId: string, fullPath: string, axis: "y1" | "y2") => void;
  onDeselectMetric: (captureId: string, fullPath: string) => void;
  onClearSelection: () => void;
  onSelectAnalysisMetric: (captureId: string, path: string[]) => boolean;
  onDeselectAnalysisMetric: (captureId: string, fullPath: string) => void;
  onClearAnalysisMetrics: () => void;
  onCreateDerivationGroup: (options?: { groupId?: string; name?: string }) => void;
  onDeleteDerivationGroup: (groupId: string) => void;
  onSetActiveDerivationGroup: (groupId: string) => void;
  onUpdateDerivationGroup: (
    groupId: string,
    updates: { newGroupId?: string; name?: string; pluginId?: string },
  ) => void;
  onReorderDerivationGroupMetrics: (groupId: string, fromIndex: number, toIndex: number) => void;
  onSetDisplayDerivationGroup: (groupId: string) => void;
  onClearCaptures: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
  onWindowSizeChange: (windowSize: number) => void;
  onWindowStartChange: (windowStart: number) => void;
  onWindowEndChange: (windowEnd: number) => void;
  onWindowRangeChange: (windowStart: number, windowEnd: number) => void;
  onYPrimaryRangeChange: (min: number, max: number) => void;
  onYSecondaryRangeChange: (min: number, max: number) => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onSetFullscreen: (enabled: boolean) => void;
  onSourceModeChange: (mode: "file" | "live") => void;
  onLiveSourceChange: (source: string, captureId?: string) => void;
  onLiveStart: (options: {
    source?: string;
    pollIntervalMs?: number;
    captureId?: string;
    filename?: string;
  }) => Promise<void>;
  onLiveStop: (options?: { captureId?: string }) => Promise<void>;
  onCaptureInit: (
    captureId: string,
    filename?: string,
    options?: { reset?: boolean; source?: string },
  ) => void;
  onCaptureComponents: (captureId: string, components: ComponentNode[]) => void;
  onCaptureAppend: (captureId: string, frame: CaptureSession["records"][number]) => void;
  onCaptureTick: (captureId: string, tick: number) => void;
  onCaptureEnd: (captureId: string, reason?: string, detail?: string) => void;
  onAddAnnotation: (annotation: Annotation) => void;
  onRemoveAnnotation: (options: { id?: string; tick?: number }) => void;
  onClearAnnotations: () => void;
  onJumpAnnotation: (direction: "next" | "previous") => void;
  onAddSubtitle: (subtitle: SubtitleOverlay) => void;
  onRemoveSubtitle: (options: {
    id?: string;
    startTick?: number;
    endTick?: number;
    text?: string;
  }) => void;
  onClearSubtitles: () => void;
  getMemoryStats: () => MemoryStatsResponse;
  getUiDebug?: () => UiDebugResponse;
  onStateSync?: (captures: { captureId: string; lastTick?: number | null }[]) => void;
  onDerivationPlugins?: (plugins: unknown[]) => void;
  onUiNotice?: (notice: UiNotice) => void;
  onUiError?: (notice: UiError) => void;
}
