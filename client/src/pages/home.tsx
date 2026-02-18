import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect, useDeferredValue } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileUpload } from "@/components/file-upload";
import { ComponentTree } from "@/components/component-tree";
import { PlaybackControls } from "@/components/playback-controls";
import { MetricsChart } from "@/components/metrics-chart";
import { MetricsHUD } from "@/components/metrics-hud";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import {
  Activity,
  X,
  FileText,
  Plus,
  BookOpen,
  ChevronDown,
  GripVertical,
  Eye,
  EyeOff,
  RefreshCw,
  Maximize,
  Maximize2,
  Minimize2,
  Play,
  Code,
  ExternalLink,
} from "lucide-react";
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
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { useWebSocketControl } from "@/hooks/use-websocket-control";
import { useStreamingActivityTracker } from "@/hooks/dashboard/use-streaming-activity";
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
  type MetricCoverageByCapture,
} from "@/lib/dashboard/chart-data";
import {
  DEFAULT_BYTES_PER_POINT,
  DEFAULT_BYTES_PER_PROP,
  formatBytes,
  formatDomainNumber,
  MIN_Y_DOMAIN_SPAN,
  sanitizeDomain,
} from "@/lib/dashboard/number-format";
import { isDerivedCaptureSource } from "@/lib/dashboard/source-utils";
import {
  DASHBOARD_STORAGE_KEYS,
  readStorageJson,
  readStorageString,
  writeStorageJson,
  writeStorageString,
} from "@/lib/dashboard/storage";

const INITIAL_WINDOW_SIZE = 50;
const DEFAULT_POLL_SECONDS = 2;
const EMPTY_METRICS: SelectedMetric[] = [];
const APPEND_FLUSH_MS = 100;
const LIVE_SERIES_REFRESH_MS = 500;
const FULLSCREEN_RESIZE_DELAY = 0;
const PERF_SAMPLE_MAX = 200;
const EVENT_LOOP_INTERVAL_MS = 100;
const COMPONENT_UPDATE_THROTTLE_MS = 250;
const STREAM_IDLE_MS = 1500;

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

type LiveStreamStatus = "idle" | "connecting" | "retrying" | "connected" | "completed";

interface LiveStreamEntry {
  id: string;
  source: string;
  pollSeconds: number;
  status: LiveStreamStatus;
  error: string | null;
}

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

type DerivationPluginOutput = { key: string; label?: string };
type DerivationPluginRecord = {
  id: string;
  name: string;
  description?: string;
  minInputs: number;
  maxInputs: number | null;
  outputs: DerivationPluginOutput[];
  uploadedAt: string;
  valid: boolean;
  error: string | null;
};

type DerivationPluginSourceResponse = {
  pluginId: string;
  name: string;
  filename: string;
  bytes: number;
  truncated: boolean;
  source: string;
};

type DerivationDragState = {
  groupId: string;
  fromIndex: number;
} | null;

type DerivationDropState = {
  groupId: string;
  targetIndex: number;
  position: "before" | "after";
} | null;

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

export default function Home() {
  const [captures, setCaptures] = useState<CaptureSession[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<SelectedMetric[]>(() => {
    const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.selectedMetrics);
    return normalizeMetricList(parsed);
  });
  const [derivationGroups, setDerivationGroups] = useState<DerivationGroup[]>(() => {
    const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.derivationGroups);
    return normalizeDerivationGroups(parsed);
  });
  const [derivationPlugins, setDerivationPlugins] = useState<DerivationPluginRecord[]>([]);
  const [derivationPluginsError, setDerivationPluginsError] = useState<string | null>(null);
  const [isDerivationPluginSourceOpen, setIsDerivationPluginSourceOpen] = useState(false);
  const [derivationPluginSource, setDerivationPluginSource] =
    useState<DerivationPluginSourceResponse | null>(null);
  const [derivationPluginSourceLoading, setDerivationPluginSourceLoading] = useState(false);
  const [derivationPluginSourceError, setDerivationPluginSourceError] = useState<string | null>(null);
  const derivationPluginFileRef = useRef<HTMLInputElement | null>(null);
  const [activeDerivationGroupId, setActiveDerivationGroupId] = useState<string>(() => {
    return readStorageString(DASHBOARD_STORAGE_KEYS.activeDerivationGroupId) ?? "";
  });
  const [displayDerivationGroupId, setDisplayDerivationGroupId] = useState<string>(() => {
    return readStorageString(DASHBOARD_STORAGE_KEYS.displayDerivationGroupId) ?? "";
  });
  const [focusedDerivationGroupNameId, setFocusedDerivationGroupNameId] = useState<string>("");
  const [derivationGroupNameDrafts, setDerivationGroupNameDrafts] = useState<
    Record<string, string>
  >({});
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [memoryStatsSnapshot, setMemoryStatsSnapshot] = useState<MemoryStatsResponse | null>(null);
  const [memoryStatsAt, setMemoryStatsAt] = useState<number | null>(null);
  const [isSelectionOpen, setIsSelectionOpen] = useState(true);
  const [selectionCaptureOpenById, setSelectionCaptureOpenById] = useState<Record<string, boolean>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"file" | "live">(() => {
    return readStorageString(DASHBOARD_STORAGE_KEYS.sourceMode) === "live"
      ? "live"
      : "file";
  });
  const [liveStreams, setLiveStreams] = useState<LiveStreamEntry[]>(() => {
    const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.liveStreams);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const hydrated = parsed
        .map((entry) => ({
          id: typeof (entry as { id?: unknown })?.id === "string"
            ? ((entry as { id: string }).id)
            : generateId(),
          source: typeof (entry as { source?: unknown })?.source === "string"
            ? ((entry as { source: string }).source)
            : "",
          pollSeconds:
            Number.isFinite(Number((entry as { pollSeconds?: unknown })?.pollSeconds))
            && Number((entry as { pollSeconds?: unknown }).pollSeconds) > 0
              ? Number((entry as { pollSeconds: unknown }).pollSeconds)
              : DEFAULT_POLL_SECONDS,
          status: "idle" as LiveStreamStatus,
          error: null,
        }))
        .filter((entry) => entry.source.trim().length > 0);

      if (hydrated.length > 0) {
        return hydrated;
      }
    }

    return [];
  });

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: true,
    currentTick: 1,
    speed: 1,
    totalTicks: 0,
  });

  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW_SIZE);
  const [windowStart, setWindowStart] = useState(1);
  const [windowEnd, setWindowEnd] = useState(INITIAL_WINDOW_SIZE);
  const [isWindowed, setIsWindowed] = useState(false);
  const [resetViewVersion, setResetViewVersion] = useState(0);
  const [windowStartInput, setWindowStartInput] = useState(String(windowStart));
  const [windowEndInput, setWindowEndInput] = useState(String(windowEnd));
  const [manualYPrimaryDomain, setManualYPrimaryDomain] = useState<[number, number] | null>(null);
  const [manualYSecondaryDomain, setManualYSecondaryDomain] = useState<[number, number] | null>(null);
  const [resolvedYPrimaryDomain, setResolvedYPrimaryDomain] = useState<[number, number]>([0, 100]);
  const [resolvedYSecondaryDomain, setResolvedYSecondaryDomain] = useState<[number, number]>([0, 100]);
  const [yPrimaryMinInput, setYPrimaryMinInput] = useState("0");
  const [yPrimaryMaxInput, setYPrimaryMaxInput] = useState("100");
  const [ySecondaryMinInput, setYSecondaryMinInput] = useState("0");
  const [ySecondaryMaxInput, setYSecondaryMaxInput] = useState("100");
  const [viewport, setViewport] = useState<VisualizationState["viewport"]>({
    width: 0,
    height: 0,
    chartWidth: 0,
    chartHeight: 0,
    devicePixelRatio: 1,
  });
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isHudVisible, setIsHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleOverlay[]>([]);
  const [sidebarMode, setSidebarMode] = useState<"setup" | "analysis">("setup");
  const [isCaptureSourceOpen, setIsCaptureSourceOpen] = useState(true);
  const [highlightedMetricKey, setHighlightedMetricKey] = useState<string | null>(null);
  const [initialSyncReady, setInitialSyncReady] = useState(false);
  const [derivationDragState, setDerivationDragState] = useState<DerivationDragState>(null);
  const [derivationDropState, setDerivationDropState] = useState<DerivationDropState>(null);
  const [loadingProbe, setLoadingProbe] = useState(() => ({
    pendingSeries: 0,
    pendingAppends: 0,
    pendingComponentUpdates: 0,
    pendingTicks: 0,
    updatedAt: 0,
  }));
  const [pendingDerivationRuns, setPendingDerivationRuns] = useState<
    Array<{ requestId: string; outputCaptureId: string; label: string }>
  >([]);
  const [uiEvents, setUiEvents] = useState<UiEvent[]>([]);
  const [isEventsVisible, setIsEventsVisible] = useState(false);
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
  const windowStartEditingRef = useRef(false);
  const windowEndEditingRef = useRef(false);
  const yPrimaryMinEditingRef = useRef(false);
  const yPrimaryMaxEditingRef = useRef(false);
  const ySecondaryMinEditingRef = useRef(false);
  const ySecondaryMaxEditingRef = useRef(false);
  const sidebarHeaderRef = useRef<HTMLDivElement | null>(null);
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
  const liveErrorEventsRef = useRef(new Map<string, string>());
  const sendMessageRef = useRef<(message: ControlResponse | ControlCommand) => boolean>(() => false);
  const selectionHandlersRef = useRef(new Map<string, (metrics: SelectedMetric[]) => void>());
  const activeCaptureIdsRef = useRef(new Set<string>());
  const streamModeRef = useRef(new Map<string, "lite" | "full">());
  const derivationRerunTimersRef = useRef(new Map<string, number>());
  const derivationOutputGroupByCaptureRef = useRef(new Map<string, string>());
  const pendingDerivationByRequestRef = useRef(
    new Map<string, { outputCaptureId: string; label: string }>(),
  );
  const pendingDerivationRequestsByCaptureRef = useRef(new Map<string, Set<string>>());
  const staleSeriesRecoverAtRef = useRef(new Map<string, number>());
  const staleSeriesRecoverErrorAtRef = useRef(new Map<string, number>());
  const sourceRepairAttemptAtRef = useRef(new Map<string, number>());

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

  const syncPendingDerivationRuns = useCallback(() => {
    const next = Array.from(pendingDerivationByRequestRef.current.entries()).map(
      ([requestId, entry]) => ({
        requestId,
        outputCaptureId: entry.outputCaptureId,
        label: entry.label,
      }),
    );
    setPendingDerivationRuns(next);
  }, []);

  const markDerivationRunPending = useCallback(
    (requestId: string, outputCaptureId: string, label: string) => {
      if (!requestId.trim() || !outputCaptureId.trim()) {
        return;
      }
      pendingDerivationByRequestRef.current.set(requestId, {
        outputCaptureId,
        label: label.trim(),
      });
      const existing = pendingDerivationRequestsByCaptureRef.current.get(outputCaptureId);
      if (existing) {
        existing.add(requestId);
      } else {
        pendingDerivationRequestsByCaptureRef.current.set(outputCaptureId, new Set([requestId]));
      }
      syncPendingDerivationRuns();
    },
    [syncPendingDerivationRuns],
  );

  const clearDerivationRunPendingByRequest = useCallback(
    (requestId?: string) => {
      if (!requestId || !requestId.trim()) {
        return;
      }
      const existing = pendingDerivationByRequestRef.current.get(requestId);
      if (!existing) {
        return;
      }
      pendingDerivationByRequestRef.current.delete(requestId);
      const captureSet = pendingDerivationRequestsByCaptureRef.current.get(
        existing.outputCaptureId,
      );
      if (captureSet) {
        captureSet.delete(requestId);
        if (captureSet.size === 0) {
          pendingDerivationRequestsByCaptureRef.current.delete(existing.outputCaptureId);
        }
      }
      syncPendingDerivationRuns();
    },
    [syncPendingDerivationRuns],
  );

  const clearDerivationRunPendingByCapture = useCallback(
    (captureId: string) => {
      if (!captureId.trim()) {
        return;
      }
      const captureSet = pendingDerivationRequestsByCaptureRef.current.get(captureId);
      if (!captureSet || captureSet.size === 0) {
        return;
      }
      captureSet.forEach((requestId) => {
        pendingDerivationByRequestRef.current.delete(requestId);
      });
      pendingDerivationRequestsByCaptureRef.current.delete(captureId);
      syncPendingDerivationRuns();
    },
    [syncPendingDerivationRuns],
  );

  const clearAllPendingDerivationRuns = useCallback(() => {
    pendingDerivationByRequestRef.current.clear();
    pendingDerivationRequestsByCaptureRef.current.clear();
    syncPendingDerivationRuns();
  }, [syncPendingDerivationRuns]);

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

    return {
      generatedAt: new Date().toISOString(),
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
        baselineHeap: baselineHeapRef.current,
        selectionHandlers: selectionHandlersRef.current.size,
        prevSelectedCount: prevSelectedRef.current.length,
        endedCaptures: Array.from(endedCapturesRef.current),
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
          if (!isLiveActive) {
            const backfillMetrics = [...metricsNeedingBackfill];
            window.setTimeout(() => {
              void fetchMetricSeriesBatch(captureId, backfillMetrics, {
                force: true,
                preferCache: false,
              });
            }, 0);
          }
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
    if (!windowStartEditingRef.current) {
      setWindowStartInput(String(windowStart));
    }
  }, [windowStart]);

  useEffect(() => {
    if (!windowEndEditingRef.current) {
      setWindowEndInput(String(windowEnd));
    }
  }, [windowEnd]);

  useEffect(() => {
    if (!yPrimaryMinEditingRef.current) {
      setYPrimaryMinInput(formatDomainNumber(resolvedYPrimaryDomain[0]));
    }
    if (!yPrimaryMaxEditingRef.current) {
      setYPrimaryMaxInput(formatDomainNumber(resolvedYPrimaryDomain[1]));
    }
  }, [resolvedYPrimaryDomain]);

  useEffect(() => {
    if (!ySecondaryMinEditingRef.current) {
      setYSecondaryMinInput(formatDomainNumber(resolvedYSecondaryDomain[0]));
    }
    if (!ySecondaryMaxEditingRef.current) {
      setYSecondaryMaxInput(formatDomainNumber(resolvedYSecondaryDomain[1]));
    }
  }, [resolvedYSecondaryDomain]);

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
            const pollSeconds = Number(stream?.pollIntervalMs)
              ? Math.max(0.5, Number(stream.pollIntervalMs) / 1000)
              : DEFAULT_POLL_SECONDS;
            const updated: LiveStreamEntry = {
              id: captureId,
              source: typeof stream?.source === "string" ? stream.source : "",
              pollSeconds,
              status: "connected",
              error: typeof stream?.lastError === "string" ? stream.lastError : null,
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
              status: "connected",
              error: updated.error,
            };
          });

          return next;
        });
      } catch (error) {
        console.warn("Failed to fetch live status:", error);
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
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

  useEffect(() => {
    return () => {
      derivationRerunTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      derivationRerunTimersRef.current.clear();
    };
  }, []);

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
    (captureId: string) => {
      endedCapturesRef.current.add(captureId);
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

  const scheduleDerivationRecompute = useCallback((groupId: string, pluginId: string) => {
    const normalizedGroupId = groupId.trim();
    const normalizedPluginId = pluginId.trim();
    if (!normalizedGroupId || !normalizedPluginId) {
      return;
    }

    const timerKey = `${normalizedGroupId}::${normalizedPluginId}`;
    const existingTimer = derivationRerunTimersRef.current.get(timerKey);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      derivationRerunTimersRef.current.delete(timerKey);
      const currentGroup = derivationGroupsRef.current.find(
        (group) => group.id === normalizedGroupId,
      );
      if (!currentGroup) {
        pushUiEvent({
          level: "info",
          message: "Derivation recompute canceled",
          detail: `group deleted: ${normalizedGroupId}`,
        });
        return;
      }
      const currentPluginId =
        typeof currentGroup.pluginId === "string" ? currentGroup.pluginId.trim() : "";
      if (currentPluginId !== normalizedPluginId) {
        pushUiEvent({
          level: "info",
          message: "Derivation recompute canceled",
          detail: `plugin changed: ${normalizedGroupId}`,
        });
        return;
      }
      const outputCaptureId = `derive-${normalizedGroupId}-${normalizedPluginId}`;
      const inputMetrics = getDerivationGroupInputMetrics(currentGroup).map(cloneMetric);
      const requestId = `derive-recompute-${generateId()}`;
      pushUiEvent({
        level: "info",
        message: "Derivation recompute started",
        detail: `${normalizedGroupId} -> ${normalizedPluginId}`,
      });
      markDerivationRunPending(
        requestId,
        outputCaptureId,
        `${normalizedGroupId} -> ${normalizedPluginId}`,
      );
      const sent = sendMessageRef.current({
        type: "run_derivation_plugin",
        groupId: normalizedGroupId,
        pluginId: normalizedPluginId,
        outputCaptureId,
        metrics: inputMetrics,
        request_id: requestId,
      });
      if (!sent) {
        clearDerivationRunPendingByRequest(requestId);
      }
    }, 180);

    derivationRerunTimersRef.current.set(timerKey, timer);
    pushUiEvent({
      level: "info",
      message: "Derivation recompute queued",
      detail: `${normalizedGroupId} -> ${normalizedPluginId}`,
    });
  }, [clearDerivationRunPendingByRequest, markDerivationRunPending, pushUiEvent]);

  const handleReorderDerivationGroupMetrics = useCallback(
    (groupId: string, fromIndex: number, toIndex: number) => {
      if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) {
        return;
      }
      const from = Math.floor(fromIndex);
      const to = Math.floor(toIndex);

      const existingGroup = derivationGroupsRef.current.find((group) => group.id === groupId);
      if (!existingGroup) {
        return;
      }
      const size = getDerivationGroupInputMetrics(existingGroup).length;
      if (size <= 1) {
        return;
      }
      if (from < 0 || from >= size || to < 0 || to >= size || from === to) {
        return;
      }

      setDerivationGroups((prev) => {
        const next = prev.map((group) => {
          if (group.id !== groupId) {
            return group;
          }
          const nextMetrics = [...getDerivationGroupInputMetrics(group)];
          const [moved] = nextMetrics.splice(from, 1);
          if (!moved) {
            return group;
          }
          nextMetrics.splice(to, 0, moved);
          return { ...group, metrics: nextMetrics };
        });
        derivationGroupsRef.current = next;
        return next;
      });

      const pluginId = typeof existingGroup.pluginId === "string" ? existingGroup.pluginId.trim() : "";
      if (pluginId) {
        scheduleDerivationRecompute(groupId, pluginId);
      }
    },
    [scheduleDerivationRecompute],
  );

  const handleDerivationMetricDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, groupId: string, fromIndex: number) => {
      setDerivationDragState({ groupId, fromIndex });
      setDerivationDropState(null);
      try {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ type: "derivation-metric", groupId, fromIndex }),
        );
      } catch {
        // ignore dataTransfer errors
      }
    },
    [],
  );

  const handleDerivationMetricDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, groupId: string, targetIndex: number) => {
      if (!derivationDragState || derivationDragState.groupId !== groupId) {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const middleY = rect.top + rect.height / 2;
      const position: "before" | "after" = event.clientY < middleY ? "before" : "after";
      setDerivationDropState({ groupId, targetIndex, position });
      event.dataTransfer.dropEffect = "move";
    },
    [derivationDragState],
  );

  const handleDerivationMetricDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, groupId: string, targetIndex: number) => {
      if (!derivationDragState || derivationDragState.groupId !== groupId) {
        return;
      }
      event.preventDefault();

      const fromIndex = derivationDragState.fromIndex;
      const position =
        derivationDropState &&
        derivationDropState.groupId === groupId &&
        derivationDropState.targetIndex === targetIndex
          ? derivationDropState.position
          : "before";

      const rawInsertIndex = position === "before" ? targetIndex : targetIndex + 1;
      const normalizedInsertIndex =
        fromIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;

      setDerivationDragState(null);
      setDerivationDropState(null);
      handleReorderDerivationGroupMetrics(groupId, fromIndex, normalizedInsertIndex);
    },
    [derivationDragState, derivationDropState, handleReorderDerivationGroupMetrics],
  );

  const handleDerivationMetricDragEnd = useCallback(() => {
    setDerivationDragState(null);
    setDerivationDropState(null);
  }, []);

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

  const handleRunDerivation = useCallback(
    (options: { groupId: string; kind: "moving_average" | "diff"; window?: number }) => {
      const derivedCaptureId =
        options.kind === "moving_average"
          ? `derive-${options.groupId}-moving_average-${options.window ?? 5}`
          : `derive-${options.groupId}-diff`;
      const requestId = `derive-run-${generateId()}`;
      derivationOutputGroupByCaptureRef.current.set(derivedCaptureId, options.groupId);
      markDerivationRunPending(
        requestId,
        derivedCaptureId,
        `${options.groupId} -> ${options.kind}`,
      );
      const sent = sendMessageRef.current({
        type: "run_derivation",
        groupId: options.groupId,
        kind: options.kind,
        window: options.window,
        request_id: requestId,
      });
      if (!sent) {
        clearDerivationRunPendingByRequest(requestId);
      }
      pushUiEvent({
        level: "info",
        message: "Derivation run requested",
        detail: `${options.kind} on ${options.groupId}`,
      });
    },
    [clearDerivationRunPendingByRequest, markDerivationRunPending, pushUiEvent],
  );

  const handleRunDerivationPlugin = useCallback(
    (options: { groupId: string; pluginId: string; outputCaptureId?: string }) => {
      const outputCaptureId =
        options.outputCaptureId || `derive-${options.groupId}-${options.pluginId}`;
      const requestId = `derive-plugin-${generateId()}`;
      const group = derivationGroupsRef.current.find(
        (entry) => entry.id === options.groupId,
      );
      if (!group) {
        pushUiEvent({
          level: "error",
          message: `Derivation group not found: ${options.groupId}`,
        });
        return;
      }
      let inputMetrics = uniqueMetrics(getDerivationGroupInputMetrics(group).map(cloneMetric));
      const plugin = derivationPluginsRef.current.find(
        (entry) => entry.id === options.pluginId,
      );
      if (plugin) {
        const minInputs = Number.isInteger(plugin.minInputs) ? plugin.minInputs : 1;
        const maxInputs =
          Number.isInteger(plugin.maxInputs) && (plugin.maxInputs as number) >= minInputs
            ? (plugin.maxInputs as number)
            : null;
        if (maxInputs !== null && inputMetrics.length > maxInputs) {
          inputMetrics = inputMetrics.slice(0, maxInputs);
          pushUiEvent({
            level: "info",
            message: "Trimmed derivation inputs",
            detail: `${options.groupId} -> ${options.pluginId} (${maxInputs} max)`,
          });
        }
        if (inputMetrics.length < minInputs) {
          pushUiEvent({
            level: "error",
            message: `Plugin ${options.pluginId} requires at least ${minInputs} input metrics`,
            detail: `${options.groupId} has ${inputMetrics.length}`,
          });
          return;
        }
      }
      derivationOutputGroupByCaptureRef.current.set(outputCaptureId, options.groupId);
      markDerivationRunPending(
        requestId,
        outputCaptureId,
        `${options.groupId} -> ${options.pluginId}`,
      );
      const sent = sendMessageRef.current({
        type: "run_derivation_plugin",
        groupId: options.groupId,
        pluginId: options.pluginId,
        outputCaptureId,
        metrics: inputMetrics,
        request_id: requestId,
      });
      if (!sent) {
        clearDerivationRunPendingByRequest(requestId);
      }
      pushUiEvent({
        level: "info",
        message: "Derivation plugin run requested",
        detail: `${options.groupId} -> ${options.pluginId}`,
      });
    },
    [clearDerivationRunPendingByRequest, markDerivationRunPending, pushUiEvent],
  );

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

  const autoReplayDerivationsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!initialSyncReady) {
      return;
    }
    if (derivationGroups.length === 0) {
      return;
    }
    derivationGroups.forEach((group) => {
      const pluginId = typeof group.pluginId === "string" ? group.pluginId.trim() : "";
      if (!pluginId) {
        return;
      }
      const metrics = getDerivationGroupInputMetrics(group);
      if (metrics.length === 0) {
        return;
      }
      const persistedDerivedMetrics = getDerivationGroupDerivedMetrics(group);
      if (persistedDerivedMetrics.length === 0) {
        return;
      }
      const knownDerivedCaptureIds = Array.from(
        new Set(
          persistedDerivedMetrics
            .map((metric) => metric.captureId)
            .filter((captureId) => typeof captureId === "string" && captureId.length > 0),
        ),
      );
      const outputCaptureId =
        knownDerivedCaptureIds[0] ?? `derive-${group.id}-${pluginId}`;
      const existing = captures.find((capture) => capture.id === outputCaptureId);
      // Replay only when the output capture already has records in this session.
      // This restores derived outputs after refresh without creating duplicate output captures.
      if (existing && existing.records.length > 0) {
        return;
      }
      const key = `${group.id}::${pluginId}`;
      if (autoReplayDerivationsRef.current.has(key)) {
        return;
      }
      autoReplayDerivationsRef.current.add(key);
      handleRunDerivationPlugin({ groupId: group.id, pluginId, outputCaptureId });
    });
  }, [captures, derivationGroups, handleRunDerivationPlugin, initialSyncReady]);

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

  const applyWindowRange = useCallback(
    (startTick: number, endTick: number) => {
      const maxTick = Math.max(1, playbackState.totalTicks || 1);
      let start = Number.isFinite(startTick) ? Math.floor(startTick) : 1;
      let end = Number.isFinite(endTick) ? Math.floor(endTick) : 1;
      start = Math.max(1, start);
      end = Math.max(1, end);
      if (end > maxTick) {
        end = maxTick;
      }
      if (start > end) {
        start = end;
      }
      setWindowStart(start);
      setWindowEnd(end);
      setPlaybackState((prev) => ({
        ...prev,
        currentTick: end,
      }));
      return { start, end };
    },
    [playbackState.totalTicks],
  );

  const handleWindowSizeChange = useCallback(
    (size: number) => {
      if (!Number.isFinite(size) || size <= 0) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      const safeSize = Math.max(1, Math.floor(size));
      setWindowSize(safeSize);
      setIsAutoScroll(false);
      setIsWindowed(true);
      const end = isAutoScroll ? playbackState.currentTick : windowEnd;
      applyWindowRange(end - safeSize + 1, end);
    },
    [applyWindowRange, isAutoScroll, playbackState.currentTick, windowEnd],
  );

  const handleWindowStartChange = useCallback(
    (startTick: number) => {
      if (!Number.isFinite(startTick)) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      setIsAutoScroll(false);
      setIsWindowed(true);
      const start = Math.max(1, Math.floor(startTick));
      const end = start + windowSize - 1;
      applyWindowRange(start, end);
    },
    [applyWindowRange, windowSize],
  );

  const handleWindowEndChange = useCallback(
    (endTick: number) => {
      if (!Number.isFinite(endTick)) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      setIsAutoScroll(false);
      setIsWindowed(true);
      const end = Math.max(1, Math.floor(endTick));
      const start = end - windowSize + 1;
      applyWindowRange(start, end);
    },
    [applyWindowRange, windowSize],
  );

  const handleWindowRangeChange = useCallback(
    (startTick: number, endTick: number) => {
      if (!Number.isFinite(startTick) && !Number.isFinite(endTick)) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      setIsAutoScroll(false);
      setIsWindowed(true);
      const window = applyWindowRange(startTick, endTick);
      setWindowSize(Math.max(1, window.end - window.start + 1));
    },
    [applyWindowRange],
  );

  const commitWindowStartInput = useCallback(
    (rawValue: string) => {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        setWindowStartInput(String(windowStart));
        return;
      }
      handleWindowStartChange(parsed);
    },
    [handleWindowStartChange, windowStart],
  );

  const commitWindowEndInput = useCallback(
    (rawValue: string) => {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        setWindowEndInput(String(windowEnd));
        return;
      }
      handleWindowEndChange(parsed);
    },
    [handleWindowEndChange, windowEnd],
  );

  const handleChartDomainChange = useCallback(
    (domain: { yPrimary: [number, number]; ySecondary: [number, number] }) => {
      const nextPrimary = sanitizeDomain(domain.yPrimary);
      const nextSecondary = sanitizeDomain(domain.ySecondary);
      setResolvedYPrimaryDomain((prev) =>
        prev[0] === nextPrimary[0] && prev[1] === nextPrimary[1] ? prev : nextPrimary,
      );
      setResolvedYSecondaryDomain((prev) =>
        prev[0] === nextSecondary[0] && prev[1] === nextSecondary[1] ? prev : nextSecondary,
      );
    },
    [],
  );

  const commitYPrimaryBoundary = useCallback(
    (boundary: "min" | "max", rawValue: string) => {
      const parsed = Number(rawValue);
      const source = sanitizeDomain(manualYPrimaryDomain ?? resolvedYPrimaryDomain);
      if (!Number.isFinite(parsed)) {
        if (boundary === "min") {
          setYPrimaryMinInput(formatDomainNumber(source[0]));
        } else {
          setYPrimaryMaxInput(formatDomainNumber(source[1]));
        }
        return;
      }
      let [nextMin, nextMax] = source;
      if (boundary === "min") {
        nextMin = parsed;
        if (nextMin >= nextMax) {
          nextMin = nextMax - MIN_Y_DOMAIN_SPAN;
        }
      } else {
        nextMax = parsed;
        if (nextMax <= nextMin) {
          nextMax = nextMin + MIN_Y_DOMAIN_SPAN;
        }
      }
      setManualYPrimaryDomain([nextMin, nextMax]);
    },
    [manualYPrimaryDomain, resolvedYPrimaryDomain],
  );

  const commitYSecondaryBoundary = useCallback(
    (boundary: "min" | "max", rawValue: string) => {
      const parsed = Number(rawValue);
      const source = sanitizeDomain(manualYSecondaryDomain ?? resolvedYSecondaryDomain);
      if (!Number.isFinite(parsed)) {
        if (boundary === "min") {
          setYSecondaryMinInput(formatDomainNumber(source[0]));
        } else {
          setYSecondaryMaxInput(formatDomainNumber(source[1]));
        }
        return;
      }
      let [nextMin, nextMax] = source;
      if (boundary === "min") {
        nextMin = parsed;
        if (nextMin >= nextMax) {
          nextMin = nextMax - MIN_Y_DOMAIN_SPAN;
        }
      } else {
        nextMax = parsed;
        if (nextMax <= nextMin) {
          nextMax = nextMin + MIN_Y_DOMAIN_SPAN;
        }
      }
      setManualYSecondaryDomain([nextMin, nextMax]);
    },
    [manualYSecondaryDomain, resolvedYSecondaryDomain],
  );

  const handleYPrimaryRangeChange = useCallback((min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return;
    }
    setManualYPrimaryDomain([min, max]);
  }, []);

  const handleYSecondaryRangeChange = useCallback((min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return;
    }
    setManualYSecondaryDomain([min, max]);
  }, []);

  const handleResetWindow = useCallback(() => {
    const end = Math.max(1, playbackState.totalTicks || playbackState.currentTick);
    setIsAutoScroll(true);
    setIsWindowed(false);
    setManualYPrimaryDomain(null);
    setManualYSecondaryDomain(null);
    setResetViewVersion((prev) => prev + 1);
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: true,
      currentTick: end,
    }));
    setWindowStart(1);
    setWindowEnd(end);
    setWindowSize(end);
  }, [playbackState.currentTick, playbackState.totalTicks]);

  const handleAutoScrollChange = useCallback(
    (enabled: boolean) => {
      const nextEnabled = Boolean(enabled);
      setIsAutoScroll(nextEnabled);
      if (nextEnabled) {
        setIsWindowed(false);
      }
      if (!enabled) {
        setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      }
    },
    [],
  );

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

    const interval = 1000 / playbackState.speed;
    let lastTime = performance.now();

    const tick = (currentTime: number) => {
      const delta = currentTime - lastTime;

      if (delta >= interval) {
        lastTime = currentTime;
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
          return { ...prev, currentTick: prev.currentTick + 1 };
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

  useLayoutEffect(() => {
    if (!isAutoScroll) {
      return;
    }
    const end = Math.max(1, playbackState.currentTick);
    const start = Math.max(1, Math.min(windowStart, end));
    const size = Math.max(1, end - start + 1);
    if (windowStart !== start) {
      setWindowStart(start);
    }
    if (windowEnd !== end) {
      setWindowEnd(end);
    }
    if (windowSize !== size) {
      setWindowSize(size);
    }
  }, [isAutoScroll, playbackState.currentTick, windowEnd, windowSize, windowStart]);

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

  const toggleSidebarMode = useCallback(() => {
    setSidebarMode((prev) => (prev === "setup" ? "analysis" : "setup"));
  }, []);

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

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <Dialog
        open={isDerivationPluginSourceOpen}
        onOpenChange={(open) => {
          setIsDerivationPluginSourceOpen(open);
          if (!open) {
            setDerivationPluginSource(null);
            setDerivationPluginSourceError(null);
            setDerivationPluginSourceLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="text-sm">Derivation System Source</DialogTitle>
          </DialogHeader>
          {derivationPluginSourceLoading && (
            <div className="text-xs text-muted-foreground">Loading source...</div>
          )}
          {derivationPluginSourceError && (
            <div className="text-xs text-red-500">{derivationPluginSourceError}</div>
          )}
          {derivationPluginSource && (
            <div className="flex flex-col gap-2 flex-1 min-h-0">
              <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                <span className="truncate">
                  {derivationPluginSource.name} ({derivationPluginSource.pluginId})
                </span>
                <span className="font-mono text-[11px] shrink-0">
                  {formatBytes(derivationPluginSource.bytes)}
                  {derivationPluginSource.truncated ? " (truncated)" : ""}
                </span>
              </div>
              <ScrollArea className="flex-1 rounded-md border border-border/50 bg-muted/20">
                <pre className="p-3 text-[11px] leading-relaxed font-mono text-foreground whitespace-pre overflow-x-auto">
                  {derivationPluginSource.source}
                </pre>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={isDocsOpen} onOpenChange={setIsDocsOpen}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <span>Documentation</span>
              <a
                href="/USAGE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Raw
                <ExternalLink className="w-3 h-3" />
              </a>
            </DialogTitle>
          </DialogHeader>
          {docsLoading ? (
            <div className="text-xs text-muted-foreground">Loading docs...</div>
          ) : null}
          {docsError ? <div className="text-xs text-destructive">{docsError}</div> : null}
          <div className="flex-1 min-h-0 rounded-md border border-border/50 bg-muted/20 overflow-hidden">
            <ScrollArea className="h-full">
              <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-foreground">
                {docsContent || "No documentation content loaded."}
              </pre>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
      {connectionLock ? (
        <div className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-md border border-border/60 bg-card/95 shadow-xl p-4 flex flex-col gap-3">
            <div className="text-sm font-medium tracking-tight text-foreground">
              Dashboard access locked
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {connectionLock.message}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              close code: {connectionLock.closeCode}
              {connectionLock.closeReason ? ` | reason: ${connectionLock.closeReason}` : ""}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={handleTakeoverDashboard}
                data-testid="button-dashboard-lock-takeover"
              >
                Take over this session
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRetryConnection}
                data-testid="button-dashboard-lock-retry"
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar>
          <SidebarHeader ref={sidebarHeaderRef} className="p-4">
            <div className="flex items-center gap-3">
              <Activity className="w-4 h-4 text-foreground" />
              <button
                type="button"
                onClick={toggleSidebarMode}
                className="text-sm font-medium tracking-tight flex items-center gap-2 hover:text-foreground/80"
                data-testid="button-toggle-sidebar-mode"
                aria-pressed={sidebarMode === "analysis"}
              >
                Metrics
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  {sidebarMode === "analysis" ? "Derivations" : "Setup"}
                </span>
              </button>
            </div>
          </SidebarHeader>
          <SidebarContent
            className="min-h-0"
            style={{ height: "calc(100% - var(--metrics-ui-sidebar-header, 0px))" }}
          >
            <div
              className={
                sidebarMode === "setup"
                  ? "flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain"
                  : "hidden"
              }
              aria-hidden={sidebarMode !== "setup"}
            >
              <>
                <Collapsible open={isCaptureSourceOpen} onOpenChange={setIsCaptureSourceOpen}>
                  <SidebarGroup>
                    <SidebarGroupLabel asChild>
                      <CollapsibleTrigger className="flex w-full items-center justify-between">
                        <span>Capture Source</span>
                        <ChevronDown
                          className={`h-3 w-3 text-muted-foreground transition-transform ${
                            isCaptureSourceOpen ? "rotate-180" : ""
                          }`}
                        />
                      </CollapsibleTrigger>
                    </SidebarGroupLabel>
                    <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                      <SidebarGroupContent>
                        <div className="px-2">
                          <Tabs
                            value={sourceMode}
                            onValueChange={(value) => {
                              const nextMode = value === "live" ? "live" : "file";
                              handleSourceModeChange(nextMode);
                            }}
                            className="w-full"
                          >
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger value="file">File</TabsTrigger>
                              <TabsTrigger value="live">Live</TabsTrigger>
                            </TabsList>
                            <TabsContent value="file" className="mt-3">
                              <FileUpload
                                onFileUpload={handleFileUpload}
                                isUploading={uploadMutation.isPending}
                                uploadedFile={null}
                                error={uploadError}
                                onClear={handleClearUploadError}
                              />
                            </TabsContent>
                            <TabsContent value="live" className="mt-3">
                              <div className="flex flex-col gap-3">
                                {liveStreams.map((entry, index) => {
                                  const isConnected = entry.status === "connected";
                                  const isConnecting = entry.status === "connecting";
                                  const isRetrying = entry.status === "retrying";
                                  const isCompleted = entry.status === "completed";
                                  const statusLabel = isConnected
                                    ? `Connected (${entry.id})`
                                    : isConnecting
                                      ? "Connecting..."
                                      : isRetrying
                                        ? "Retrying..."
                                        : isCompleted
                                          ? "Completed"
                                          : "Idle";

                                  return (
                                    <div
                                      key={entry.id}
                                      className="rounded-md border border-border/50 p-2 flex flex-col gap-2"
                                    >
                                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                        <span>Stream {index + 1}</span>
                                        <button
                                          type="button"
                                          onClick={() => removeCaptureIds([entry.id])}
                                          data-testid={`button-live-remove-${entry.id}`}
                                          aria-label={`Remove live stream ${index + 1}`}
                                          className="h-3 w-3 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                                        >
                                        </button>
                                      </div>
                                      <Input
                                        placeholder="Capture file URL or path"
                                        value={entry.source}
                                        onChange={(event) => {
                                          handleLiveSourceInput(entry.id, event.target.value);
                                        }}
                                        className="h-8 px-2 py-1 text-xs"
                                        aria-label={`Capture file source ${index + 1}`}
                                      />
                                      <Input
                                        type="number"
                                        min={0.5}
                                        step={0.5}
                                        placeholder="Poll interval (seconds)"
                                        value={String(entry.pollSeconds)}
                                        onChange={(event) => {
                                          const parsed = Number(event.target.value);
                                          if (Number.isFinite(parsed) && parsed > 0) {
                                            handleLivePollChange(entry.id, parsed);
                                          }
                                        }}
                                        className="h-8 px-2 py-1 text-xs"
                                        disabled={isConnected || isConnecting}
                                        aria-label={`Poll interval seconds ${index + 1}`}
                                      />
                                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{statusLabel}</span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => handleLiveRefresh(entry.id)}
                                          disabled={!entry.source.trim() || isConnected || isConnecting}
                                          data-testid={`button-live-refresh-${entry.id}`}
                                          aria-label={`Refresh live source ${index + 1}`}
                                        >
                                          <RefreshCw className="w-3 h-3" />
                                        </Button>
                                      </div>
                                      {entry.pollSeconds > 0 && (
                                        <div className="text-[11px] text-muted-foreground">
                                          Polling every {entry.pollSeconds.toLocaleString()}s
                                        </div>
                                      )}
                                      {entry.error && (
                                        <div className="text-xs text-destructive">{entry.error}</div>
                                      )}
                                    </div>
                                  );
                                })}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  onClick={handleAddLiveStream}
                                  data-testid="button-live-add"
                                >
                                  Add live stream
                                </Button>
                              </div>
                            </TabsContent>
                          </Tabs>
                        </div>
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
                <SidebarGroup>
                  <SidebarGroupLabel>Captures</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <div className="flex flex-col gap-1 px-2">
                      {captures.map((capture) => (
                        <div
                          key={capture.id}
                          className="flex items-center gap-2 py-1.5 text-sm"
                          data-testid={`capture-item-${capture.id}`}
                        >
                          <Checkbox
                            checked={capture.isActive}
                            onCheckedChange={() => handleToggleCapture(capture.id)}
                            data-testid={`checkbox-capture-${capture.id}`}
                          />
                          <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1 text-xs" title={capture.filename}>
                            {getCaptureShortName(capture)}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {capture.tickCount}
                          </span>
                          <button
                            type="button"
                            className="h-3 w-3 shrink-0 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                            onClick={() => handleRemoveCapture(capture.id)}
                            data-testid={`button-remove-capture-${capture.id}`}
                            aria-label={`Remove capture ${capture.id}`}
                          />
                        </div>
                      ))}
                      {captures.length === 0 && (
                        <p className="text-xs text-muted-foreground py-2">
                          No captures loaded
                        </p>
                      )}
                    </div>
                  </SidebarGroupContent>
                </SidebarGroup>
                <Collapsible open={isSelectionOpen} onOpenChange={setIsSelectionOpen}>
                  <SidebarGroup>
                    <SidebarGroupLabel asChild>
                      <CollapsibleTrigger className="flex w-full items-center justify-between">
                        <span>Selection</span>
                        <ChevronDown
                          className={`h-3 w-3 text-muted-foreground transition-transform ${
                            isSelectionOpen ? "rotate-180" : ""
                          }`}
                        />
                      </CollapsibleTrigger>
                    </SidebarGroupLabel>
                    <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                      <SidebarGroupContent>
                        <div className="flex flex-col gap-3">
                          {activeCaptures.length === 0 && (
                            <div className="px-2 text-xs text-muted-foreground">
                              No active captures
                            </div>
                          )}
                          {activeCaptures.map((capture) => {
                            const isCaptureSelectionOpen =
                              selectionCaptureOpenById[capture.id] ?? true;
                            return (
                              <Collapsible
                                key={capture.id}
                                open={isCaptureSelectionOpen}
                                onOpenChange={(open) =>
                                  setSelectionCaptureOpenById((prev) => {
                                    if ((prev[capture.id] ?? true) === open) {
                                      return prev;
                                    }
                                    return { ...prev, [capture.id]: open };
                                  })
                                }
                              >
                                <div className="flex flex-col gap-1">
                                  <CollapsibleTrigger asChild>
                                    <button
                                      type="button"
                                      className="group flex w-full items-center px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                      aria-label={`Toggle metric tree for ${capture.id}`}
                                      data-testid={`button-toggle-selection-capture-${capture.id}`}
                                    >
                                      <span className="truncate text-left" title={capture.filename}>
                                        {getCaptureShortName(capture)}
                                      </span>
                                    </button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                                    <ComponentTree
                                      captureId={capture.id}
                                      components={capture.components}
                                      selectedMetrics={selectedMetricsByCapture.get(capture.id) ?? EMPTY_METRICS}
                                      metricCoverage={deferredMetricCoverage[capture.id]}
                                      onSelectionChange={getSelectionHandler(capture.id)}
                                      colorOffset={captures.findIndex((c) => c.id === capture.id)}
                                      isVisible={isSelectionOpen && isCaptureSelectionOpen}
                                    />
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            );
                          })}
                        </div>
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
                <SidebarGroup>
                  <SidebarGroupLabel>Overview</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <div className="flex flex-col gap-2 px-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Captures</span>
                        <span className="font-mono text-foreground">{captures.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Active</span>
                        <span className="font-mono text-foreground">{activeCaptures.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Selected metrics</span>
                        <span className="font-mono text-foreground">{selectedMetrics.length}</span>
                      </div>
                    </div>
                  </SidebarGroupContent>
                </SidebarGroup>
                <SidebarGroup>
                  <SidebarGroupLabel>View</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <div className="flex flex-col gap-2 px-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Tick</span>
                        <span className="font-mono text-foreground">
                          {playbackState.currentTick} / {playbackState.totalTicks}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Window</span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            value={windowStartInput}
                            onFocus={() => {
                              windowStartEditingRef.current = true;
                            }}
                            onChange={(event) => setWindowStartInput(event.target.value)}
                            onBlur={(event) => {
                              windowStartEditingRef.current = false;
                              commitWindowStartInput(event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                windowStartEditingRef.current = false;
                                commitWindowStartInput((event.target as HTMLInputElement).value);
                                (event.target as HTMLInputElement).blur();
                              }
                            }}
                            className="h-auto p-0 text-xs md:text-xs font-mono text-right text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            style={{ width: `${Math.max(windowStartInput.length, 1)}ch` }}
                            aria-label="Window start tick"
                          />
                          <span className="text-muted-foreground">–</span>
                          <Input
                            type="number"
                            min={1}
                            value={windowEndInput}
                            onFocus={() => {
                              windowEndEditingRef.current = true;
                            }}
                            onChange={(event) => setWindowEndInput(event.target.value)}
                            onBlur={(event) => {
                              windowEndEditingRef.current = false;
                              commitWindowEndInput(event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                windowEndEditingRef.current = false;
                                commitWindowEndInput((event.target as HTMLInputElement).value);
                                (event.target as HTMLInputElement).blur();
                              }
                            }}
                            className="h-auto p-0 text-xs md:text-xs font-mono text-right text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            style={{ width: `${Math.max(windowEndInput.length, 1)}ch` }}
                            aria-label="Window end tick"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Y</span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={yPrimaryMinInput}
                            onFocus={() => {
                              yPrimaryMinEditingRef.current = true;
                            }}
                            onChange={(event) => setYPrimaryMinInput(event.target.value)}
                            onBlur={(event) => {
                              yPrimaryMinEditingRef.current = false;
                              commitYPrimaryBoundary("min", event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                yPrimaryMinEditingRef.current = false;
                                commitYPrimaryBoundary("min", (event.target as HTMLInputElement).value);
                                (event.target as HTMLInputElement).blur();
                              }
                            }}
                            className="h-auto p-0 text-xs md:text-xs font-mono text-right text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            style={{ width: `${Math.max(yPrimaryMinInput.length, 1)}ch` }}
                            aria-label="Primary axis minimum"
                          />
                          <span className="text-muted-foreground">–</span>
                          <Input
                            type="number"
                            value={yPrimaryMaxInput}
                            onFocus={() => {
                              yPrimaryMaxEditingRef.current = true;
                            }}
                            onChange={(event) => setYPrimaryMaxInput(event.target.value)}
                            onBlur={(event) => {
                              yPrimaryMaxEditingRef.current = false;
                              commitYPrimaryBoundary("max", event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                yPrimaryMaxEditingRef.current = false;
                                commitYPrimaryBoundary("max", (event.target as HTMLInputElement).value);
                                (event.target as HTMLInputElement).blur();
                              }
                            }}
                            className="h-auto p-0 text-xs md:text-xs font-mono text-right text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            style={{ width: `${Math.max(yPrimaryMaxInput.length, 1)}ch` }}
                            aria-label="Primary axis maximum"
                          />
                        </div>
                      </div>
                      {hasSecondaryAxis ? (
                        <div className="flex items-center justify-between">
                          <span>Y2</span>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={ySecondaryMinInput}
                              onFocus={() => {
                                ySecondaryMinEditingRef.current = true;
                              }}
                              onChange={(event) => setYSecondaryMinInput(event.target.value)}
                              onBlur={(event) => {
                                ySecondaryMinEditingRef.current = false;
                                commitYSecondaryBoundary("min", event.target.value);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  ySecondaryMinEditingRef.current = false;
                                  commitYSecondaryBoundary("min", (event.target as HTMLInputElement).value);
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                              className="h-auto p-0 text-xs md:text-xs font-mono text-right text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              style={{ width: `${Math.max(ySecondaryMinInput.length, 1)}ch` }}
                              aria-label="Secondary axis minimum"
                            />
                            <span className="text-muted-foreground">–</span>
                            <Input
                              type="number"
                              value={ySecondaryMaxInput}
                              onFocus={() => {
                                ySecondaryMaxEditingRef.current = true;
                              }}
                              onChange={(event) => setYSecondaryMaxInput(event.target.value)}
                              onBlur={(event) => {
                                ySecondaryMaxEditingRef.current = false;
                                commitYSecondaryBoundary("max", event.target.value);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  ySecondaryMaxEditingRef.current = false;
                                  commitYSecondaryBoundary("max", (event.target as HTMLInputElement).value);
                                  (event.target as HTMLInputElement).blur();
                                }
                              }}
                              className="h-auto p-0 text-xs md:text-xs font-mono text-right text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              style={{ width: `${Math.max(ySecondaryMaxInput.length, 1)}ch` }}
                              aria-label="Secondary axis maximum"
                            />
                          </div>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between">
                        <span>Auto-scroll</span>
                        <span className="font-mono text-foreground">
                          {isAutoScroll ? "On" : "Off"}
                        </span>
                      </div>
                    </div>
                  </SidebarGroupContent>
                </SidebarGroup>
                <Collapsible open={isDiagnosticsOpen} onOpenChange={setIsDiagnosticsOpen}>
                  <SidebarGroup>
                    <SidebarGroupLabel asChild>
                      <CollapsibleTrigger className="flex w-full items-center justify-between">
                        <span>Diagnostics</span>
                        <ChevronDown
                          className={`h-3 w-3 text-muted-foreground transition-transform ${
                            isDiagnosticsOpen ? "rotate-180" : ""
                          }`}
                        />
                      </CollapsibleTrigger>
                    </SidebarGroupLabel>
                    <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                      <SidebarGroupContent>
                        <div className="flex items-center justify-between px-2 text-[11px] text-muted-foreground">
                          <span>
                            {memoryStatsAt
                              ? `Updated ${new Date(memoryStatsAt).toLocaleTimeString()}`
                              : "Not sampled"}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={handleRefreshMemoryStats}
                            data-testid="button-refresh-diagnostics"
                          >
                            Refresh
                          </Button>
                        </div>
                        {!memoryStatsSnapshot && (
                          <div className="px-2 py-2 text-xs text-muted-foreground">
                            Click refresh to capture telemetry.
                          </div>
                        )}
                        {memoryStatsSnapshot && (
                          <div className="flex flex-col gap-3 px-2 py-2 text-xs text-muted-foreground">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between">
                                <span>Heap used</span>
                                <span className="font-mono text-foreground">
                                  {formatBytes(memoryStatsSnapshot.usedHeap)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Record store</span>
                                <span className="font-mono text-foreground">
                                  {formatBytes(memoryStatsSnapshot.estimates.recordStoreBytes)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Series bytes</span>
                                <span className="font-mono text-foreground">
                                  {formatBytes(memoryStatsSnapshot.totals.seriesBytes)}
                                </span>
                              </div>
                              <div className="text-[10px] uppercase tracking-wide">
                                Estimates ({memoryStatsSnapshot.estimates.estimateSource})
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Bytes / prop</span>
                                <span className="font-mono text-foreground">
                                  {memoryStatsSnapshot.estimates.effectiveBytesPerObjectProp.toFixed(1)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Bytes / point</span>
                                <span className="font-mono text-foreground">
                                  {memoryStatsSnapshot.estimates.effectiveBytesPerSeriesPoint.toFixed(1)}
                                </span>
                              </div>
                            </div>
                            {memoryStatsSnapshot.captures.map((capture) => {
                              const topSeries = [...capture.seriesMetrics]
                                .sort((a, b) => b.estBytes - a.estBytes)
                                .slice(0, 5);
                              return (
                                <div
                                  key={capture.captureId}
                                  className="rounded-md border border-border/50 p-2 flex flex-col gap-2"
                                >
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="truncate font-medium text-foreground">
                                      {capture.filename}
                                    </span>
                                    <span className="font-mono text-muted-foreground">
                                      {capture.tickCount}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                                    <span>Records</span>
                                    <span className="font-mono text-foreground">
                                      {capture.records}
                                    </span>
                                    <span>Record bytes</span>
                                    <span className="font-mono text-foreground">
                                      {formatBytes(capture.estimatedRecordBytes)}
                                    </span>
                                    <span>Series points</span>
                                    <span className="font-mono text-foreground">
                                      {capture.seriesPoints}
                                    </span>
                                    <span>Series bytes</span>
                                    <span className="font-mono text-foreground">
                                      {formatBytes(capture.seriesBytes)}
                                    </span>
                                  </div>
                                  {topSeries.length > 0 && (
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Top series
                                      </span>
                                      {topSeries.map((entry) => (
                                        <div
                                          key={`${capture.captureId}-${entry.fullPath}`}
                                          className="flex items-center justify-between text-[11px]"
                                        >
                                          <span className="truncate">{entry.fullPath}</span>
                                          <span className="font-mono text-foreground">
                                            {formatBytes(entry.estBytes)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              </>
            </div>
            <div
              className={
                sidebarMode === "analysis"
                  ? "flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain"
                  : "hidden"
              }
              aria-hidden={sidebarMode !== "analysis"}
            >
              <>
                <SidebarGroup>
                  <SidebarGroupLabel>Derivations</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <input
                      ref={derivationPluginFileRef}
                      type="file"
                      accept=".mjs,.js"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handleUploadDerivationPlugin(file);
                        }
                        event.target.value = "";
                      }}
                    />
                    <div className="flex items-center justify-between px-2 pb-2">
                      <span className="text-xs text-muted-foreground">
                        {derivationPlugins.length} systems
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => derivationPluginFileRef.current?.click()}
                        data-testid="button-derivation-plugin-upload"
                        aria-label="Upload derivation system"
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                    {derivationPluginsError && (
                      <div className="px-2 text-xs text-red-500">
                        {derivationPluginsError}
                      </div>
                    )}
                    {derivationPlugins.length === 0 && (
                      <div className="px-2 text-xs text-muted-foreground">
                        Upload a derivation system plugin to compute derived metrics.
                      </div>
                    )}
                    {derivationPlugins.length > 0 && (
                      <div className="flex flex-col gap-2 px-2 pb-2 text-xs text-muted-foreground">
                        {derivationPlugins.map((plugin) => (
                          <div
                            key={plugin.id}
                            className={`rounded-md border px-2 py-1.5 flex items-start justify-between gap-2 ${
                              plugin.valid ? "border-border/50" : "border-red-500/40"
                            }`}
                          >
                            <div className="min-w-0 flex flex-col gap-0.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate font-medium text-foreground">
                                  {plugin.name}
                                </span>
                                <span className="truncate font-mono text-[10px] text-muted-foreground">
                                  {plugin.id}
                                </span>
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                outputs:{" "}
                                {plugin.outputs.length > 0
                                  ? plugin.outputs.map((output) => output.key).join(", ")
                                  : "-"}
                              </div>
                              {!plugin.valid && plugin.error && (
                                <div className="text-[10px] text-red-500">
                                  {plugin.error}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0 mt-0.5">
                              <button
                                type="button"
                                onClick={() => handleViewDerivationPluginSource(plugin.id)}
                                aria-label={`View derivation system source ${plugin.name}`}
                                data-testid={`button-derivation-plugin-source-${plugin.id}`}
                                className="h-3 w-3 rounded-sm bg-muted/40 hover:bg-muted/60 transition-colors flex items-center justify-center"
                              >
                                <Code className="w-[10px] h-[10px] text-muted-foreground" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDerivationPlugin(plugin.id)}
                                aria-label={`Delete derivation system ${plugin.name}`}
                                className="h-3 w-3 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mx-2 h-px bg-border/50" />

                    <div className="flex items-center justify-between px-2 pb-2">
                      <span className="text-xs text-muted-foreground">
                        {derivationGroups.length} groups
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            data-testid="button-derivation-group-create"
                            aria-label="Create derivation group"
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-44"
                          data-testid="menu-derivation-group-create"
                        >
                          <DropdownMenuItem
                            onClick={() => handleCreateDerivationGroupFromActive("new")}
                            data-testid="menu-item-derivation-group-new"
                          >
                            New Group
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={derivationGroups.length === 0}
                            onClick={() => handleCreateDerivationGroupFromActive("deep-copy")}
                            data-testid="menu-item-derivation-group-deep-copy"
                          >
                            Deep Copy
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={derivationGroups.length === 0}
                            onClick={() => handleCreateDerivationGroupFromActive("shallow-copy")}
                            data-testid="menu-item-derivation-group-shallow-copy"
                          >
                            Shallow Copy
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {derivationGroups.length === 0 && (
                      <div className="px-2 text-xs text-muted-foreground">
                        Click a metric in the HUD to create a default group.
                      </div>
                    )}
                    <div className="flex flex-col gap-3 px-2 text-xs text-muted-foreground">
                      {derivationGroups.map((group) => {
                        const isActive = group.id === resolvedActiveDerivationGroupId;
                        const isDisplayed = group.id === resolvedDisplayDerivationGroupId;
                        const selectedPluginId =
                          typeof group.pluginId === "string" ? group.pluginId : "";
                        const normalizedPluginId = selectedPluginId.trim();
                        const selectedPlugin = selectedPluginId
                          ? derivationPlugins.find((plugin) => plugin.id === selectedPluginId) ?? null
                          : null;
                        const canRunPlugin = Boolean(
                          selectedPluginId && selectedPlugin && selectedPlugin.valid,
                        );
                        const inputMetricRows = getDerivationGroupInputMetrics(group).map(
                          (metric, index) => ({ metric, index }),
                        );
                        const derivedMetricRows = getDerivationGroupDerivedMetrics(group);
                        return (
                          <div
                            key={group.id}
                            className={`rounded-md border p-2 flex flex-col gap-2 ${
                              isActive ? "border-foreground/40" : "border-border/50"
                            } cursor-pointer`}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleSetActiveDerivationGroup(group.id)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) {
                                return;
                              }
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleSetActiveDerivationGroup(group.id);
                              }
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <Input
                                value={derivationGroupNameDrafts[group.id] ?? group.name}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setDerivationGroupNameDrafts((prev) => {
                                    if (prev[group.id] === nextValue) {
                                      return prev;
                                    }
                                    return { ...prev, [group.id]: nextValue };
                                  });
                                }}
                                onFocus={() => {
                                  setFocusedDerivationGroupNameId(group.id);
                                  setDerivationGroupNameDrafts((prev) => {
                                    if (typeof prev[group.id] === "string") {
                                      return prev;
                                    }
                                    return { ...prev, [group.id]: group.name };
                                  });
                                }}
                                onBlur={(event) => {
                                  const rawValue =
                                    derivationGroupNameDrafts[group.id] ?? event.target.value;
                                  const nextName = rawValue.trim();
                                  if (nextName && nextName !== group.name) {
                                    handleUpdateDerivationGroup(group.id, { name: nextName });
                                  }
                                  setFocusedDerivationGroupNameId((prev) =>
                                    prev === group.id ? "" : prev,
                                  );
                                  setDerivationGroupNameDrafts((prev) => {
                                    if (!(group.id in prev)) {
                                      return prev;
                                    }
                                    const { [group.id]: _removed, ...rest } = prev;
                                    return rest;
                                  });
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    (event.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="flex-1 min-w-0 h-auto p-0 text-xs font-mono tracking-tight text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                                aria-label={`Derivation group name`}
                              />
                              <div className="flex items-center gap-1 shrink-0">
                                <div
                                  className="w-[7.5rem]"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Select
                                    value={selectedPluginId || "__none__"}
                                    onValueChange={(value) => {
                                      handleUpdateDerivationGroup(group.id, {
                                        pluginId: value === "__none__" ? "" : value,
                                      });
                                    }}
                                  >
                                    <SelectTrigger
                                      className="h-6 px-2 py-1 text-xs font-mono tracking-tight bg-transparent border-border/50 focus:ring-0 focus:ring-offset-0"
                                      aria-label={`Derivation system for ${group.name}`}
                                      data-testid={`select-derivation-group-plugin-${group.id}`}
                                    >
                                      <SelectValue placeholder="No system" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">No system</SelectItem>
                                      {derivationPlugins.map((plugin) => (
                                        <SelectItem
                                          key={plugin.id}
                                          value={plugin.id}
                                          disabled={!plugin.valid}
                                        >
                                          {plugin.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!canRunPlugin) {
                                      return;
                                    }
                                    const stableOutputCaptureId = `derive-${group.id}-${selectedPluginId}`;
                                    handleRunDerivationPlugin({
                                      groupId: group.id,
                                      pluginId: selectedPluginId,
                                      outputCaptureId: stableOutputCaptureId,
                                    });
                                  }}
                                  disabled={!canRunPlugin}
                                  aria-label={`Run derivation system for ${group.name}`}
                                  data-testid={`button-derivation-group-run-plugin-${group.id}`}
                                  className={`h-5 w-5 flex items-center justify-center rounded-sm transition-colors ${
                                    canRunPlugin
                                      ? "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                      : "text-muted-foreground/30 cursor-not-allowed"
                                  }`}
                                >
                                  <Play className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSetDisplayDerivationGroup(isDisplayed ? "" : group.id)
                                  }
                                  data-testid={`button-derivation-group-display-${group.id}`}
                                  aria-label={
                                    isDisplayed
                                      ? `Show all metrics (stop solo display for ${group.name})`
                                      : `Show only metrics in ${group.name}`
                                  }
                                  className={`h-3 w-3 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 ${
                                    isDisplayed
                                      ? "bg-yellow-400/90 hover:bg-yellow-400"
                                      : "bg-yellow-400/20 hover:bg-yellow-400/30"
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDerivationGroup(group.id)}
                                  data-testid={`button-derivation-group-delete-${group.id}`}
                                  aria-label={`Delete derivation group ${group.name}`}
                                  className="h-3 w-3 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                                />
                              </div>
                            </div>
                            {focusedDerivationGroupNameId === group.id && (
                              <div
                                className="rounded-sm border border-border/50 bg-muted/20 px-2 py-1 text-xs font-mono text-foreground break-all"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {derivationGroupNameDrafts[group.id] ?? group.name}
                              </div>
                            )}
                            <div className="flex flex-col gap-1">
                              {inputMetricRows.length === 0 && derivedMetricRows.length === 0 && (
                                <div className="text-xs text-muted-foreground">
                                  No metrics yet.
                                </div>
                              )}
                              {inputMetricRows.length > 0 && (
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                  Inputs
                                </div>
                              )}
                              {inputMetricRows.map((row) => {
                                const { metric, index } = row;
                                const capture = captures.find(
                                  (entry) => entry.id === metric.captureId,
                                );
                                const captureName = capture
                                  ? getCaptureShortName(capture)
                                  : metric.captureId;
                                const isDraggingThis =
                                  derivationDragState?.groupId === group.id
                                  && derivationDragState?.fromIndex === index;
                                const isDropTarget =
                                  derivationDropState?.groupId === group.id
                                  && derivationDropState?.targetIndex === index;
                                const dropBefore = isDropTarget && derivationDropState?.position === "before";
                                const dropAfter = isDropTarget && derivationDropState?.position === "after";
                                return (
                                  <div
                                    key={`${group.id}-${getAnalysisKey(metric)}`}
                                    className={`relative flex items-center gap-2 rounded-sm ${
                                      isDraggingThis ? "opacity-60" : ""
                                    }`}
                                    draggable
                                    onDragStart={(event) => {
                                      event.stopPropagation();
                                      handleDerivationMetricDragStart(event, group.id, index);
                                    }}
                                    onDragOver={(event) => {
                                      event.stopPropagation();
                                      handleDerivationMetricDragOver(event, group.id, index);
                                    }}
                                    onDrop={(event) => {
                                      event.stopPropagation();
                                      handleDerivationMetricDrop(event, group.id, index);
                                    }}
                                    onDragEnd={(event) => {
                                      event.stopPropagation();
                                      handleDerivationMetricDragEnd();
                                    }}
                                  >
                                    {dropBefore && (
                                      <span className="pointer-events-none absolute -top-0.5 left-0 right-0 h-px bg-foreground/70" />
                                    )}
                                    {dropAfter && (
                                      <span className="pointer-events-none absolute -bottom-0.5 left-0 right-0 h-px bg-foreground/70" />
                                    )}
                                    <span className="text-muted-foreground/70 cursor-grab active:cursor-grabbing">
                                      <GripVertical className="w-3 h-3" />
                                    </span>
                                    <span
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: metric.color }}
                                    />
                                    <span className="truncate flex-1">
                                      {captureName}: {metric.label}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-foreground"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRemoveDerivationMetric(group.id, metric);
                                      }}
                                      aria-label={`Remove ${captureName}: ${metric.label} from ${group.name}`}
                                    >
                                      x
                                    </button>
                                  </div>
                                );
                              })}
                              {derivedMetricRows.length > 0 && (
                                <div className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                  Derived
                                </div>
                              )}
                              {derivedMetricRows.map((metric) => {
                                const capture = captures.find(
                                  (entry) => entry.id === metric.captureId,
                                );
                                const captureName = capture
                                  ? getCaptureShortName(capture)
                                  : metric.captureId;
                                return (
                                  <div
                                    key={`${group.id}-${getAnalysisKey(metric)}`}
                                    className="flex items-center gap-2 opacity-90"
                                  >
                                    <span
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: metric.color }}
                                    />
                                    <span className="truncate flex-1">
                                      {captureName}: {metric.label}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-foreground"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRemoveDerivationMetric(group.id, metric);
                                      }}
                                      aria-label={`Remove ${captureName}: ${metric.label} from ${group.name}`}
                                    >
                                      x
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            </div>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <header className="flex items-center justify-between gap-4 px-4 h-12 shrink-0">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedMetrics.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSelection}
                  className="gap-1.5"
                  data-testid="button-clear-selection"
                >
                  <X className="w-3 h-3" />
                  Clear ({selectedMetrics.length})
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsHudVisible(!isHudVisible)}
                data-testid="button-toggle-hud"
                title={isHudVisible ? "Hide HUD" : "Show HUD"}
              >
                {isHudVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleResetWindow}
                data-testid="button-reset-window"
                title="Full View"
              >
                <Maximize className="w-4 h-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 px-2"
                    data-testid="button-loading-status"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {isLoading ? loadingEntries.length : "Stable"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Loading</div>
                    <div className="flex h-6 min-w-[4.5rem] items-center justify-end">
                      <div className="text-right text-xs leading-none text-muted-foreground">
                        {isLoading ? "In progress" : "None"}
                      </div>
                    </div>
                  </div>
                  <ScrollArea className="mt-3 max-h-40 pr-2">
                    {loadingEntries.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No active work.</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {loadingEntries.map((entry) => (
                          <div key={entry.key} className="text-xs">
                            <div className="text-foreground">{entry.label}</div>
                            {entry.detail ? (
                              <div className="text-muted-foreground">{entry.detail}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="my-3 h-px bg-border/50" />
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Events</div>
                    <div className="ml-auto flex h-6 items-center justify-end gap-1">
                      <div className="text-right text-xs leading-none text-muted-foreground">
                        {recentUiEvents.length > 0 ? recentUiEvents.length : "None"}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-auto px-0 text-right text-[11px]"
                        onClick={() => setIsEventsVisible((prev) => !prev)}
                        data-testid="button-toggle-events"
                      >
                        {isEventsVisible ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>
                  {isEventsVisible ? (
                    <div className="mt-2 max-h-56 overflow-y-auto pr-2">
                      {recentUiEvents.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No recent events.</div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {recentUiEvents.map((event) => (
                            <div key={event.id} className="text-xs">
                              <div
                                className={
                                  event.level === "error" ? "text-destructive" : "text-foreground"
                                }
                              >
                                {event.message}
                              </div>
                              {event.detail ? (
                                <div className="text-muted-foreground break-all">{event.detail}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </PopoverContent>
              </Popover>
              <div className="h-6 w-px bg-border/60 mx-1" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleSetFullscreen(!isFullscreen)}
                data-testid="button-fullscreen"
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-testid="button-docs"
                onClick={handleOpenDocs}
              >
                <BookOpen className="w-4 h-4" />
              </Button>
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden min-h-0">
            <div className="relative flex-1 min-h-0">
              <MetricsChart
                data={chartData}
                selectedMetrics={activeMetrics}
                currentTick={playbackState.currentTick}
                windowStart={windowStart}
                windowEnd={windowEnd}
                resetViewVersion={resetViewVersion}
                isAutoScroll={isAutoScroll}
                annotations={annotations}
                subtitles={subtitles}
                captures={captures}
                highlightedMetricKey={highlightedMetricKey}
                yPrimaryDomain={manualYPrimaryDomain}
                ySecondaryDomain={hasSecondaryAxis ? manualYSecondaryDomain : null}
                onYPrimaryDomainChange={setManualYPrimaryDomain}
                onYSecondaryDomainChange={setManualYSecondaryDomain}
                onDomainChange={handleChartDomainChange}
                onWindowRangeChange={handleWindowRangeChange}
                onSizeChange={(size) => {
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
                }}
                onAddAnnotation={handleAddAnnotation}
                onRemoveAnnotation={handleRemoveAnnotation}
              />
              <MetricsHUD
                currentData={currentData}
                selectedMetrics={activeMetrics}
                currentTick={playbackState.currentTick}
                captures={captures}
                isVisible={isHudVisible}
                analysisKeys={analysisKeys}
                onToggleAnalysisMetric={handleToggleAnalysisMetric}
                onToggleMetricAxis={handleToggleMetricAxis}
                isMetricOnSecondaryAxis={isMetricOnSecondaryAxis}
                onDeselectMetric={handleDeselectMetric}
                onHoverMetric={setHighlightedMetricKey}
                highlightedMetricKey={highlightedMetricKey}
              />
            </div>

            <div className="shrink-0">
              <PlaybackControls
                playbackState={playbackState}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
                onSeek={handleSeek}
                onSpeedChange={handleSpeedChange}
                onStepForward={handleStepForward}
                onStepBackward={handleStepBackward}
                currentTime=""
                disabled={captures.length === 0}
                seekDisabled={isWindowed}
              />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
