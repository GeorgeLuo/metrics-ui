import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect, useDeferredValue } from "react";
import { useMutation } from "@tanstack/react-query";
import { PopoutProjection } from "@/components/popout-projection";
import type { InjectedVisualizationDebug } from "@/components/injected-visualization";
import { ConnectionLockOverlay } from "@/components/home/connection-lock-overlay";
import { DerivationPluginSourceDialog } from "@/components/home/derivation-plugin-source-dialog";
import { DocsDialog } from "@/components/home/docs-dialog";
import { HomeHeaderControls } from "@/components/home/home-header-controls";
import type { ChartViewProps } from "@/components/home/metrics-chart-view";
import { MetricsMainPanel } from "@/components/home/metrics-main-panel";
import { MiniModeView, MiniProjectionContent } from "@/components/home/mini-mode-view";
import { SidebarDerivationsPane } from "@/components/home/sidebar-derivations-pane";
import { SidebarSetupPane } from "@/components/home/sidebar-setup-pane";
import { SidebarSubappHeader } from "@/components/home/sidebar-subapp-header";
import { HintingPanel } from "@/components/hinting-panel";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
} from "@/components/ui/sidebar";
import type {
  Annotation,
  SubtitleOverlay,
  ComponentNode,
  SelectedMetric,
  DerivationGroup,
  PlaybackState,
  DataPoint,
  CaptureRecord,
  CaptureSession,
  ControlCommand,
  ControlResponse,
  MemoryStatsResponse,
  VisualizationState,
  VisualizationFrameState,
} from "@shared/schema";
import { useWebSocketControl } from "@/hooks/use-websocket-control";
import { useStreamingActivityTracker } from "@/hooks/dashboard/use-streaming-activity";
import {
  useDerivationGroups,
  type DerivationPluginOutput,
  type DerivationPluginRecord,
  type DerivationPluginSourceResponse,
} from "@/hooks/home/use-derivation-groups";
import { useDerivationRuntime } from "@/hooks/home/use-derivation-runtime";
import {
  useLiveStreams,
  type LiveStreamEntry,
  type LiveStreamStatus,
} from "@/hooks/home/use-live-streams";
import { useWindowAndAxes } from "@/hooks/home/use-window-and-axes";
import { compactRecord } from "@shared/compact";
import {
  mergeComponentTrees,
} from "@shared/component-tree";
import {
  analyzeChartData,
  analyzeComponentTree,
  appendRecordStats,
  countComponentNodes,
  createEmptyCaptureStats,
  readPerformanceMemory,
  type CaptureStats,
} from "@/lib/memory-stats";
import {
  buildSeriesKey,
  cloneMetric,
  getMetricIdentityKey as getMetricKey,
  normalizeMetricList,
  sanitizeMetricPathKey as sanitizeKey,
  uniqueMetrics,
} from "@/lib/dashboard/metric-utils";
import {
  buildDerivedMetricLabel,
  getDerivationGroupDerivedMetrics,
  getDerivationGroupDisplayMetrics,
  getDerivationGroupInputMetrics,
  normalizeDerivationGroups,
  resolveDerivedGroupIdForCapture,
} from "@/lib/dashboard/derivation-utils";
import {
  buildEntitiesForMetrics,
  deleteValueAtPath,
  setValueAtPath,
} from "@/lib/dashboard/entity-path-utils";
import {
  extractDataPoints,
  parseComponentTree,
} from "@/lib/dashboard/chart-data";
import {
  DEFAULT_BYTES_PER_POINT,
  DEFAULT_BYTES_PER_PROP,
  formatBytes,
} from "@/lib/dashboard/number-format";
import { isDerivedCaptureSource } from "@/lib/dashboard/source-utils";
import {
  type SidebarMode,
} from "@/lib/dashboard/subapp-shell";
import {
  DASHBOARD_STORAGE_KEYS,
  readStorageJson,
  readStorageString,
  writeStorageJson,
  writeStorageString,
} from "@/lib/dashboard/storage";

const INITIAL_WINDOW_SIZE = 50;
const DEFAULT_POLL_SECONDS = 2;
const APPEND_FLUSH_MS = 100;
const LIVE_SERIES_REFRESH_MS = 500;
const FULLSCREEN_RESIZE_DELAY = 0;
const PERF_SAMPLE_MAX = 200;
const EVENT_LOOP_INTERVAL_MS = 100;
const COMPONENT_UPDATE_THROTTLE_MS = 250;
const STREAM_IDLE_MS = 1500;
const INLINE_EDIT_BASE_CLASS =
  "h-auto p-0 text-xs md:text-xs font-mono text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0";
const INLINE_EDIT_TEXT_CLASS = `${INLINE_EDIT_BASE_CLASS} text-left`;
const INLINE_EDIT_NUMERIC_CLASS =
  `${INLINE_EDIT_BASE_CLASS} text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;
const INLINE_EDIT_EMPTY_CLASS = "rounded-sm bg-muted/40 px-1";

const METRIC_COLORS = [
  "#E4572E",
  "#17B890",
  "#4C78A8",
  "#F2C14E",
  "#2E86AB",
  "#F25F5C",
  "#70C1B3",
  "#9C755F",
  "#3D5A80",
  "#C44536",
  "#8AC926",
  "#FFB703",
];

interface LiveStreamMeta {
  dirty: boolean;
  lastSource: string | null;
  retryTimer: number | null;
  retrySource: string | null;
  completed: boolean;
}

interface LiveStatusStream {
  captureId?: unknown;
  source?: unknown;
  pollIntervalMs?: unknown;
  lastError?: unknown;
}

type UiEventLevel = "info" | "error";

interface UiEvent {
  id: string;
  level: UiEventLevel;
  message: string;
  detail?: string;
  timestamp: number;
}

type ConnectionLockState = {
  reason: "busy" | "replaced";
  message: string;
  closeCode: number;
  closeReason: string;
} | null;

type VisualizationDebugState = InjectedVisualizationDebug;

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function pushSample(list: number[], value: number): void {
  if (!Number.isFinite(value)) {
    return;
  }
  list.push(value);
  if (list.length > PERF_SAMPLE_MAX) {
    list.splice(0, list.length - PERF_SAMPLE_MAX);
  }
}

function computeSampleStats(samples: number[]) {
  if (!samples.length) {
    return { samples: 0, avgMs: null, maxMs: null, p95Ms: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const avg = total / samples.length;
  const max = sorted[sorted.length - 1] ?? avg;
  const p95Index = Math.max(0, Math.floor(0.95 * (sorted.length - 1)));
  const p95 = sorted[p95Index] ?? avg;
  return {
    samples: samples.length,
    avgMs: Number.isFinite(avg) ? avg : null,
    maxMs: Number.isFinite(max) ? max : null,
    p95Ms: Number.isFinite(p95) ? p95 : null,
  };
}

function isInlineFieldBlank(value: string): boolean {
  return value.trim().length === 0;
}

function normalizeVisualizationFrameState(value: unknown): VisualizationFrameState {
  if (!value || typeof value !== "object") {
    return { mode: "builtin" };
  }
  const raw = value as Partial<VisualizationFrameState>;
  const mode = raw.mode === "plugin" ? "plugin" : "builtin";
  const next: VisualizationFrameState = { mode };
  if (mode === "plugin" && typeof raw.pluginId === "string") {
    next.pluginId = raw.pluginId;
  }
  if (typeof raw.name === "string") {
    next.name = raw.name;
  }
  if (typeof raw.captureId === "string") {
    next.captureId = raw.captureId;
  }
  if (typeof raw.updatedAt === "string") {
    next.updatedAt = raw.updatedAt;
  }
  return next;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined"
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable in this environment.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!success) {
    throw new Error("Clipboard copy command failed.");
  }
}

interface HomeProps {
  miniMode?: boolean;
}

export default function Home({ miniMode = false }: HomeProps = {}) {
  const [captures, setCaptures] = useState<CaptureSession[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<SelectedMetric[]>(() => {
    const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.selectedMetrics);
    return normalizeMetricList(parsed);
  });
  const {
    derivationGroups,
    setDerivationGroups,
    derivationPlugins,
    setDerivationPlugins,
    derivationPluginsError,
    setDerivationPluginsError,
    isDerivationPluginSourceOpen,
    setIsDerivationPluginSourceOpen,
    derivationPluginSource,
    setDerivationPluginSource,
    derivationPluginSourceLoading,
    setDerivationPluginSourceLoading,
    derivationPluginSourceError,
    setDerivationPluginSourceError,
    isDerivationPluginSourceCopied,
    setIsDerivationPluginSourceCopied,
    derivationPluginCopyResetTimerRef,
    derivationPluginFileRef,
    activeDerivationGroupId,
    setActiveDerivationGroupId,
    displayDerivationGroupId,
    setDisplayDerivationGroupId,
    focusedDerivationGroupNameId,
    setFocusedDerivationGroupNameId,
    derivationGroupNameDrafts,
    setDerivationGroupNameDrafts,
    derivationDragState,
    setDerivationDragState,
    derivationDropState,
    setDerivationDropState,
  } = useDerivationGroups();
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [memoryStatsSnapshot, setMemoryStatsSnapshot] = useState<MemoryStatsResponse | null>(null);
  const [memoryStatsAt, setMemoryStatsAt] = useState<number | null>(null);
  const [isSelectionOpen, setIsSelectionOpen] = useState(true);
  const [selectionCaptureOpenById, setSelectionCaptureOpenById] = useState<Record<string, boolean>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const {
    sourceMode,
    setSourceMode,
    liveStreams,
    setLiveStreams,
    livePollInputDrafts,
    setLivePollInputDrafts,
    handleLivePollInputDraftChange,
    handleLivePollInputDraftBlur,
  } = useLiveStreams({
    createId: generateId,
    defaultPollSeconds: DEFAULT_POLL_SECONDS,
  });

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: true,
    currentTick: 1,
    speed: 1,
    totalTicks: 0,
  });
  const {
    windowSize,
    setWindowSize,
    windowStart,
    setWindowStart,
    windowEnd,
    setWindowEnd,
    isWindowed,
    setIsWindowed,
    resetViewVersion,
    setResetViewVersion,
    windowStartInput,
    setWindowStartInput,
    windowEndInput,
    setWindowEndInput,
    manualYPrimaryDomain,
    setManualYPrimaryDomain,
    manualYSecondaryDomain,
    setManualYSecondaryDomain,
    resolvedYPrimaryDomain,
    setResolvedYPrimaryDomain,
    resolvedYSecondaryDomain,
    setResolvedYSecondaryDomain,
    yPrimaryMinInput,
    setYPrimaryMinInput,
    yPrimaryMaxInput,
    setYPrimaryMaxInput,
    ySecondaryMinInput,
    setYSecondaryMinInput,
    ySecondaryMaxInput,
    setYSecondaryMaxInput,
    isAutoScroll,
    setIsAutoScroll,
    windowStartEditingRef,
    windowEndEditingRef,
    yPrimaryMinEditingRef,
    yPrimaryMaxEditingRef,
    ySecondaryMinEditingRef,
    ySecondaryMaxEditingRef,
    applyWindowRange,
    handleWindowSizeChange,
    handleWindowStartChange,
    handleWindowEndChange,
    handleWindowRangeChange,
    commitWindowStartInput,
    commitWindowEndInput,
    handleChartDomainChange,
    commitYPrimaryBoundary,
    commitYSecondaryBoundary,
    handleYPrimaryRangeChange,
    handleYSecondaryRangeChange,
    handleResetWindow,
    handleAutoScrollChange,
  } = useWindowAndAxes({
    playbackState,
    setPlaybackState,
    initialWindowSize: INITIAL_WINDOW_SIZE,
  });
  const [viewport, setViewport] = useState<VisualizationState["viewport"]>({
    width: 0,
    height: 0,
    chartWidth: 0,
    chartHeight: 0,
    devicePixelRatio: 1,
  });
  const isHudVisible = true;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleOverlay[]>([]);
  const [visualizationFrame, setVisualizationFrame] = useState<VisualizationFrameState>(() =>
    normalizeVisualizationFrameState(readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.visualizationFrame)),
  );
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("setup");
  const [isCaptureSourceOpen, setIsCaptureSourceOpen] = useState(true);
  const [highlightedMetricKey, setHighlightedMetricKey] = useState<string | null>(null);
  const [initialSyncReady, setInitialSyncReady] = useState(false);
  const [loadingProbe, setLoadingProbe] = useState(() => ({
    pendingSeries: 0,
    pendingAppends: 0,
    pendingComponentUpdates: 0,
    pendingTicks: 0,
    updatedAt: 0,
  }));
  const [uiEvents, setUiEvents] = useState<UiEvent[]>([]);
  const [isEventsVisible, setIsEventsVisible] = useState(false);
  const [isMiniProjectionOpen, setIsMiniProjectionOpen] = useState(false);
  const [isVisualizationPoppedOut, setIsVisualizationPoppedOut] = useState(false);
  const [visualizationDockRequestToken, setVisualizationDockRequestToken] = useState(0);
  const [connectionLock, setConnectionLock] = useState<ConnectionLockState>(null);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [docsContent, setDocsContent] = useState<string>("");
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const {
    streamActivityVersion,
    noteStreamingActivity,
    stopStreamingIndicator,
    pruneStreamingActivity,
    clearStreamingActivity,
    getStreamingCaptureIds,
  } = useStreamingActivityTracker({ idleMs: STREAM_IDLE_MS });

  const playbackRef = useRef<number | null>(null);
  const capturesRef = useRef(captures);
  const liveStreamsRef = useRef(liveStreams);
  const selectedMetricsRef = useRef(selectedMetrics);
  const derivationGroupsRef = useRef(derivationGroups);
  const derivationPluginsRef = useRef(derivationPlugins);
  const activeDerivationGroupIdRef = useRef(activeDerivationGroupId);
  const displayDerivationGroupIdRef = useRef(displayDerivationGroupId);
  const liveMetaRef = useRef(new Map<string, LiveStreamMeta>());
  const initialSyncTimerRef = useRef<number | null>(null);
  const initialSyncReadyRef = useRef(false);
  const restoredFromServerRef = useRef(false);
  const attemptConnectRef = useRef<(
    id: string,
    options?: { force?: boolean; showConnecting?: boolean; allowCompleted?: boolean },
  ) => void>(
    () => {},
  );
  const pendingAppendsRef = useRef(new Map<string, CaptureRecord[]>());
  const appendFlushTimerRef = useRef<number | null>(null);
  const pendingTicksRef = useRef(new Map<string, number>());
  const tickFlushTimerRef = useRef<number | null>(null);
  const captureStatsRef = useRef<Map<string, CaptureStats>>(new Map());
  const pendingSeriesRef = useRef(new Set<string>());
  const pendingFullBackfillRef = useRef(new Set<string>());
  const loadedSeriesRef = useRef(new Set<string>());
  const partialSeriesRef = useRef(new Set<string>());
  const seriesRefreshTimerRef = useRef<number | null>(null);
  const lastSeriesRefreshRef = useRef(new Map<string, number>());
  const lastSeriesTickRef = useRef(new Map<string, number>());
  const sidebarHeaderRef = useRef<HTMLDivElement | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement | null>(null);
  const sidebarBodyRef = useRef<HTMLDivElement | null>(null);
  const baselineHeapRef = useRef<number | null>(null);
  const componentUpdateSamplesRef = useRef<number[]>([]);
  const componentUpdateLastMsRef = useRef<number | null>(null);
  const componentUpdateLastAtRef = useRef<number | null>(null);
  const componentUpdateLastNodesRef = useRef<number | null>(null);
  const componentUpdateThrottledRef = useRef<number>(0);
  const componentUpdateLastAppliedRef = useRef<Map<string, number>>(new Map());
  const pendingComponentUpdatesRef = useRef<Map<string, ComponentNode[]>>(new Map());
  const componentUpdateTimersRef = useRef<Map<string, number>>(new Map());
  const eventLoopLagSamplesRef = useRef<number[]>([]);
  const frameTimeSamplesRef = useRef<number[]>([]);
  const longTaskStatsRef = useRef({
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastStart: null as number | null,
    lastDurationMs: null as number | null,
  });
  const endedCapturesRef = useRef(new Set<string>());
  const endedCaptureReasonsRef = useRef(
    new Map<string, { reason: string; detail?: string; at: string }>(),
  );
  const liveErrorEventsRef = useRef(new Map<string, string>());
  const sendMessageRef = useRef<(message: ControlResponse | ControlCommand) => boolean>(() => false);
  const selectionHandlersRef = useRef(new Map<string, (metrics: SelectedMetric[]) => void>());
  const activeCaptureIdsRef = useRef(new Set<string>());
  const streamModeRef = useRef(new Map<string, "lite" | "full">());
  const staleSeriesRecoverAtRef = useRef(new Map<string, number>());
  const staleSeriesRecoverErrorAtRef = useRef(new Map<string, number>());
  const sourceRepairAttemptAtRef = useRef(new Map<string, number>());
  const visualizationDebugRef = useRef<VisualizationDebugState | null>(null);

  const handleVisualizationDebugChange = useCallback((debug: VisualizationDebugState) => {
    visualizationDebugRef.current = debug;
  }, []);

  const pushUiEvent = useCallback((event: Omit<UiEvent, "id" | "timestamp">) => {
    setUiEvents((prev) => {
      const next: UiEvent = {
        id: generateId(),
        timestamp: Date.now(),
        ...event,
      };
      const updated = [...prev, next];
      if (updated.length <= 200) {
        return updated;
      }
      return updated.slice(updated.length - 200);
    });
  }, []);

  const {
    pendingDerivationRuns,
    syncPendingDerivationRuns,
    derivationRerunTimersRef,
    derivationOutputGroupByCaptureRef,
    pendingDerivationByRequestRef,
    pendingDerivationRequestsByCaptureRef,
    autoReplayDerivationsRef,
    clearDerivationRunPendingByRequest,
    clearDerivationRunPendingByCapture,
    clearAllPendingDerivationRuns,
    handleReorderDerivationGroupMetrics,
    handleDerivationMetricDragStart,
    handleDerivationMetricDragOver,
    handleDerivationMetricDrop,
    handleDerivationMetricDragEnd,
    handleRunDerivation,
    handleRunDerivationPlugin,
  } = useDerivationRuntime({
    captures,
    initialSyncReady,
    derivationGroups,
    derivationGroupsRef,
    derivationPluginsRef,
    setDerivationGroups,
    derivationDragState,
    derivationDropState,
    setDerivationDragState,
    setDerivationDropState,
    sendMessageRef,
    pushUiEvent,
    generateId,
  });

  const normalizeDerivationPlugins = useCallback((raw: unknown): DerivationPluginRecord[] => {
    if (!Array.isArray(raw)) {
      return [];
    }
    const plugins: DerivationPluginRecord[] = [];
    raw.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const id = typeof (entry as any).id === "string" ? String((entry as any).id).trim() : "";
      const name = typeof (entry as any).name === "string" ? String((entry as any).name).trim() : "";
      if (!id || !name) {
        return;
      }
      const outputsRaw = Array.isArray((entry as any).outputs) ? (entry as any).outputs : [];
      const outputs: DerivationPluginOutput[] = outputsRaw
        .map((output: any): DerivationPluginOutput => ({
          key: typeof output?.key === "string" ? output.key : "",
          label: typeof output?.label === "string" ? output.label : undefined,
        }))
        .filter((output: DerivationPluginOutput) => output.key.length > 0);

      plugins.push({
        id,
        name,
        description: typeof (entry as any).description === "string" ? (entry as any).description : undefined,
        minInputs:
          Number.isInteger((entry as any).minInputs) && (entry as any).minInputs >= 0
            ? (entry as any).minInputs
            : 1,
        maxInputs:
          Number.isInteger((entry as any).maxInputs) && (entry as any).maxInputs >= 0
            ? (entry as any).maxInputs
            : null,
        outputs,
        uploadedAt: typeof (entry as any).uploadedAt === "string" ? (entry as any).uploadedAt : "",
        valid: Boolean((entry as any).valid),
        error: typeof (entry as any).error === "string" ? (entry as any).error : null,
      });
    });
    return plugins;
  }, []);

  const refreshDerivationPlugins = useCallback(async () => {
    setDerivationPluginsError(null);
    try {
      const response = await fetch("/api/derivations/plugins");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : `Failed to load derivation plugins (${response.status})`,
        );
      }
      setDerivationPlugins(normalizeDerivationPlugins(payload?.plugins));
    } catch (error) {
      setDerivationPluginsError(error instanceof Error ? error.message : "Failed to load derivation plugins.");
    }
  }, [normalizeDerivationPlugins]);

  useEffect(() => {
    refreshDerivationPlugins();
  }, [refreshDerivationPlugins]);

  const activeCaptures = useMemo(() => captures.filter((capture) => capture.isActive), [captures]);

  useEffect(() => {
    const liveIds = new Set(liveStreams.map((entry) => entry.id));
    setLivePollInputDrafts((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([captureId, value]) => {
        if (liveIds.has(captureId)) {
          next[captureId] = value;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [liveStreams]);

  useEffect(() => {
    const activeIds = new Set(activeCaptures.map((capture) => capture.id));
    setSelectionCaptureOpenById((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([captureId, isOpen]) => {
        if (activeIds.has(captureId)) {
          next[captureId] = isOpen;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [activeCaptures]);
  const maxTotalTicks = activeCaptures.length > 0 
    ? Math.max(...activeCaptures.map(c => c.tickCount)) 
    : 0;

  const selectedMetricsByCapture = useMemo(() => {
    const grouped = new Map<string, SelectedMetric[]>();
    selectedMetrics.forEach((metric) => {
      const existing = grouped.get(metric.captureId);
      if (existing) {
        existing.push(metric);
      } else {
        grouped.set(metric.captureId, [metric]);
      }
    });
    return grouped;
  }, [selectedMetrics]);

  const getSelectionHandler = useCallback((captureId: string) => {
    const existing = selectionHandlersRef.current.get(captureId);
    if (existing) {
      return existing;
    }
    const handler = (newMetrics: SelectedMetric[]) => {
      setSelectedMetrics((prev) => {
        const otherMetrics = prev.filter((metric) => metric.captureId !== captureId);
        const next = [...otherMetrics, ...newMetrics];
        selectedMetricsRef.current = next;
        return next;
      });
    };
    selectionHandlersRef.current.set(captureId, handler);
    return handler;
  }, []);

  const resolvedActiveDerivationGroupId = useMemo(() => {
    if (derivationGroups.length === 0) {
      return "";
    }
    if (
      activeDerivationGroupId &&
      derivationGroups.some((group) => group.id === activeDerivationGroupId)
    ) {
      return activeDerivationGroupId;
    }
    return derivationGroups[0]?.id ?? "";
  }, [activeDerivationGroupId, derivationGroups]);

  useEffect(() => {
    if (resolvedActiveDerivationGroupId !== activeDerivationGroupId) {
      setActiveDerivationGroupId(resolvedActiveDerivationGroupId);
    }
  }, [activeDerivationGroupId, resolvedActiveDerivationGroupId]);

  const resolvedDisplayDerivationGroupId = useMemo(() => {
    if (!displayDerivationGroupId) {
      return "";
    }
    if (derivationGroups.some((group) => group.id === displayDerivationGroupId)) {
      return displayDerivationGroupId;
    }
    return "";
  }, [derivationGroups, displayDerivationGroupId]);

  useEffect(() => {
    if (resolvedDisplayDerivationGroupId !== displayDerivationGroupId) {
      setDisplayDerivationGroupId(resolvedDisplayDerivationGroupId);
    }
  }, [displayDerivationGroupId, resolvedDisplayDerivationGroupId]);

  useEffect(() => {
    if (!focusedDerivationGroupNameId) {
      return;
    }
    if (!derivationGroups.some((group) => group.id === focusedDerivationGroupNameId)) {
      setFocusedDerivationGroupNameId("");
    }
  }, [derivationGroups, focusedDerivationGroupNameId]);

  useEffect(() => {
    setDerivationGroupNameDrafts((prev) => {
      const validIds = new Set(derivationGroups.map((group) => group.id));
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (validIds.has(id)) {
          next[id] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [derivationGroups]);

  const analysisMetrics = useMemo(() => {
    if (!resolvedActiveDerivationGroupId) {
      return [];
    }
    const group = derivationGroups.find((entry) => entry.id === resolvedActiveDerivationGroupId);
    return group ? getDerivationGroupInputMetrics(group) : [];
  }, [derivationGroups, resolvedActiveDerivationGroupId]);

  const displayGroupMetrics = useMemo(() => {
    if (!resolvedDisplayDerivationGroupId) {
      return null;
    }
    const group = derivationGroups.find((entry) => entry.id === resolvedDisplayDerivationGroupId);
    return group ? getDerivationGroupDisplayMetrics(group) : [];
  }, [derivationGroups, resolvedDisplayDerivationGroupId]);

  const displayGroupHasActiveCaptures = useMemo(() => {
    if (!resolvedDisplayDerivationGroupId) {
      return false;
    }
    const metrics = displayGroupMetrics ?? [];
    if (metrics.length === 0) {
      return false;
    }
    return metrics.some((metric) =>
      captures.some((capture) => capture.id === metric.captureId && capture.isActive),
    );
  }, [captures, displayGroupMetrics, resolvedDisplayDerivationGroupId]);

  const selectedMetricAxisByKey = useMemo(() => {
    const map = new Map<string, "y2">();
    selectedMetrics.forEach((metric) => {
      if (metric.axis === "y2") {
        map.set(getMetricKey(metric), "y2");
      }
    });
    return map;
  }, [selectedMetrics]);

  const displayMetrics = useMemo(() => {
    const applyAxisAssignment = (metric: SelectedMetric): SelectedMetric => {
      const assignedAxis = selectedMetricAxisByKey.get(getMetricKey(metric));
      if (assignedAxis === "y2" && metric.axis !== "y2") {
        return { ...metric, axis: "y2" };
      }
      return metric;
    };

    if (!resolvedDisplayDerivationGroupId || !displayGroupHasActiveCaptures) {
      return selectedMetrics.map(applyAxisAssignment);
    }
    return (displayGroupMetrics ?? []).map(applyAxisAssignment);
  }, [
    displayGroupHasActiveCaptures,
    displayGroupMetrics,
    resolvedDisplayDerivationGroupId,
    selectedMetricAxisByKey,
    selectedMetrics,
  ]);

  const getUiDebug = useCallback(() => {
    const serializeMap = <T,>(
      map: Map<string, T>,
      mapValue: (value: T) => unknown = (value) => value,
    ) => Array.from(map.entries()).map(([key, value]) => ({
      captureId: key,
      value: mapValue(value),
    }));

    const localStorageSnapshot = (() => {
      if (typeof window === "undefined") {
        return undefined;
      }
      return {
        selectedMetrics: readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.selectedMetrics),
        derivationGroups: readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.derivationGroups),
        activeDerivationGroupId: readStorageString(DASHBOARD_STORAGE_KEYS.activeDerivationGroupId),
        displayDerivationGroupId: readStorageString(DASHBOARD_STORAGE_KEYS.displayDerivationGroupId),
        visualizationFrame: readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.visualizationFrame),
        liveStreams: readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.liveStreams),
        sourceMode: readStorageString(DASHBOARD_STORAGE_KEYS.sourceMode),
        theme: readStorageString("theme"),
      };
    })();

    const captureSummaries = captures.map((capture) => {
      const stats = captureStatsRef.current.get(capture.id);
      return {
        id: capture.id,
        filename: capture.filename,
        fileSize: capture.fileSize,
        tickCount: capture.tickCount,
        recordCount: capture.records.length,
        componentNodes: stats?.componentNodes ?? capture.components.length,
        isActive: capture.isActive,
      };
    });

    const pendingAppends = Array.from(pendingAppendsRef.current.entries()).map(
      ([captureId, frames]) => ({
        captureId,
        count: frames.length,
        lastTick: frames.length > 0 ? frames[frames.length - 1].tick : null,
      }),
    );

    const pendingTicks = Array.from(pendingTicksRef.current.entries()).map(
      ([captureId, tick]) => ({ captureId, tick }),
    );

    const liveMeta = Array.from(liveMetaRef.current.entries()).map(
      ([captureId, meta]) => ({
        captureId,
        dirty: meta.dirty,
        lastSource: meta.lastSource,
        retrySource: meta.retrySource,
        completed: meta.completed,
        hasRetryTimer: meta.retryTimer !== null,
      }),
    );

    const captureStats = serializeMap(captureStatsRef.current, (value) => value);
    const componentUpdateLastApplied = serializeMap(componentUpdateLastAppliedRef.current, (value) => value);
    const lastSeriesTick = serializeMap(lastSeriesTickRef.current, (value) => value);
    const lastSeriesRefresh = serializeMap(lastSeriesRefreshRef.current, (value) => value);
    const streamModes = serializeMap(streamModeRef.current, (value) => value);
    const pendingComponentUpdates = Array.from(pendingComponentUpdatesRef.current.entries()).map(
      ([captureId, nodes]) => ({
        captureId,
        count: nodes.length,
      }),
    );
    const componentUpdateTimers = Array.from(componentUpdateTimersRef.current.entries()).map(
      ([captureId, timerId]) => ({ captureId, hasTimer: timerId !== null }),
    );
    const sidebarContentHeight = sidebarContentRef.current?.getBoundingClientRect?.().height ?? null;
    const sidebarBodyHeight = sidebarBodyRef.current?.getBoundingClientRect?.().height ?? null;
    const hintPanelEl =
      typeof document !== "undefined"
        ? document.querySelector<HTMLElement>("[data-testid='hinting-panel']")
        : null;
    const chartContainerEl =
      typeof document !== "undefined"
        ? document.querySelector<HTMLElement>("[data-testid='metrics-chart-container']")
        : null;
    const annotationOverlayLayerEl =
      typeof document !== "undefined"
        ? document.querySelector<HTMLElement>("[data-testid='annotation-overlay-layer']")
        : null;
    const annotationRenderedCount =
      typeof document !== "undefined"
        ? document.querySelectorAll("[data-testid^='annotation-line-']").length
        : null;
    const chartContainerRect = chartContainerEl?.getBoundingClientRect?.();
    const chartCenterProbe =
      chartContainerRect && typeof document !== "undefined"
        ? (() => {
            const centerX = chartContainerRect.left + chartContainerRect.width / 2;
            const centerY = chartContainerRect.top + chartContainerRect.height / 2;
            const element = document.elementFromPoint(centerX, centerY);
            return {
              x: centerX,
              y: centerY,
              tag: element?.tagName?.toLowerCase() ?? null,
              className:
                typeof (element as HTMLElement | null)?.className === "string"
                  ? ((element as HTMLElement).className as string)
                  : null,
              dataTestId: (element as HTMLElement | null)?.getAttribute?.("data-testid") ?? null,
              insideChart: element ? chartContainerEl?.contains(element) ?? false : false,
            };
          })()
        : null;
    const hintPanelHeight = hintPanelEl?.getBoundingClientRect?.().height ?? null;
    const sidebarHeightSum =
      typeof sidebarBodyHeight === "number" && typeof hintPanelHeight === "number"
        ? sidebarBodyHeight + hintPanelHeight
        : null;
    const sidebarHeightDelta =
      typeof sidebarContentHeight === "number" && typeof sidebarHeightSum === "number"
        ? sidebarContentHeight - sidebarHeightSum
        : null;

    return {
      generatedAt: new Date().toISOString(),
      buildMarker: "annotation-reference-line-2026-03-02",
      state: {
        captures: captureSummaries,
        selectedMetrics,
        analysisMetrics,
        derivationGroups,
        activeDerivationGroupId: resolvedActiveDerivationGroupId,
        displayDerivationGroupId: resolvedDisplayDerivationGroupId,
        playback: playbackState,
        windowStart,
        windowEnd,
        windowSize,
        windowStartInput,
        windowEndInput,
        isWindowed,
        autoScroll: isAutoScroll,
        isFullscreen,
        isHudVisible,
        sourceMode,
        liveStreams,
        annotations,
        subtitles,
        visualizationFrame,
        sidebarMode,
        isCaptureSourceOpen,
        isSelectionOpen,
        isDiagnosticsOpen,
        memoryStatsSnapshot,
        memoryStatsAt,
        uploadError,
        uiEvents,
        pendingDerivationRuns,
        highlightedMetricKey,
        initialSyncReady,
        loadingProbe,
        viewport,
      },
      refs: {
        playbackTimerActive: playbackRef.current !== null,
        capturesRefCount: capturesRef.current.length,
        liveStreamsRefCount: liveStreamsRef.current.length,
        selectedMetricsRefCount: selectedMetricsRef.current.length,
        pendingAppends,
        pendingTicks,
        pendingSeries: Array.from(pendingSeriesRef.current),
        loadedSeries: Array.from(loadedSeriesRef.current),
        partialSeries: Array.from(partialSeriesRef.current),
        lastSeriesTick,
        lastSeriesRefresh,
        activeCaptureIds: Array.from(activeCaptureIdsRef.current),
        streamModes,
        liveMeta,
        captureStats,
        componentUpdateSamples: [...componentUpdateSamplesRef.current],
        componentUpdateLastMs: componentUpdateLastMsRef.current,
        componentUpdateLastAt: componentUpdateLastAtRef.current,
        componentUpdateLastNodes: componentUpdateLastNodesRef.current,
        componentUpdateThrottled: componentUpdateThrottledRef.current,
        pendingComponentUpdates,
        componentUpdateTimers,
        componentUpdateLastApplied,
        pendingDerivationByRequest: Array.from(
          pendingDerivationByRequestRef.current.entries(),
        ).map(([requestId, value]) => ({
          requestId,
          outputCaptureId: value.outputCaptureId,
          label: value.label,
        })),
        pendingDerivationByCapture: Array.from(
          pendingDerivationRequestsByCaptureRef.current.entries(),
        ).map(([captureId, requestIds]) => ({
          captureId,
          requestIds: Array.from(requestIds.values()),
        })),
        eventLoopLagSamples: [...eventLoopLagSamplesRef.current],
        frameTimeSamples: [...frameTimeSamplesRef.current],
        longTaskStats: { ...longTaskStatsRef.current },
        initialSyncReadyRef: initialSyncReadyRef.current,
        initialSyncTimerActive: initialSyncTimerRef.current !== null,
        seriesRefreshTimerActive: seriesRefreshTimerRef.current !== null,
        appendFlushTimerActive: appendFlushTimerRef.current !== null,
        tickFlushTimerActive: tickFlushTimerRef.current !== null,
        windowStartEditing: windowStartEditingRef.current,
        windowEndEditing: windowEndEditingRef.current,
        sidebarHeaderHeight: sidebarHeaderRef.current?.getBoundingClientRect?.().height ?? null,
        sidebarContentHeight,
        sidebarBodyHeight,
        hintPanelHeight,
        chartContainerRect: chartContainerRect
          ? {
              left: chartContainerRect.left,
              top: chartContainerRect.top,
              width: chartContainerRect.width,
              height: chartContainerRect.height,
            }
          : null,
        annotationOverlayLayerPresent: Boolean(annotationOverlayLayerEl),
        annotationRenderedCount,
        chartCenterProbe,
        sidebarHeightSum,
        sidebarHeightDelta,
        baselineHeap: baselineHeapRef.current,
        selectionHandlers: selectionHandlersRef.current.size,
        prevSelectedCount: prevSelectedRef.current.length,
        endedCaptures: Array.from(endedCapturesRef.current),
        endedCaptureReasons: Array.from(endedCaptureReasonsRef.current.entries()).map(
          ([captureId, info]) => ({ captureId, ...info }),
        ),
        visualization: visualizationDebugRef.current,
      },
      localStorage: localStorageSnapshot,
    };
  }, [
    analysisMetrics,
    derivationGroups,
    resolvedActiveDerivationGroupId,
    resolvedDisplayDerivationGroupId,
    annotations,
    captures,
    initialSyncReady,
    isCaptureSourceOpen,
    isDiagnosticsOpen,
    isFullscreen,
    isHudVisible,
    isSelectionOpen,
    isWindowed,
    liveStreams,
    loadingProbe,
    memoryStatsAt,
    memoryStatsSnapshot,
    pendingDerivationRuns,
    playbackState,
    selectedMetrics,
    sourceMode,
    sidebarMode,
    subtitles,
    uploadError,
    uiEvents,
    viewport,
    windowEndInput,
    windowEnd,
    windowStartInput,
    windowSize,
    windowStart,
    highlightedMetricKey,
    isAutoScroll,
    visualizationFrame,
  ]);

  useEffect(() => {
    const activeIds = new Set(captures.map((capture) => capture.id));
    const isActiveCaptureId = (captureId: string) => activeIds.has(captureId);
    let prunedPendingDerivations = false;

    selectionHandlersRef.current.forEach((_handler, id) => {
      if (!activeIds.has(id)) {
        selectionHandlersRef.current.delete(id);
      }
    });
    staleSeriesRecoverAtRef.current.forEach((_value, id) => {
      if (!activeIds.has(id)) {
        staleSeriesRecoverAtRef.current.delete(id);
      }
    });
    staleSeriesRecoverErrorAtRef.current.forEach((_value, id) => {
      if (!activeIds.has(id)) {
        staleSeriesRecoverErrorAtRef.current.delete(id);
      }
    });

    pendingAppendsRef.current.forEach((_records, id) => {
      if (!isActiveCaptureId(id)) {
        pendingAppendsRef.current.delete(id);
      }
    });
    pendingTicksRef.current.forEach((_tick, id) => {
      if (!isActiveCaptureId(id)) {
        pendingTicksRef.current.delete(id);
      }
    });
    captureStatsRef.current.forEach((_stats, id) => {
      if (!isActiveCaptureId(id)) {
        captureStatsRef.current.delete(id);
      }
    });
    lastSeriesRefreshRef.current.forEach((_value, id) => {
      if (!isActiveCaptureId(id)) {
        lastSeriesRefreshRef.current.delete(id);
      }
    });
    lastSeriesTickRef.current.forEach((_value, id) => {
      if (!isActiveCaptureId(id)) {
        lastSeriesTickRef.current.delete(id);
      }
    });
    activeCaptureIdsRef.current.forEach((id) => {
      if (!isActiveCaptureId(id)) {
        activeCaptureIdsRef.current.delete(id);
      }
    });
    endedCapturesRef.current.forEach((id) => {
      if (!isActiveCaptureId(id)) {
        endedCapturesRef.current.delete(id);
        endedCaptureReasonsRef.current.delete(id);
      }
    });
    pruneStreamingActivity(activeIds);
    liveErrorEventsRef.current.forEach((_value, id) => {
      if (!isActiveCaptureId(id)) {
        liveErrorEventsRef.current.delete(id);
      }
    });
    streamModeRef.current.forEach((_mode, id) => {
      if (!isActiveCaptureId(id)) {
        streamModeRef.current.delete(id);
      }
    });
    liveMetaRef.current.forEach((_meta, id) => {
      if (!isActiveCaptureId(id)) {
        liveMetaRef.current.delete(id);
      }
    });
    componentUpdateLastAppliedRef.current.forEach((_value, id) => {
      if (!isActiveCaptureId(id)) {
        componentUpdateLastAppliedRef.current.delete(id);
      }
    });
    pendingComponentUpdatesRef.current.forEach((_nodes, id) => {
      if (!isActiveCaptureId(id)) {
        pendingComponentUpdatesRef.current.delete(id);
      }
    });
    componentUpdateTimersRef.current.forEach((timerId, id) => {
      if (!isActiveCaptureId(id)) {
        if (typeof window !== "undefined") {
          window.clearTimeout(timerId);
        }
        componentUpdateTimersRef.current.delete(id);
      }
    });
    derivationOutputGroupByCaptureRef.current.forEach((_groupId, captureId) => {
      if (!isActiveCaptureId(captureId)) {
        derivationOutputGroupByCaptureRef.current.delete(captureId);
      }
    });
    pendingDerivationRequestsByCaptureRef.current.forEach((requestIds, captureId) => {
      if (!isActiveCaptureId(captureId)) {
        requestIds.forEach((requestId) => {
          pendingDerivationByRequestRef.current.delete(requestId);
          prunedPendingDerivations = true;
        });
        pendingDerivationRequestsByCaptureRef.current.delete(captureId);
      }
    });
    pendingDerivationByRequestRef.current.forEach((entry, requestId) => {
      if (!isActiveCaptureId(entry.outputCaptureId)) {
        pendingDerivationByRequestRef.current.delete(requestId);
        prunedPendingDerivations = true;
      }
    });

    const seriesKeys = new Set<string>();
    pendingSeriesRef.current.forEach((key) => seriesKeys.add(key));
    loadedSeriesRef.current.forEach((key) => seriesKeys.add(key));
    partialSeriesRef.current.forEach((key) => seriesKeys.add(key));
    pendingFullBackfillRef.current.forEach((key) => seriesKeys.add(key));
    seriesKeys.forEach((key) => {
      const captureId = key.includes("::") ? key.split("::")[0]! : "";
      if (!captureId || !isActiveCaptureId(captureId)) {
        pendingSeriesRef.current.delete(key);
        loadedSeriesRef.current.delete(key);
        partialSeriesRef.current.delete(key);
        pendingFullBackfillRef.current.delete(key);
      }
    });

    if (prunedPendingDerivations) {
      syncPendingDerivationRuns();
    }
  }, [captures, pruneStreamingActivity, syncPendingDerivationRuns]);

  const ingestCapturePayload = useCallback(
    (data: {
      filename?: string;
      size?: number;
      tickCount?: number;
      records?: CaptureRecord[];
      components?: ComponentNode[];
    }) => {
      const records = Array.isArray(data.records) ? (data.records as CaptureRecord[]) : [];
      const incomingComponents = Array.isArray(data.components)
        ? (data.components as ComponentNode[])
        : parseComponentTree(records);
      const newCapture: CaptureSession = {
        id: generateId(),
        filename: typeof data.filename === "string" ? data.filename : "capture.jsonl",
        fileSize: typeof data.size === "number" ? data.size : 0,
        tickCount: typeof data.tickCount === "number" ? data.tickCount : records.length,
        records,
        components: incomingComponents,
        isActive: true,
      };

      const captureStats = createEmptyCaptureStats();
      newCapture.records.forEach((record: CaptureRecord) => {
        appendRecordStats(captureStats, record);
      });
      captureStats.componentNodes = countComponentNodes(newCapture.components);
      captureStatsRef.current.set(newCapture.id, captureStats);
      activeCaptureIdsRef.current.add(newCapture.id);

      setCaptures((prev) => {
        const nextCaptures = [...prev, newCapture];
        const newActiveCaptures = nextCaptures.filter((capture) => capture.isActive);
        const newMaxTicks =
          newActiveCaptures.length > 0
            ? Math.max(...newActiveCaptures.map((capture) => capture.tickCount))
            : 0;
        setPlaybackState((prevState) => ({
          ...prevState,
          totalTicks: newMaxTicks,
          currentTick: prevState.currentTick || 1,
        }));
        return nextCaptures;
      });
    },
    [],
  );

  const mergeSeriesIntoCaptures = useCallback(
    (captureId: string, path: string[], points: Array<{ tick: number; value: number | null }>) => {
      if (!points.length) {
        return;
      }
      setCaptures((prev) => {
        let updatedCapture: CaptureSession | null = null;
        const next = prev.map((capture) => {
          if (capture.id !== captureId) {
            return capture;
          }
          const recordMap = new Map<number, CaptureRecord>();
          capture.records.forEach((record) => {
            recordMap.set(record.tick, {
              tick: record.tick,
              entities: { ...record.entities },
            });
          });
          points.forEach((point) => {
            const existing = recordMap.get(point.tick);
            const entities = existing ? { ...existing.entities } : {};
            setValueAtPath(entities as Record<string, unknown>, path, point.value);
            recordMap.set(point.tick, { tick: point.tick, entities: entities as Record<string, Record<string, unknown>> });
          });
          const nextRecords = Array.from(recordMap.values()).sort((a, b) => a.tick - b.tick);
          const nextTickCount = Math.max(
            capture.tickCount,
            points[points.length - 1]?.tick ?? capture.tickCount,
          );
          updatedCapture = {
            ...capture,
            records: nextRecords,
            tickCount: nextTickCount,
          };
          return updatedCapture;
        });

        const statsCapture = updatedCapture ?? next.find((capture) => capture.id === captureId) ?? null;
        if (statsCapture) {
          const stats = createEmptyCaptureStats();
          statsCapture.records.forEach((record: CaptureRecord) => appendRecordStats(stats, record));
          stats.componentNodes = countComponentNodes(statsCapture.components);
          captureStatsRef.current.set(statsCapture.id, stats);
        }

        return next;
      });
    },
    [],
  );

  const removeMetricFromCaptures = useCallback((captureId: string, path: string[]) => {
    setCaptures((prev) => {
      let updatedCapture: CaptureSession | null = null;
      const next = prev.map((capture) => {
        if (capture.id !== captureId) {
          return capture;
        }
        const nextRecords = capture.records.map((record) => {
          const entities = { ...record.entities };
          deleteValueAtPath(entities as Record<string, unknown>, path);
          return { ...record, entities: entities as Record<string, Record<string, unknown>> };
        });
        updatedCapture = { ...capture, records: nextRecords };
        return updatedCapture;
      });
      const statsCapture = updatedCapture ?? next.find((capture) => capture.id === captureId) ?? null;
      if (statsCapture) {
        const stats = createEmptyCaptureStats();
        statsCapture.records.forEach((record: CaptureRecord) => appendRecordStats(stats, record));
        stats.componentNodes = countComponentNodes(statsCapture.components);
        captureStatsRef.current.set(statsCapture.id, stats);
      }
      return next;
    });
  }, []);

  const clearCaptureRecords = useCallback((captureId: string) => {
    setCaptures((prev) =>
      prev.map((capture) =>
        capture.id === captureId
          ? { ...capture, records: [] }
          : capture,
      ),
    );
    captureStatsRef.current.delete(captureId);
  }, []);

  const fetchMetricSeriesBatch = useCallback(
    async (
      captureId: string,
      metrics: SelectedMetric[],
      options?: { force?: boolean; preferCache?: boolean },
    ) => {
      if (!metrics.length) {
        return;
      }
      const liveEntry = liveStreamsRef.current.find((entry) => entry.id === captureId);
      const isLiveActive = Boolean(
        liveEntry
        && liveEntry.status !== "idle"
        && liveEntry.status !== "completed"
        && liveEntry.source.trim().length > 0,
      );
      const hasLiveSource = Boolean(liveEntry && liveEntry.source.trim().length > 0);
      const capture = capturesRef.current.find((entry) => entry.id === captureId);
      const hasCaptureSource = Boolean(capture && typeof capture.source === "string" && capture.source.trim().length > 0);
      if (!hasCaptureSource && !hasLiveSource && capture && capture.records.length > 0) {
        // Push-only capture: rely on capture_append frames for chart data.
        return;
      }
      if (!options?.force && liveEntry && liveEntry.status !== "idle" && liveEntry.status !== "completed") {
        return;
      }
      const uniqueMetrics = new Map<string, SelectedMetric>();
      metrics.forEach((metric) => {
        const key = buildSeriesKey(metric.captureId, metric.fullPath);
        if (pendingSeriesRef.current.has(key)) {
          return;
        }
        uniqueMetrics.set(key, metric);
      });
      if (uniqueMetrics.size === 0) {
        return;
      }
      const metricsToFetch = Array.from(uniqueMetrics.values());
      const metricsNeedingBackfill: SelectedMetric[] = [];
      metricsToFetch.forEach((metric) => {
        pendingSeriesRef.current.add(buildSeriesKey(metric.captureId, metric.fullPath));
      });
      try {
        const response = await fetch("/api/series/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            captureId,
            paths: metricsToFetch.map((metric) => metric.path),
            preferCache: options?.preferCache !== false,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to load series.");
        }
        const seriesList = Array.isArray(data?.series) ? data.series : [];
        const seriesByPath = new Map<string, { points: Array<{ tick: number; value: number | null }>; partial: boolean }>();
        seriesList.forEach((entry: { path?: string[]; points?: Array<{ tick: number; value: number | null }>; partial?: boolean }) => {
          if (!Array.isArray(entry?.path)) {
            return;
          }
          const points = Array.isArray(entry?.points) ? entry.points : [];
          seriesByPath.set(JSON.stringify(entry.path), { points, partial: Boolean(entry?.partial) });
        });
        metricsToFetch.forEach((metric) => {
          const key = JSON.stringify(metric.path);
          const entry = seriesByPath.get(key);
          if (!entry) {
            return;
          }
          mergeSeriesIntoCaptures(metric.captureId, metric.path, entry.points);
          loadedSeriesRef.current.add(buildSeriesKey(metric.captureId, metric.fullPath));
          const seriesKey = buildSeriesKey(metric.captureId, metric.fullPath);
          if (entry.partial) {
            partialSeriesRef.current.add(seriesKey);
            if (options?.preferCache !== false && !pendingFullBackfillRef.current.has(seriesKey)) {
              pendingFullBackfillRef.current.add(seriesKey);
              metricsNeedingBackfill.push(metric);
            }
          } else {
            partialSeriesRef.current.delete(seriesKey);
            pendingFullBackfillRef.current.delete(seriesKey);
          }
        });

        if (metricsNeedingBackfill.length > 0 && options?.preferCache !== false) {
          const backfillMetrics = [...metricsNeedingBackfill];
          const backfillDelayMs = isLiveActive ? 200 : 0;
          window.setTimeout(() => {
            void fetchMetricSeriesBatch(captureId, backfillMetrics, {
              force: true,
              preferCache: false,
            });
          }, backfillDelayMs);
        }
        sourceRepairAttemptAtRef.current.delete(captureId);
      } catch (error) {
        console.error("[series] Batch fetch error:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("capture source not found")) {
          const sourceFromCapture =
            capturesRef.current.find((entry) => entry.id === captureId)?.source?.trim() ?? "";
          const sourceFromLive =
            liveStreamsRef.current.find((entry) => entry.id === captureId)?.source?.trim() ?? "";
          const source = sourceFromCapture || sourceFromLive;
          if (source) {
            const now = Date.now();
            const lastAttempt = sourceRepairAttemptAtRef.current.get(captureId) ?? 0;
            if (now - lastAttempt >= 1000) {
              sourceRepairAttemptAtRef.current.set(captureId, now);
              sendMessageRef.current({
                type: "sync_capture_sources",
                sources: [{ captureId, source }],
                replace: false,
              });
              pushUiEvent({
                level: "info",
                message: "Capture source missing on server; repairing source mapping",
                detail: captureId,
              });
              window.setTimeout(() => {
                void fetchMetricSeriesBatch(captureId, metricsToFetch, {
                  force: true,
                  preferCache: options?.preferCache,
                });
              }, 200);
            }
          }
        }
        metricsToFetch.forEach((metric) => {
          const key = buildSeriesKey(metric.captureId, metric.fullPath);
          pendingFullBackfillRef.current.delete(key);
        });
      } finally {
        metricsToFetch.forEach((metric) => {
          pendingSeriesRef.current.delete(buildSeriesKey(metric.captureId, metric.fullPath));
        });
      }
    },
    [mergeSeriesIntoCaptures, pushUiEvent],
  );

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload file");
      }

      return response.json();
    },
    onSuccess: (data) => {
      if (data && data.streaming && typeof data.captureId === "string") {
        setUploadError(null);
        return;
      }
      ingestCapturePayload(data);
      setUploadError(null);
    },
    onError: (error: Error) => {
      setUploadError(error.message);
    },
  });

  const handleUploadDerivationPlugin = useCallback(
    async (file: File) => {
      setDerivationPluginsError(null);
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch("/api/derivations/plugins/upload", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : `Failed to upload plugin (${response.status})`,
          );
        }
        if (payload?.plugins) {
          setDerivationPlugins(normalizeDerivationPlugins(payload.plugins));
        } else {
          refreshDerivationPlugins();
        }
      } catch (error) {
        setDerivationPluginsError(error instanceof Error ? error.message : "Failed to upload derivation plugin.");
      }
    },
    [normalizeDerivationPlugins, refreshDerivationPlugins],
  );

  const handleDeleteDerivationPlugin = useCallback(
    async (pluginId: string) => {
      setDerivationPluginsError(null);
      try {
        const response = await fetch(`/api/derivations/plugins/${encodeURIComponent(pluginId)}`, {
          method: "DELETE",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : `Failed to delete plugin (${response.status})`,
          );
        }
        refreshDerivationPlugins();
      } catch (error) {
        setDerivationPluginsError(error instanceof Error ? error.message : "Failed to delete derivation plugin.");
      }
    },
    [refreshDerivationPlugins],
  );

  const handleViewDerivationPluginSource = useCallback(async (pluginId: string) => {
    if (derivationPluginCopyResetTimerRef.current !== null) {
      window.clearTimeout(derivationPluginCopyResetTimerRef.current);
      derivationPluginCopyResetTimerRef.current = null;
    }
    setIsDerivationPluginSourceCopied(false);
    setDerivationPluginSourceError(null);
    setDerivationPluginSourceLoading(true);
    setIsDerivationPluginSourceOpen(true);
    try {
      const response = await fetch(
        `/api/derivations/plugins/${encodeURIComponent(pluginId)}/source`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : `Failed to load plugin source (${response.status})`,
        );
      }
      setDerivationPluginSource(payload as DerivationPluginSourceResponse);
    } catch (error) {
      setDerivationPluginSource(null);
      setDerivationPluginSourceError(
        error instanceof Error ? error.message : "Failed to load derivation plugin source.",
      );
    } finally {
      setDerivationPluginSourceLoading(false);
    }
  }, []);

  const handleCopyDerivationPluginSource = useCallback(async () => {
    if (!derivationPluginSource?.source) {
      return;
    }
    try {
      await copyTextToClipboard(derivationPluginSource.source);
      setIsDerivationPluginSourceCopied(true);
      pushUiEvent({
        level: "info",
        message: "Plugin source copied",
        detail: derivationPluginSource.pluginId,
      });
      if (derivationPluginCopyResetTimerRef.current !== null) {
        window.clearTimeout(derivationPluginCopyResetTimerRef.current);
      }
      derivationPluginCopyResetTimerRef.current = window.setTimeout(() => {
        setIsDerivationPluginSourceCopied(false);
        derivationPluginCopyResetTimerRef.current = null;
      }, 1500);
    } catch (error) {
      pushUiEvent({
        level: "error",
        message: "Failed to copy plugin source",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [derivationPluginSource, pushUiEvent]);

  useEffect(() => {
    return () => {
      if (derivationPluginCopyResetTimerRef.current !== null) {
        window.clearTimeout(derivationPluginCopyResetTimerRef.current);
        derivationPluginCopyResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    liveStreamsRef.current = liveStreams;
  }, [liveStreams]);

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  useEffect(() => {
    selectedMetricsRef.current = selectedMetrics;
  }, [selectedMetrics]);

  useEffect(() => {
    derivationGroupsRef.current = derivationGroups;
  }, [derivationGroups]);

  useEffect(() => {
    derivationPluginsRef.current = derivationPlugins;
  }, [derivationPlugins]);

  useEffect(() => {
    activeDerivationGroupIdRef.current = activeDerivationGroupId;
  }, [activeDerivationGroupId]);

  useEffect(() => {
    displayDerivationGroupIdRef.current = displayDerivationGroupId;
  }, [displayDerivationGroupId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (seriesRefreshTimerRef.current !== null) {
      window.clearInterval(seriesRefreshTimerRef.current);
      seriesRefreshTimerRef.current = null;
    }

    seriesRefreshTimerRef.current = window.setInterval(() => {
      const now =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      const metricsByCapture = new Map<string, SelectedMetric[]>();
      selectedMetricsRef.current.forEach((metric) => {
        const list = metricsByCapture.get(metric.captureId);
        if (list) {
          list.push(metric);
        } else {
          metricsByCapture.set(metric.captureId, [metric]);
        }
      });

      if (metricsByCapture.size === 0) {
        return;
      }

      metricsByCapture.forEach((metrics, captureId) => {
        const liveEntry = liveStreamsRef.current.find((entry) => entry.id === captureId);
        if (
          !liveEntry
          || liveEntry.status === "idle"
          || liveEntry.status === "completed"
          || !liveEntry.source.trim()
        ) {
          return;
        }
        const capture = capturesRef.current.find((entry) => entry.id === captureId);
        if (!capture || !capture.isActive) {
          return;
        }
        let lastTick = lastSeriesTickRef.current.get(captureId) ?? 0;
        if (capture.tickCount < lastTick) {
          // Stream restart/reset: drop stale tick cursor so series refresh resumes progressively.
          lastTick = 0;
          lastSeriesTickRef.current.set(captureId, 0);
          lastSeriesRefreshRef.current.delete(captureId);
        }
        if (capture.tickCount <= lastTick) {
          return;
        }
        const lastRefresh = lastSeriesRefreshRef.current.get(captureId) ?? 0;
        if (now - lastRefresh < LIVE_SERIES_REFRESH_MS) {
          return;
        }
        lastSeriesRefreshRef.current.set(captureId, now);
        lastSeriesTickRef.current.set(captureId, capture.tickCount);
        fetchMetricSeriesBatch(captureId, metrics, { force: true, preferCache: true });
      });
    }, LIVE_SERIES_REFRESH_MS);

    return () => {
      if (seriesRefreshTimerRef.current !== null) {
        window.clearInterval(seriesRefreshTimerRef.current);
        seriesRefreshTimerRef.current = null;
      }
    };
  }, [fetchMetricSeriesBatch]);

  useEffect(() => {
    if (captures.length === 0) {
      streamModeRef.current.clear();
      return;
    }
    const nextModes = new Map<string, "lite" | "full">();
    captures.forEach((capture) => {
      const hasSelected = selectedMetrics.some((metric) => metric.captureId === capture.id);
      const captureSource =
        typeof capture.source === "string" ? capture.source.trim() : "";
      const liveEntry = liveStreamsRef.current.find((entry) => entry.id === capture.id);
      const liveSource = liveEntry ? liveEntry.source.trim() : "";
      // File-backed live streams stay in lite mode to avoid streaming full frames into the UI.
      // Use capture.source as well to avoid races during startup before liveStreams is populated.
      const isFileBacked = Boolean(captureSource) || Boolean(liveSource);
      nextModes.set(capture.id, hasSelected && !isFileBacked ? "full" : "lite");
    });

    nextModes.forEach((mode, captureId) => {
      const prev = streamModeRef.current.get(captureId);
      if (prev === mode) {
        return;
      }
      streamModeRef.current.set(captureId, mode);
      sendMessageRef.current({ type: "set_stream_mode", captureId, mode });
    });

    streamModeRef.current.forEach((_mode, captureId) => {
      if (!nextModes.has(captureId)) {
        streamModeRef.current.delete(captureId);
      }
    });
  }, [captures, selectedMetrics]);

  useEffect(() => {
    writeStorageJson(DASHBOARD_STORAGE_KEYS.selectedMetrics, selectedMetrics);
  }, [selectedMetrics]);

  useEffect(() => {
    writeStorageJson(DASHBOARD_STORAGE_KEYS.derivationGroups, derivationGroups);
  }, [derivationGroups]);

  useEffect(() => {
    writeStorageString(
      DASHBOARD_STORAGE_KEYS.activeDerivationGroupId,
      activeDerivationGroupId,
    );
  }, [activeDerivationGroupId]);

  useEffect(() => {
    writeStorageString(
      DASHBOARD_STORAGE_KEYS.displayDerivationGroupId,
      displayDerivationGroupId,
    );
  }, [displayDerivationGroupId]);

  useEffect(() => {
    writeStorageJson(DASHBOARD_STORAGE_KEYS.visualizationFrame, visualizationFrame);
  }, [visualizationFrame]);

  useEffect(() => {
    if (sidebarMode !== "analysis") {
      setHighlightedMetricKey(null);
    }
  }, [sidebarMode]);

  useEffect(() => {
    const payload = liveStreams
      .filter(
        (entry) =>
          entry.source.trim().length > 0 && !isDerivedCaptureSource(entry.source),
      )
      .map((entry) => ({
        id: entry.id,
        source: entry.source,
        pollSeconds: entry.pollSeconds,
        completed: entry.status === "completed",
      }));
    writeStorageJson(DASHBOARD_STORAGE_KEYS.liveStreams, payload);
  }, [liveStreams]);

  useEffect(() => {
    writeStorageString(DASHBOARD_STORAGE_KEYS.sourceMode, sourceMode);
  }, [sourceMode]);

  const getLiveMeta = useCallback((id: string) => {
    const existing = liveMetaRef.current.get(id);
    if (existing) {
      return existing;
    }
    const meta: LiveStreamMeta = {
      dirty: false,
      lastSource: null,
      retryTimer: null,
      retrySource: null,
      completed: false,
    };
    liveMetaRef.current.set(id, meta);
    return meta;
  }, []);

  const markInitialSyncReady = useCallback(() => {
    if (initialSyncTimerRef.current !== null) {
      window.clearTimeout(initialSyncTimerRef.current);
      initialSyncTimerRef.current = null;
    }
    if (!initialSyncReadyRef.current) {
      initialSyncReadyRef.current = true;
      setInitialSyncReady(true);
    }
  }, []);

  const resetInitialSync = useCallback(
    (options?: { delayMs?: number }) => {
      initialSyncReadyRef.current = false;
      setInitialSyncReady(false);
      if (initialSyncTimerRef.current !== null) {
        window.clearTimeout(initialSyncTimerRef.current);
      }
      const delay = Math.max(0, Math.floor(options?.delayMs ?? 2000));
      initialSyncTimerRef.current = window.setTimeout(() => {
        markInitialSyncReady();
      }, delay);
    },
    [markInitialSyncReady],
  );

  useEffect(() => {
    return () => {
      if (initialSyncTimerRef.current !== null) {
        window.clearTimeout(initialSyncTimerRef.current);
        initialSyncTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    liveStreams.forEach((entry) => {
      const meta = getLiveMeta(entry.id);
      meta.completed = entry.status === "completed";
    });
  }, [getLiveMeta, liveStreams]);

  useEffect(() => {
    const activeIds = new Set<string>();
    captures.forEach((capture) => activeIds.add(capture.id));
    liveStreams.forEach((entry) => activeIds.add(entry.id));

    for (const [id, meta] of liveMetaRef.current.entries()) {
      if (activeIds.has(id)) {
        continue;
      }
      const hasSource =
        (meta.lastSource !== null && meta.lastSource.trim().length > 0) ||
        (meta.retrySource !== null && meta.retrySource.trim().length > 0);
      const hasPendingWork = meta.retryTimer !== null || meta.dirty || meta.completed;
      if (!hasSource && !hasPendingWork) {
        liveMetaRef.current.delete(id);
      }
    }
  }, [captures, liveStreams]);

  useEffect(() => {
    const activeIds = new Set(liveStreams.map((entry) => entry.id));
    for (const existingId of Array.from(liveErrorEventsRef.current.keys())) {
      if (!activeIds.has(existingId)) {
        liveErrorEventsRef.current.delete(existingId);
      }
    }

    liveStreams.forEach((entry) => {
      const errorText = typeof entry.error === "string" ? entry.error.trim() : "";
      if (!errorText) {
        liveErrorEventsRef.current.delete(entry.id);
        return;
      }
      const fingerprint = `${entry.source}::${errorText}`;
      const previous = liveErrorEventsRef.current.get(entry.id);
      if (previous === fingerprint) {
        return;
      }
      liveErrorEventsRef.current.set(entry.id, fingerprint);
      pushUiEvent({
        level: "error",
        message: "Live stream source error",
        detail: `${entry.id}: ${errorText}`,
      });
    });
  }, [liveStreams, pushUiEvent]);

  const updateLiveStream = useCallback(
    (id: string, updates: Partial<LiveStreamEntry>) => {
      setLiveStreams((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)),
      );
    },
    [],
  );

  const clearLiveRetry = useCallback(
    (id: string, options?: { keepStatus?: boolean }) => {
      const meta = getLiveMeta(id);
      if (meta.retryTimer !== null) {
        window.clearTimeout(meta.retryTimer);
        meta.retryTimer = null;
      }
      meta.retrySource = null;
      if (options?.keepStatus) {
        return;
      }
      setLiveStreams((prev) =>
        prev.map((entry) =>
          entry.id === id && entry.status === "retrying"
            ? { ...entry, status: "idle" }
            : entry,
        ),
      );
    },
    [getLiveMeta],
  );

  useEffect(() => {
    return () => {
      liveMetaRef.current.forEach((meta) => {
        if (meta.retryTimer !== null) {
          window.clearTimeout(meta.retryTimer);
        }
      });
      liveMetaRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let statusInterval: number | null = null;

    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/live/status");
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (cancelled || !data) {
          return;
        }
        const streams = Array.isArray(data.streams)
          ? (data.streams as LiveStatusStream[])
          : data.running
            ? ([{
                captureId: data.captureId,
                source: data.source,
                pollIntervalMs: data.pollIntervalMs,
                lastError: data.lastError,
              }] as LiveStatusStream[])
            : [];
        setLiveStreams((prev) => {
          const next = [...prev];
          const indexById = new Map<string, number>();
          next.forEach((entry, index) => {
            indexById.set(entry.id, index);
          });

          streams.forEach((stream: LiveStatusStream) => {
            const captureId = typeof stream?.captureId === "string" ? stream.captureId : "";
            if (!captureId) {
              return;
            }
            const lastError =
              typeof stream?.lastError === "string" && stream.lastError.trim().length > 0
                ? stream.lastError
                : null;
            const pollSeconds = Number(stream?.pollIntervalMs)
              ? Math.max(0.5, Number(stream.pollIntervalMs) / 1000)
              : DEFAULT_POLL_SECONDS;
            const updated: LiveStreamEntry = {
              id: captureId,
              source: typeof stream?.source === "string" ? stream.source : "",
              pollSeconds,
              status: lastError ? "retrying" : "connected",
              error: lastError,
            };
            const existingIndex = indexById.get(captureId);
            if (existingIndex === undefined) {
              next.push(updated);
              return;
            }
            next[existingIndex] = {
              ...next[existingIndex],
              source: updated.source,
              pollSeconds: updated.pollSeconds,
              status: updated.status,
              error: updated.error,
            };
          });

          return next;
        });
      } catch (error) {
        console.warn("Failed to fetch live status:", error);
      }
    };

    void fetchStatus();
    if (sourceMode === "live") {
      statusInterval = window.setInterval(() => {
        void fetchStatus();
      }, 2000);
    }

    return () => {
      cancelled = true;
      if (statusInterval !== null) {
        window.clearInterval(statusInterval);
      }
    };
  }, [sourceMode]);

  const updateBaselineHeap = useCallback(() => {
    const memory = readPerformanceMemory();
    if (!memory) {
      return;
    }
    if (
      baselineHeapRef.current === null ||
      memory.usedJSHeapSize < baselineHeapRef.current
    ) {
      baselineHeapRef.current = memory.usedJSHeapSize;
    }
  }, []);

  const updateViewport = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const nextWidth = Math.max(0, Math.floor(window.innerWidth));
    const nextHeight = Math.max(0, Math.floor(window.innerHeight));
    const nextDpr = Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
    setViewport((prev) => {
      if (
        prev?.width === nextWidth &&
        prev?.height === nextHeight &&
        prev?.devicePixelRatio === nextDpr
      ) {
        return prev;
      }
      return {
        ...(prev ?? {}),
        width: nextWidth,
        height: nextHeight,
        devicePixelRatio: nextDpr,
      };
    });
  }, []);

  useLayoutEffect(() => {
    updateViewport();
  }, [updateViewport]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => updateViewport();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateViewport]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof performance === "undefined") {
      return;
    }
    let last = performance.now();
    const interval = EVENT_LOOP_INTERVAL_MS;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const lag = Math.max(0, now - last - interval);
      last = now;
      pushSample(eventLoopLagSamplesRef.current, lag);
    }, interval);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof performance === "undefined") {
      return;
    }
    let rafId = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const delta = now - last;
      last = now;
      if (delta > 0 && delta < 1000) {
        pushSample(frameTimeSamplesRef.current, delta);
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
      return;
    }
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType !== "longtask") {
            return;
          }
          const duration = typeof entry.duration === "number" ? entry.duration : 0;
          const stats = longTaskStatsRef.current;
          stats.count += 1;
          stats.totalMs += duration;
          stats.maxMs = Math.max(stats.maxMs, duration);
          stats.lastStart = entry.startTime ?? null;
          stats.lastDurationMs = duration;
        });
      });
      observer.observe({
        entryTypes: ["longtask"] as string[],
      });
    } catch {
      // ignore observer failures
    }
    return () => {
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    updateBaselineHeap();
  }, [updateBaselineHeap]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const interval = window.setInterval(() => {
      const next = {
        pendingSeries: pendingSeriesRef.current.size,
        pendingAppends: pendingAppendsRef.current.size,
        pendingComponentUpdates: pendingComponentUpdatesRef.current.size,
        pendingTicks: pendingTicksRef.current.size,
      };
      setLoadingProbe((prev) => {
        if (
          prev.pendingSeries === next.pendingSeries
          && prev.pendingAppends === next.pendingAppends
          && prev.pendingComponentUpdates === next.pendingComponentUpdates
          && prev.pendingTicks === next.pendingTicks
        ) {
          return prev;
        }
        return { ...next, updatedAt: Date.now() };
      });
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const updateFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    updateFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let raf1 = 0;
    let raf2 = 0;
    let timer: number | null = null;
    const dispatchResize = () => {
      window.dispatchEvent(new Event("resize"));
    };
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        dispatchResize();
      });
    });
    if (FULLSCREEN_RESIZE_DELAY > 0) {
      timer = window.setTimeout(() => {
        dispatchResize();
      }, FULLSCREEN_RESIZE_DELAY);
    }
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (captures.length === 0) {
      updateBaselineHeap();
    }
  }, [captures.length, updateBaselineHeap]);


  useEffect(() => {
    setPlaybackState(prev => ({
      ...prev,
      totalTicks: maxTotalTicks,
    }));
  }, [maxTotalTicks]);

  const handleFileUpload = useCallback(
    (file: File) => {
      uploadMutation.mutate(file);
    },
    [uploadMutation],
  );

  const startLiveStream = useCallback(
    async (options?: {
      source?: string;
      pollIntervalMs?: number;
      captureId?: string;
      filename?: string;
    }) => {
      const targetId = options?.captureId ?? `live-${generateId()}`;
      const existing = liveStreamsRef.current.find((entry) => entry.id === targetId);
      const source = (options?.source ?? existing?.source ?? "").trim();
      if (!source) {
        setLiveStreams((prev) => {
          const hasEntry = prev.some((entry) => entry.id === targetId);
          if (!hasEntry) {
            return [
              ...prev,
              {
                id: targetId,
                source: "",
                pollSeconds: DEFAULT_POLL_SECONDS,
                status: "idle",
                error: "Enter a capture file URL or path to start streaming.",
              },
            ];
          }
          return prev.map((entry) =>
            entry.id === targetId
              ? {
                  ...entry,
                  status: "idle",
                  error: "Enter a capture file URL or path to start streaming.",
                }
              : entry,
          );
        });
        throw new Error("Missing capture file source.");
      }
      const pollIntervalMs =
        options?.pollIntervalMs ??
        Math.max(
          500,
          Math.round((existing?.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000),
        );
      const pollSeconds = Math.max(0.5, pollIntervalMs / 1000);

      clearLiveRetry(targetId);
      setLiveStreams((prev) => {
        const hasEntry = prev.some((entry) => entry.id === targetId);
        if (!hasEntry) {
          return [
            ...prev,
            {
              id: targetId,
              source,
              pollSeconds,
              status: "connecting",
              error: null,
            },
          ];
        }
        return prev.map((entry) =>
          entry.id === targetId
            ? {
                ...entry,
                source,
                pollSeconds,
                status: "connecting",
                error: null,
              }
            : entry,
        );
      });

      try {
        const response = await fetch("/api/live/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            pollIntervalMs,
            captureId: targetId,
            filename: options?.filename,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 409) {
            try {
              const statusResponse = await fetch("/api/live/status");
              const statusData = await statusResponse.json().catch(() => ({}));
              const streams = Array.isArray(statusData?.streams)
                ? (statusData.streams as LiveStatusStream[])
                : statusData?.running
                  ? ([statusData] as LiveStatusStream[])
                  : [];
              const match = streams.find((stream: LiveStatusStream) => stream?.captureId === targetId);
              if (statusResponse.ok && match) {
                getLiveMeta(targetId).completed = false;
                updateLiveStream(targetId, {
                  status: "connected",
                  source: typeof match?.source === "string" ? match.source : source,
                  pollSeconds:
                    Number(match?.pollIntervalMs)
                      ? Math.max(0.5, Number(match.pollIntervalMs) / 1000)
                      : pollSeconds,
                  error: typeof match?.lastError === "string" ? match.lastError : null,
                });
                setSourceMode("live");
                return;
              }
            } catch {
              // fall through to error
            }
          }
          throw new Error(data?.error || "Failed to start live stream.");
        }
        getLiveMeta(targetId).completed = false;
        updateLiveStream(targetId, {
          status: "connected",
          source,
          pollSeconds: Number(data?.pollIntervalMs)
            ? Math.max(0.5, Number(data.pollIntervalMs) / 1000)
            : pollSeconds,
          error: null,
        });
        setSourceMode("live");
      } catch (error) {
        updateLiveStream(targetId, {
          status: "idle",
          error: error instanceof Error ? error.message : "Failed to start live stream.",
        });
        throw error;
      }
    },
    [clearLiveRetry, getLiveMeta, updateLiveStream],
  );

  const stopLiveStream = useCallback(
    async (options?: { captureId?: string }) => {
      try {
        const response = await fetch("/api/live/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: options?.captureId ? JSON.stringify({ captureId: options.captureId }) : undefined,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to stop live stream.");
        }
        const stopped = Array.isArray(data?.stopped)
          ? data.stopped
          : options?.captureId
            ? [options.captureId]
            : [];
        const notFound = Array.isArray(data?.notFound) ? data.notFound : [];
        const affected = Array.from(new Set([...stopped, ...notFound]));
        if (!options?.captureId) {
          setLiveStreams((prev) =>
            prev.map((entry) => ({ ...entry, status: "idle", error: null })),
          );
          liveStreamsRef.current.forEach((entry) => clearLiveRetry(entry.id));
        } else if (affected.length > 0) {
          setLiveStreams((prev) =>
            prev.map((entry) =>
              affected.includes(entry.id)
                ? { ...entry, status: "idle", error: null }
                : entry,
            ),
          );
          affected.forEach((id) => clearLiveRetry(id));
        }
      } catch (error) {
        throw error;
      }
    },
    [clearLiveRetry],
  );

  const handleClearUploadError = useCallback(() => {
    setUploadError(null);
  }, []);

  const handleSetFullscreen = useCallback((enabled: boolean) => {
    if (typeof document === "undefined") {
      return;
    }
    if (enabled) {
      if (!document.fullscreenElement) {
        const target = document.documentElement;
        if (target.requestFullscreen) {
          target.requestFullscreen().catch(() => {});
        }
      }
      return;
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleSetVisualizationFrame = useCallback(
    (next: {
      mode: "builtin" | "plugin";
      pluginId?: string;
      name?: string;
      captureId?: string;
    }) => {
      setVisualizationFrame((prev) => {
        const normalized = normalizeVisualizationFrameState({
          mode: next.mode,
          pluginId: typeof next.pluginId === "string" ? next.pluginId : undefined,
          name: typeof next.name === "string" ? next.name : undefined,
          captureId: typeof next.captureId === "string" ? next.captureId : undefined,
          updatedAt: new Date().toISOString(),
        });
        if (JSON.stringify(prev) === JSON.stringify(normalized)) {
          return prev;
        }
        return normalized;
      });
    },
    [],
  );

  const handleSourceModeChange = useCallback((mode: "file" | "live") => {
    setSourceMode(mode);
    if (mode === "live") {
      setUploadError(null);
      resetInitialSync();
    }
  }, [resetInitialSync]);

  const handleAddLiveStream = useCallback(() => {
    setLiveStreams((prev) => [
      ...prev,
      {
        id: generateId(),
        source: "",
        pollSeconds: DEFAULT_POLL_SECONDS,
        status: "idle",
        error: null,
      },
    ]);
  }, []);

  const handleLiveSourceInput = useCallback(
    (id: string, source: string) => {
      getLiveMeta(id).completed = false;
      setLiveStreams((prev) =>
        prev.map((entry) =>
          entry.id === id ? { ...entry, source, error: null } : entry,
        ),
      );
      if (sourceMode === "live") {
        getLiveMeta(id).dirty = true;
      }
    },
    [getLiveMeta, sourceMode],
  );

  const handleLiveSourceCommand = useCallback(
    (source: string, captureId?: string) => {
      const targetId = captureId ?? liveStreamsRef.current[0]?.id ?? generateId();
      getLiveMeta(targetId).completed = false;
      setLiveStreams((prev) => {
        const existing = prev.find((entry) => entry.id === targetId);
        if (!existing) {
          return [
            ...prev,
            {
              id: targetId,
              source,
              pollSeconds: DEFAULT_POLL_SECONDS,
              status: "idle",
              error: null,
            },
          ];
        }
        return prev.map((entry) =>
          entry.id === targetId ? { ...entry, source, error: null } : entry,
        );
      });
      if (sourceMode === "live") {
        getLiveMeta(targetId).dirty = true;
      }
    },
    [getLiveMeta, sourceMode],
  );

  const handleLivePollChange = useCallback((id: string, value: number) => {
    setLiveStreams((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, pollSeconds: value } : entry,
      ),
    );
  }, []);

  const checkSource = useCallback(async (source: string) => {
    const response = await fetch("/api/source/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to check live source.");
    }
    return Boolean(data?.ok);
  }, []);

  const scheduleRetry = useCallback(
    (id: string, source: string, errorMessage?: string) => {
      const meta = getLiveMeta(id);
      if (meta.retryTimer !== null) {
        return;
      }
      meta.retrySource = source;
      updateLiveStream(id, { status: "retrying", error: errorMessage ?? null });
      meta.retryTimer = window.setTimeout(() => {
        meta.retryTimer = null;
        if (sourceMode !== "live") {
          return;
        }
        const entry = liveStreamsRef.current.find((item) => item.id === id);
        if (!entry || entry.source.trim() !== source) {
          return;
        }
        attemptConnectRef.current(id, { force: true, showConnecting: false });
      }, 3000);
    },
    [getLiveMeta, sourceMode, updateLiveStream],
  );

  const attemptConnect = useCallback(
    async (
      id: string,
      options?: { force?: boolean; showConnecting?: boolean; allowCompleted?: boolean },
    ) => {
      const entry = liveStreamsRef.current.find((item) => item.id === id);
      if (!entry || sourceMode !== "live") {
        return;
      }
      const source = entry.source.trim();
      if (!source) {
        return;
      }
      if (entry.status === "connecting") {
        return;
      }
      if (entry.status === "connected" && !options?.force) {
        return;
      }
      const meta = getLiveMeta(id);
      if (meta.completed && !options?.allowCompleted) {
        return;
      }
      if (!options?.force && !meta.dirty) {
        return;
      }
      meta.dirty = false;
      const showConnecting = options?.showConnecting ?? entry.status !== "retrying";
      clearLiveRetry(id, { keepStatus: !showConnecting });
      if (showConnecting) {
        updateLiveStream(id, { status: "connecting", error: null });
      }
      try {
        const isAvailable = await checkSource(source);
        if (!isAvailable) {
          scheduleRetry(id, source, "Live capture not available yet.");
          return;
        }
        await startLiveStream({
          source,
          pollIntervalMs: Math.round(entry.pollSeconds * 1000),
          captureId: id,
        });
      } catch (error) {
        scheduleRetry(
          id,
          source,
          error instanceof Error ? error.message : "Failed to start live stream.",
        );
      }
    },
    [checkSource, clearLiveRetry, getLiveMeta, scheduleRetry, sourceMode, startLiveStream, updateLiveStream],
  );

  useEffect(() => {
    attemptConnectRef.current = attemptConnect;
  }, [attemptConnect]);

  useEffect(() => {
    if (liveStreams.length === 0) {
      return;
    }
    setCaptures((prev) => {
      let changed = false;
      const next = prev.map((capture) => {
        if (typeof capture.source === "string" && capture.source.trim().length > 0) {
          return capture;
        }
        const liveSource = liveStreams.find((entry) => entry.id === capture.id)?.source?.trim() ?? "";
        if (!liveSource) {
          return capture;
        }
        changed = true;
        return { ...capture, source: liveSource };
      });
      return changed ? next : prev;
    });
  }, [liveStreams]);

  useEffect(() => {
    if (sourceMode !== "live" || !initialSyncReady) {
      return;
    }
    const knownCaptureIds = new Set(captures.map((capture) => capture.id));
    liveStreams.forEach((entry) => {
      if (!entry.source.trim()) {
        return;
      }
      if (knownCaptureIds.has(entry.id)) {
        return;
      }
      if (entry.status !== "idle" && entry.status !== "retrying") {
        return;
      }
      attemptConnectRef.current(entry.id, { force: true, showConnecting: false });
    });
  }, [captures, initialSyncReady, liveStreams, sourceMode]);

  const handleWsReconnect = useCallback(() => {
    if (sourceMode === "live") {
      resetInitialSync();
    }
    refreshDerivationPlugins();
  }, [refreshDerivationPlugins, resetInitialSync, sourceMode]);

  const handleStateSync = useCallback(
    (syncCaptures: { captureId: string; lastTick?: number | null }[]) => {
      if (!Array.isArray(syncCaptures) || syncCaptures.length === 0) {
        markInitialSyncReady();
        return;
      }
      setCaptures((prev) => {
        const next = [...prev];
        const indexById = new Map<string, number>();
        next.forEach((capture, index) => {
          indexById.set(capture.id, index);
        });
        syncCaptures.forEach((entry) => {
          const captureId = entry.captureId;
          const lastTick = entry.lastTick;
          const liveSource = liveStreamsRef.current
            .find((liveEntry) => liveEntry.id === captureId)
            ?.source
            ?.trim();
          if (typeof captureId !== "string" || !captureId) {
            return;
          }
          if (typeof lastTick !== "number") {
            return;
          }
          const existingIndex = indexById.get(captureId);
          if (existingIndex === undefined) {
            const fallbackName = `${captureId}.jsonl`;
            const newCapture: CaptureSession = {
              id: captureId,
              filename: fallbackName,
              fileSize: 0,
              tickCount: lastTick,
              records: [],
              components: [],
              isActive: true,
              source: liveSource || undefined,
            };
            next.push(newCapture);
            indexById.set(captureId, next.length - 1);
            activeCaptureIdsRef.current.add(captureId);
            const stats = createEmptyCaptureStats();
            stats.tickCount = lastTick;
            captureStatsRef.current.set(captureId, stats);
            return;
          }
          const existing = next[existingIndex];
          if (existing.tickCount >= lastTick) {
            if (!existing.source && liveSource) {
              next[existingIndex] = { ...existing, source: liveSource };
            }
            return;
          }
          next[existingIndex] = {
            ...existing,
            tickCount: lastTick,
            source: existing.source ?? liveSource ?? undefined,
          };
          const stats = captureStatsRef.current.get(captureId);
          if (stats) {
            stats.tickCount = Math.max(stats.tickCount, lastTick);
          }
        });
        return next;
      });
      markInitialSyncReady();
    },
    [markInitialSyncReady],
  );

  const handleRestoreState = useCallback(
    (command: Extract<ControlCommand, { type: "restore_state" }>) => {
      if (!command || typeof command !== "object") {
        return;
      }
      if (restoredFromServerRef.current) {
        return;
      }

      // Avoid overwriting an existing localStorage-driven session.
      if (selectedMetricsRef.current.length > 0 || derivationGroupsRef.current.length > 0) {
        return;
      }

      const state = command.state ?? {};
      restoredFromServerRef.current = true;

      if (Array.isArray(state.selectedMetrics)) {
        const nextSelected = normalizeMetricList(state.selectedMetrics);
        selectedMetricsRef.current = nextSelected;
        setSelectedMetrics(nextSelected);
      }
      if (Array.isArray(state.derivationGroups)) {
        setDerivationGroups(normalizeDerivationGroups(state.derivationGroups));
      }
      if (typeof state.activeDerivationGroupId === "string") {
        setActiveDerivationGroupId(state.activeDerivationGroupId);
      }
      if (typeof state.displayDerivationGroupId === "string") {
        setDisplayDerivationGroupId(state.displayDerivationGroupId);
      }
      if (state.playback && typeof state.playback === "object") {
        const maybe = state.playback as Partial<PlaybackState>;
        setPlaybackState((prev) => ({
          ...prev,
          isPlaying: typeof maybe.isPlaying === "boolean" ? maybe.isPlaying : prev.isPlaying,
          speed: typeof maybe.speed === "number" ? maybe.speed : prev.speed,
          currentTick:
            typeof maybe.currentTick === "number" ? Math.max(1, Math.floor(maybe.currentTick)) : prev.currentTick,
        }));
      }

      const autoScroll = typeof state.autoScroll === "boolean" ? state.autoScroll : isAutoScroll;
      setIsAutoScroll(autoScroll);
      setIsWindowed(!autoScroll);

      if (typeof state.windowSize === "number") {
        setWindowSize(Math.max(1, Math.floor(state.windowSize)));
      }
      if (typeof state.windowStart === "number") {
        setWindowStart(Math.max(1, Math.floor(state.windowStart)));
      }
      if (typeof state.windowEnd === "number") {
        setWindowEnd(Math.max(1, Math.floor(state.windowEnd)));
      }
      if (Array.isArray(state.yPrimaryDomain) && state.yPrimaryDomain.length === 2) {
        const min = Number(state.yPrimaryDomain[0]);
        const max = Number(state.yPrimaryDomain[1]);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          setManualYPrimaryDomain([min, max]);
        }
      } else if (state.yPrimaryDomain === null) {
        setManualYPrimaryDomain(null);
      }
      if (Array.isArray(state.ySecondaryDomain) && state.ySecondaryDomain.length === 2) {
        const min = Number(state.ySecondaryDomain[0]);
        const max = Number(state.ySecondaryDomain[1]);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          setManualYSecondaryDomain([min, max]);
        }
      } else if (state.ySecondaryDomain === null) {
        setManualYSecondaryDomain(null);
      }
      if (Array.isArray(state.annotations)) {
        setAnnotations(state.annotations);
      }
      if (Array.isArray(state.subtitles)) {
        setSubtitles(state.subtitles);
      }
      if (state.visualizationFrame && typeof state.visualizationFrame === "object") {
        setVisualizationFrame(normalizeVisualizationFrameState(state.visualizationFrame));
      }
    },
    [isAutoScroll],
  );

  const handleLiveRefresh = useCallback(
    (id: string) => {
      if (sourceMode !== "live") {
        return;
      }
      attemptConnectRef.current(id, { force: true, showConnecting: true, allowCompleted: true });
    },
    [sourceMode],
  );

  const handleRemoveLiveStream = useCallback(
    (id: string) => {
      clearLiveRetry(id);
      liveMetaRef.current.delete(id);
      setLiveStreams((prev) => prev.filter((entry) => entry.id !== id));
      stopLiveStream({ captureId: id }).catch(() => {});
    },
    [clearLiveRetry, stopLiveStream],
  );

  useEffect(() => {
    liveStreams.forEach((entry) => {
      const meta = getLiveMeta(entry.id);
      const trimmed = entry.source.trim();
      const sourceChanged = meta.lastSource !== null && trimmed !== meta.lastSource;

      if (sourceMode !== "live") {
        meta.dirty = false;
        meta.lastSource = trimmed;
        return;
      }

      if (!trimmed) {
        clearLiveRetry(entry.id);
        meta.dirty = false;
        if (entry.status === "connected") {
          stopLiveStream({ captureId: entry.id }).catch(() => {});
          updateLiveStream(entry.id, { status: "idle", error: null });
        } else if (entry.status === "retrying" || entry.status === "connecting") {
          updateLiveStream(entry.id, { status: "idle", error: null });
        }
        meta.lastSource = trimmed;
        return;
      }

      if (meta.retrySource && meta.retrySource !== trimmed) {
        clearLiveRetry(entry.id);
      }

      if (entry.status === "connected" && sourceChanged && meta.dirty) {
        stopLiveStream({ captureId: entry.id })
          .then(() => attemptConnect(entry.id, { force: true }))
          .catch(() => scheduleRetry(entry.id, trimmed));
        meta.lastSource = trimmed;
        return;
      }

      if (sourceChanged && meta.dirty && entry.status !== "connected") {
        attemptConnect(entry.id, { force: true });
      }

      meta.lastSource = trimmed;
    });
  }, [
    attemptConnect,
    clearLiveRetry,
    getLiveMeta,
    liveStreams,
    scheduleRetry,
    sourceMode,
    stopLiveStream,
    updateLiveStream,
  ]);

  const handleCaptureInit = useCallback(
    (
      captureId: string,
      filename?: string,
      options?: { reset?: boolean; source?: string },
    ) => {
      const isReset = Boolean(options?.reset);
      const source = typeof options?.source === "string" ? options.source : "";
      let shouldFetch = true;
      let shouldClear = true;

      // A new capture init means this capture is active again (even if it previously ended).
      endedCapturesRef.current.delete(captureId);
      endedCaptureReasonsRef.current.delete(captureId);
      stopStreamingIndicator(captureId);

      setCaptures((prev) => {
        const fallbackName = `${captureId}.jsonl`;
        const existing = prev.find((capture) => capture.id === captureId);
        if (!existing) {
          shouldClear = true;
          activeCaptureIdsRef.current.add(captureId);
          return [
            ...prev,
            {
              id: captureId,
              filename: filename || fallbackName,
              fileSize: 0,
              tickCount: 0,
              records: [],
              components: [],
              isActive: true,
              source: source.trim() ? source : undefined,
            },
          ];
        }

        shouldFetch = existing.isActive;
        shouldClear = isReset;
        if (!isReset) {
          return prev.map((capture) =>
            capture.id === captureId
              ? {
                  ...capture,
                  filename: filename || capture.filename || fallbackName,
                  source: source.trim() ? source : capture.source,
                }
              : capture,
          );
        }

        return prev.map((capture) =>
          capture.id === captureId
            ? {
                ...capture,
                filename: filename || capture.filename || fallbackName,
                tickCount: 0,
                records: [],
                components: [],
                source: source.trim() ? source : capture.source,
              }
            : capture,
        );
      });

      if (sourceMode === "live" && source.trim()) {
        if (!isDerivedCaptureSource(source)) {
        setLiveStreams((prev) => {
          const existing = prev.find((entry) => entry.id === captureId);
          if (existing) {
            if (existing.source.trim() === source.trim()) {
              return prev;
            }
            const updated = prev.map((entry) =>
              entry.id === captureId ? { ...entry, source } : entry,
            );
            liveStreamsRef.current = updated;
            return updated;
          }
          const next = [
            ...prev,
            {
              id: captureId,
              source,
              pollSeconds: DEFAULT_POLL_SECONDS,
              status: "idle" as LiveStreamStatus,
              error: null,
            },
          ];
          liveStreamsRef.current = next;
          return next;
        });
          const meta = getLiveMeta(captureId);
          meta.dirty = false;
          meta.lastSource = source.trim();
        }
      }

      if (shouldClear) {
        captureStatsRef.current.set(captureId, createEmptyCaptureStats());
        lastSeriesRefreshRef.current.delete(captureId);
        lastSeriesTickRef.current.delete(captureId);
        partialSeriesRef.current.forEach((key) => {
          if (key.startsWith(`${captureId}::`)) {
            partialSeriesRef.current.delete(key);
            pendingFullBackfillRef.current.delete(key);
          }
        });
        Array.from(loadedSeriesRef.current.keys()).forEach((key) => {
          if (key.startsWith(`${captureId}::`)) {
            loadedSeriesRef.current.delete(key);
            pendingSeriesRef.current.delete(key);
            pendingFullBackfillRef.current.delete(key);
          }
        });
      }

      if (!shouldFetch || shouldClear) {
        // For reset/init, wait for post-reset ticks so fetches align with the new stream state.
        // Immediate fetch here can race with reset and leave loadedSeries marked while records are empty.
        return;
      }
      const selectedForCapture = selectedMetricsRef.current.filter(
        (metric) => metric.captureId === captureId,
      );
      fetchMetricSeriesBatch(captureId, selectedForCapture, { preferCache: true });
    },
    [fetchMetricSeriesBatch, getLiveMeta, sourceMode, stopStreamingIndicator],
  );

  const handleCaptureComponents = useCallback((captureId: string, components: ComponentNode[]) => {
    if (!components || components.length === 0) {
      return;
    }
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const lastApplied = componentUpdateLastAppliedRef.current.get(captureId) ?? 0;
    const elapsed = now - lastApplied;
    if (elapsed < COMPONENT_UPDATE_THROTTLE_MS) {
      componentUpdateThrottledRef.current += 1;
      pendingComponentUpdatesRef.current.set(captureId, components);
      if (!componentUpdateTimersRef.current.has(captureId)) {
        const delay = Math.max(0, COMPONENT_UPDATE_THROTTLE_MS - elapsed);
        const timer = window.setTimeout(() => {
          componentUpdateTimersRef.current.delete(captureId);
          const pending = pendingComponentUpdatesRef.current.get(captureId);
          if (pending) {
            pendingComponentUpdatesRef.current.delete(captureId);
            handleCaptureComponents(captureId, pending);
          }
        }, delay);
        componentUpdateTimersRef.current.set(captureId, timer);
      }
      return;
    }

    let durationMs = 0;
    let nodeCount = 0;
    setCaptures((prev) => {
      const start =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      const existing = prev.find((capture) => capture.id === captureId);
      const fallbackName = `${captureId}.jsonl`;
      if (!existing) {
        const stats = createEmptyCaptureStats();
        // The server sends a fully-merged component tree. Counting/merging on every update is
        // expensive for large captures and can starve the WS control loop.
        stats.componentNodes = components.length;
        nodeCount = stats.componentNodes;
        captureStatsRef.current.set(captureId, stats);
        activeCaptureIdsRef.current.add(captureId);
        durationMs = (typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()) - start;
        return [
          ...prev,
          {
            id: captureId,
            filename: fallbackName,
            fileSize: 0,
            tickCount: 0,
            records: [],
            components,
            isActive: true,
          },
        ];
      }

      const stats = captureStatsRef.current.get(captureId) ?? createEmptyCaptureStats();
      // The server already maintains a merged tree (and only sends when it grows). Avoid merging
      // and deep counting here to keep UI responsive during large capture loads.
      if (!stats.componentNodes) {
        stats.componentNodes = components.length;
      }
      nodeCount = stats.componentNodes;
      captureStatsRef.current.set(captureId, stats);
      durationMs = (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - start;

      return prev.map((capture) =>
        capture.id === captureId
          ? { ...capture, components }
          : capture,
      );
    });

    componentUpdateLastAppliedRef.current.set(captureId, now);
    if (durationMs > 0) {
      pushSample(componentUpdateSamplesRef.current, durationMs);
      componentUpdateLastMsRef.current = durationMs;
      componentUpdateLastAtRef.current =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      componentUpdateLastNodesRef.current = nodeCount || componentUpdateLastNodesRef.current;
    }
  }, []);

  const flushPendingAppends = useCallback(() => {
    appendFlushTimerRef.current = null;
    if (pendingAppendsRef.current.size === 0) {
      return;
    }
    const pending = pendingAppendsRef.current;
    pendingAppendsRef.current = new Map();

    const metricsByCapture = new Map<string, SelectedMetric[]>();
    selectedMetricsRef.current.forEach((metric) => {
      const list = metricsByCapture.get(metric.captureId);
      if (list) {
        list.push(metric);
      } else {
        metricsByCapture.set(metric.captureId, [metric]);
      }
    });

    setCaptures((prev) => {
      const next = [...prev];
      const indexById = new Map<string, number>();
      next.forEach((capture, index) => {
        indexById.set(capture.id, index);
      });

      for (const [captureId, frames] of pending.entries()) {
        if (frames.length === 0) {
          continue;
        }
        const metricsForCapture = metricsByCapture.get(captureId) ?? [];
        const existingIndex = indexById.get(captureId);
        const existingCapture =
          existingIndex !== undefined
            ? next[existingIndex]
            : null;
        const derivedBySource = isDerivedCaptureSource(existingCapture?.source ?? "");
        const derivedByFrameShape = frames.some(
          (frame) =>
            typeof (frame as { componentId?: unknown }).componentId === "string" &&
            (frame as { componentId?: string }).componentId === "derivations",
        );
        const isDerivedCapture = captureId.startsWith("derive-") || derivedBySource || derivedByFrameShape;
        const shouldAppend = metricsForCapture.length > 0 || isDerivedCapture;
        const newRecords: CaptureRecord[] = [];
        let lastTick: number | null = null;

        frames.forEach((frame) => {
          lastTick = frame.tick;
          if (!shouldAppend) {
            return;
          }
          if (isDerivedCapture) {
            const compactedFrame = compactRecord(frame);
            if (Object.keys(compactedFrame.entities).length === 0) {
              return;
            }
            newRecords.push(compactedFrame);
            return;
          }
          const filteredEntities = buildEntitiesForMetrics(
            (frame.entities || {}) as Record<string, unknown>,
            metricsForCapture,
          );
          if (Object.keys(filteredEntities).length === 0) {
            return;
          }
          const compactedFrame = compactRecord({ tick: frame.tick, entities: filteredEntities });
          if (Object.keys(compactedFrame.entities).length === 0) {
            return;
          }
          newRecords.push(compactedFrame);
        });

        const nextTickCount = lastTick ?? 0;
        if (existingIndex === undefined) {
          const fallbackName = `${captureId}.jsonl`;
          const createdRecords =
            shouldAppend && isDerivedCapture
              ? Array.from(
                  new Map(newRecords.map((record) => [record.tick, record])).values(),
                ).sort((a, b) => a.tick - b.tick)
              : shouldAppend
                ? newRecords
                : [];
          const newCapture: CaptureSession = {
            id: captureId,
            filename: fallbackName,
            fileSize: 0,
            tickCount: nextTickCount,
            records: createdRecords,
            components: [],
            isActive: true,
          };
          next.push(newCapture);
          indexById.set(captureId, next.length - 1);
          activeCaptureIdsRef.current.add(captureId);
          const stats = createEmptyCaptureStats();
          createdRecords.forEach((record) => appendRecordStats(stats, record));
          stats.tickCount = Math.max(stats.tickCount, nextTickCount);
          stats.componentNodes = countComponentNodes(newCapture.components);
          captureStatsRef.current.set(captureId, stats);
          continue;
        }

        const existing = next[existingIndex];
        const updatedTickCount = Math.max(existing.tickCount, nextTickCount);
        let updatedRecords = existing.records;
        const stats = captureStatsRef.current.get(captureId) ?? createEmptyCaptureStats();
        if (shouldAppend && newRecords.length > 0) {
          if (isDerivedCapture) {
            const byTick = new Map<number, CaptureRecord>();
            existing.records.forEach((record) => {
              byTick.set(record.tick, record);
            });
            newRecords.forEach((record) => {
              byTick.set(record.tick, record);
            });
            updatedRecords = Array.from(byTick.values()).sort((a, b) => a.tick - b.tick);
            const recalculated = createEmptyCaptureStats();
            updatedRecords.forEach((record) => appendRecordStats(recalculated, record));
            recalculated.tickCount = Math.max(recalculated.tickCount, updatedTickCount);
            recalculated.componentNodes = countComponentNodes(existing.components);
            captureStatsRef.current.set(captureId, recalculated);
          } else {
            updatedRecords = existing.records.concat(newRecords);
            newRecords.forEach((record) => appendRecordStats(stats, record));
            stats.tickCount = Math.max(stats.tickCount, updatedTickCount);
            stats.componentNodes = countComponentNodes(existing.components);
            captureStatsRef.current.set(captureId, stats);
          }
        } else {
          stats.tickCount = Math.max(stats.tickCount, updatedTickCount);
          stats.componentNodes = countComponentNodes(existing.components);
          captureStatsRef.current.set(captureId, stats);
        }

        next[existingIndex] = {
          ...existing,
          records: updatedRecords,
          tickCount: updatedTickCount,
          isActive: true,
        };
      }

      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (appendFlushTimerRef.current !== null) {
        window.clearTimeout(appendFlushTimerRef.current);
        appendFlushTimerRef.current = null;
      }
    };
  }, []);

  const flushPendingTicks = useCallback(() => {
    tickFlushTimerRef.current = null;
    if (pendingTicksRef.current.size === 0) {
      return;
    }
    const pending = pendingTicksRef.current;
    pendingTicksRef.current = new Map();

    setCaptures((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      return prev.map((capture) => {
        const pendingTick = pending.get(capture.id);
        if (pendingTick === undefined) {
          return capture;
        }
        const nextTick = Math.max(capture.tickCount, pendingTick);
        if (nextTick === capture.tickCount) {
          return capture;
        }
        const stats = captureStatsRef.current.get(capture.id);
        if (stats) {
          stats.tickCount = Math.max(stats.tickCount, nextTick);
        }
        return { ...capture, tickCount: nextTick, isActive: true };
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (tickFlushTimerRef.current !== null) {
        window.clearTimeout(tickFlushTimerRef.current);
        tickFlushTimerRef.current = null;
      }
    };
  }, []);

  const handleCaptureAppend = useCallback((captureId: string, frame: CaptureRecord) => {
    if (!activeCaptureIdsRef.current.has(captureId)) {
      return;
    }
    noteStreamingActivity(captureId);

    const pending = pendingAppendsRef.current;
    const list = pending.get(captureId);
    if (list) {
      list.push(frame);
    } else {
      pending.set(captureId, [frame]);
    }
    if (appendFlushTimerRef.current === null) {
      appendFlushTimerRef.current = window.setTimeout(() => {
        flushPendingAppends();
      }, APPEND_FLUSH_MS);
    }
  }, [flushPendingAppends, noteStreamingActivity]);

  const handleCaptureTick = useCallback((captureId: string, tick: number) => {
    if (!activeCaptureIdsRef.current.has(captureId)) {
      const capture = captures.find((entry) => entry.id === captureId);
      if (capture?.isActive) {
        activeCaptureIdsRef.current.add(captureId);
      } else {
        return;
      }
    }
    noteStreamingActivity(captureId);
    const existing = pendingTicksRef.current.get(captureId) ?? 0;
    if (tick > existing) {
      pendingTicksRef.current.set(captureId, tick);
    }
    flushPendingTicks();
  }, [captures, flushPendingTicks, noteStreamingActivity]);

  const handleCaptureEnd = useCallback(
    (captureId: string, reason?: string, detail?: string) => {
      endedCapturesRef.current.add(captureId);
      endedCaptureReasonsRef.current.set(captureId, {
        reason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : "unspecified",
        detail: typeof detail === "string" && detail.trim().length > 0 ? detail.trim() : undefined,
        at: new Date().toISOString(),
      });
      clearDerivationRunPendingByCapture(captureId);
      stopStreamingIndicator(captureId);
      clearLiveRetry(captureId);
      const liveEntry = liveStreamsRef.current.find((entry) => entry.id === captureId);
      if (liveEntry) {
        getLiveMeta(captureId).completed = true;
        setLiveStreams((prev) =>
          prev.map((entry) =>
            entry.id === captureId ? { ...entry, status: "completed", error: null } : entry,
          ),
        );
      } else {
        setLiveStreams((prev) =>
          prev.map((entry) =>
            entry.id === captureId ? { ...entry, status: "idle", error: null } : entry,
          ),
        );
      }
      const selectedForCapture = selectedMetricsRef.current.filter(
        (metric) => metric.captureId === captureId,
      );
      if (selectedForCapture.length > 0) {
        // Always force a full-source backfill at capture end. Cache-first partial fetches can mark a
        // series as loaded before full records are available, leaving "completed + empty records".
        fetchMetricSeriesBatch(captureId, selectedForCapture, {
          force: true,
          preferCache: false,
        });
      }
    },
    [
      clearDerivationRunPendingByCapture,
      clearLiveRetry,
      fetchMetricSeriesBatch,
      getLiveMeta,
      stopStreamingIndicator,
    ],
  );

  const handleToggleCapture = useCallback((captureId: string) => {
    const wasActive = captures.find((capture) => capture.id === captureId)?.isActive ?? false;
    setCaptures((prev) => {
      const updated = prev.map((capture) =>
        capture.id === captureId ? { ...capture, isActive: !capture.isActive } : capture,
      );
      const newActiveCaptures = updated.filter((capture) => capture.isActive);
      const newMaxTicks =
        newActiveCaptures.length > 0
          ? Math.max(...newActiveCaptures.map((capture) => capture.tickCount))
          : 0;

      setPlaybackState((ps) => ({
        ...ps,
        totalTicks: newMaxTicks,
        currentTick: Math.min(ps.currentTick, newMaxTicks || 1),
      }));

      return updated;
    });

    if (wasActive) {
      activeCaptureIdsRef.current.delete(captureId);
      pendingAppendsRef.current.delete(captureId);
      return;
    }

    activeCaptureIdsRef.current.add(captureId);
    const selectedForCapture = selectedMetricsRef.current.filter(
      (metric) => metric.captureId === captureId,
    );
    fetchMetricSeriesBatch(captureId, selectedForCapture, { preferCache: true });
  }, [captures, fetchMetricSeriesBatch]);

  const handleRemoveCapture = useCallback((captureId: string) => {
    clearDerivationRunPendingByCapture(captureId);
    endedCapturesRef.current.delete(captureId);
    endedCaptureReasonsRef.current.delete(captureId);
    stopStreamingIndicator(captureId);
    setCaptures(prev => prev.filter(c => c.id !== captureId));
    setSelectedMetrics((prev) => {
      const next = prev.filter((metric) => metric.captureId !== captureId);
      selectedMetricsRef.current = next;
      return next;
    });
    setDerivationGroups((prev) =>
      prev.map((group) => ({
        ...group,
        metrics: getDerivationGroupInputMetrics(group).filter(
          (metric) => metric.captureId !== captureId,
        ),
        derivedMetrics: getDerivationGroupDerivedMetrics(group).filter(
          (metric) => metric.captureId !== captureId,
        ),
      })),
    );
    captureStatsRef.current.delete(captureId);
    activeCaptureIdsRef.current.delete(captureId);
    pendingTicksRef.current.delete(captureId);
    lastSeriesRefreshRef.current.delete(captureId);
    lastSeriesTickRef.current.delete(captureId);
    staleSeriesRecoverAtRef.current.delete(captureId);
    staleSeriesRecoverErrorAtRef.current.delete(captureId);
    partialSeriesRef.current.forEach((key) => {
      if (key.startsWith(`${captureId}::`)) {
        partialSeriesRef.current.delete(key);
        pendingFullBackfillRef.current.delete(key);
      }
    });
    loadedSeriesRef.current.forEach((key) => {
      if (key.startsWith(`${captureId}::`)) {
        loadedSeriesRef.current.delete(key);
        pendingFullBackfillRef.current.delete(key);
      }
    });
    pendingSeriesRef.current.forEach((key) => {
      if (key.startsWith(`${captureId}::`)) {
        pendingSeriesRef.current.delete(key);
        pendingFullBackfillRef.current.delete(key);
      }
    });
    derivationOutputGroupByCaptureRef.current.delete(captureId);
    handleRemoveLiveStream(captureId);
    sendMessageRef.current({ type: "remove_capture", captureId });
  }, [clearDerivationRunPendingByCapture, handleRemoveLiveStream, stopStreamingIndicator]);

  const handleSelectMetric = useCallback((captureId: string, path: string[], explicitGroupId?: string) => {
    const fullPath = path.join(".");
    const baseLabel = path[path.length - 1];
    const key = `${captureId}::${fullPath}`;
    const selectedCapture = capturesRef.current.find((entry) => entry.id === captureId);
    const isDerivedCapture =
      captureId.startsWith("derive-") || isDerivedCaptureSource(selectedCapture?.source ?? "");
    const liveEntry = liveStreamsRef.current.find((entry) => entry.id === captureId);
    if (liveEntry && liveEntry.status !== "idle" && !liveEntry.source.trim()) {
      streamModeRef.current.set(captureId, "full");
      sendMessageRef.current({ type: "set_stream_mode", captureId, mode: "full" });
    }

    const explicitGroup =
      typeof explicitGroupId === "string" && explicitGroupId.trim().length > 0
        ? explicitGroupId.trim()
        : null;
    const targetGroupId =
      explicitGroup && derivationGroupsRef.current.some((group) => group.id === explicitGroup)
        ? explicitGroup
        : resolveDerivedGroupIdForCapture(
            captureId,
            derivationGroupsRef.current,
            derivationOutputGroupByCaptureRef.current,
          );
    const targetGroup = targetGroupId
      ? derivationGroupsRef.current.find((group) => group.id === targetGroupId) ?? null
      : null;

    const existingMetric = selectedMetricsRef.current.find(
      (metric) => metric.captureId === captureId && metric.fullPath === fullPath,
    );
    let selectedMetric: SelectedMetric =
      existingMetric ??
      (() => {
        // Deterministic color assignment so asynchronous selection events do not produce unstable colors.
        let hash = 0;
        for (let i = 0; i < key.length; i += 1) {
          hash = (hash * 31 + key.charCodeAt(i)) | 0;
        }
        const colorIndex = Math.abs(hash) % METRIC_COLORS.length;
        const label =
          targetGroup && isDerivedCapture
            ? buildDerivedMetricLabel(targetGroup.name, { path, label: baseLabel })
            : baseLabel;
        return {
          captureId,
          path,
          fullPath,
          label,
          color: METRIC_COLORS[colorIndex]!,
        };
      })();

    if (targetGroup && isDerivedCapture) {
      const expectedLabel = buildDerivedMetricLabel(targetGroup.name, selectedMetric);
      if (selectedMetric.label !== expectedLabel) {
        selectedMetric = { ...selectedMetric, label: expectedLabel };
      }
    }

    const refExists = selectedMetricsRef.current.some(
      (metric) => metric.captureId === captureId && metric.fullPath === fullPath,
    );
    if (!refExists) {
      selectedMetricsRef.current = [...selectedMetricsRef.current, selectedMetric];
    }

    setSelectedMetrics((prev) => {
      const existingIndex = prev.findIndex(
        (metric) => metric.captureId === captureId && metric.fullPath === fullPath,
      );
      if (existingIndex >= 0) {
        const found = prev[existingIndex]!;
        let nextMetric = found;
        if (targetGroup && isDerivedCapture) {
          const expectedLabel = buildDerivedMetricLabel(targetGroup.name, found);
          if (found.label !== expectedLabel) {
            nextMetric = { ...found, label: expectedLabel };
          }
        }
        if (nextMetric !== found) {
          const next = [...prev];
          next[existingIndex] = nextMetric;
          selectedMetric = nextMetric;
          selectedMetricsRef.current = next;
          return next;
        }
        selectedMetric = found;
        selectedMetricsRef.current = prev;
        return prev;
      }
      const next = [...prev, selectedMetric];
      selectedMetricsRef.current = next;
      return next;
    });
    if (targetGroupId) {
      const selectedKey = getMetricKey(selectedMetric);
      setDerivationGroups((prev) =>
        prev.map((group) => {
          if (group.id !== targetGroupId) {
            return group;
          }
          const existing = uniqueMetrics([
            ...getDerivationGroupInputMetrics(group),
            ...getDerivationGroupDerivedMetrics(group),
          ]);
          const exists = existing.some((entry) => getMetricKey(entry) === selectedKey);
          if (exists) {
            return group;
          }
          return {
            ...group,
            derivedMetrics: [
              ...getDerivationGroupDerivedMetrics(group),
              selectedMetric,
            ],
          };
        }),
      );
    }
  }, []);

  const handleToggleMetricAxis = useCallback((metric: SelectedMetric) => {
    const metricKey = getMetricKey(metric);
    const toggleAxis = (entry: SelectedMetric): SelectedMetric => {
      if (getMetricKey(entry) !== metricKey) {
        return entry;
      }
      if (entry.axis === "y2") {
        const { axis: _axis, ...rest } = entry;
        return rest;
      }
      return { ...entry, axis: "y2" };
    };

    setSelectedMetrics((prev) => {
      const next = prev.map(toggleAxis);
      selectedMetricsRef.current = next;
      return next;
    });
    setDerivationGroups((prev) =>
      prev.map((group) => ({
        ...group,
        metrics: getDerivationGroupInputMetrics(group).map(toggleAxis),
        derivedMetrics: getDerivationGroupDerivedMetrics(group).map(toggleAxis),
      })),
    );
  }, []);

  const handleSetMetricAxis = useCallback(
    (captureId: string, fullPath: string, axis: "y1" | "y2") => {
      const applyAxis = (entry: SelectedMetric): SelectedMetric => {
        if (entry.captureId !== captureId || entry.fullPath !== fullPath) {
          return entry;
        }
        if (axis === "y2") {
          if (entry.axis === "y2") {
            return entry;
          }
          return { ...entry, axis: "y2" };
        }
        if (entry.axis === "y2") {
          const { axis: _axis, ...rest } = entry;
          return rest;
        }
        return entry;
      };

      setSelectedMetrics((prev) => {
        const next = prev.map(applyAxis);
        selectedMetricsRef.current = next;
        return next;
      });
      setDerivationGroups((prev) =>
        prev.map((group) => ({
          ...group,
          metrics: getDerivationGroupInputMetrics(group).map(applyAxis),
          derivedMetrics: getDerivationGroupDerivedMetrics(group).map(applyAxis),
        })),
      );
    },
    [],
  );

  const handleDeselectMetric = useCallback((captureId: string, fullPath: string) => {
    setSelectedMetrics((prev) => {
      const next = prev.filter((metric) => !(metric.captureId === captureId && metric.fullPath === fullPath));
      selectedMetricsRef.current = next;
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    selectedMetricsRef.current = [];
    setSelectedMetrics([]);
  }, []);

  const resolveActiveDerivationGroupId = useCallback((): string | null => {
    const groups = derivationGroupsRef.current;
    if (groups.length === 0) {
      return null;
    }
    const activeId = activeDerivationGroupIdRef.current;
    const resolved =
      activeId && groups.some((group) => group.id === activeId) ? activeId : groups[0]!.id;
    if (resolved !== activeId) {
      setActiveDerivationGroupId(resolved);
    }
    return resolved;
  }, []);

  const ensureActiveDerivationGroupId = useCallback((): string => {
    const resolved = resolveActiveDerivationGroupId();
    if (resolved) {
      return resolved;
    }
    const id = "default";
    const group: DerivationGroup = { id, name: "Default", metrics: [], derivedMetrics: [] };
    setDerivationGroups([group]);
    setActiveDerivationGroupId(id);
    return id;
  }, [resolveActiveDerivationGroupId]);

  const handleSelectAnalysisMetric = useCallback((captureId: string, path: string[]) => {
    const fullPath = path.join(".");
    const label = path[path.length - 1] ?? fullPath;
    const key = `${captureId}::${fullPath}`;

    const existing = selectedMetricsRef.current.find(
      (entry) => entry.captureId === captureId && entry.fullPath === fullPath,
    );

    const metric: SelectedMetric =
      existing ??
      (() => {
        // Deterministic color assignment so agent-driven flows (select+analysis-select sent back-to-back)
        // don't depend on React state update timing.
        let hash = 0;
        for (let i = 0; i < key.length; i += 1) {
          hash = (hash * 31 + key.charCodeAt(i)) | 0;
        }
        const colorIndex = Math.abs(hash) % METRIC_COLORS.length;
        return {
          captureId,
          path,
          fullPath,
          label,
          color: METRIC_COLORS[colorIndex]!,
        };
      })();

    // Ensure the metric exists in the displayed set as well.
    setSelectedMetrics((prev) => {
      const exists = prev.some((entry) => entry.captureId === captureId && entry.fullPath === fullPath);
      if (exists) {
        selectedMetricsRef.current = prev;
        return prev;
      }
      const next = [...prev, metric];
      selectedMetricsRef.current = next;
      return next;
    });
    const groupId = ensureActiveDerivationGroupId();
    setDerivationGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        if (getDerivationGroupInputMetrics(group).some((entry) => getMetricKey(entry) === key)) {
          return group;
        }
        return { ...group, metrics: [...getDerivationGroupInputMetrics(group), metric] };
      }),
    );
    return true;
  }, [ensureActiveDerivationGroupId]);

  const handleDeselectAnalysisMetric = useCallback((captureId: string, fullPath: string) => {
    const groupId = resolveActiveDerivationGroupId();
    if (!groupId) {
      return;
    }
    setDerivationGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          metrics: getDerivationGroupInputMetrics(group).filter(
            (entry) => !(entry.captureId === captureId && entry.fullPath === fullPath),
          ),
        };
      }),
    );
  }, []);

  const handleClearAnalysisMetrics = useCallback(() => {
    setDerivationGroups((prev) =>
      prev.map((group) => ({ ...group, metrics: [] })),
    );
  }, []);

  const toUniqueGroupId = useCallback((desired: string, ignoreId?: string): string => {
    const base = desired.trim() || "group";
    const existing = new Set(derivationGroupsRef.current.map((group) => group.id));
    if (ignoreId) {
      existing.delete(ignoreId);
    }
    if (!existing.has(base)) {
      return base;
    }
    let counter = 2;
    while (existing.has(`${base}-${counter}`)) {
      counter += 1;
    }
    return `${base}-${counter}`;
  }, []);

  const handleCreateDerivationGroup = useCallback(
    (options?: { groupId?: string; name?: string }) => {
      const desiredId = options?.groupId?.trim() || `group-${generateId()}`;
      const id = toUniqueGroupId(desiredId);
      const name = options?.name?.trim() || id;
      const group: DerivationGroup = { id, name, metrics: [], derivedMetrics: [] };
      setDerivationGroups((prev) => {
        const next = [group, ...prev];
        derivationGroupsRef.current = next;
        return next;
      });
      activeDerivationGroupIdRef.current = id;
      setActiveDerivationGroupId(id);
    },
    [toUniqueGroupId],
  );

  const removeCaptureIds = useCallback(
    (captureIds: string[]) => {
      const ids = Array.from(
        new Set(
          captureIds
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
        ),
      );
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      const matchesCapturePrefix = (key: string) => {
        for (const id of idSet) {
          if (key.startsWith(`${id}::`)) {
            return true;
          }
        }
        return false;
      };

      ids.forEach((captureId) => {
        clearDerivationRunPendingByCapture(captureId);
        endedCapturesRef.current.delete(captureId);
        endedCaptureReasonsRef.current.delete(captureId);
        stopStreamingIndicator(captureId);
        captureStatsRef.current.delete(captureId);
        activeCaptureIdsRef.current.delete(captureId);
        pendingTicksRef.current.delete(captureId);
        lastSeriesRefreshRef.current.delete(captureId);
        lastSeriesTickRef.current.delete(captureId);
        staleSeriesRecoverAtRef.current.delete(captureId);
        staleSeriesRecoverErrorAtRef.current.delete(captureId);
        derivationOutputGroupByCaptureRef.current.delete(captureId);
        handleRemoveLiveStream(captureId);
        sendMessageRef.current({ type: "remove_capture", captureId });
      });

      partialSeriesRef.current.forEach((key) => {
        if (matchesCapturePrefix(key)) {
          partialSeriesRef.current.delete(key);
          pendingFullBackfillRef.current.delete(key);
        }
      });
      loadedSeriesRef.current.forEach((key) => {
        if (matchesCapturePrefix(key)) {
          loadedSeriesRef.current.delete(key);
          pendingFullBackfillRef.current.delete(key);
        }
      });
      pendingSeriesRef.current.forEach((key) => {
        if (matchesCapturePrefix(key)) {
          pendingSeriesRef.current.delete(key);
          pendingFullBackfillRef.current.delete(key);
        }
      });

      setCaptures((prev) => prev.filter((capture) => !idSet.has(capture.id)));
      setSelectedMetrics((prev) => {
        const next = prev.filter((metric) => !idSet.has(metric.captureId));
        selectedMetricsRef.current = next;
        return next;
      });
      setDerivationGroups((prev) =>
        prev.map((group) => ({
          ...group,
          metrics: getDerivationGroupInputMetrics(group).filter(
            (metric) => !idSet.has(metric.captureId),
          ),
          derivedMetrics: getDerivationGroupDerivedMetrics(group).filter(
            (metric) => !idSet.has(metric.captureId),
          ),
        })),
      );
    },
    [clearDerivationRunPendingByCapture, handleRemoveLiveStream, stopStreamingIndicator],
  );

  const handleDeleteDerivationGroup = useCallback((groupId: string) => {
    const derivedPrefix = `derive-${groupId}-`;
    const derivedCaptureIds = new Set<string>();
    for (const [captureId, mappedGroupId] of derivationOutputGroupByCaptureRef.current.entries()) {
      if (mappedGroupId === groupId) {
        derivedCaptureIds.add(captureId);
      }
    }
    capturesRef.current.forEach((capture) => {
      if (capture.id.startsWith(derivedPrefix)) {
        derivedCaptureIds.add(capture.id);
      }
    });
    removeCaptureIds(Array.from(derivedCaptureIds));

    const nextGroups = derivationGroupsRef.current.filter((group) => group.id !== groupId);
    if (activeDerivationGroupIdRef.current === groupId) {
      const nextId = nextGroups[0]?.id ?? "";
      activeDerivationGroupIdRef.current = nextId;
      setActiveDerivationGroupId(nextId);
    }
    if (displayDerivationGroupIdRef.current === groupId) {
      displayDerivationGroupIdRef.current = "";
      setDisplayDerivationGroupId("");
    }
    for (const [captureId, mappedGroupId] of derivationOutputGroupByCaptureRef.current.entries()) {
      if (mappedGroupId === groupId) {
        derivationOutputGroupByCaptureRef.current.delete(captureId);
      }
    }
    for (const [timerKey, timerId] of derivationRerunTimersRef.current.entries()) {
      if (!timerKey.startsWith(`${groupId}::`)) {
        continue;
      }
      window.clearTimeout(timerId);
      derivationRerunTimersRef.current.delete(timerKey);
    }
    for (const key of autoReplayDerivationsRef.current) {
      if (key.startsWith(`${groupId}::`)) {
        autoReplayDerivationsRef.current.delete(key);
      }
    }
    derivationGroupsRef.current = nextGroups;
    setDerivationGroups(nextGroups);
  }, [removeCaptureIds]);

  useEffect(() => {
    if (!initialSyncReady || captures.length === 0) {
      return;
    }
    const groupIds = new Set(derivationGroups.map((group) => group.id));
    const orphanDerivedCaptureIds = captures
      .filter((capture) => {
        if (!capture.id.startsWith("derive-")) {
          return false;
        }
        const mappedGroup = derivationOutputGroupByCaptureRef.current.get(capture.id);
        if (mappedGroup && groupIds.has(mappedGroup)) {
          return false;
        }
        for (const groupId of groupIds) {
          if (capture.id.startsWith(`derive-${groupId}-`)) {
            return false;
          }
        }
        return true;
      })
      .map((capture) => capture.id);

    if (orphanDerivedCaptureIds.length === 0) {
      return;
    }
    pushUiEvent({
      level: "info",
      message: "Removing orphan derived captures",
      detail: orphanDerivedCaptureIds.join(", "),
    });
    removeCaptureIds(orphanDerivedCaptureIds);
  }, [captures, derivationGroups, initialSyncReady, pushUiEvent, removeCaptureIds]);

  const handleSetActiveDerivationGroup = useCallback((groupId: string) => {
    if (!derivationGroupsRef.current.some((group) => group.id === groupId)) {
      return;
    }
    activeDerivationGroupIdRef.current = groupId;
    setActiveDerivationGroupId(groupId);
  }, []);

  const handleUpdateDerivationGroup = useCallback(
    (groupId: string, updates: { newGroupId?: string; name?: string; pluginId?: string }) => {
      const currentGroup = derivationGroupsRef.current.find((group) => group.id === groupId);
      if (!currentGroup) {
        return;
      }
      const desiredNewId = updates.newGroupId?.trim();
      const nextId = desiredNewId ? toUniqueGroupId(desiredNewId, groupId) : null;
      const nextName = updates.name?.trim();
      const wantsPluginUpdate = Object.prototype.hasOwnProperty.call(updates, "pluginId");
      const nextPluginIdRaw = typeof updates.pluginId === "string" ? updates.pluginId.trim() : "";
      const nextPluginId = nextPluginIdRaw.length > 0 ? nextPluginIdRaw : undefined;
      const currentPluginId =
        typeof currentGroup.pluginId === "string" ? currentGroup.pluginId.trim() : "";
      const resolvedPluginId = wantsPluginUpdate
        ? nextPluginIdRaw
        : currentPluginId;
      const shouldResetDerived = wantsPluginUpdate && resolvedPluginId !== currentPluginId;

      if (nextId && nextId !== groupId && activeDerivationGroupIdRef.current === groupId) {
        activeDerivationGroupIdRef.current = nextId;
        setActiveDerivationGroupId(nextId);
      }
      if (nextId && nextId !== groupId && displayDerivationGroupIdRef.current === groupId) {
        displayDerivationGroupIdRef.current = nextId;
        setDisplayDerivationGroupId(nextId);
      }

      if (nextId && nextId !== groupId) {
        for (const [captureId, mappedGroupId] of derivationOutputGroupByCaptureRef.current.entries()) {
          if (mappedGroupId === groupId) {
            derivationOutputGroupByCaptureRef.current.set(captureId, nextId);
          }
        }
      }

      if (shouldResetDerived) {
        const derivedCaptureIds = new Set<string>();
        for (const [captureId, mappedGroupId] of derivationOutputGroupByCaptureRef.current.entries()) {
          if (mappedGroupId === groupId) {
            derivedCaptureIds.add(captureId);
          }
        }
        capturesRef.current.forEach((capture) => {
          if (capture.id.startsWith(`derive-${groupId}-`)) {
            derivedCaptureIds.add(capture.id);
          }
        });
        if (currentPluginId) {
          derivedCaptureIds.add(`derive-${groupId}-${currentPluginId}`);
        }

        for (const [timerKey, timerId] of derivationRerunTimersRef.current.entries()) {
          if (!timerKey.startsWith(`${groupId}::`)) {
            continue;
          }
          window.clearTimeout(timerId);
          derivationRerunTimersRef.current.delete(timerKey);
        }

        for (const key of Array.from(autoReplayDerivationsRef.current)) {
          if (key.startsWith(`${groupId}::`)) {
            autoReplayDerivationsRef.current.delete(key);
          }
        }

        if (derivedCaptureIds.size > 0) {
          const removed = Array.from(derivedCaptureIds);
          pushUiEvent({
            level: "info",
            message: "Removing outdated derived outputs",
            detail: `${groupId}: ${removed.join(", ")}`,
          });
          removeCaptureIds(removed);
        }
      }

      setDerivationGroups((prev) =>
        prev.map((group) => {
          if (group.id !== groupId) {
            return group;
          }
          const nextGroupPluginId = wantsPluginUpdate ? nextPluginId : group.pluginId;
          return {
            ...group,
            id: nextId ?? group.id,
            name: nextName ?? group.name,
            pluginId: nextGroupPluginId,
            derivedMetrics: shouldResetDerived
              ? []
              : getDerivationGroupDerivedMetrics(group),
          };
        }),
      );
    },
    [pushUiEvent, removeCaptureIds, toUniqueGroupId],
  );

  const handleSetDisplayDerivationGroup = useCallback((groupId: string) => {
    if (!groupId) {
      displayDerivationGroupIdRef.current = "";
      setDisplayDerivationGroupId("");
      return;
    }
    if (!derivationGroupsRef.current.some((group) => group.id === groupId)) {
      return;
    }
    displayDerivationGroupIdRef.current = groupId;
    setDisplayDerivationGroupId(groupId);
  }, []);

  const handleCreateDerivationGroupFromActive = useCallback(
    (mode: "new" | "deep-copy" | "shallow-copy") => {
      if (mode === "new") {
        handleCreateDerivationGroup();
        return;
      }

      const source =
        derivationGroupsRef.current.find(
          (group) => group.id === activeDerivationGroupIdRef.current,
        ) ?? derivationGroupsRef.current[0];

      if (!source) {
        handleCreateDerivationGroup();
        return;
      }

      const suffix = mode === "deep-copy" ? "deep-copy" : "copy";
      const desiredId = `${source.id}-${suffix}`;
      const id = toUniqueGroupId(desiredId);

      const baseName =
        mode === "deep-copy" ? `${source.name} deep copy` : `${source.name} copy`;
      const existingNames = new Set(
        derivationGroupsRef.current
          .map((group) => group.name.trim().toLowerCase())
          .filter((name) => name.length > 0),
      );
      let name = baseName;
      if (existingNames.has(name.toLowerCase())) {
        let counter = 2;
        while (existingNames.has(`${baseName} ${counter}`.toLowerCase())) {
          counter += 1;
        }
        name = `${baseName} ${counter}`;
      }

      const copiedInputs = uniqueMetrics(
        getDerivationGroupInputMetrics(source).map(cloneMetric),
      );
      const copiedDerived = uniqueMetrics(
        getDerivationGroupDerivedMetrics(source).map(cloneMetric),
      );
      const copiedPluginId =
        typeof source.pluginId === "string" && source.pluginId.trim().length > 0
          ? source.pluginId.trim()
          : undefined;

      const nextGroup: DerivationGroup = {
        id,
        name,
        metrics:
          mode === "shallow-copy"
            ? uniqueMetrics([...copiedInputs, ...copiedDerived])
            : copiedInputs,
        derivedMetrics: [],
        pluginId: mode === "deep-copy" ? copiedPluginId : undefined,
      };

      setDerivationGroups((prev) => {
        const next = [nextGroup, ...prev];
        derivationGroupsRef.current = next;
        return next;
      });
      activeDerivationGroupIdRef.current = id;
      setActiveDerivationGroupId(id);

      if (mode === "deep-copy" && copiedPluginId && copiedInputs.length > 0) {
        const outputCaptureId = `derive-${id}-${copiedPluginId}`;
        handleRunDerivationPlugin({ groupId: id, pluginId: copiedPluginId, outputCaptureId });
      }
    },
    [handleCreateDerivationGroup, handleRunDerivationPlugin, toUniqueGroupId],
  );

  const prevSelectedRef = useRef<SelectedMetric[]>([]);

  const captureSeriesIdentity = captures
    .map((capture) => {
      const source = typeof capture.source === "string" ? capture.source.trim() : "";
      return `${capture.id}:${capture.isActive ? 1 : 0}:${source}`;
    })
    .join("|");
  const liveSeriesIdentity = liveStreams
    .map((entry) => `${entry.id}:${entry.status}:${entry.source.trim()}`)
    .join("|");

  useEffect(() => {
    if (captures.length === 0 || selectedMetrics.length === 0) {
      return;
    }
    const metricsByCapture = new Map<string, SelectedMetric[]>();
    selectedMetrics.forEach((metric) => {
      const capture = captures.find((entry) => entry.id === metric.captureId);
      if (!capture || !capture.isActive) {
        return;
      }
      const key = buildSeriesKey(metric.captureId, metric.fullPath);
      if (
        (loadedSeriesRef.current.has(key) && !partialSeriesRef.current.has(key))
        || pendingSeriesRef.current.has(key)
      ) {
        return;
      }
      const list = metricsByCapture.get(metric.captureId);
      if (list) {
        list.push(metric);
      } else {
        metricsByCapture.set(metric.captureId, [metric]);
      }
    });
    metricsByCapture.forEach((metrics, captureId) => {
      fetchMetricSeriesBatch(captureId, metrics, { force: true, preferCache: true });
    });
  }, [captureSeriesIdentity, fetchMetricSeriesBatch, liveSeriesIdentity, selectedMetrics]);

  useEffect(() => {
    if (captures.length === 0 || selectedMetrics.length === 0) {
      return;
    }
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    const metricsByCapture = new Map<string, SelectedMetric[]>();
    selectedMetrics.forEach((metric) => {
      const capture = captures.find((entry) => entry.id === metric.captureId);
      if (!capture || !capture.isActive) {
        return;
      }
      const list = metricsByCapture.get(metric.captureId);
      if (list) {
        list.push(metric);
      } else {
        metricsByCapture.set(metric.captureId, [metric]);
      }
    });

    metricsByCapture.forEach((metrics, captureId) => {
      const capture = captures.find((entry) => entry.id === captureId);
      if (!capture || !capture.isActive || capture.tickCount <= 0) {
        return;
      }
      if (capture.records.length > 0) {
        staleSeriesRecoverErrorAtRef.current.delete(captureId);
        return;
      }

      const liveEntry = liveStreamsRef.current.find((entry) => entry.id === captureId);
      const isCompletedCapture =
        liveEntry?.status === "completed" || endedCapturesRef.current.has(captureId);
      const source =
        (typeof capture.source === "string" ? capture.source.trim() : "")
        || (liveEntry?.source ? liveEntry.source.trim() : "");
      if (!source) {
        return;
      }

      const hasPending = metrics.some((metric) =>
        pendingSeriesRef.current.has(buildSeriesKey(metric.captureId, metric.fullPath)),
      );
      if (hasPending) {
        return;
      }

      const fullyLoaded = metrics.every((metric) => {
        const key = buildSeriesKey(metric.captureId, metric.fullPath);
        return loadedSeriesRef.current.has(key) && !partialSeriesRef.current.has(key);
      });
      if (!isCompletedCapture && fullyLoaded) {
        return;
      }

      const lastAttempt = staleSeriesRecoverAtRef.current.get(captureId) ?? 0;
      if (now - lastAttempt < 1500) {
        return;
      }
      staleSeriesRecoverAtRef.current.set(captureId, now);

      if (isCompletedCapture) {
        const lastError = staleSeriesRecoverErrorAtRef.current.get(captureId) ?? 0;
        if (now - lastError >= 5000) {
          staleSeriesRecoverErrorAtRef.current.set(captureId, now);
          pushUiEvent({
            level: "error",
            message: "Capture completed without resolved metric records",
            detail: captureId,
          });
        }
      }

      pushUiEvent({
        level: "info",
        message: isCompletedCapture
          ? "Recovering capture series (full backfill)"
          : "Recovering capture series",
        detail: captureId,
      });
      fetchMetricSeriesBatch(captureId, metrics, {
        force: true,
        preferCache: !isCompletedCapture,
      });
    });
  }, [captures, fetchMetricSeriesBatch, liveSeriesIdentity, pushUiEvent, selectedMetrics]);

  useEffect(() => {
    const prev = prevSelectedRef.current;
    const prevKeys = new Set(prev.map((metric) => buildSeriesKey(metric.captureId, metric.fullPath)));
    const nextKeys = new Set(selectedMetrics.map((metric) => buildSeriesKey(metric.captureId, metric.fullPath)));
    const added = selectedMetrics.filter(
      (metric) => !prevKeys.has(buildSeriesKey(metric.captureId, metric.fullPath)),
    );
    const removed = prev.filter(
      (metric) => !nextKeys.has(buildSeriesKey(metric.captureId, metric.fullPath)),
    );

    const addedByCapture = new Map<string, SelectedMetric[]>();
    added.forEach((metric) => {
      const capture = captures.find((entry) => entry.id === metric.captureId);
      if (!capture || !capture.isActive) {
        return;
      }
      const key = buildSeriesKey(metric.captureId, metric.fullPath);
      if (loadedSeriesRef.current.has(key) && !partialSeriesRef.current.has(key)) {
        return;
      }
      const list = addedByCapture.get(metric.captureId);
      if (list) {
        list.push(metric);
      } else {
        addedByCapture.set(metric.captureId, [metric]);
      }
    });
    addedByCapture.forEach((metrics, captureId) => {
      const liveEntry = liveStreamsRef.current.find((entry) => entry.id === captureId);
      const shouldForce =
        liveEntry?.status !== "idle"
        && liveEntry?.status !== "completed"
        && Boolean(liveEntry?.source?.trim());
      fetchMetricSeriesBatch(
        captureId,
        metrics,
        shouldForce ? { force: true, preferCache: true } : { preferCache: true },
      );
    });

    if (removed.length > 0) {
      const remainingByCapture = new Map<string, SelectedMetric[]>();
      selectedMetrics.forEach((metric) => {
        const list = remainingByCapture.get(metric.captureId);
        if (list) {
          list.push(metric);
        } else {
          remainingByCapture.set(metric.captureId, [metric]);
        }
      });

      removed.forEach((metric) => {
        const key = buildSeriesKey(metric.captureId, metric.fullPath);
        loadedSeriesRef.current.delete(key);
        pendingSeriesRef.current.delete(key);
        partialSeriesRef.current.delete(key);
        pendingFullBackfillRef.current.delete(key);
        const remaining = remainingByCapture.get(metric.captureId);
        if (!remaining || remaining.length === 0) {
          clearCaptureRecords(metric.captureId);
          return;
        }
        removeMetricFromCaptures(metric.captureId, metric.path);
      });
    }

    prevSelectedRef.current = selectedMetrics;
  }, [clearCaptureRecords, fetchMetricSeriesBatch, removeMetricFromCaptures, selectedMetrics]);

  const handleClearCaptures = useCallback(() => {
    clearAllPendingDerivationRuns();
    selectedMetricsRef.current = [];
    setCaptures([]);
    setSelectedMetrics([]);
    captureStatsRef.current.clear();
    endedCapturesRef.current.clear();
    endedCaptureReasonsRef.current.clear();
    clearStreamingActivity();
    activeCaptureIdsRef.current.clear();
    pendingTicksRef.current.clear();
    lastSeriesRefreshRef.current.clear();
    lastSeriesTickRef.current.clear();
    staleSeriesRecoverAtRef.current.clear();
    staleSeriesRecoverErrorAtRef.current.clear();
    partialSeriesRef.current.clear();
    pendingFullBackfillRef.current.clear();
    derivationOutputGroupByCaptureRef.current.clear();
    if (tickFlushTimerRef.current !== null) {
      window.clearTimeout(tickFlushTimerRef.current);
      tickFlushTimerRef.current = null;
    }
    setLiveStreams([]);
    liveMetaRef.current.clear();
    stopLiveStream().catch(() => {});
    sendMessageRef.current({ type: "clear_captures" });
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: false,
      currentTick: 1,
      totalTicks: 0,
    }));
    setWindowSize(INITIAL_WINDOW_SIZE);
    setWindowStart(1);
    setWindowEnd(INITIAL_WINDOW_SIZE);
    setIsAutoScroll(true);
  }, [clearAllPendingDerivationRuns, clearStreamingActivity]);

  const handlePlay = useCallback(() => {
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: true,
      currentTick: isAutoScroll ? prev.currentTick : windowEnd,
    }));
    if (!isAutoScroll) {
      setIsAutoScroll(true);
    }
  }, [isAutoScroll, windowEnd]);

  const handlePause = useCallback(() => {
    setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const handleStop = useCallback(() => {
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: false,
      currentTick: 1,
    }));
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
    }
  }, []);

  const handleSeek = useCallback((tick: number) => {
    if (isWindowed) {
      return;
    }
    const maxTick = Math.max(1, playbackState.totalTicks || 1);
    const clamped = Math.min(Math.max(1, Math.floor(tick)), maxTick);
    setPlaybackState((prev) => ({ ...prev, currentTick: clamped }));
  }, [isWindowed, playbackState.totalTicks]);

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackState((prev) => ({ ...prev, speed }));
  }, []);

  const handleAddAnnotation = useCallback((annotation: Annotation) => {
    if (!Number.isFinite(annotation.tick)) {
      return;
    }
    const tick = Math.max(1, Math.floor(annotation.tick));
    const id = annotation.id && annotation.id.trim().length > 0
      ? annotation.id.trim()
      : `anno-${generateId()}`;
    const rawLabel = typeof annotation.label === "string" ? annotation.label : undefined;
    const label = rawLabel && rawLabel.trim().length > 0 ? rawLabel : undefined;
    const color = annotation.color && annotation.color.trim().length > 0 ? annotation.color.trim() : undefined;
    setAnnotations((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === id);
      const nextEntry: Annotation = { id, tick, label, color };
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextEntry;
        return next;
      }
      return [...prev, nextEntry].sort((a, b) => a.tick - b.tick);
    });
  }, []);

  const handleRemoveAnnotation = useCallback((options: { id?: string; tick?: number }) => {
    setAnnotations((prev) => {
      const targetId = options.id?.trim();
      const targetTick = Number.isFinite(options.tick)
        ? Math.max(1, Math.floor(options.tick as number))
        : null;
      if (!targetId && targetTick === null) {
        return prev;
      }
      return prev.filter((annotation) => {
        if (targetId) {
          return annotation.id !== targetId;
        }
        return annotation.tick !== targetTick;
      });
    });
  }, []);

  const handleClearAnnotations = useCallback(() => {
    setAnnotations([]);
  }, []);

  const handleJumpAnnotation = useCallback(
    (direction: "next" | "previous") => {
      if (annotations.length === 0) {
        return;
      }
      const sorted = [...annotations].sort((a, b) => a.tick - b.tick);
      if (direction === "next") {
        const next = sorted.find((item) => item.tick > playbackState.currentTick);
        if (next) {
          handleSeek(next.tick);
        }
        return;
      }
      const reversed = [...sorted].reverse();
      const prev = reversed.find((item) => item.tick < playbackState.currentTick);
      if (prev) {
        handleSeek(prev.tick);
      }
    },
    [annotations, playbackState.currentTick, handleSeek],
  );

  const handleAddSubtitle = useCallback((subtitle: SubtitleOverlay) => {
    if (!subtitle || !Number.isFinite(subtitle.startTick) || !Number.isFinite(subtitle.endTick)) {
      return;
    }
    const text = subtitle.text ? subtitle.text.trim() : "";
    if (!text) {
      return;
    }
    let startTick = Math.max(1, Math.floor(subtitle.startTick));
    let endTick = Math.max(1, Math.floor(subtitle.endTick));
    if (startTick > endTick) {
      [startTick, endTick] = [endTick, startTick];
    }
    const id = subtitle.id && subtitle.id.trim().length > 0
      ? subtitle.id.trim()
      : `subtitle-${generateId()}`;
    const color = subtitle.color && subtitle.color.trim().length > 0 ? subtitle.color.trim() : undefined;
    setSubtitles((prev) => {
      const nextEntry: SubtitleOverlay = { id, startTick, endTick, text, color };
      const existingIndex = prev.findIndex((item) => item.id === id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextEntry;
        return next.sort((a, b) => a.startTick - b.startTick);
      }
      return [...prev, nextEntry].sort((a, b) => a.startTick - b.startTick);
    });
  }, []);

  const handleRemoveSubtitle = useCallback((options: {
    id?: string;
    startTick?: number;
    endTick?: number;
    text?: string;
  }) => {
    setSubtitles((prev) => {
      const targetId = options.id?.trim();
      if (targetId) {
        return prev.filter((subtitle) => subtitle.id !== targetId);
      }
      const startTick = Number.isFinite(options.startTick)
        ? Math.max(1, Math.floor(options.startTick as number))
        : null;
      const endTick = Number.isFinite(options.endTick)
        ? Math.max(1, Math.floor(options.endTick as number))
        : null;
      const text = options.text ? options.text.trim() : "";
      if (startTick === null && endTick === null && !text) {
        return prev;
      }
      return prev.filter((subtitle) => {
        if (text && subtitle.text !== text) {
          return true;
        }
        if (startTick !== null && subtitle.startTick !== startTick) {
          return true;
        }
        if (endTick !== null && subtitle.endTick !== endTick) {
          return true;
        }
        return false;
      });
    });
  }, []);

  const handleClearSubtitles = useCallback(() => {
    setSubtitles([]);
  }, []);

  const handleStepForward = useCallback(() => {
    setPlaybackState((prev) => ({
      ...prev,
      currentTick: Math.min(prev.totalTicks, prev.currentTick + 1),
    }));
  }, []);

  const handleStepBackward = useCallback(() => {
    setPlaybackState((prev) => ({
      ...prev,
      currentTick: Math.max(1, prev.currentTick - 1),
    }));
  }, []);

  const activeMetrics = useMemo(
    () =>
      displayMetrics.filter((metric) =>
        captures.some((capture) => capture.id === metric.captureId && capture.isActive),
      ),
    [displayMetrics, captures],
  );

  const activeDerivationGroupName = useMemo(() => {
    const active = derivationGroups.find((group) => group.id === resolvedActiveDerivationGroupId);
    if (!active || typeof active.name !== "string") {
      return "active derivation group";
    }
    const trimmed = active.name.trim();
    return trimmed.length > 0 ? trimmed : "active derivation group";
  }, [derivationGroups, resolvedActiveDerivationGroupId]);

  const hasSecondaryAxis = useMemo(
    () => activeMetrics.some((metric) => metric.axis === "y2"),
    [activeMetrics],
  );

  useEffect(() => {
    if (hasSecondaryAxis) {
      return;
    }
    setManualYSecondaryDomain(null);
  }, [hasSecondaryAxis]);

  const isMetricOnSecondaryAxis = useCallback(
    (metric: SelectedMetric) =>
      metric.axis === "y2" || selectedMetricAxisByKey.has(getMetricKey(metric)),
    [selectedMetricAxisByKey],
  );

  const { data: chartData, coverage: metricCoverage } = useMemo(
    () => extractDataPoints(captures, activeMetrics),
    [captures, activeMetrics],
  );
  const deferredMetricCoverage = useDeferredValue(metricCoverage);

  const recentUiEvents = useMemo(() => {
    if (uiEvents.length === 0) {
      return [];
    }
    return [...uiEvents].reverse();
  }, [uiEvents]);

  const loadingEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; detail?: string }> = [];

    if (!initialSyncReady) {
      entries.push({ key: "initial_sync", label: "Waiting for initial sync" });
    }

    if (uploadMutation.isPending) {
      entries.push({ key: "upload_capture", label: "Uploading capture file" });
    }

    if (loadingProbe.pendingSeries > 0) {
      entries.push({
        key: "pending_series",
        label: "Fetching metric series",
        detail: `${loadingProbe.pendingSeries} request(s) in flight`,
      });
    }

    if (loadingProbe.pendingComponentUpdates > 0) {
      entries.push({
        key: "pending_components",
        label: "Applying component tree updates",
        detail: `${loadingProbe.pendingComponentUpdates} capture(s) pending`,
      });
    }

    if (loadingProbe.pendingAppends > 0) {
      entries.push({
        key: "pending_appends",
        label: "Applying streamed frames",
        detail: `${loadingProbe.pendingAppends} capture(s) buffered`,
      });
    }

    if (loadingProbe.pendingTicks > 0) {
      entries.push({
        key: "pending_ticks",
        label: "Applying tick updates",
        detail: `${loadingProbe.pendingTicks} capture(s) pending`,
      });
    }

    if (pendingDerivationRuns.length > 0) {
      const first = pendingDerivationRuns[0];
      entries.push({
        key: "pending_derivations",
        label: "Recalculating derivations",
        detail:
          pendingDerivationRuns.length === 1
            ? first?.label ?? "1 run in progress"
            : `${pendingDerivationRuns.length} run(s) in progress`,
      });
    }

    liveStreams.forEach((entry) => {
      const source = entry.source.trim();
      if (!source) {
        return;
      }
      if (entry.status === "idle" || entry.status === "completed") {
        return;
      }
      const tickCount = captures.find((capture) => capture.id === entry.id)?.tickCount ?? 0;
      const statusLabel =
        entry.status === "connecting"
          ? "Connecting"
          : entry.status === "retrying"
            ? "Retrying"
            : "Streaming";
      entries.push({
        key: `live_${entry.id}`,
        label: `${statusLabel}: ${entry.id}`,
        detail: tickCount > 0 ? `${tickCount} tick(s)` : undefined,
      });
    });

    const liveStreamingIds = new Set(
      liveStreams
        .filter((entry) => entry.status !== "idle" && entry.status !== "completed")
        .map((entry) => entry.id),
    );
    getStreamingCaptureIds().forEach((captureId) => {
      if (liveStreamingIds.has(captureId)) {
        return;
      }
      const capture = captures.find((entry) => entry.id === captureId);
      if (!capture || !capture.isActive) {
        return;
      }
      if (endedCapturesRef.current.has(captureId)) {
        return;
      }
      entries.push({
        key: `stream_${captureId}`,
        label: `Streaming: ${captureId}`,
        detail: capture.tickCount > 0 ? `${capture.tickCount} tick(s)` : undefined,
      });
    });

    return entries;
  }, [
    captures,
    initialSyncReady,
    liveStreams,
    loadingProbe,
    pendingDerivationRuns,
    streamActivityVersion,
    getStreamingCaptureIds,
    uploadMutation.isPending,
  ]);

  const isLoading = loadingEntries.length > 0;

  const currentData =
    chartData.find((dataPoint) => dataPoint.tick === playbackState.currentTick) || null;

  const visualizationCapture = useMemo(() => {
    const activeSourceCaptures = captures.filter(
      (capture) => capture.isActive && !isDerivedCaptureSource(capture.source ?? ""),
    );
    if (activeSourceCaptures.length === 0) {
      return null;
    }
    const pinnedCaptureId =
      typeof visualizationFrame.captureId === "string"
      && visualizationFrame.captureId.trim().length > 0
        ? visualizationFrame.captureId.trim()
        : "";
    if (pinnedCaptureId) {
      const pinned = activeSourceCaptures.find((capture) => capture.id === pinnedCaptureId);
      if (pinned) {
        return pinned;
      }
    }
    return activeSourceCaptures[0];
  }, [captures, visualizationFrame.captureId]);

  const rebuildCaptureStats = useCallback((capture: CaptureSession): CaptureStats => {
    const stats = createEmptyCaptureStats();
    capture.records.forEach((record) => {
      appendRecordStats(stats, record);
    });
    stats.componentNodes = countComponentNodes(capture.components);
    return stats;
  }, []);

  const ensureCaptureStats = useCallback(
    (capture: CaptureSession): CaptureStats => {
      const existing = captureStatsRef.current.get(capture.id);
      if (!existing || existing.records !== capture.records.length) {
        const rebuilt = rebuildCaptureStats(capture);
        captureStatsRef.current.set(capture.id, rebuilt);
        return rebuilt;
      }

      existing.tickCount = capture.tickCount;
      existing.componentNodes = countComponentNodes(capture.components);
      return existing;
    },
    [rebuildCaptureStats],
  );

  const buildMemoryStats = useCallback((): MemoryStatsResponse => {
    const captureStatsBase = captures.map((capture) => {
      const stats = ensureCaptureStats(capture);
      const componentTree = analyzeComponentTree(capture.components);
      return {
        captureId: capture.id,
        filename: capture.filename,
        records: stats.records,
        tickCount: capture.tickCount,
        componentNodes: stats.componentNodes,
        componentTree,
        objectProps: stats.objectProps,
        leafValues: stats.leafValues,
        numeric: stats.numeric,
        string: stats.string,
        boolean: stats.boolean,
        nulls: stats.nulls,
        arrays: stats.arrays,
        arrayValues: stats.arrayValues,
        objects: stats.objects,
        stringChars: stats.stringChars,
      };
    });

    const totalsBase = captureStatsBase.reduce(
      (acc, item) => {
        acc.captures += 1;
        acc.records += item.records;
        acc.tickCountMax = Math.max(acc.tickCountMax, item.tickCount);
        acc.componentNodes += item.componentNodes;
        acc.objectProps += item.objectProps;
        acc.leafValues += item.leafValues;
        acc.numeric += item.numeric;
        acc.string += item.string;
        acc.boolean += item.boolean;
        acc.nulls += item.nulls;
        acc.arrays += item.arrays;
        acc.arrayValues += item.arrayValues;
        acc.objects += item.objects;
        acc.stringChars += item.stringChars;
        return acc;
      },
      {
        captures: 0,
        records: 0,
        tickCountMax: 0,
        componentNodes: 0,
        objectProps: 0,
        leafValues: 0,
        numeric: 0,
        string: 0,
        boolean: 0,
        nulls: 0,
        arrays: 0,
        arrayValues: 0,
        objects: 0,
        stringChars: 0,
        estimatedRecordBytes: null,
        seriesPoints: 0,
        seriesBytes: null,
      },
    );

    const componentTreeTotals = captureStatsBase.reduce(
      (acc, item) => {
        const tree = item.componentTree;
        acc.nodes += tree.nodes;
        acc.leaves += tree.leaves;
        acc.numericLeaves += tree.numericLeaves;
        acc.stringLeaves += tree.stringLeaves;
        acc.booleanLeaves += tree.booleanLeaves;
        acc.nullLeaves += tree.nullLeaves;
        acc.arrayNodes += tree.arrayNodes;
        acc.objectNodes += tree.objectNodes;
        acc.maxDepth = Math.max(acc.maxDepth, tree.maxDepth);
        acc.pathSegments += tree.pathSegments;
        acc.pathChars += tree.pathChars;
        acc.idChars += tree.idChars;
        acc.labelChars += tree.labelChars;
        return acc;
      },
      {
        nodes: 0,
        leaves: 0,
        numericLeaves: 0,
        stringLeaves: 0,
        booleanLeaves: 0,
        nullLeaves: 0,
        arrayNodes: 0,
        objectNodes: 0,
        maxDepth: 0,
        pathSegments: 0,
        pathChars: 0,
        idChars: 0,
        labelChars: 0,
      },
    );

    const selectedByCapture = selectedMetrics.reduce((acc, metric) => {
      acc.set(metric.captureId, (acc.get(metric.captureId) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

    const selectedMetricsStats = {
      total: selectedMetrics.length,
      active: activeMetrics.length,
      byCapture: Array.from(selectedByCapture.entries()).map(([captureId, count]) => ({
        captureId,
        count,
      })),
    };

    const chartDataStats = analyzeChartData(chartData);

    const memory = readPerformanceMemory();
    const baselineHeap = baselineHeapRef.current;
    const usedHeap = memory ? memory.usedJSHeapSize : null;
    const totalHeap = memory ? memory.totalJSHeapSize : null;
    const heapLimit = memory ? memory.jsHeapSizeLimit : null;
    const rawHeapDelta =
      memory && baselineHeap !== null ? memory.usedJSHeapSize - baselineHeap : null;
    const heapDelta = rawHeapDelta !== null ? Math.max(0, rawHeapDelta) : null;
    const bytesPerObjectProp =
      heapDelta !== null && heapDelta > 0 && totalsBase.objectProps > 0
        ? heapDelta / totalsBase.objectProps
        : null;
    const bytesPerLeafValue =
      heapDelta !== null && heapDelta > 0 && totalsBase.leafValues > 0
        ? heapDelta / totalsBase.leafValues
        : null;
    const effectiveBytesPerObjectProp =
      bytesPerObjectProp !== null && bytesPerObjectProp > 0
        ? bytesPerObjectProp
        : DEFAULT_BYTES_PER_PROP;
    const effectiveBytesPerSeriesPoint = DEFAULT_BYTES_PER_POINT;
    const estimateSource: "performance" | "default" =
      bytesPerObjectProp !== null && bytesPerObjectProp > 0 ? "performance" : "default";

    const captureStats = captureStatsBase.map((item) => {
      const coverageForCapture = metricCoverage[item.captureId] ?? {};
      const seriesMetrics = Object.entries(coverageForCapture).map(([fullPath, entry]) => ({
        fullPath,
        numericCount: entry.numericCount,
        estBytes: entry.numericCount * effectiveBytesPerSeriesPoint,
      }));
      const seriesPoints = seriesMetrics.reduce((sum, entry) => sum + entry.numericCount, 0);
      const seriesBytes = seriesPoints * effectiveBytesPerSeriesPoint;
      return {
        ...item,
        estimatedRecordBytes: item.objectProps * effectiveBytesPerObjectProp,
        seriesPoints,
        seriesBytes,
        seriesMetrics,
      };
    });

    const totals = captureStats.reduce(
      (acc, item) => {
        acc.captures += 1;
        acc.records += item.records;
        acc.tickCountMax = Math.max(acc.tickCountMax, item.tickCount);
        acc.componentNodes += item.componentNodes;
        acc.objectProps += item.objectProps;
        acc.leafValues += item.leafValues;
        acc.numeric += item.numeric;
        acc.string += item.string;
        acc.boolean += item.boolean;
        acc.nulls += item.nulls;
        acc.arrays += item.arrays;
        acc.arrayValues += item.arrayValues;
        acc.objects += item.objects;
        acc.stringChars += item.stringChars;
        acc.estimatedRecordBytes =
          acc.estimatedRecordBytes === null
            ? item.estimatedRecordBytes
            : (item.estimatedRecordBytes ?? 0) + acc.estimatedRecordBytes;
        acc.seriesPoints += item.seriesPoints;
        acc.seriesBytes =
          acc.seriesBytes === null
            ? item.seriesBytes
            : (item.seriesBytes ?? 0) + acc.seriesBytes;
        return acc;
      },
      {
        captures: 0,
        records: 0,
        tickCountMax: 0,
        componentNodes: 0,
        objectProps: 0,
        leafValues: 0,
        numeric: 0,
        string: 0,
        boolean: 0,
        nulls: 0,
        arrays: 0,
        arrayValues: 0,
        objects: 0,
        stringChars: 0,
        estimatedRecordBytes: 0,
        seriesPoints: 0,
        seriesBytes: 0,
      },
    );

    const recordStoreBytes = totals.objectProps * effectiveBytesPerObjectProp;
    const chartDataBytes =
      chartDataStats.totalObjectProps * effectiveBytesPerObjectProp;

    const eventLoopStats = computeSampleStats(eventLoopLagSamplesRef.current);
    const frameStats = computeSampleStats(frameTimeSamplesRef.current);
    const avgFrameMs = frameStats.avgMs;
    const fps = avgFrameMs && avgFrameMs > 0 ? 1000 / avgFrameMs : null;
    const longTasks = longTaskStatsRef.current;

    return {
      performanceMemoryAvailable: Boolean(memory),
      baselineHeap: baselineHeap ?? null,
      usedHeap,
      totalHeap,
      heapLimit,
      heapDelta,
      bytesPerObjectProp,
      bytesPerLeafValue,
      chartData: chartDataStats,
      selectedMetrics: selectedMetricsStats,
      componentTreeTotals,
      estimates: {
        recordStoreBytes,
        chartDataBytes,
        effectiveBytesPerObjectProp,
        effectiveBytesPerSeriesPoint,
        estimateSource,
      },
      captures: captureStats,
      totals,
      uiLag: {
        eventLoop: eventLoopStats,
        frame: {
          ...frameStats,
          fps,
          avgFrameMs,
        },
        longTasks: {
          count: longTasks.count,
          totalMs: longTasks.totalMs,
          maxMs: longTasks.maxMs,
          lastStart: longTasks.lastStart,
          lastDurationMs: longTasks.lastDurationMs,
        },
        sampleWindow: {
          maxSamples: PERF_SAMPLE_MAX,
          intervalMs: EVENT_LOOP_INTERVAL_MS,
        },
      },
      componentUpdates: {
        ...computeSampleStats(componentUpdateSamplesRef.current),
        lastMs: componentUpdateLastMsRef.current,
        lastAt: componentUpdateLastAtRef.current,
        lastNodes: componentUpdateLastNodesRef.current,
        throttled: componentUpdateThrottledRef.current,
      },
    };
  }, [captures, ensureCaptureStats, selectedMetrics, activeMetrics, chartData, metricCoverage]);

  const handleRefreshMemoryStats = useCallback(() => {
    setMemoryStatsSnapshot(buildMemoryStats());
    setMemoryStatsAt(Date.now());
  }, [buildMemoryStats]);

  useEffect(() => {
    if (isDiagnosticsOpen) {
      handleRefreshMemoryStats();
    }
  }, [isDiagnosticsOpen, handleRefreshMemoryStats]);

  const hasLiveIntent = useMemo(() => {
    if (sourceMode === "live") {
      return true;
    }
    return liveStreams.some((entry) => entry.source.trim().length > 0);
  }, [liveStreams, sourceMode]);

  useEffect(() => {
    if (!playbackState.isPlaying) return;

    const effectiveSpeed =
      Number.isFinite(playbackState.speed) && playbackState.speed > 0
        ? playbackState.speed
        : 1;
    const interval = 1000 / effectiveSpeed;
    let lastTime = performance.now();

    const tick = (currentTime: number) => {
      const delta = currentTime - lastTime;

      if (delta >= interval) {
        const steps = Math.max(1, Math.floor(delta / interval));
        lastTime += steps * interval;
        setPlaybackState((prev) => {
          if (prev.totalTicks <= 0) {
            return prev;
          }
          if (prev.currentTick >= prev.totalTicks) {
            if (hasLiveIntent) {
              return prev;
            }
            return { ...prev, isPlaying: false };
          }
          const nextTick = Math.min(prev.totalTicks, prev.currentTick + steps);
          return { ...prev, currentTick: nextTick };
        });
      }

      playbackRef.current = requestAnimationFrame(tick);
    };

    playbackRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackRef.current) {
        cancelAnimationFrame(playbackRef.current);
      }
    };
  }, [hasLiveIntent, playbackState.isPlaying, playbackState.speed]);

  const { sendMessage } = useWebSocketControl({
    captures,
    selectedMetrics,
    analysisMetrics,
    derivationGroups,
    activeDerivationGroupId: resolvedActiveDerivationGroupId,
    displayDerivationGroupId: resolvedDisplayDerivationGroupId,
    playbackState,
    windowSize,
    windowStart,
    windowEnd,
    yPrimaryDomain: manualYPrimaryDomain,
    ySecondaryDomain: manualYSecondaryDomain,
    autoScroll: isAutoScroll,
    isWindowed,
    isFullscreen,
    viewport,
    annotations,
    subtitles,
    visualizationFrame,
    onRestoreState: handleRestoreState,
    onSourceModeChange: handleSourceModeChange,
    onLiveSourceChange: handleLiveSourceCommand,
    onToggleCapture: handleToggleCapture,
    onRemoveCapture: handleRemoveCapture,
    onSelectMetric: handleSelectMetric,
    onSetMetricAxis: handleSetMetricAxis,
    onDeselectMetric: handleDeselectMetric,
    onClearSelection: handleClearSelection,
    onSelectAnalysisMetric: handleSelectAnalysisMetric,
    onDeselectAnalysisMetric: handleDeselectAnalysisMetric,
    onClearAnalysisMetrics: handleClearAnalysisMetrics,
    onCreateDerivationGroup: handleCreateDerivationGroup,
    onDeleteDerivationGroup: handleDeleteDerivationGroup,
    onSetActiveDerivationGroup: handleSetActiveDerivationGroup,
    onUpdateDerivationGroup: handleUpdateDerivationGroup,
    onReorderDerivationGroupMetrics: handleReorderDerivationGroupMetrics,
    onSetDisplayDerivationGroup: handleSetDisplayDerivationGroup,
    onClearCaptures: handleClearCaptures,
    onPlay: handlePlay,
    onPause: handlePause,
    onStop: handleStop,
    onSeek: handleSeek,
    onSpeedChange: handleSpeedChange,
    onWindowSizeChange: handleWindowSizeChange,
    onWindowStartChange: handleWindowStartChange,
    onWindowEndChange: handleWindowEndChange,
    onWindowRangeChange: handleWindowRangeChange,
    onYPrimaryRangeChange: handleYPrimaryRangeChange,
    onYSecondaryRangeChange: handleYSecondaryRangeChange,
    onAutoScrollChange: handleAutoScrollChange,
    onSetFullscreen: handleSetFullscreen,
    onSetVisualizationFrame: handleSetVisualizationFrame,
    onLiveStart: startLiveStream,
    onLiveStop: stopLiveStream,
    onCaptureInit: handleCaptureInit,
    onCaptureComponents: handleCaptureComponents,
    onCaptureAppend: handleCaptureAppend,
    onCaptureTick: handleCaptureTick,
    onCaptureEnd: handleCaptureEnd,
    onAddAnnotation: handleAddAnnotation,
    onRemoveAnnotation: handleRemoveAnnotation,
    onClearAnnotations: handleClearAnnotations,
    onJumpAnnotation: handleJumpAnnotation,
    onAddSubtitle: handleAddSubtitle,
    onRemoveSubtitle: handleRemoveSubtitle,
    onClearSubtitles: handleClearSubtitles,
    getMemoryStats: buildMemoryStats,
    getUiDebug,
    onDerivationPlugins: (plugins) => {
      setDerivationPluginsError(null);
      setDerivationPlugins(normalizeDerivationPlugins(plugins));
    },
    onUiNotice: ({ message, context }) => {
      const detail =
        context && Object.keys(context).length > 0
          ? JSON.stringify(context)
          : undefined;
      pushUiEvent({ level: "info", message, detail });
    },
    onUiError: ({ error, context, requestId }) => {
      clearDerivationRunPendingByRequest(requestId);
      const detail =
        context && Object.keys(context).length > 0
          ? JSON.stringify(context)
          : undefined;
      pushUiEvent({ level: "error", message: error, detail });
    },
    onReconnect: handleWsReconnect,
    onStateSync: handleStateSync,
    onConnectionLock: (event) => {
      setConnectionLock(event);
      pushUiEvent({
        level: "error",
        message: "Dashboard locked",
        detail: `${event.message} (code ${event.closeCode})`,
      });
    },
    onConnectionUnlock: () => {
      setConnectionLock(null);
    },
  });

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const sidebarStyle = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  };

  const getMetricDisplayKey = (metric: SelectedMetric): string => {
    return `${metric.captureId}_${sanitizeKey(metric.fullPath)}`;
  };

  const getAnalysisKey = useCallback((metric: SelectedMetric): string => {
    return `${metric.captureId}::${metric.fullPath}`;
  }, []);

  const getCaptureShortName = (capture: CaptureSession): string => {
    const name = capture.filename.replace(".jsonl", "");
    const MAX_NAME_CHARS = 40;
    return name.length > MAX_NAME_CHARS ? `${name.substring(0, MAX_NAME_CHARS)}...` : name;
  };

  const handleSidebarModeSelect = useCallback((nextMode: SidebarMode) => {
    setSidebarMode(nextMode);
  }, []);
  const handleToggleSidebarMode = useCallback(() => {
    handleSidebarModeSelect(sidebarMode === "analysis" ? "setup" : "analysis");
  }, [handleSidebarModeSelect, sidebarMode]);

  const handleTakeoverDashboard = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("takeover", "1");
      window.location.assign(url.toString());
    } catch {
      window.location.reload();
    }
  }, []);

  const handleRetryConnection = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.location.reload();
  }, []);

  const handleOpenMiniPlayer = useCallback(() => {
    setIsMiniProjectionOpen(true);
  }, []);

  const handleRecallVisualization = useCallback(() => {
    setVisualizationDockRequestToken((prev) => prev + 1);
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const header = sidebarHeaderRef.current;
    if (!header) {
      return;
    }
    const update = () => {
      const height = header.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--metrics-ui-sidebar-header", `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const analysisKeys = useMemo(() => {
    return new Set(analysisMetrics.map(getAnalysisKey));
  }, [analysisMetrics, getAnalysisKey]);

  useEffect(() => {
    const selectedKeys = new Set(selectedMetrics.map(getAnalysisKey));
    setDerivationGroups((prev) =>
      prev.map((group) => ({
        ...group,
        metrics: getDerivationGroupInputMetrics(group).filter((metric) =>
          selectedKeys.has(getAnalysisKey(metric)),
        ),
        derivedMetrics: getDerivationGroupDerivedMetrics(group).filter((metric) =>
          selectedKeys.has(getAnalysisKey(metric)),
        ),
      })),
    );
  }, [getAnalysisKey, selectedMetrics]);

  useEffect(() => {
    const groups = derivationGroupsRef.current;
    if (groups.length === 0) {
      return;
    }

    setSelectedMetrics((prev) => {
      let changed = false;
      const next = prev.map((metric) => {
        const groupId = resolveDerivedGroupIdForCapture(
          metric.captureId,
          groups,
          derivationOutputGroupByCaptureRef.current,
        );
        if (!groupId) {
          return metric;
        }
        const group = groups.find((entry) => entry.id === groupId);
        if (!group) {
          return metric;
        }
        const expectedLabel = buildDerivedMetricLabel(group.name, metric);
        if (metric.label === expectedLabel) {
          return metric;
        }
        changed = true;
        return { ...metric, label: expectedLabel };
      });
      if (!changed) {
        return prev;
      }
      selectedMetricsRef.current = next;
      return next;
    });

    setDerivationGroups((prev) => {
      let changed = false;
      const next = prev.map((group) => {
        const derived = getDerivationGroupDerivedMetrics(group);
        const nextDerived = derived.map((metric) => {
          const expectedLabel = buildDerivedMetricLabel(group.name, metric);
          if (metric.label === expectedLabel) {
            return metric;
          }
          changed = true;
          return { ...metric, label: expectedLabel };
        });
        if (nextDerived === derived || nextDerived.every((metric, index) => metric === derived[index])) {
          return group;
        }
        return { ...group, derivedMetrics: nextDerived };
      });
      if (!changed) {
        return prev;
      }
      derivationGroupsRef.current = next;
      return next;
    });
  }, [derivationGroups, selectedMetrics]);

  const handleToggleAnalysisMetric = useCallback((metric: SelectedMetric) => {
    const key = getAnalysisKey(metric);
    const groupId = ensureActiveDerivationGroupId();
    setDerivationGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        const inputMetrics = getDerivationGroupInputMetrics(group);
        const exists = inputMetrics.some((entry) => getAnalysisKey(entry) === key);
        const nextMetrics = exists
          ? inputMetrics.filter((entry) => getAnalysisKey(entry) !== key)
          : [...inputMetrics, metric];
        return { ...group, metrics: nextMetrics };
      }),
    );
  }, [ensureActiveDerivationGroupId, getAnalysisKey]);

  const handleRemoveDerivationMetric = useCallback(
    (groupId: string, metric: SelectedMetric) => {
      const key = getAnalysisKey(metric);
      setDerivationGroups((prev) =>
        prev.map((group) => {
          if (group.id !== groupId) {
            return group;
          }
          const metricInputs = getDerivationGroupInputMetrics(group);
          const metricDerived = getDerivationGroupDerivedMetrics(group);
          return {
            ...group,
            metrics: metricInputs.filter((entry) => getAnalysisKey(entry) !== key),
            derivedMetrics: metricDerived.filter((entry) => getAnalysisKey(entry) !== key),
          };
        }),
      );
    },
    [getAnalysisKey],
  );

  const handleOpenDocs = useCallback(() => {
    setIsDocsOpen(true);
    if (docsLoading || docsContent.length > 0) {
      return;
    }
    setDocsLoading(true);
    setDocsError(null);
    fetch("/api/docs")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || typeof payload?.content !== "string") {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : `Failed to load docs (${response.status})`,
          );
        }
        setDocsContent(payload.content);
      })
      .catch((error) => {
        setDocsError(error instanceof Error ? error.message : "Failed to load docs.");
      })
      .finally(() => {
        setDocsLoading(false);
      });
  }, [docsContent.length, docsLoading]);

  const handleSelectionCaptureOpenChange = useCallback((captureId: string, open: boolean) => {
    setSelectionCaptureOpenById((prev) => {
      if ((prev[captureId] ?? true) === open) {
        return prev;
      }
      return { ...prev, [captureId]: open };
    });
  }, []);

  const handleChartSizeChange = useCallback((size: { width: number; height: number }) => {
    setViewport((prev) => {
      const base = prev ?? { width: 0, height: 0, devicePixelRatio: 1 };
      if (base.chartWidth === size.width && base.chartHeight === size.height) {
        return base;
      }
      return {
        ...base,
        chartWidth: size.width,
        chartHeight: size.height,
      };
    });
  }, []);

  const chartViewProps: ChartViewProps = {
    data: chartData,
    selectedMetrics: activeMetrics,
    currentTick: playbackState.currentTick,
    windowStart,
    windowEnd,
    resetViewVersion,
    isAutoScroll,
    annotations,
    subtitles,
    captures,
    highlightedMetricKey,
    yPrimaryDomain: manualYPrimaryDomain,
    ySecondaryDomain: hasSecondaryAxis ? manualYSecondaryDomain : null,
    onYPrimaryDomainChange: setManualYPrimaryDomain,
    onYSecondaryDomainChange: setManualYSecondaryDomain,
    onDomainChange: handleChartDomainChange,
    onWindowRangeChange: handleWindowRangeChange,
    onSizeChange: handleChartSizeChange,
    onAddAnnotation: handleAddAnnotation,
    onRemoveAnnotation: handleRemoveAnnotation,
  };

  const miniProjectionContent = <MiniProjectionContent chart={chartViewProps} />;

  if (miniMode) {
    return (
      <MiniModeView
        chart={chartViewProps}
        playbackState={playbackState}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onSeek={handleSeek}
        onSpeedChange={handleSpeedChange}
        onStepForward={handleStepForward}
        onStepBackward={handleStepBackward}
        onResetWindow={handleResetWindow}
        seekDisabled={isWindowed}
        disabled={captures.length === 0}
        isLoading={isLoading}
        loadingCount={loadingEntries.length}
        connectionLock={connectionLock}
        onTakeoverDashboard={handleTakeoverDashboard}
        onRetryConnection={handleRetryConnection}
      />
    );
  }

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <DerivationPluginSourceDialog
        open={isDerivationPluginSourceOpen}
        onOpenChange={(open) => {
          setIsDerivationPluginSourceOpen(open);
          if (!open) {
            if (derivationPluginCopyResetTimerRef.current !== null) {
              window.clearTimeout(derivationPluginCopyResetTimerRef.current);
              derivationPluginCopyResetTimerRef.current = null;
            }
            setIsDerivationPluginSourceCopied(false);
            setDerivationPluginSource(null);
            setDerivationPluginSourceError(null);
            setDerivationPluginSourceLoading(false);
          }
        }}
        loading={derivationPluginSourceLoading}
        error={derivationPluginSourceError}
        source={derivationPluginSource}
        copied={isDerivationPluginSourceCopied}
        onCopy={handleCopyDerivationPluginSource}
        formatBytes={formatBytes}
      />
      <DocsDialog
        open={isDocsOpen}
        onOpenChange={setIsDocsOpen}
        loading={docsLoading}
        error={docsError}
        content={docsContent}
      />
      <PopoutProjection
        open={isMiniProjectionOpen}
        onOpenChange={setIsMiniProjectionOpen}
        windowName="metrics-ui-mini-player-projection"
        title="Metrics UI - Mini Player"
      >
        {miniProjectionContent}
      </PopoutProjection>
      <ConnectionLockOverlay
        lock={connectionLock}
        onTakeover={handleTakeoverDashboard}
        onRetry={handleRetryConnection}
      />
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar>
          <SidebarHeader ref={sidebarHeaderRef} className="p-4">
            <SidebarSubappHeader
              sidebarMode={sidebarMode}
              onToggleMode={handleToggleSidebarMode}
            />
          </SidebarHeader>
          <SidebarContent
            ref={sidebarContentRef}
            className="min-h-0 flex flex-col"
          >
            <div ref={sidebarBodyRef} className="flex flex-col flex-1 min-h-0">
                <>
                  <SidebarSetupPane
                    sidebarMode={sidebarMode}
                    isCaptureSourceOpen={isCaptureSourceOpen}
                    onCaptureSourceOpenChange={setIsCaptureSourceOpen}
                    sourceMode={sourceMode}
                    onSourceModeChange={handleSourceModeChange}
                    onFileUpload={handleFileUpload}
                    isUploading={uploadMutation.isPending}
                    uploadError={uploadError}
                    onClearUploadError={handleClearUploadError}
                    liveStreams={liveStreams}
                    livePollInputDrafts={livePollInputDrafts}
                    onLivePollInputDraftChange={handleLivePollInputDraftChange}
                    onLivePollInputDraftBlur={handleLivePollInputDraftBlur}
                    onLivePollChange={handleLivePollChange}
                    onRemoveLiveStream={(captureId) => removeCaptureIds([captureId])}
                    onLiveSourceInput={handleLiveSourceInput}
                    onLiveRefresh={handleLiveRefresh}
                    onAddLiveStream={handleAddLiveStream}
                    inlineEditTextClass={INLINE_EDIT_TEXT_CLASS}
                    inlineEditNumericClass={INLINE_EDIT_NUMERIC_CLASS}
                    inlineEditEmptyClass={INLINE_EDIT_EMPTY_CLASS}
                    isInlineFieldBlank={isInlineFieldBlank}
                    captures={captures}
                    onToggleCapture={handleToggleCapture}
                    onRemoveCapture={handleRemoveCapture}
                    getCaptureShortName={getCaptureShortName}
                    isSelectionOpen={isSelectionOpen}
                    onSelectionOpenChange={setIsSelectionOpen}
                    activeCaptures={activeCaptures}
                    selectionCaptureOpenById={selectionCaptureOpenById}
                    onSelectionCaptureOpenChange={handleSelectionCaptureOpenChange}
                    selectedMetricsByCapture={selectedMetricsByCapture}
                    deferredMetricCoverage={deferredMetricCoverage}
                    getSelectionHandler={getSelectionHandler}
                    selectedMetricCount={selectedMetrics.length}
                    playbackState={playbackState}
                    windowStartInput={windowStartInput}
                    onWindowStartInputChange={setWindowStartInput}
                    windowStartEditingRef={windowStartEditingRef}
                    onCommitWindowStartInput={commitWindowStartInput}
                    windowEndInput={windowEndInput}
                    onWindowEndInputChange={setWindowEndInput}
                    windowEndEditingRef={windowEndEditingRef}
                    onCommitWindowEndInput={commitWindowEndInput}
                    yPrimaryMinInput={yPrimaryMinInput}
                    onYPrimaryMinInputChange={setYPrimaryMinInput}
                    yPrimaryMinEditingRef={yPrimaryMinEditingRef}
                    onCommitYPrimaryBoundary={commitYPrimaryBoundary}
                    yPrimaryMaxInput={yPrimaryMaxInput}
                    onYPrimaryMaxInputChange={setYPrimaryMaxInput}
                    yPrimaryMaxEditingRef={yPrimaryMaxEditingRef}
                    hasSecondaryAxis={hasSecondaryAxis}
                    ySecondaryMinInput={ySecondaryMinInput}
                    onYSecondaryMinInputChange={setYSecondaryMinInput}
                    ySecondaryMinEditingRef={ySecondaryMinEditingRef}
                    onCommitYSecondaryBoundary={commitYSecondaryBoundary}
                    ySecondaryMaxInput={ySecondaryMaxInput}
                    onYSecondaryMaxInputChange={setYSecondaryMaxInput}
                    ySecondaryMaxEditingRef={ySecondaryMaxEditingRef}
                    isAutoScroll={isAutoScroll}
                    isDiagnosticsOpen={isDiagnosticsOpen}
                    onDiagnosticsOpenChange={setIsDiagnosticsOpen}
                    memoryStatsAt={memoryStatsAt}
                    onRefreshMemoryStats={handleRefreshMemoryStats}
                    memoryStatsSnapshot={memoryStatsSnapshot}
                    formatBytes={formatBytes}
                  />
                  <SidebarDerivationsPane
                    sidebarMode={sidebarMode}
                    derivationPluginFileRef={derivationPluginFileRef}
                    onUploadDerivationPlugin={handleUploadDerivationPlugin}
                    derivationPlugins={derivationPlugins}
                    derivationPluginsError={derivationPluginsError}
                    onViewDerivationPluginSource={handleViewDerivationPluginSource}
                    onDeleteDerivationPlugin={handleDeleteDerivationPlugin}
                    derivationGroups={derivationGroups}
                    onCreateDerivationGroupFromActive={handleCreateDerivationGroupFromActive}
                    resolvedActiveDerivationGroupId={resolvedActiveDerivationGroupId}
                    resolvedDisplayDerivationGroupId={resolvedDisplayDerivationGroupId}
                    onSetActiveDerivationGroup={handleSetActiveDerivationGroup}
                    derivationGroupNameDrafts={derivationGroupNameDrafts}
                    setDerivationGroupNameDrafts={setDerivationGroupNameDrafts}
                    focusedDerivationGroupNameId={focusedDerivationGroupNameId}
                    setFocusedDerivationGroupNameId={setFocusedDerivationGroupNameId}
                    onUpdateDerivationGroup={handleUpdateDerivationGroup}
                    onRunDerivationPlugin={handleRunDerivationPlugin}
                    onSetDisplayDerivationGroup={handleSetDisplayDerivationGroup}
                    onDeleteDerivationGroup={handleDeleteDerivationGroup}
                    captures={captures}
                    getCaptureShortName={getCaptureShortName}
                    derivationDragState={derivationDragState}
                    derivationDropState={derivationDropState}
                    getAnalysisKey={getAnalysisKey}
                    onDerivationMetricDragStart={handleDerivationMetricDragStart}
                    onDerivationMetricDragOver={handleDerivationMetricDragOver}
                    onDerivationMetricDrop={handleDerivationMetricDrop}
                    onDerivationMetricDragEnd={handleDerivationMetricDragEnd}
                    onRemoveDerivationMetric={handleRemoveDerivationMetric}
                  />
                </>
            </div>
          </SidebarContent>
          <SidebarFooter className="p-0 gap-0 shrink-0 w-full min-w-0 overflow-x-hidden">
            <HintingPanel />
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <HomeHeaderControls
            selectedMetricCount={selectedMetrics.length}
            annotationCount={annotations.length}
            onClearSelection={handleClearSelection}
            onClearAnnotations={handleClearAnnotations}
            onRecallVisualization={handleRecallVisualization}
            isVisualizationPoppedOut={isVisualizationPoppedOut}
            isLoading={isLoading}
            loadingEntries={loadingEntries}
            recentUiEvents={recentUiEvents}
            isEventsVisible={isEventsVisible}
            onToggleEvents={() => setIsEventsVisible((prev) => !prev)}
            isFullscreen={isFullscreen}
            onSetFullscreen={handleSetFullscreen}
            onOpenDocs={handleOpenDocs}
          />
            <MetricsMainPanel
              chart={chartViewProps}
              currentData={currentData}
              activeMetrics={activeMetrics}
              playbackState={playbackState}
              captures={captures}
              isHudVisible={isHudVisible}
              activeDerivationGroupName={activeDerivationGroupName}
              analysisKeys={analysisKeys}
              onToggleAnalysisMetric={handleToggleAnalysisMetric}
              onToggleMetricAxis={handleToggleMetricAxis}
              isMetricOnSecondaryAxis={isMetricOnSecondaryAxis}
              onDeselectMetric={handleDeselectMetric}
              onHoverMetric={setHighlightedMetricKey}
              highlightedMetricKey={highlightedMetricKey}
              visualizationFrame={visualizationFrame}
              visualizationCapture={visualizationCapture}
              onVisualizationDebugChange={handleVisualizationDebugChange}
              onVisualizationPopoutChange={setIsVisualizationPoppedOut}
              visualizationDockRequestToken={visualizationDockRequestToken}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onSeek={handleSeek}
              onSpeedChange={handleSpeedChange}
              onStepForward={handleStepForward}
              onStepBackward={handleStepBackward}
              onResetWindow={handleResetWindow}
              onOpenMiniPlayer={handleOpenMiniPlayer}
              seekDisabled={isWindowed}
            />
        </div>
      </div>
    </SidebarProvider>
  );
}
