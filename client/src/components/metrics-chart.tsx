import { memo, useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { LineChart as LineChartIcon, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  Annotation,
  SubtitleOverlay,
  DataPoint,
  SelectedMetric,
  CaptureSession,
} from "@shared/schema";
import { cn } from "@/lib/utils";

function sanitizeKey(key: string): string {
  return key.replace(/\./g, "_");
}

interface MetricsChartProps {
  data: DataPoint[];
  selectedMetrics: SelectedMetric[];
  currentTick: number;
  windowStart: number;
  windowEnd: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  isAutoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  captures: CaptureSession[];
  onSizeChange?: (size: { width: number; height: number }) => void;
}

interface ChartLinesProps {
  data: DataPoint[];
  selectedMetrics: SelectedMetric[];
  domain: { x: [number, number]; y: [number, number] };
  annotations: Annotation[];
  windowStart: number;
  windowEnd: number;
  captures: CaptureSession[];
  width?: number;
  height?: number;
}

interface ChartCursorProps {
  points?: Array<{ x: number; y: number }>;
  width?: number;
  height?: number;
  stroke?: string;
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

const CHART_MARGIN = { top: 5, right: 30, left: 20, bottom: 5 };
const Y_AXIS_WIDTH = 60;

function ChartCursor({
  points,
  height,
  stroke,
  viewBox,
}: ChartCursorProps) {
  const x = points?.[0]?.x;
  if (!Number.isFinite(x)) {
    return null;
  }
  const viewLeft = Number.isFinite(viewBox?.x) ? (viewBox?.x as number) : 0;
  const viewTop = Number.isFinite(viewBox?.y) ? (viewBox?.y as number) : 0;
  const viewWidth = Number.isFinite(viewBox?.width)
    ? (viewBox?.width as number)
    : undefined;
  const viewHeight = Number.isFinite(viewBox?.height)
    ? (viewBox?.height as number)
    : Number.isFinite(height)
      ? (height as number)
      : undefined;
  if (!Number.isFinite(viewHeight)) {
    return null;
  }
  const viewRight = viewWidth !== undefined ? viewLeft + viewWidth : undefined;
  let clampedX = x as number;
  const plotLeft = Math.max(viewLeft, CHART_MARGIN.left + Y_AXIS_WIDTH);
  clampedX = Math.max(plotLeft, clampedX);
  if (viewRight !== undefined) {
    clampedX = Math.min(viewRight, clampedX);
  }
  return (
    <line
      x1={clampedX}
      x2={clampedX}
      y1={viewTop}
      y2={viewTop + viewHeight}
      stroke={stroke ?? "hsl(var(--primary))"}
      strokeDasharray="3 3"
    />
  );
}

const ChartLines = memo(function ChartLines({
  data,
  selectedMetrics,
  domain,
  annotations,
  windowStart,
  windowEnd,
  captures,
  width,
  height,
}: ChartLinesProps) {
  if (!width || !height) {
    return null;
  }
  const getDataKey = (metric: SelectedMetric): string => {
    return `${metric.captureId}_${sanitizeKey(metric.fullPath)}`;
  };

  const captureNameById = useMemo(() => {
    const map = new Map<string, string>();
    captures.forEach((capture) => {
      const name = capture.filename.replace(".jsonl", "");
      map.set(capture.id, name.length > 8 ? name.substring(0, 8) : name);
    });
    return map;
  }, [captures]);

  return (
    <LineChart width={width} height={height} data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
        <XAxis
          dataKey="tick"
          domain={domain.x}
          type="number"
          tickFormatter={(v) => v.toLocaleString()}
          className="text-xs fill-muted-foreground"
        />
        <YAxis
          domain={domain.y}
          width={Y_AXIS_WIDTH}
          tickFormatter={(v) => {
            if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
            if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
            return v.toFixed(0);
          }}
          className="text-xs fill-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--popover-border))",
            borderRadius: "var(--radius)",
            fontSize: "12px",
          }}
          cursor={<ChartCursor />}
          labelFormatter={(label) => `Tick ${label}`}
          formatter={(value: number, name: string) => {
            const metric = selectedMetrics.find((m) => getDataKey(m) === name);
            const captureName = metric ? captureNameById.get(metric.captureId) ?? "" : "";
            const label = metric ? `${captureName}: ${metric.label}` : name;
            return [typeof value === "number" ? value.toLocaleString() : value, label];
          }}
        />
        {annotations
          .filter((annotation) => annotation.tick >= windowStart && annotation.tick <= windowEnd)
          .map((annotation) => (
            <ReferenceLine
              key={annotation.id}
              x={annotation.tick}
              stroke={annotation.color ?? "hsl(var(--primary))"}
              strokeDasharray="2 4"
              strokeWidth={annotation.color ? 1.5 : 2}
              label={
                annotation.label
                  ? {
                      value: annotation.label,
                      position: "insideTop",
                      offset: 6,
                      fill: annotation.color ?? "hsl(var(--primary))",
                      fontSize: 10,
                    }
                  : undefined
              }
            />
          ))}
        {selectedMetrics.map((metric, index) => {
          const dataKey = getDataKey(metric);
          const isDashed = index % 2 === 1;
          return (
            <Line
              key={`${metric.captureId}-${metric.fullPath}`}
              type="monotone"
              dataKey={dataKey}
              name={dataKey}
              stroke={metric.color}
              strokeWidth={2}
              strokeDasharray={isDashed ? "5 5" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          );
        })}
    </LineChart>
  );
});

export function MetricsChart({
  data,
  selectedMetrics,
  currentTick,
  windowStart,
  windowEnd,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  isAutoScroll,
  annotations,
  subtitles,
  captures,
  onSizeChange,
}: MetricsChartProps) {
  const visibleData = useMemo(() => {
    if (data.length === 0) return [];

    const startTick = Math.max(1, Math.floor(windowStart));
    const endTick = Math.max(startTick, Math.floor(windowEnd));
    return data.filter((d) => d.tick >= startTick && d.tick <= endTick);
  }, [data, windowStart, windowEnd]);

  const domain = useMemo(() => {
    if (data.length === 0) return { x: [0, 50], y: [0, 100] };

    const fallbackStart = Math.max(0, Math.floor(windowStart));
    const fallbackEnd = Math.max(fallbackStart, Math.floor(windowEnd));
    const xMin = visibleData.length > 0 ? Math.min(...visibleData.map((d) => d.tick)) : fallbackStart;
    const xMax = visibleData.length > 0 ? Math.max(...visibleData.map((d) => d.tick)) : fallbackEnd;

    let yMin = Infinity;
    let yMax = -Infinity;

    visibleData.forEach((point) => {
      selectedMetrics.forEach((metric) => {
        const dataKey = `${metric.captureId}_${sanitizeKey(metric.fullPath)}`;
        const val = point[dataKey];
        if (typeof val === "number" && !isNaN(val)) {
          yMin = Math.min(yMin, val);
          yMax = Math.max(yMax, val);
        }
      });
    });

    if (!isFinite(yMin)) yMin = 0;
    if (!isFinite(yMax)) yMax = 100;

    const yPadding = (yMax - yMin) * 0.1 || 10;
    return {
      x: [xMin, xMax],
      y: [Math.max(0, yMin - yPadding), yMax + yPadding],
    };
  }, [visibleData, selectedMetrics, data.length, windowStart, windowEnd]);

  const activeSubtitles = useMemo(() => {
    if (!subtitles || subtitles.length === 0) {
      return [];
    }
    return subtitles
      .filter((subtitle) => subtitle.startTick <= currentTick && subtitle.endTick >= currentTick)
      .sort((a, b) => a.startTick - b.startTick);
  }, [subtitles, currentTick]);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const chartSizeRef = useRef(chartSize);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);

  const commitChartSize = useCallback((nextWidth: number, nextHeight: number) => {
    const prev = chartSizeRef.current;
    if (prev.width === nextWidth && prev.height === nextHeight) {
      return;
    }
    const next = { width: nextWidth, height: nextHeight };
    chartSizeRef.current = next;
    setChartSize(next);
    if (onSizeChange) {
      onSizeChange(next);
    }
  }, [onSizeChange]);

  useLayoutEffect(() => {
    const el = chartContainerRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const initialWidth = Math.max(0, Math.floor(rect.width));
    const initialHeight = Math.max(0, Math.floor(rect.height));
    commitChartSize(initialWidth, initialHeight);
  }, [commitChartSize]);

  useLayoutEffect(() => {
    if (!chartContainerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const nextWidth = Math.max(0, Math.floor(width));
        const nextHeight = Math.max(0, Math.floor(height));
        pendingSizeRef.current = { width: nextWidth, height: nextHeight };
        if (resizeFrameRef.current !== null) {
          continue;
        }
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          const pending = pendingSizeRef.current;
          if (!pending) {
            return;
          }
          commitChartSize(pending.width, pending.height);
        });
      }
    });
    observer.observe(chartContainerRef.current);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, [commitChartSize]);

  if (selectedMetrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <LineChartIcon className="w-12 h-12 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">No metrics selected</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onZoomIn}
          data-testid="button-zoom-in"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onZoomOut}
          data-testid="button-zoom-out"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onResetZoom}
          data-testid="button-reset-zoom"
          aria-label="Reset zoom"
          className={cn(!isAutoScroll && "text-primary")}
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>
      {activeSubtitles.length > 0 && (
        <div className="absolute bottom-3 left-1/2 z-20 max-w-[70%] -translate-x-1/2 space-y-1 pointer-events-none">
          {activeSubtitles.map((subtitle) => (
            <div
              key={subtitle.id}
              className="rounded-md border border-muted/40 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur"
              style={subtitle.color ? { color: subtitle.color } : undefined}
            >
              {subtitle.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 p-4 pt-12">
        <div ref={chartContainerRef} className="relative h-full w-full overflow-hidden">
          <ResponsiveContainer width="100%" height="100%" debounce={0}>
            <ChartLines
              data={visibleData}
              selectedMetrics={selectedMetrics}
              domain={domain}
              annotations={annotations}
              windowStart={windowStart}
              windowEnd={windowEnd}
              captures={captures}
            />
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
