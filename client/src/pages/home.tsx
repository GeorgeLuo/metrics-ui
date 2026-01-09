import { useState, useCallback, useRef, useEffect } from "react";
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
import { Activity, X, FileText, Trash2, BookOpen, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";
import type {
  ComponentNode,
  SelectedMetric,
  PlaybackState,
  DataPoint,
  CaptureRecord,
  CaptureSession,
  ControlResponse,
  MemoryStatsResponse,
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { useWebSocketControl } from "@/hooks/use-websocket-control";
import { compactRecord } from "@shared/compact";
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

interface LiveStatus {
  running: boolean;
  captureId: string | null;
  source: string;
  pollIntervalMs: number;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function buildTree(
  obj: Record<string, unknown>,
  parentPath: string[],
  parentId: string
): ComponentNode[] {
  const result: ComponentNode[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = [...parentPath, key];
    const id = parentId ? `${parentId}.${key}` : key;

    let valueType: ComponentNode["valueType"] = "null";
    let children: ComponentNode[] = [];

    if (value === null || value === undefined) {
      valueType = "null";
    } else if (typeof value === "number") {
      valueType = "number";
    } else if (typeof value === "string") {
      valueType = "string";
    } else if (typeof value === "boolean") {
      valueType = "boolean";
    } else if (Array.isArray(value)) {
      valueType = "array";
      if (value.length > 0 && typeof value[0] === "object") {
        children = buildTree(value[0] as Record<string, unknown>, path, id);
      }
    } else if (typeof value === "object") {
      valueType = "object";
      children = buildTree(value as Record<string, unknown>, path, id);
    }

    result.push({
      id,
      label: key,
      path,
      children,
      isLeaf: children.length === 0,
      valueType,
    });
  }

  return result;
}

function buildComponentTreeFromEntities(entities: Record<string, unknown>): ComponentNode[] {
  const nodes: ComponentNode[] = [];

  Object.entries(entities).forEach(([entityId, components]) => {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      return;
    }
    const componentTree = buildTree(components as Record<string, unknown>, [entityId], entityId);
    nodes.push({
      id: entityId,
      label: entityId,
      path: [entityId],
      children: componentTree,
      isLeaf: false,
      valueType: "object",
    });
  });

  return nodes;
}

function mergeValueType(
  existing: ComponentNode["valueType"],
  incoming: ComponentNode["valueType"],
) {
  if (incoming === "null" && existing !== "null") {
    return existing;
  }
  return incoming;
}

function mergeComponentTrees(existing: ComponentNode[], incoming: ComponentNode[]): ComponentNode[] {
  const existingMap = new Map(existing.map((node) => [node.id, node]));
  const merged: ComponentNode[] = [];

  incoming.forEach((node) => {
    const current = existingMap.get(node.id);
    existingMap.delete(node.id);
    if (!current) {
      merged.push(node);
      return;
    }
    const mergedChildren = mergeComponentTrees(current.children, node.children);
    merged.push({
      ...current,
      ...node,
      valueType: mergeValueType(current.valueType, node.valueType),
      children: mergedChildren,
      isLeaf: mergedChildren.length === 0,
    });
  });

  existingMap.forEach((node) => merged.push(node));
  return merged;
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

function extractDataPoints(
  captures: CaptureSession[],
  selectedMetrics: SelectedMetric[]
): DataPoint[] {
  const tickMap = new Map<number, DataPoint>();

  const activeCaptures = captures.filter(c => c.isActive);
  
  activeCaptures.forEach(capture => {
    const captureMetrics = selectedMetrics.filter(m => m.captureId === capture.id);
    
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
        point[dataKey] = typeof value === "number" ? value : null;
      });
    });
  });

  return Array.from(tickMap.values()).sort((a, b) => a.tick - b.tick);
}

export default function Home() {
  const [captures, setCaptures] = useState<CaptureSession[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<SelectedMetric[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"file" | "live">(() => {
    if (typeof window === "undefined") {
      return "file";
    }
    return window.localStorage.getItem("metrics-ui-source-mode") === "live"
      ? "live"
      : "file";
  });
  const [liveSource, setLiveSource] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem("metrics-ui-source") ?? "";
  });
  const [livePollSeconds, setLivePollSeconds] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 2;
    }
    const stored = window.localStorage.getItem("metrics-ui-live-poll-seconds");
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  });
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({
    running: false,
    captureId: null,
    source: "",
    pollIntervalMs: 2000,
  });
  const [isLiveRetrying, setIsLiveRetrying] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isLivePending, setIsLivePending] = useState(false);

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTick: 1,
    speed: 1,
    totalTicks: 0,
  });

  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW_SIZE);
  const [isAutoZoom, setIsAutoZoom] = useState(true);
  const [isHudVisible, setIsHudVisible] = useState(true);

  const playbackRef = useRef<number | null>(null);
  const liveRetryRef = useRef<{ timer: number | null; source: string | null }>({
    timer: null,
    source: null,
  });
  const liveSourceDirtyRef = useRef(false);
  const lastLiveSourceRef = useRef<string | null>(null);
  const captureProgressRef = useRef(
    new Map<string, { received: number; kept: number; dropped: number }>(),
  );
  const captureStatsRef = useRef<Map<string, CaptureStats>>(new Map());
  const baselineHeapRef = useRef<number | null>(null);
  const sendMessageRef = useRef<(message: ControlResponse) => boolean>(() => false);

  const activeCaptures = captures.filter(c => c.isActive);
  const maxTotalTicks = activeCaptures.length > 0 
    ? Math.max(...activeCaptures.map(c => c.tickCount)) 
    : 0;

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
      ingestCapturePayload(data);
      setUploadError(null);
    },
    onError: (error: Error) => {
      setUploadError(error.message);
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("metrics-ui-source", liveSource);
  }, [liveSource]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("metrics-ui-source-mode", sourceMode);
  }, [sourceMode]);

  const clearLiveRetry = useCallback(() => {
    if (liveRetryRef.current.timer !== null) {
      window.clearTimeout(liveRetryRef.current.timer);
      liveRetryRef.current.timer = null;
    }
    liveRetryRef.current.source = null;
    setIsLiveRetrying(false);
  }, []);

  useEffect(() => {
    return () => {
      clearLiveRetry();
    };
  }, [clearLiveRetry]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "metrics-ui-live-poll-seconds",
      String(livePollSeconds),
    );
  }, [livePollSeconds]);

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
        if (data.running) {
          setLiveStatus({
            running: true,
            captureId: data.captureId ?? null,
            source: data.source ?? "",
            pollIntervalMs: Number(data.pollIntervalMs) || 2000,
          });
          setSourceMode("live");
          if (data.source) {
            setLiveSource(data.source);
          }
          if (data.pollIntervalMs) {
            setLivePollSeconds(Math.max(0.5, data.pollIntervalMs / 1000));
          }
        }
      } catch (error) {
        console.warn("Failed to fetch live status:", error);
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    updateBaselineHeap();
  }, [updateBaselineHeap]);

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
      const source = (options?.source ?? liveSource).trim();
      if (!source) {
        setLiveError("Enter a capture file URL or path to start streaming.");
        throw new Error("Missing capture file source.");
      }
      const pollIntervalMs =
        options?.pollIntervalMs ?? Math.max(500, Math.round(livePollSeconds * 1000));
      setIsLivePending(true);
      setLiveError(null);
      try {
        const response = await fetch("/api/live/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            pollIntervalMs,
            captureId: options?.captureId,
            filename: options?.filename,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 409) {
            try {
              const statusResponse = await fetch("/api/live/status");
              const statusData = await statusResponse.json().catch(() => ({}));
              if (statusResponse.ok && statusData?.running) {
                setLiveStatus({
                  running: true,
                  captureId: statusData.captureId ?? null,
                  source: statusData.source ?? source,
                  pollIntervalMs:
                    Number(statusData.pollIntervalMs) || pollIntervalMs,
                });
                if (statusData.source) {
                  setLiveSource(statusData.source);
                }
                setSourceMode("live");
                setLiveError(null);
                return;
              }
            } catch {
              // fall through to error
            }
          }
          throw new Error(data?.error || "Failed to start live stream.");
        }
        setLiveSource(source);
        setLiveStatus({
          running: true,
          captureId: data.captureId ?? options?.captureId ?? null,
          source,
          pollIntervalMs: Number(data.pollIntervalMs) || pollIntervalMs,
        });
        setSourceMode("live");
      } catch (error) {
        setLiveError(error instanceof Error ? error.message : "Failed to start live stream.");
        throw error;
      } finally {
        setIsLivePending(false);
      }
    },
    [liveSource, livePollSeconds],
  );

  const stopLiveStream = useCallback(async () => {
    setIsLivePending(true);
    setLiveError(null);
    try {
      const response = await fetch("/api/live/stop", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to stop live stream.");
      }
      setLiveStatus((prev) => ({
        running: false,
        captureId: null,
        source: prev.source || liveSource,
        pollIntervalMs: prev.pollIntervalMs || Math.round(livePollSeconds * 1000),
      }));
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "Failed to stop live stream.");
      throw error;
    } finally {
      setIsLivePending(false);
    }
  }, [liveSource, livePollSeconds]);

  const handleClearUploadError = useCallback(() => {
    setUploadError(null);
  }, []);

  const handleSourceModeChange = useCallback((mode: "file" | "live") => {
    setSourceMode(mode);
    liveSourceDirtyRef.current = false;
    if (mode === "live") {
      setUploadError(null);
    } else {
      setLiveError(null);
    }
  }, []);

  const handleLiveSourceChange = useCallback((source: string) => {
    setLiveSource(source);
    setLiveError(null);
    if (sourceMode === "live") {
      liveSourceDirtyRef.current = true;
    }
  }, [sourceMode]);

  useEffect(() => {
    const trimmed = liveSource.trim();
    const previousSource = lastLiveSourceRef.current;
    const sourceChanged = previousSource !== null && trimmed !== previousSource;
    const shouldAttemptConnect = sourceChanged && liveSourceDirtyRef.current;

    const scheduleRetry = (source: string) => {
      if (liveRetryRef.current.timer !== null) {
        return;
      }
      liveRetryRef.current.source = source;
      setIsLiveRetrying(true);
      liveRetryRef.current.timer = window.setTimeout(() => {
        liveRetryRef.current.timer = null;
        if (sourceMode !== "live") {
          return;
        }
        if (liveSource.trim() !== source) {
          return;
        }
        attemptConnect(source);
      }, 3000);
    };

    const checkSource = async (source: string) => {
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
    };

    const attemptConnect = async (source: string) => {
      if (sourceMode !== "live" || !source) {
        return;
      }
      if (isLivePending) {
        scheduleRetry(source);
        return;
      }
      if (liveStatus.running && liveStatus.source === source) {
        clearLiveRetry();
        return;
      }
      try {
        const isAvailable = await checkSource(source);
        if (!isAvailable) {
          scheduleRetry(source);
          return;
        }
        await startLiveStream({ source });
        clearLiveRetry();
      } catch {
        scheduleRetry(source);
      }
    };

    if (sourceMode !== "live") {
      clearLiveRetry();
      liveSourceDirtyRef.current = false;
      lastLiveSourceRef.current = trimmed;
      return;
    }

    if (!trimmed) {
      clearLiveRetry();
      liveSourceDirtyRef.current = false;
      if (liveStatus.running && !isLivePending) {
        stopLiveStream().catch(() => {});
      }
      lastLiveSourceRef.current = trimmed;
      return;
    }

    if (liveRetryRef.current.source && liveRetryRef.current.source !== trimmed) {
      clearLiveRetry();
    }

    if (liveStatus.running) {
      if (
        shouldAttemptConnect &&
        liveStatus.source &&
        liveStatus.source !== trimmed &&
        !isLivePending
      ) {
        stopLiveStream()
          .then(() => {
            liveSourceDirtyRef.current = false;
            attemptConnect(trimmed);
          })
          .catch(() => scheduleRetry(trimmed));
      } else {
        clearLiveRetry();
      }
      lastLiveSourceRef.current = trimmed;
      return;
    }

    if (liveRetryRef.current.timer !== null) {
      lastLiveSourceRef.current = trimmed;
      return;
    }

    if (shouldAttemptConnect) {
      liveSourceDirtyRef.current = false;
      attemptConnect(trimmed);
    }
    lastLiveSourceRef.current = trimmed;
  }, [
    liveSource,
    sourceMode,
    liveStatus.running,
    liveStatus.source,
    isLiveRetrying,
    isLivePending,
    startLiveStream,
    stopLiveStream,
    clearLiveRetry,
  ]);

  const handleCaptureInit = useCallback((captureId: string, filename?: string) => {
    captureProgressRef.current.set(captureId, { received: 0, kept: 0, dropped: 0 });
    captureStatsRef.current.set(captureId, createEmptyCaptureStats());
    sendMessageRef.current({
      type: "capture_progress",
      payload: { captureId, received: 0, kept: 0, dropped: 0, lastTick: null },
    });

    setCaptures((prev) => {
      const fallbackName = `${captureId}.jsonl`;
      const incoming: CaptureSession = {
        id: captureId,
        filename: filename || fallbackName,
        fileSize: 0,
        tickCount: 0,
        records: [],
        components: [],
        isActive: true,
      };

      const existing = prev.find((capture) => capture.id === captureId);
      if (!existing) {
        return [...prev, incoming];
      }

      return prev.map((capture) =>
        capture.id === captureId
          ? { ...incoming, filename: filename || existing.filename }
          : capture,
      );
    });

    setSelectedMetrics((prev) => prev.filter((metric) => metric.captureId !== captureId));
  }, []);

  const handleCaptureAppend = useCallback((captureId: string, frame: CaptureRecord) => {
    const compactedFrame = compactRecord(frame);
    const progress = captureProgressRef.current.get(captureId) ?? {
      received: 0,
      kept: 0,
      dropped: 0,
    };
    progress.received += 1;
    const hasData = Object.keys(compactedFrame.entities || {}).length > 0;
    if (hasData) {
      progress.kept += 1;
    } else {
      progress.dropped += 1;
    }
    captureProgressRef.current.set(captureId, progress);
    sendMessageRef.current({
      type: "capture_progress",
      payload: {
        captureId,
        received: progress.received,
        kept: progress.kept,
        dropped: progress.dropped,
        lastTick: compactedFrame.tick,
      },
    });

    setCaptures((prev) => {
      const existing = prev.find((capture) => capture.id === captureId);
      const incomingComponents = buildComponentTreeFromEntities(frame.entities || {});
      const stats = captureStatsRef.current.get(captureId) ?? createEmptyCaptureStats();
      appendRecordStats(stats, compactedFrame);

      if (!existing) {
        const fallbackName = `${captureId}.jsonl`;
        stats.componentNodes = countComponentNodes(incomingComponents);
        captureStatsRef.current.set(captureId, stats);
        return [
          ...prev,
          {
            id: captureId,
            filename: fallbackName,
            fileSize: 0,
            tickCount: compactedFrame.tick,
            records: [compactedFrame],
            components: incomingComponents,
            isActive: true,
          },
        ];
      }

      const mergedComponents =
        existing.components.length > 0
          ? mergeComponentTrees(existing.components, incomingComponents)
          : incomingComponents;
      const nextTickCount = Math.max(existing.tickCount, compactedFrame.tick);
      stats.componentNodes = countComponentNodes(mergedComponents);
      captureStatsRef.current.set(captureId, stats);

      return prev.map((capture) =>
        capture.id === captureId
          ? {
              ...capture,
              records: [...capture.records, compactedFrame],
              components: mergedComponents,
              tickCount: nextTickCount,
              isActive: true,
            }
          : capture,
      );
    });
  }, []);

  const handleCaptureEnd = useCallback((captureId: string) => {
    setCaptures((prev) =>
      prev.map((capture) =>
        capture.id === captureId ? { ...capture, isActive: true } : capture,
      ),
    );
    setLiveStatus((prev) => {
      if (prev.running && prev.captureId === captureId) {
        return { ...prev, running: false, captureId: null };
      }
      return prev;
    });
  }, []);

  const handleToggleCapture = useCallback((captureId: string) => {
    setCaptures(prev => {
      const updated = prev.map(c => 
        c.id === captureId ? { ...c, isActive: !c.isActive } : c
      );
      const newActiveCaptures = updated.filter(c => c.isActive);
      const newMaxTicks = newActiveCaptures.length > 0 
        ? Math.max(...newActiveCaptures.map(c => c.tickCount)) 
        : 0;
      
      setPlaybackState(ps => ({
        ...ps,
        totalTicks: newMaxTicks,
        currentTick: Math.min(ps.currentTick, newMaxTicks || 1),
      }));
      
      return updated;
    });
    
    setSelectedMetrics(prev => {
      const capture = captures.find(c => c.id === captureId);
      if (capture && capture.isActive) {
        return prev.filter(m => m.captureId !== captureId);
      }
      return prev;
    });
  }, [captures]);

  const handleRemoveCapture = useCallback((captureId: string) => {
    setCaptures(prev => prev.filter(c => c.id !== captureId));
    setSelectedMetrics(prev => prev.filter(m => m.captureId !== captureId));
    captureStatsRef.current.delete(captureId);
  }, []);

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

  const handlePlay = useCallback(() => {
    setPlaybackState((prev) => ({ ...prev, isPlaying: true }));
  }, []);

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
    setPlaybackState((prev) => ({ ...prev, currentTick: tick }));
  }, []);

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackState((prev) => ({ ...prev, speed }));
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

  const handleZoomIn = useCallback(() => {
    setWindowSize((prev) => Math.max(10, Math.floor(prev / 2)));
    setIsAutoZoom(false);
  }, []);

  const handleZoomOut = useCallback(() => {
    setWindowSize((prev) => Math.min(playbackState.totalTicks, prev * 2));
    setIsAutoZoom(false);
  }, [playbackState.totalTicks]);

  const handleResetZoom = useCallback(() => {
    setWindowSize(INITIAL_WINDOW_SIZE);
    setIsAutoZoom(true);
  }, []);

  const activeMetrics = selectedMetrics.filter(
    (metric) => captures.some((capture) => capture.id === metric.captureId && capture.isActive),
  );

  const chartData = extractDataPoints(captures, activeMetrics);

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

  useEffect(() => {
    if (isAutoZoom && playbackState.currentTick > windowSize) {
      setWindowSize(playbackState.currentTick);
    }
  }, [playbackState.currentTick, isAutoZoom, windowSize]);

  const { sendMessage } = useWebSocketControl({
    captures,
    selectedMetrics,
    playbackState,
    windowSize,
    onSourceModeChange: handleSourceModeChange,
    onLiveSourceChange: handleLiveSourceChange,
    onToggleCapture: handleToggleCapture,
    onSelectMetric: handleSelectMetric,
    onDeselectMetric: handleDeselectMetric,
    onClearSelection: handleClearSelection,
    onPlay: handlePlay,
    onPause: handlePause,
    onStop: handleStop,
    onSeek: handleSeek,
    onSpeedChange: handleSpeedChange,
    onLiveStart: startLiveStream,
    onLiveStop: stopLiveStream,
    onCaptureInit: handleCaptureInit,
    onCaptureAppend: handleCaptureAppend,
    onCaptureEnd: handleCaptureEnd,
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
                        <Input
                          placeholder="Capture file URL or path"
                          value={liveSource}
                          onChange={(event) => {
                            handleLiveSourceChange(event.target.value);
                          }}
                          className="h-8 text-xs"
                          aria-label="Capture file source"
                        />
                        <Input
                          type="number"
                          min={0.5}
                          step={0.5}
                          placeholder="Poll interval (seconds)"
                          value={String(livePollSeconds)}
                          onChange={(event) => {
                            const parsed = Number(event.target.value);
                            if (Number.isFinite(parsed) && parsed > 0) {
                              setLivePollSeconds(parsed);
                            }
                          }}
                          className="h-8 text-xs"
                          disabled={liveStatus.running}
                          aria-label="Poll interval seconds"
                        />
                        <div className="text-xs text-muted-foreground">
                          {liveStatus.running
                            ? `Connected (${liveStatus.captureId ?? "live"})`
                            : isLivePending
                              ? "Connecting..."
                              : isLiveRetrying
                                ? "Retrying..."
                                : "Idle"}
                        </div>
                        {livePollSeconds > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            Polling every {livePollSeconds.toLocaleString()}s
                          </div>
                        )}
                        {liveError && (
                          <div className="text-xs text-destructive">{liveError}</div>
                        )}
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
                    selectedMetrics={selectedMetrics.filter(m => m.captureId === capture.id)}
                    onSelectionChange={(newMetrics) => {
                      setSelectedMetrics(prev => {
                        const otherMetrics = prev.filter(m => m.captureId !== capture.id);
                        return [...otherMetrics, ...newMetrics];
                      });
                    }}
                    colorOffset={captures.findIndex(c => c.id === capture.id)}
                  />
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-col flex-1 min-w-0">
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
              <Link href="/docs">
                <Button variant="ghost" size="icon" data-testid="button-docs">
                  <BookOpen className="w-4 h-4" />
                </Button>
              </Link>
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
            <div className="relative flex-1 min-h-0">
              <MetricsChart
                data={chartData}
                selectedMetrics={activeMetrics}
                currentTick={playbackState.currentTick}
                windowSize={windowSize}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onResetZoom={handleResetZoom}
                isAutoZoom={isAutoZoom}
                captures={captures}
              />
              <MetricsHUD
                currentData={currentData}
                selectedMetrics={activeMetrics}
                currentTick={playbackState.currentTick}
                captures={captures}
                isVisible={isHudVisible}
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
