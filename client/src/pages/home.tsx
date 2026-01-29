import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileUpload } from "@/components/file-upload";
import { ComponentTree } from "@/components/component-tree";
import { PlaybackControls } from "@/components/playback-controls";
import { MetricsChart } from "@/components/metrics-chart";
import { MetricsHUD } from "@/components/metrics-hud";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Trash2,
  BookOpen,
  Eye,
  EyeOff,
  RefreshCw,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Link } from "wouter";
import type {
  Annotation,
  SubtitleOverlay,
  ComponentNode,
  SelectedMetric,
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
import { compactRecord } from "@shared/compact";
import {
  buildComponentTreeFromEntities,
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

const INITIAL_WINDOW_SIZE = 50;
const DEFAULT_POLL_SECONDS = 2;
const EMPTY_METRICS: SelectedMetric[] = [];
const APPEND_FLUSH_MS = 100;
const FULLSCREEN_RESIZE_DELAY = 0;

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

type LiveStreamStatus = "idle" | "connecting" | "retrying" | "connected";

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
}

interface LiveStatusStream {
  captureId?: unknown;
  source?: unknown;
  pollIntervalMs?: unknown;
  lastError?: unknown;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}


function parseComponentTree(records: CaptureRecord[]): ComponentNode[] {
  if (records.length === 0) return [];

  const firstRecord =
    records.find((record) => record.entities && Object.keys(record.entities).length > 0) ??
    records[0];
  if (!firstRecord) {
    return [];
  }

  return buildComponentTreeFromEntities(firstRecord.entities || {});
}

function sanitizeKey(key: string): string {
  return key.replace(/\./g, "_");
}

function buildSeriesKey(captureId: string, fullPath: string): string {
  return `${captureId}::${fullPath}`;
}

function getValueAtPath(source: Record<string, unknown>, path: string[]): unknown {
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

function setValueAtPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let current: Record<string, unknown> = target;
  path.forEach((part, index) => {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
}

function buildEntitiesForMetrics(
  entities: Record<string, unknown>,
  metrics: SelectedMetric[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  metrics.forEach((metric) => {
    const value = getValueAtPath(entities, metric.path);
    if (value === undefined) {
      return;
    }
    setValueAtPath(result, metric.path, value);
  });
  return result as Record<string, Record<string, unknown>>;
}

function deleteValueAtPath(target: Record<string, unknown>, path: string[]) {
  if (path.length === 0) {
    return;
  }
  const parents: Array<{ node: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    parents.push({ node: current, key: part });
    current = next as Record<string, unknown>;
  }
  delete current[path[path.length - 1]];
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const { node, key } = parents[i];
    const value = node[key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      delete node[key];
    } else {
      break;
    }
  }
}

interface MetricCoverageEntry {
  numericCount: number;
  total: number;
  lastTick: number | null;
}

type MetricCoverageByCapture = Record<string, Record<string, MetricCoverageEntry>>;

function extractDataPoints(
  captures: CaptureSession[],
  selectedMetrics: SelectedMetric[]
): { data: DataPoint[]; coverage: MetricCoverageByCapture } {
  const tickMap = new Map<number, DataPoint>();
  const coverage: MetricCoverageByCapture = {};

  const activeCaptures = captures.filter(c => c.isActive);
  
  activeCaptures.forEach(capture => {
    const captureMetrics = selectedMetrics.filter(m => m.captureId === capture.id);
    if (captureMetrics.length === 0) {
      return;
    }
    if (!coverage[capture.id]) {
      coverage[capture.id] = {};
    }
    const captureCoverage = coverage[capture.id];
    const totalFrames = capture.records.length;
    captureMetrics.forEach(metric => {
      captureCoverage[metric.fullPath] = {
        numericCount: 0,
        total: totalFrames,
        lastTick: null,
      };
    });
    
    capture.records.forEach(record => {
      if (!tickMap.has(record.tick)) {
        tickMap.set(record.tick, { tick: record.tick });
      }
      
      const point = tickMap.get(record.tick)!;
      
      captureMetrics.forEach(metric => {
        const pathParts = metric.path;
        let value: unknown = record.entities;

        for (const part of pathParts) {
          if (value && typeof value === "object" && part in value) {
            value = (value as Record<string, unknown>)[part];
          } else {
            value = null;
            break;
          }
        }

        const dataKey = `${capture.id}_${sanitizeKey(metric.fullPath)}`;
        if (typeof value === "number") {
          point[dataKey] = value;
          const metricCoverage = captureCoverage[metric.fullPath];
          if (metricCoverage) {
            metricCoverage.numericCount += 1;
            metricCoverage.lastTick = record.tick;
          }
        } else {
          point[dataKey] = null;
        }
      });
    });
  });

  return {
    data: Array.from(tickMap.values()).sort((a, b) => a.tick - b.tick),
    coverage,
  };
}

export default function Home() {
  const [captures, setCaptures] = useState<CaptureSession[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<SelectedMetric[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    const stored = window.localStorage.getItem("metrics-ui-selected-metrics");
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (metric) =>
          metric &&
          typeof metric.captureId === "string" &&
          Array.isArray(metric.path) &&
          typeof metric.fullPath === "string" &&
          typeof metric.label === "string" &&
          typeof metric.color === "string",
      ) as SelectedMetric[];
    } catch {
      return [];
    }
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"file" | "live">(() => {
    if (typeof window === "undefined") {
      return "file";
    }
    return window.localStorage.getItem("metrics-ui-source-mode") === "live"
      ? "live"
      : "file";
  });
  const [liveStreams, setLiveStreams] = useState<LiveStreamEntry[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const stored = window.localStorage.getItem("metrics-ui-live-streams");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hydrated = parsed
            .map((entry) => ({
              id: typeof entry?.id === "string" ? entry.id : generateId(),
              source: typeof entry?.source === "string" ? entry.source : "",
              pollSeconds:
                Number.isFinite(Number(entry?.pollSeconds)) && Number(entry?.pollSeconds) > 0
                  ? Number(entry.pollSeconds)
                  : DEFAULT_POLL_SECONDS,
              status: "idle" as LiveStreamStatus,
              error: null,
            }))
            .filter((entry) => entry.source.trim().length > 0);

          if (hydrated.length > 0) {
            return hydrated;
          }
        }
      } catch {
        // ignore invalid stored state
      }
    }

    return [];
  });

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTick: 1,
    speed: 1,
    totalTicks: 0,
  });

  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW_SIZE);
  const [windowStart, setWindowStart] = useState(1);
  const [windowEnd, setWindowEnd] = useState(INITIAL_WINDOW_SIZE);
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

  const playbackRef = useRef<number | null>(null);
  const liveStreamsRef = useRef(liveStreams);
  const selectedMetricsRef = useRef(selectedMetrics);
  const liveMetaRef = useRef(new Map<string, LiveStreamMeta>());
  const didInitialLiveConnectRef = useRef(false);
  const attemptConnectRef = useRef<(
    id: string,
    options?: { force?: boolean; showConnecting?: boolean },
  ) => void>(
    () => {},
  );
  const pendingAppendsRef = useRef(new Map<string, CaptureRecord[]>());
  const appendFlushTimerRef = useRef<number | null>(null);
  const captureStatsRef = useRef<Map<string, CaptureStats>>(new Map());
  const pendingSeriesRef = useRef(new Set<string>());
  const loadedSeriesRef = useRef(new Set<string>());
  const baselineHeapRef = useRef<number | null>(null);
  const sendMessageRef = useRef<(message: ControlResponse | ControlCommand) => boolean>(() => false);
  const selectionHandlersRef = useRef(new Map<string, (metrics: SelectedMetric[]) => void>());
  const activeCaptureIdsRef = useRef(new Set<string>());

  const activeCaptures = useMemo(() => captures.filter((capture) => capture.isActive), [captures]);
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
        return [...otherMetrics, ...newMetrics];
      });
    };
    selectionHandlersRef.current.set(captureId, handler);
    return handler;
  }, []);

  useEffect(() => {
    const activeIds = new Set(captures.map((capture) => capture.id));
    selectionHandlersRef.current.forEach((_handler, id) => {
      if (!activeIds.has(id)) {
        selectionHandlersRef.current.delete(id);
      }
    });
  }, [captures]);

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

  const fetchMetricSeries = useCallback(
    async (metric: SelectedMetric) => {
      const key = buildSeriesKey(metric.captureId, metric.fullPath);
      if (pendingSeriesRef.current.has(key)) {
        return;
      }
      pendingSeriesRef.current.add(key);
      try {
        const response = await fetch("/api/series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureId: metric.captureId, path: metric.path }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Failed to load series.");
        }
        const points = Array.isArray(data?.points)
          ? (data.points as Array<{ tick: number; value: number | null }>)
          : [];
        mergeSeriesIntoCaptures(metric.captureId, metric.path, points);
        loadedSeriesRef.current.add(key);
      } catch (error) {
        console.error("[series] Fetch error:", error);
      } finally {
        pendingSeriesRef.current.delete(key);
      }
    },
    [mergeSeriesIntoCaptures],
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

  useEffect(() => {
    liveStreamsRef.current = liveStreams;
  }, [liveStreams]);

  useEffect(() => {
    activeCaptureIdsRef.current = new Set(
      captures.filter((capture) => capture.isActive).map((capture) => capture.id),
    );
  }, [captures]);

  useEffect(() => {
    selectedMetricsRef.current = selectedMetrics;
  }, [selectedMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "metrics-ui-selected-metrics",
      JSON.stringify(selectedMetrics),
    );
  }, [selectedMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const payload = liveStreams
      .filter((entry) => entry.source.trim().length > 0)
      .map((entry) => ({
        id: entry.id,
        source: entry.source,
        pollSeconds: entry.pollSeconds,
      }));
    window.localStorage.setItem("metrics-ui-live-streams", JSON.stringify(payload));
  }, [liveStreams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("metrics-ui-source-mode", sourceMode);
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
    };
    liveMetaRef.current.set(id, meta);
    return meta;
  }, []);

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
    updateBaselineHeap();
  }, [updateBaselineHeap]);

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
    [clearLiveRetry, updateLiveStream],
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
    }
  }, []);

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
    async (id: string, options?: { force?: boolean; showConnecting?: boolean }) => {
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

  const handleLiveRefresh = useCallback(
    (id: string) => {
      if (sourceMode !== "live") {
        return;
      }
      attemptConnectRef.current(id, { force: true, showConnecting: true });
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
    if (didInitialLiveConnectRef.current) {
      return;
    }
    didInitialLiveConnectRef.current = true;
    if (sourceMode !== "live") {
      return;
    }
    liveStreamsRef.current.forEach((entry) => {
      if (entry.source.trim()) {
        attemptConnectRef.current(entry.id, { force: true });
      }
    });
  }, []);

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
    (captureId: string, filename?: string, options?: { reset?: boolean }) => {
      const isReset = Boolean(options?.reset);
      let shouldFetch = true;
      let shouldClear = true;

      setCaptures((prev) => {
        const fallbackName = `${captureId}.jsonl`;
        const existing = prev.find((capture) => capture.id === captureId);
        if (!existing) {
          shouldClear = true;
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
              }
            : capture,
        );
      });

      if (shouldClear) {
        captureStatsRef.current.set(captureId, createEmptyCaptureStats());
        Array.from(loadedSeriesRef.current.keys()).forEach((key) => {
          if (key.startsWith(`${captureId}::`)) {
            loadedSeriesRef.current.delete(key);
            pendingSeriesRef.current.delete(key);
          }
        });
      }

      if (!shouldFetch) {
        return;
      }
      const selectedForCapture = selectedMetricsRef.current.filter(
        (metric) => metric.captureId === captureId,
      );
      selectedForCapture.forEach((metric) => {
        fetchMetricSeries(metric);
      });
    },
    [fetchMetricSeries],
  );

  const handleCaptureComponents = useCallback((captureId: string, components: ComponentNode[]) => {
    if (!components || components.length === 0) {
      return;
    }
    setCaptures((prev) => {
      const existing = prev.find((capture) => capture.id === captureId);
      const fallbackName = `${captureId}.jsonl`;
      if (!existing) {
        const stats = createEmptyCaptureStats();
        stats.componentNodes = countComponentNodes(components);
        captureStatsRef.current.set(captureId, stats);
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

      const mergedComponents =
        existing.components.length > 0
          ? mergeComponentTrees(existing.components, components)
          : components;
      const stats = captureStatsRef.current.get(captureId) ?? createEmptyCaptureStats();
      stats.componentNodes = countComponentNodes(mergedComponents);
      captureStatsRef.current.set(captureId, stats);

      return prev.map((capture) =>
        capture.id === captureId
          ? { ...capture, components: mergedComponents }
          : capture,
      );
    });
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
        const shouldAppend = metricsForCapture.length > 0;
        const newRecords: CaptureRecord[] = [];
        let lastTick: number | null = null;

        frames.forEach((frame) => {
          lastTick = frame.tick;
          if (!shouldAppend) {
            return;
          }
          const filteredEntities = buildEntitiesForMetrics(
            (frame.entities || {}) as Record<string, unknown>,
            metricsForCapture,
          );
          const compactedFrame = compactRecord({ tick: frame.tick, entities: filteredEntities });
          newRecords.push(compactedFrame);
        });

        const existingIndex = indexById.get(captureId);
        const nextTickCount = lastTick ?? 0;
        if (existingIndex === undefined) {
          const fallbackName = `${captureId}.jsonl`;
          const createdRecords = shouldAppend ? newRecords : [];
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
          updatedRecords = existing.records.concat(newRecords);
          newRecords.forEach((record) => appendRecordStats(stats, record));
        } else {
          stats.tickCount = Math.max(stats.tickCount, updatedTickCount);
        }
        stats.componentNodes = countComponentNodes(existing.components);
        captureStatsRef.current.set(captureId, stats);

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
      }
    };
  }, []);

  const handleCaptureAppend = useCallback((captureId: string, frame: CaptureRecord) => {
    if (!activeCaptureIdsRef.current.has(captureId)) {
      return;
    }

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
  }, [flushPendingAppends]);

  const handleCaptureEnd = useCallback(
    (captureId: string) => {
      clearLiveRetry(captureId);
      setLiveStreams((prev) =>
        prev.map((entry) =>
          entry.id === captureId ? { ...entry, status: "idle", error: null } : entry,
        ),
      );
    },
    [clearLiveRetry],
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
    selectedForCapture.forEach((metric) => {
      fetchMetricSeries(metric);
    });
  }, [captures, fetchMetricSeries]);

  const handleRemoveCapture = useCallback((captureId: string) => {
    setCaptures(prev => prev.filter(c => c.id !== captureId));
    setSelectedMetrics(prev => prev.filter(m => m.captureId !== captureId));
    captureStatsRef.current.delete(captureId);
    handleRemoveLiveStream(captureId);
    sendMessageRef.current({ type: "remove_capture", captureId });
  }, [handleRemoveLiveStream]);

  const handleSelectMetric = useCallback((captureId: string, path: string[]) => {
    const fullPath = path.join(".");
    const label = path[path.length - 1];
    setSelectedMetrics((prev) => {
      const exists = prev.some((metric) => metric.captureId === captureId && metric.fullPath === fullPath);
      if (exists) {
        return prev;
      }
      const colorIndex = prev.length % METRIC_COLORS.length;
      const newMetric: SelectedMetric = {
        captureId,
        path,
        fullPath,
        label,
        color: METRIC_COLORS[colorIndex],
      };
      return [...prev, newMetric];
    });
  }, []);

  const handleDeselectMetric = useCallback((captureId: string, fullPath: string) => {
    setSelectedMetrics(prev => prev.filter(m => !(m.captureId === captureId && m.fullPath === fullPath)));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedMetrics([]);
  }, []);

  const prevSelectedRef = useRef<SelectedMetric[]>([]);

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

    added.forEach((metric) => {
      const capture = captures.find((entry) => entry.id === metric.captureId);
      if (!capture || !capture.isActive) {
        return;
      }
      const key = buildSeriesKey(metric.captureId, metric.fullPath);
      if (!loadedSeriesRef.current.has(key)) {
        fetchMetricSeries(metric);
      }
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
        const remaining = remainingByCapture.get(metric.captureId);
        if (!remaining || remaining.length === 0) {
          clearCaptureRecords(metric.captureId);
          return;
        }
        removeMetricFromCaptures(metric.captureId, metric.path);
      });
    }

    prevSelectedRef.current = selectedMetrics;
  }, [clearCaptureRecords, fetchMetricSeries, removeMetricFromCaptures, selectedMetrics]);

  const handleClearCaptures = useCallback(() => {
    setCaptures([]);
    setSelectedMetrics([]);
    captureStatsRef.current.clear();
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
  }, []);

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
    const maxTick = Math.max(1, playbackState.totalTicks || 1);
    const clamped = Math.min(Math.max(1, Math.floor(tick)), maxTick);
    setPlaybackState((prev) => ({ ...prev, currentTick: clamped }));
  }, [playbackState.totalTicks]);

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
      const window = applyWindowRange(startTick, endTick);
      setWindowSize(Math.max(1, window.end - window.start + 1));
    },
    [applyWindowRange],
  );

  const handleResetWindow = useCallback(() => {
    const end = Math.max(1, playbackState.totalTicks || playbackState.currentTick);
    setIsAutoScroll(true);
    setPlaybackState((prev) => ({
      ...prev,
      currentTick: end,
    }));
    setWindowStart(1);
    setWindowEnd(end);
    setWindowSize(end);
  }, [playbackState.currentTick, playbackState.totalTicks]);

  const handleAutoScrollChange = useCallback(
    (enabled: boolean) => {
      setIsAutoScroll(Boolean(enabled));
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
      selectedMetrics.filter((metric) =>
        captures.some((capture) => capture.id === metric.captureId && capture.isActive),
      ),
    [selectedMetrics, captures],
  );

  const { data: chartData, coverage: metricCoverage } = useMemo(
    () => extractDataPoints(captures, activeMetrics),
    [captures, activeMetrics],
  );

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
    const captureStats = captures.map((capture) => {
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
      },
    );

    const componentTreeTotals = captureStats.reduce(
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
      heapDelta !== null && heapDelta > 0 && totals.objectProps > 0
        ? heapDelta / totals.objectProps
        : null;
    const bytesPerLeafValue =
      heapDelta !== null && heapDelta > 0 && totals.leafValues > 0
        ? heapDelta / totals.leafValues
        : null;
    const recordStoreBytes =
      bytesPerObjectProp !== null ? totals.objectProps * bytesPerObjectProp : null;
    const chartDataBytes =
      bytesPerObjectProp !== null
        ? chartDataStats.totalObjectProps * bytesPerObjectProp
        : null;

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
      },
      captures: captureStats,
      totals,
    };
  }, [captures, ensureCaptureStats, selectedMetrics, activeMetrics, chartData]);

  useEffect(() => {
    if (!playbackState.isPlaying) return;

    const interval = 1000 / playbackState.speed;
    let lastTime = performance.now();

    const tick = (currentTime: number) => {
      const delta = currentTime - lastTime;

      if (delta >= interval) {
        lastTime = currentTime;
        setPlaybackState((prev) => {
          if (prev.currentTick >= prev.totalTicks) {
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
  }, [playbackState.isPlaying, playbackState.speed]);

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
    playbackState,
    windowSize,
    windowStart,
    windowEnd,
    autoScroll: isAutoScroll,
    isFullscreen,
    viewport,
    annotations,
    subtitles,
    onSourceModeChange: handleSourceModeChange,
    onLiveSourceChange: handleLiveSourceCommand,
    onToggleCapture: handleToggleCapture,
    onRemoveCapture: handleRemoveCapture,
    onSelectMetric: handleSelectMetric,
    onDeselectMetric: handleDeselectMetric,
    onClearSelection: handleClearSelection,
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
    onAutoScrollChange: handleAutoScrollChange,
    onSetFullscreen: handleSetFullscreen,
    onLiveStart: startLiveStream,
    onLiveStop: stopLiveStream,
    onCaptureInit: handleCaptureInit,
    onCaptureComponents: handleCaptureComponents,
    onCaptureAppend: handleCaptureAppend,
    onCaptureEnd: handleCaptureEnd,
    onAddAnnotation: handleAddAnnotation,
    onRemoveAnnotation: handleRemoveAnnotation,
    onClearAnnotations: handleClearAnnotations,
    onJumpAnnotation: handleJumpAnnotation,
    onAddSubtitle: handleAddSubtitle,
    onRemoveSubtitle: handleRemoveSubtitle,
    onClearSubtitles: handleClearSubtitles,
    getMemoryStats: buildMemoryStats,
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

  const getCaptureShortName = (capture: CaptureSession): string => {
    const name = capture.filename.replace('.jsonl', '');
    return name.length > 12 ? name.substring(0, 12) + '...' : name;
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background">
        <Sidebar>
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-3">
              <Activity className="w-4 h-4 text-foreground" />
              <h1 className="text-sm font-medium tracking-tight">Metrics</h1>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Capture Source</SidebarGroupLabel>
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
                          const statusLabel = isConnected
                            ? `Connected (${entry.id})`
                            : isConnecting
                              ? "Connecting..."
                              : isRetrying
                                ? "Retrying..."
                                : "Idle";

                          return (
                            <div
                              key={entry.id}
                              className="rounded-md border border-border/50 p-2 flex flex-col gap-2"
                            >
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>Stream {index + 1}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleRemoveLiveStream(entry.id)}
                                  data-testid={`button-live-remove-${entry.id}`}
                                  aria-label={`Remove live stream ${index + 1}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
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
            </SidebarGroup>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleRemoveCapture(capture.id)}
                        data-testid={`button-remove-capture-${capture.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
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
            
            {activeCaptures.map((capture) => (
              <SidebarGroup key={capture.id}>
                <SidebarGroupLabel className="text-xs">
                  {getCaptureShortName(capture)}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <ComponentTree
                    captureId={capture.id}
                    components={capture.components}
                    selectedMetrics={selectedMetricsByCapture.get(capture.id) ?? EMPTY_METRICS}
                    metricCoverage={metricCoverage[capture.id]}
                    onSelectionChange={getSelectionHandler(capture.id)}
                    colorOffset={captures.findIndex(c => c.id === capture.id)}
                  />
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
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
                  onClick={() => setSelectedMetrics([])}
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
                onClick={() => handleSetFullscreen(!isFullscreen)}
                data-testid="button-fullscreen"
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleResetWindow}
                data-testid="button-reset-window"
                title="Show all ticks"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <div className="h-6 w-px bg-border/60 mx-1" />
              <Link href="/docs">
                <Button variant="ghost" size="icon" data-testid="button-docs">
                  <BookOpen className="w-4 h-4" />
                </Button>
              </Link>
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
                isAutoScroll={isAutoScroll}
                annotations={annotations}
                subtitles={subtitles}
                captures={captures}
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
                onDeselectMetric={handleDeselectMetric}
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
              />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
