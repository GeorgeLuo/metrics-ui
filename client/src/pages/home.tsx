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
import { Activity, X, FileText, Trash2 } from "lucide-react";
import type {
  ComponentNode,
  SelectedMetric,
  PlaybackState,
  DataPoint,
  CaptureRecord,
  CaptureSession,
} from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

const INITIAL_WINDOW_SIZE = 50;

const GRAYSCALE_COLORS = [
  "hsl(0, 0%, 20%)",
  "hsl(0, 0%, 40%)",
  "hsl(0, 0%, 55%)",
  "hsl(0, 0%, 70%)",
  "hsl(0, 0%, 35%)",
  "hsl(0, 0%, 50%)",
  "hsl(0, 0%, 65%)",
  "hsl(0, 0%, 25%)",
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function parseComponentTree(records: CaptureRecord[]): ComponentNode[] {
  if (records.length === 0) return [];

  const firstRecord = records[0];
  const nodes: ComponentNode[] = [];

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

  const valueTree = buildTree(firstRecord.value as Record<string, unknown>, [], "");
  nodes.push({
    id: firstRecord.componentId,
    label: firstRecord.componentId,
    path: [firstRecord.componentId],
    children: valueTree,
    isLeaf: false,
    valueType: "object",
  });

  return nodes;
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
        let value: unknown = record.value;

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

  const playbackRef = useRef<number | null>(null);

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
      const newCapture: CaptureSession = {
        id: generateId(),
        filename: data.filename,
        fileSize: data.size,
        tickCount: data.tickCount,
        records: data.records,
        components: parseComponentTree(data.records),
        isActive: true,
      };
      
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

  const activeMetrics = selectedMetrics.filter(m => 
    captures.some(c => c.id === m.captureId && c.isActive)
  );

  const chartData = extractDataPoints(captures, activeMetrics);

  const currentData = chartData.find((d) => d.tick === playbackState.currentTick) || null;

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
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
            <FileUpload
              onFileUpload={handleFileUpload}
              isUploading={uploadMutation.isPending}
              uploadedFile={null}
              error={uploadError}
              onClear={handleClearError}
            />

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
