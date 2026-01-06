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
import { Activity, LayoutDashboard, X } from "lucide-react";
import type {
  ComponentNode,
  SelectedMetric,
  PlaybackState,
  DataPoint,
  CaptureRecord,
} from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

const INITIAL_WINDOW_SIZE = 50;

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
  records: CaptureRecord[],
  selectedMetrics: SelectedMetric[]
): DataPoint[] {
  return records.map((record) => {
    const point: DataPoint = { tick: record.tick };

    selectedMetrics.forEach((metric) => {
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

      const sanitizedKey = sanitizeKey(metric.fullPath);
      point[sanitizedKey] = typeof value === "number" ? value : null;
    });

    return point;
  });
}

export default function Home() {
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [components, setComponents] = useState<ComponentNode[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<SelectedMetric[]>([]);
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: number;
    tickCount: number;
  } | null>(null);
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
      setRecords(data.records);
      setComponents(parseComponentTree(data.records));
      setUploadedFile({
        name: data.filename,
        size: data.size,
        tickCount: data.tickCount,
      });
      setPlaybackState({
        isPlaying: false,
        currentTick: 1,
        speed: 1,
        totalTicks: data.tickCount,
      });
      setUploadError(null);
    },
    onError: (error: Error) => {
      setUploadError(error.message);
    },
  });

  const handleFileUpload = useCallback(
    (file: File) => {
      uploadMutation.mutate(file);
    },
    [uploadMutation]
  );

  const handleClearFile = useCallback(() => {
    setRecords([]);
    setComponents([]);
    setSelectedMetrics([]);
    setUploadedFile(null);
    setUploadError(null);
    setPlaybackState({
      isPlaying: false,
      currentTick: 1,
      speed: 1,
      totalTicks: 0,
    });
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
    }
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

  const chartData = extractDataPoints(
    records.filter((r) => r.tick <= playbackState.currentTick),
    selectedMetrics
  );

  const currentData = chartData.find((d) => d.tick === playbackState.currentTick) || null;

  const currentRecord = records.find((r) => r.tick === playbackState.currentTick);
  const currentTime = currentRecord
    ? ((currentRecord.value as Record<string, unknown>)?.sim_clock as { current_datetime?: string })
        ?.current_datetime || ""
    : "";
  const formattedTime = currentTime
    ? new Date(currentTime).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  const sidebarStyle = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
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
              <SidebarGroupLabel>Components</SidebarGroupLabel>
              <SidebarGroupContent>
                <ComponentTree
                  components={components}
                  selectedMetrics={selectedMetrics}
                  onSelectionChange={setSelectedMetrics}
                />
              </SidebarGroupContent>
            </SidebarGroup>
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
              uploadedFile={uploadedFile}
              error={uploadError}
              onClear={handleClearFile}
            />

            <div className="relative flex-1 min-h-0">
              <MetricsChart
                data={chartData}
                selectedMetrics={selectedMetrics}
                currentTick={playbackState.currentTick}
                windowSize={windowSize}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onResetZoom={handleResetZoom}
                isAutoZoom={isAutoZoom}
              />
              <MetricsHUD
                currentData={currentData}
                selectedMetrics={selectedMetrics}
                currentTick={playbackState.currentTick}
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
                currentTime={formattedTime}
                disabled={!uploadedFile}
              />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
