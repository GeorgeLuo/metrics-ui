import { memo, useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { LineChart as LineChartIcon, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  isAutoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  captures: CaptureSession[];
  highlightedMetricKey?: string | null;
  onSizeChange?: (size: { width: number; height: number }) => void;
  onAddAnnotation?: (annotation: Annotation) => void;
  onRemoveAnnotation?: (options: { id?: string; tick?: number }) => void;
  onWindowRangeChange?: (startTick: number, endTick: number) => void;
}

interface ChartLinesProps {
  data: DataPoint[];
  selectedMetrics: SelectedMetric[];
  domain: { x: [number, number]; y: [number, number] };
  annotations: Annotation[];
  selectionSummary: SelectionSummary | null;
  windowStart: number;
  windowEnd: number;
  captures: CaptureSession[];
  highlightedMetricKey?: string | null;
  suppressCursor?: boolean;
  width?: number;
  height?: number;
}

interface ChartCursorProps {
  points?: Array<{ x: number; y: number }>;
  width?: number;
  height?: number;
  stroke?: string;
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  plotTop?: number;
  plotBottom?: number;
}

interface SelectionSummaryMetric {
  dataKey: string;
  metric: SelectedMetric;
  startValue: number | null;
  endValue: number | null;
}

interface SelectionSummary {
  startTick: number;
  endTick: number;
  metrics: SelectionSummaryMetric[];
}


const CHART_MARGIN = { top: 5, right: 30, left: 20, bottom: 5 };
const Y_AXIS_WIDTH = 60;
const X_AXIS_HEIGHT = 30;

function ChartCursor({
  points,
  height,
  stroke,
  viewBox,
  plotTop,
  plotBottom,
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
  const resolvedHeight = Number.isFinite(viewBox?.height)
    ? (viewBox?.height as number)
    : Number.isFinite(height)
      ? (height as number)
      : null;
  if (resolvedHeight === null || !Number.isFinite(resolvedHeight)) {
    return null;
  }
  const viewRight = viewWidth !== undefined ? viewLeft + viewWidth : undefined;
  let clampedX = x as number;
  const plotLeft = Math.max(viewLeft, CHART_MARGIN.left + Y_AXIS_WIDTH);
  clampedX = Math.max(plotLeft, clampedX);
  if (viewRight !== undefined) {
    clampedX = Math.min(viewRight, clampedX);
  }
  const lineTop = Number.isFinite(plotTop)
    ? (plotTop as number)
    : viewTop + CHART_MARGIN.top;
  const lineBottom = Number.isFinite(plotBottom)
    ? (plotBottom as number)
    : viewTop + resolvedHeight - X_AXIS_HEIGHT;
  if (lineBottom <= lineTop) {
    return null;
  }
  return (
    <line
      x1={clampedX}
      x2={clampedX}
      y1={lineTop}
      y2={lineBottom}
      stroke={stroke ?? "hsl(var(--primary))"}
      strokeWidth={1}
    />
  );
}

const ChartLines = memo(function ChartLines({
  data,
  selectedMetrics,
  domain,
  annotations,
  selectionSummary,
  windowStart,
  windowEnd,
  captures,
  highlightedMetricKey,
  suppressCursor,
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

  const formatValue = useCallback((value: unknown) => {
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    return String(value);
  }, []);

  const TooltipContent = useCallback(
    ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: number }) => {
      if (!active || !payload || payload.length === 0) {
        return null;
      }
      const entries = payload.map((entry) => {
        const metric = selectedMetrics.find((m) => getDataKey(m) === entry.dataKey);
        const captureName = metric ? captureNameById.get(metric.captureId) ?? "" : "";
        const displayLabel = metric ? `${captureName}: ${metric.label}` : entry.dataKey;
        return {
          key: entry.dataKey,
          label: displayLabel,
          value: formatValue(entry.value),
          color: entry.color ?? metric?.color ?? "hsl(var(--primary))",
        };
      });

      const selectionDetails = selectionSummary
        ? selectionSummary.metrics.map((item) => {
          const captureName = captureNameById.get(item.metric.captureId) ?? "";
          return {
            key: item.dataKey,
            label: `${captureName}: ${item.metric.label}`,
            start: formatValue(item.startValue),
            end: formatValue(item.endValue),
            color: item.metric.color,
          };
        })
        : [];

      return (
        <div className="rounded-md border border-muted/40 bg-popover px-3 py-2 text-xs shadow-sm">
          <div className="mb-1 text-[11px] text-muted-foreground">Tick {label}</div>
          <div className="space-y-1">
            {entries.map((entry) => (
              <div key={entry.key} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="flex-1 text-muted-foreground">{entry.label}</span>
                <span className="font-medium text-foreground">{entry.value}</span>
              </div>
            ))}
          </div>
          {selectionSummary && (
            <div className="mt-2 border-t border-muted/30 pt-2">
              <div className="mb-1 text-[11px] text-muted-foreground">
                Selection {selectionSummary.startTick}–{selectionSummary.endTick}
              </div>
              <div className="space-y-1">
                {selectionDetails.map((entry) => (
                  <div key={entry.key} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="flex-1 text-muted-foreground">{entry.label}</span>
                    <span className="font-medium text-foreground">
                      {entry.start} → {entry.end}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    },
    [captureNameById, formatValue, selectedMetrics, selectionSummary],
  );

  return (
    <LineChart width={width} height={height} data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
        <XAxis
          dataKey="tick"
          domain={domain.x}
          type="number"
          height={X_AXIS_HEIGHT}
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
          cursor={
            suppressCursor
              ? false
              : (
                <ChartCursor
                  plotTop={CHART_MARGIN.top}
                  plotBottom={height - (CHART_MARGIN.bottom + X_AXIS_HEIGHT)}
                />
              )
          }
          content={TooltipContent}
        />
        {selectedMetrics.map((metric, index) => {
          const dataKey = getDataKey(metric);
          const isDashed = index % 2 === 1;
          const isHighlighted = highlightedMetricKey === dataKey;
          return (
            <Line
              key={`${metric.captureId}-${metric.fullPath}`}
              type="monotone"
              dataKey={dataKey}
              name={dataKey}
              stroke={metric.color}
              strokeWidth={isHighlighted ? 4 : 2}
              strokeDasharray={isDashed ? "5 5" : undefined}
              dot={false}
              activeDot={false}
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
  isAutoScroll,
  annotations,
  subtitles,
  captures,
  highlightedMetricKey,
  onSizeChange,
  onAddAnnotation,
  onRemoveAnnotation,
  onWindowRangeChange,
}: MetricsChartProps) {
  const visibleData = useMemo(() => {
    if (data.length === 0) return [];

    const startTick = Math.max(1, Math.floor(windowStart));
    const endTick = Math.max(startTick, Math.floor(windowEnd));
    return data.filter((d) => d.tick >= startTick && d.tick <= endTick);
  }, [data, windowStart, windowEnd]);

  const domain = useMemo(() => {
    if (data.length === 0) return { x: [0, 50] as [number, number], y: [0, 100] as [number, number] };

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
      x: [xMin, xMax] as [number, number],
      y: [Math.max(0, yMin - yPadding), yMax + yPadding] as [number, number],
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const chartSizeRef = useRef(chartSize);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [hoverAnnotationId, setHoverAnnotationId] = useState<string | null>(null);
  const [annotationPanelPosition, setAnnotationPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const idCounterRef = useRef(0);
  const [selectionRange, setSelectionRange] = useState<{ startX: number; endX: number } | null>(null);
  const selectionStateRef = useRef<{ startX: number; endX: number; dragged: boolean } | null>(null);
  const suppressClickRef = useRef(false);

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

  useEffect(() => {
    if (activeAnnotationId && !annotations.some((annotation) => annotation.id === activeAnnotationId)) {
      setActiveAnnotationId(null);
      setAnnotationPanelPosition(null);
    }
  }, [annotations, activeAnnotationId]);

  const buildAnnotationId = useCallback(() => {
    idCounterRef.current += 1;
    return `anno-${Date.now().toString(36)}-${idCounterRef.current.toString(36)}`;
  }, []);

  const getAnnotationX = useCallback(
    (tick: number) => {
      const [xMin, xMax] = domain.x;
      if (!chartSize.width || xMax === xMin) {
        return null;
      }
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotWidth = Math.max(1, chartSize.width - plotLeft - CHART_MARGIN.right);
      const clampedTick = Math.min(Math.max(tick, xMin), xMax);
      const ratio = (clampedTick - xMin) / (xMax - xMin);
      return plotLeft + ratio * plotWidth;
    },
    [chartSize.width, domain.x],
  );

  const getTickFromX = useCallback(
    (x: number) => {
      const [xMin, xMax] = domain.x;
      if (!chartSize.width || xMax === xMin) {
        return null;
      }
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotRight = chartSize.width - CHART_MARGIN.right;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const clampedX = Math.min(Math.max(x, plotLeft), plotRight);
      const ratio = (clampedX - plotLeft) / plotWidth;
      return Math.round(xMin + ratio * (xMax - xMin));
    },
    [chartSize.width, domain.x],
  );

  const findAnnotationNearX = useCallback(
    (x: number) => {
      const [xMin, xMax] = domain.x;
      if (!chartSize.width || xMax === xMin) {
        return null;
      }
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotWidth = Math.max(1, chartSize.width - plotLeft - CHART_MARGIN.right);
      const clamp = (tick: number) => Math.min(Math.max(tick, xMin), xMax);
      const visible = annotations.filter(
        (annotation) => annotation.tick >= windowStart && annotation.tick <= windowEnd,
      );
      const threshold = 10;
      for (const annotation of visible) {
        const ratio = (clamp(annotation.tick) - xMin) / (xMax - xMin);
        const position = plotLeft + ratio * plotWidth;
        if (Math.abs(position - x) <= threshold) {
          return annotation;
        }
      }
      return null;
    },
    [annotations, chartSize.width, domain.x, windowEnd, windowStart],
  );

  const handleChartClick = useCallback(
    (event: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (!onAddAnnotation || !chartContainerRef.current) {
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("input") ||
        target.closest("[data-annotation-panel]")
      ) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotRight = chartSize.width - CHART_MARGIN.right;
      if (!chartSize.width || localX < plotLeft || localX > plotRight) {
        return;
      }
      const [xMin, xMax] = domain.x;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const ratio = (localX - plotLeft) / plotWidth;
      const tick = Math.round(xMin + ratio * (xMax - xMin));
      const existing = findAnnotationNearX(localX);
      if (existing) {
        setActiveAnnotationId(existing.id);
        setAnnotationPanelPosition(null);
        return;
      }
      const id = buildAnnotationId();
      onAddAnnotation({ id, tick });
      setActiveAnnotationId(null);
    },
    [buildAnnotationId, chartSize.width, domain.x, findAnnotationNearX, onAddAnnotation],
  );

  const handleChartMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || !chartContainerRef.current) {
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("input") ||
        target.closest("[data-annotation-panel]")
      ) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotRight = chartSize.width - CHART_MARGIN.right;
      if (!chartSize.width || localX < plotLeft || localX > plotRight) {
        return;
      }
      selectionStateRef.current = { startX: localX, endX: localX, dragged: false };
      setSelectionRange({ startX: localX, endX: localX });
      setActiveAnnotationId(null);
      setHoverAnnotationId(null);
    },
    [chartSize.width],
  );

  const handleChartMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!chartContainerRef.current || isDraggingPanel) {
        return;
      }
      if (selectionStateRef.current) {
        const rect = chartContainerRef.current.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
        const plotRight = chartSize.width - CHART_MARGIN.right;
        const clampedX = Math.min(Math.max(localX, plotLeft), plotRight);
        const selection = selectionStateRef.current;
        selection.endX = clampedX;
        if (!selection.dragged && Math.abs(selection.endX - selection.startX) > 4) {
          selection.dragged = true;
          suppressClickRef.current = true;
        }
        setSelectionRange({ startX: selection.startX, endX: selection.endX });
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const annotation = findAnnotationNearX(localX);
      setHoverAnnotationId(annotation ? annotation.id : null);
    },
    [chartSize.width, findAnnotationNearX, isDraggingPanel],
  );

  const handleChartMouseLeave = useCallback(() => {
    if (!selectionStateRef.current) {
      setHoverAnnotationId(null);
    }
  }, []);

  useEffect(() => {
    if (!selectionRange) {
      return;
    }
    const handleMouseUp = () => {
      const selection = selectionStateRef.current;
      selectionStateRef.current = null;
      setSelectionRange(null);
      if (!selection || !selection.dragged) {
        return;
      }
      if (!onWindowRangeChange) {
        return;
      }
      const startTick = getTickFromX(selection.startX);
      const endTick = getTickFromX(selection.endX);
      if (startTick === null || endTick === null) {
        return;
      }
      const start = Math.min(startTick, endTick);
      const end = Math.max(startTick, endTick);
      onWindowRangeChange(start, end);
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!chartContainerRef.current || !selectionStateRef.current) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotRight = chartSize.width - CHART_MARGIN.right;
      const clampedX = Math.min(Math.max(localX, plotLeft), plotRight);
      const selection = selectionStateRef.current;
      selection.endX = clampedX;
      if (!selection.dragged && Math.abs(selection.endX - selection.startX) > 4) {
        selection.dragged = true;
        suppressClickRef.current = true;
      }
      setSelectionRange({ startX: selection.startX, endX: selection.endX });
    };
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [chartSize.width, getTickFromX, onWindowRangeChange, selectionRange]);

  const activeAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === activeAnnotationId) ?? null,
    [annotations, activeAnnotationId],
  );

  const activeAnnotationPanel = useMemo(() => {
    if (!activeAnnotation || !chartSize.width) {
      return null;
    }
    if (annotationPanelPosition) {
      return {
        left: annotationPanelPosition.x,
        top: annotationPanelPosition.y,
        tick: activeAnnotation.tick,
      };
    }
    const position = getAnnotationX(activeAnnotation.tick);
    if (position === null) {
      return null;
    }
    const panelWidth = 220;
    const left = Math.min(
      Math.max(position - panelWidth / 2, 8),
      Math.max(8, chartSize.width - panelWidth - 8),
    );
    return { left, top: 12, tick: activeAnnotation.tick };
  }, [activeAnnotation, annotationPanelPosition, chartSize.width, getAnnotationX]);

  const handlePanelMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDraggingPanel(true);
      const rect = panelRef.current?.getBoundingClientRect()
        ?? (event.currentTarget as HTMLElement).getBoundingClientRect();
      dragOffsetRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const handleMove = (moveEvent: MouseEvent) => {
        if (!chartContainerRef.current) {
          return;
        }
        const containerRect = chartContainerRef.current.getBoundingClientRect();
        const panelWidth = rect.width;
        const panelHeight = rect.height;
        const nextX = Math.min(
          Math.max(moveEvent.clientX - containerRect.left - dragOffsetRef.current.x, 8),
          Math.max(8, containerRect.width - panelWidth - 8),
        );
        const nextY = Math.min(
          Math.max(moveEvent.clientY - containerRect.top - dragOffsetRef.current.y, 8),
          Math.max(8, containerRect.height - panelHeight - 8),
        );
        setAnnotationPanelPosition({ x: nextX, y: nextY });
      };
      const handleUp = () => {
        setIsDraggingPanel(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [],
  );

  const hoverAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === hoverAnnotationId) ?? null,
    [annotations, hoverAnnotationId],
  );

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.tick >= windowStart && annotation.tick <= windowEnd),
    [annotations, windowEnd, windowStart],
  );

  const annotationOverlays = useMemo(() => {
    if (!chartSize.width) {
      return [];
    }
    return visibleAnnotations
      .map((annotation) => {
        const left = getAnnotationX(annotation.tick);
        if (left === null) {
          return null;
        }
        return { ...annotation, left };
      })
      .filter((annotation): annotation is Annotation & { left: number } => Boolean(annotation));
  }, [chartSize.width, getAnnotationX, visibleAnnotations]);

  const selectionSummary = useMemo<SelectionSummary | null>(() => {
    if (!selectionRange) {
      return null;
    }
    const startTickRaw = getTickFromX(selectionRange.startX);
    const endTickRaw = getTickFromX(selectionRange.endX);
    if (startTickRaw === null || endTickRaw === null) {
      return null;
    }
    const startTick = Math.min(startTickRaw, endTickRaw);
    const endTick = Math.max(startTickRaw, endTickRaw);
    const tickMap = new Map<number, DataPoint>();
    data.forEach((point) => {
      tickMap.set(point.tick, point);
    });
    const startPoint = tickMap.get(startTick);
    const endPoint = tickMap.get(endTick);
    const metrics = selectedMetrics.map((metric) => {
      const dataKey = `${metric.captureId}_${sanitizeKey(metric.fullPath)}`;
      const startValue = startPoint?.[dataKey];
      const endValue = endPoint?.[dataKey];
      return {
        dataKey,
        metric,
        startValue: typeof startValue === "number" ? startValue : null,
        endValue: typeof endValue === "number" ? endValue : null,
      };
    });
    return { startTick, endTick, metrics };
  }, [data, getTickFromX, selectionRange, selectedMetrics]);

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
        <div
          ref={chartContainerRef}
          className={cn(
            "relative h-full w-full overflow-hidden isolate",
            hoverAnnotationId ? "cursor-pointer" : "cursor-crosshair",
          )}
          onMouseDown={handleChartMouseDown}
          onClick={handleChartClick}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
        >
          <div className="absolute inset-0 z-10">
            <ResponsiveContainer width="100%" height="100%" debounce={0}>
              <ChartLines
                data={visibleData}
                selectedMetrics={selectedMetrics}
                domain={domain}
                annotations={annotations}
                selectionSummary={selectionSummary}
                windowStart={windowStart}
                windowEnd={windowEnd}
                captures={captures}
                highlightedMetricKey={highlightedMetricKey}
                suppressCursor={Boolean(hoverAnnotationId)}
              />
            </ResponsiveContainer>
          </div>
          <div className="absolute inset-0 z-0 pointer-events-none">
            {annotationOverlays.map((annotation) => {
              const axisLineColor = "hsl(var(--muted-foreground) / 0.35)";
              return (
                <div
                  key={annotation.id}
                  className="absolute"
                  style={{
                    left: `${annotation.left}px`,
                    top: `${CHART_MARGIN.top}px`,
                    bottom: `${CHART_MARGIN.bottom + X_AXIS_HEIGHT}px`,
                  }}
                >
                  <div
                    className={cn(
                      "h-full border-l-2 border-solid",
                      hoverAnnotationId === annotation.id && "border-l-[3px]",
                    )}
                    style={{ borderColor: axisLineColor }}
                  />
                  {annotation.label && (
                    <div
                      className="absolute top-0 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-1 text-[11px] text-white shadow-sm backdrop-blur"
                      style={annotation.color ? { borderColor: annotation.color } : undefined}
                    >
                      {annotation.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {selectionRange && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20"
              style={{
                left: `${Math.min(selectionRange.startX, selectionRange.endX)}px`,
                width: `${Math.abs(selectionRange.endX - selectionRange.startX)}px`,
              }}
            >
              <div className="h-full bg-primary/15 border border-primary/30" />
            </div>
          )}
          {activeAnnotation && activeAnnotationPanel && (
            <div
              data-annotation-panel
              className="absolute z-30 w-[220px] rounded-md border border-muted/40 bg-background p-2 text-xs shadow-md"
              style={{ left: activeAnnotationPanel.left, top: activeAnnotationPanel.top }}
              onClick={(event) => event.stopPropagation()}
              ref={panelRef}
            >
              <div
                className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground cursor-grab select-none"
                onMouseDown={handlePanelMouseDown}
              >
                <div className="flex items-center gap-1">
                  <GripVertical className="h-3 w-3 text-muted-foreground" />
                  <span>Annotation @ {activeAnnotationPanel.tick}</span>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setActiveAnnotationId(null)}
                  aria-label="Close annotation editor"
                >
                  ×
                </button>
              </div>
              <Input
                value={activeAnnotation.label ?? ""}
                onChange={(event) => {
                  onAddAnnotation?.({
                    id: activeAnnotation.id,
                    tick: activeAnnotation.tick,
                    label: event.target.value,
                    color: activeAnnotation.color,
                  });
                }}
                placeholder="Annotation label"
                className="h-7 text-xs"
              />
              <div className="mt-2 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    onRemoveAnnotation?.({ id: activeAnnotation.id });
                    setActiveAnnotationId(null);
                  }}
                >
                  Remove
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setActiveAnnotationId(null)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
