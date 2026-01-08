import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileUpload } from "@/components/file-upload";
import { ComponentTree } from "@/components/component-tree";
import { PlaybackControls } from "@/components/playback-controls";
import { MetricsChart } from "@/components/metrics-chart";
import { MetricsHUD } from "@/components/metrics-hud";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
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
      const incomingComponents = Array.isArray(data.components)
        ? (data.components as ComponentNode[])
        : parseComponentTree(data.records);
      const newCapture: CaptureSession = {
        id: generateId(),
        filename: data.filename,
        fileSize: data.size,
        tickCount: data.tickCount,
        records: data.records,
        components: incomingComponents,
        isActive: true,
      };

      const captureStats = createEmptyCaptureStats();
      newCapture.records.forEach((record: CaptureRecord) => {
        appendRecordStats(captureStats, record);
      });
      captureStats.componentNodes = countComponentNodes(newCapture.components);
      captureStatsRef.current.set(newCapture.id, captureStats);
      
      setCaptures(prev => [...prev, newCapture]);
      setUploadError(null);
      
      const newMaxTicks = Math.max(
        ...captures.filter(c => c.isActive).map(c => c.tickCount),
        newCapture.tickCount
      );
      
      setPlaybackState(prev => ({
        ...prev,
        totalTicks: newMaxTicks,
        currentTick: prev.currentTick || 1,
      }));
    },
    onError: (error: Error) => {
      setUploadError(error.message);
    },
  });

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
    [uploadMutation]
  );

  const handleClearError = useCallback(() => {
    setUploadError(null);
  }, []);

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
    onToggleCapture: handleToggleCapture,
    onSelectMetric: handleSelectMetric,
    onDeselectMetric: handleDeselectMetric,
    onClearSelection: handleClearSelection,
    onPlay: handlePlay,
    onPause: handlePause,
    onStop: handleStop,
    onSeek: handleSeek,
    onSpeedChange: handleSpeedChange,
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
              <SidebarGroupLabel>Captures</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="flex flex-col gap-1 px-2">
                  <FileUpload
                    onFileUpload={handleFileUpload}
                    isUploading={uploadMutation.isPending}
                    uploadedFile={null}
                    error={uploadError}
                    onClear={handleClearError}
                  />
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
