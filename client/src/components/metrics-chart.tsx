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
  resetViewVersion?: number;
  isAutoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  captures: CaptureSession[];
  highlightedMetricKey?: string | null;
  yPrimaryDomain?: [number, number] | null;
  ySecondaryDomain?: [number, number] | null;
  onSizeChange?: (size: { width: number; height: number }) => void;
  onYPrimaryDomainChange?: (domain: [number, number] | null) => void;
  onYSecondaryDomainChange?: (domain: [number, number] | null) => void;
  onDomainChange?: (domain: {
    yPrimary: [number, number];
    ySecondary: [number, number];
  }) => void;
  onAddAnnotation?: (annotation: Annotation) => void;
  onRemoveAnnotation?: (options: { id?: string; tick?: number }) => void;
  onWindowRangeChange?: (startTick: number, endTick: number) => void;
}

interface ChartDomain {
  x: [number, number];
  yPrimary: [number, number];
  ySecondary: [number, number];
}

interface ChartLinesProps {
  data: DataPoint[];
  selectedMetrics: SelectedMetric[];
  domain: ChartDomain;
  hasSecondaryAxis: boolean;
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

type AxisTarget = "left" | "right" | "bottom";

interface PlotBounds {
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
}

const CHART_MARGIN = { top: 5, right: 30, left: 20, bottom: 5 };
const Y_AXIS_WIDTH = 60;
const X_AXIS_HEIGHT = 30;
const AXIS_ZOOM_SENSITIVITY = 0.01;
const MIN_DOMAIN_SPAN = 1e-6;
const AXIS_TICK_STYLE = { style: { userSelect: "none" as const } };

function formatAxisTick(value: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
}

function createAxisTickFormatter(domain: [number, number]) {
  const span = Math.abs(domain[1] - domain[0]);
  return (value: number): string => {
    if (!Number.isFinite(value)) {
      return "";
    }
    if (Math.abs(value) >= 1000) {
      return formatAxisTick(value);
    }
    // Preserve precision for tight domains (e.g. correlation near 1.0).
    if (span <= 0.5) {
      return value.toFixed(3);
    }
    if (span <= 5) {
      return value.toFixed(2);
    }
    if (span <= 20) {
      return value.toFixed(1);
    }
    return value.toFixed(0);
  };
}

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
  hasSecondaryAxis,
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
  const primaryTickFormatter = useMemo(
    () => createAxisTickFormatter(domain.yPrimary),
    [domain.yPrimary],
  );
  const secondaryTickFormatter = useMemo(
    () => createAxisTickFormatter(domain.ySecondary),
    [domain.ySecondary],
  );

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
          tick={AXIS_TICK_STYLE}
          tickFormatter={(v) => v.toLocaleString()}
          className="text-xs fill-muted-foreground"
        />
        <YAxis
          yAxisId="left"
          domain={domain.yPrimary}
          allowDataOverflow={true}
          width={Y_AXIS_WIDTH}
          tickCount={6}
          tick={AXIS_TICK_STYLE}
          tickFormatter={primaryTickFormatter}
          className="text-xs fill-muted-foreground"
        />
        {hasSecondaryAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={domain.ySecondary}
            allowDataOverflow={true}
            width={Y_AXIS_WIDTH}
            tickCount={6}
            tick={AXIS_TICK_STYLE}
            tickFormatter={secondaryTickFormatter}
            className="text-xs fill-muted-foreground"
          />
        )}
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
          const isHighlighted = highlightedMetricKey === dataKey;
          return (
            <Line
              key={`${metric.captureId}-${metric.fullPath}`}
              type="monotone"
              dataKey={dataKey}
              name={dataKey}
              yAxisId={metric.axis === "y2" ? "right" : "left"}
              stroke={metric.color}
              strokeWidth={isHighlighted ? 4 : 2}
              connectNulls={true}
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
  resetViewVersion,
  isAutoScroll,
  annotations,
  subtitles,
  captures,
  highlightedMetricKey,
  yPrimaryDomain,
  ySecondaryDomain,
  onSizeChange,
  onYPrimaryDomainChange,
  onYSecondaryDomainChange,
  onDomainChange,
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

  const hasSecondaryAxis = useMemo(
    () => selectedMetrics.some((metric) => metric.axis === "y2"),
    [selectedMetrics],
  );

  const [internalYPrimaryDomain, setInternalYPrimaryDomain] = useState<[number, number] | null>(null);
  const [internalYSecondaryDomain, setInternalYSecondaryDomain] = useState<[number, number] | null>(null);
  const isYPrimaryControlled = yPrimaryDomain !== undefined;
  const isYSecondaryControlled = ySecondaryDomain !== undefined;
  const manualYPrimaryDomain = isYPrimaryControlled ? yPrimaryDomain ?? null : internalYPrimaryDomain;
  const manualYSecondaryDomain = isYSecondaryControlled ? ySecondaryDomain ?? null : internalYSecondaryDomain;

  const setManualYPrimaryDomain = useCallback(
    (next: [number, number] | null) => {
      if (!isYPrimaryControlled) {
        setInternalYPrimaryDomain(next);
      }
      onYPrimaryDomainChange?.(next);
    },
    [isYPrimaryControlled, onYPrimaryDomainChange],
  );

  const setManualYSecondaryDomain = useCallback(
    (next: [number, number] | null) => {
      if (!isYSecondaryControlled) {
        setInternalYSecondaryDomain(next);
      }
      onYSecondaryDomainChange?.(next);
    },
    [isYSecondaryControlled, onYSecondaryDomainChange],
  );

  const domain = useMemo<ChartDomain>(() => {
    const buildYAxisDomain = (metrics: SelectedMetric[]): [number, number] => {
      if (metrics.length === 0) {
        return [0, 100];
      }
      let yMin = Infinity;
      let yMax = -Infinity;

      visibleData.forEach((point) => {
        metrics.forEach((metric) => {
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
      return [Math.max(0, yMin - yPadding), yMax + yPadding] as [number, number];
    };

    if (data.length === 0) {
      return {
        x: [0, 50],
        yPrimary: [0, 100],
        ySecondary: [0, 100],
      };
    }

    const fallbackStart = Math.max(0, Math.floor(windowStart));
    const fallbackEnd = Math.max(fallbackStart, Math.floor(windowEnd));
    const xMin = visibleData.length > 0 ? Math.min(...visibleData.map((d) => d.tick)) : fallbackStart;
    const xMax = visibleData.length > 0 ? Math.max(...visibleData.map((d) => d.tick)) : fallbackEnd;

    const primaryMetrics = selectedMetrics.filter((metric) => metric.axis !== "y2");
    const secondaryMetrics = selectedMetrics.filter((metric) => metric.axis === "y2");
    const autoPrimaryDomain = buildYAxisDomain(primaryMetrics);
    const autoSecondaryDomain = hasSecondaryAxis
      ? buildYAxisDomain(secondaryMetrics)
      : autoPrimaryDomain;

    const isValidDomain = (candidate: [number, number] | null): candidate is [number, number] => {
      if (!candidate) {
        return false;
      }
      const [min, max] = candidate;
      return Number.isFinite(min) && Number.isFinite(max) && max > min;
    };

    const primaryDomain = isValidDomain(manualYPrimaryDomain)
      ? manualYPrimaryDomain
      : autoPrimaryDomain;
    const secondaryDomain = hasSecondaryAxis
      ? (isValidDomain(manualYSecondaryDomain) ? manualYSecondaryDomain : autoSecondaryDomain)
      : primaryDomain;

    return {
      x: [xMin, xMax] as [number, number],
      yPrimary: primaryDomain,
      ySecondary: secondaryDomain,
    };
  }, [
    data.length,
    hasSecondaryAxis,
    manualYPrimaryDomain,
    manualYSecondaryDomain,
    selectedMetrics,
    visibleData,
    windowEnd,
    windowStart,
  ]);

  useEffect(() => {
    onDomainChange?.({
      yPrimary: domain.yPrimary,
      ySecondary: domain.ySecondary,
    });
  }, [
    domain.yPrimary,
    domain.ySecondary,
    onDomainChange,
  ]);

  const activeSubtitles = useMemo(() => {
    if (!subtitles || subtitles.length === 0) {
      return [];
    }
    return subtitles
      .filter((subtitle) => subtitle.startTick <= currentTick && subtitle.endTick >= currentTick)
      .sort((a, b) => a.startTick - b.startTick);
  }, [subtitles, currentTick]);

  useEffect(() => {
    if (!hasSecondaryAxis && manualYSecondaryDomain !== null) {
      setManualYSecondaryDomain(null);
    }
  }, [hasSecondaryAxis, manualYSecondaryDomain]);

  useEffect(() => {
    setManualYPrimaryDomain(null);
    setManualYSecondaryDomain(null);
    axisDragStateRef.current = null;
    setIsAxisDragging(false);
    setAxisHoverTarget(null);
  }, [resetViewVersion]);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const annotationInputRef = useRef<HTMLInputElement | null>(null);
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
  const [selectionRange, setSelectionRange] = useState<{
    startX: number;
    endX: number;
    startY: number;
    endY: number;
  } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStateRef = useRef<{
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    dragged: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [axisHoverTarget, setAxisHoverTarget] = useState<AxisTarget | null>(null);
  const [isAxisDragging, setIsAxisDragging] = useState(false);
  const axisDragStateRef = useRef<{
    axis: "left" | "right";
    startY: number;
    anchorValue: number;
    startDomain: [number, number];
    dragged: boolean;
  } | {
    axis: "bottom";
    startY: number;
    anchorTick: number;
    startWindowStart: number;
    startWindowEnd: number;
    dragged: boolean;
  } | null>(null);

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

  useEffect(() => {
    if (!activeAnnotationId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const input = annotationInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeAnnotationId]);

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
      const plotRight = chartSize.width - CHART_MARGIN.right - (hasSecondaryAxis ? Y_AXIS_WIDTH : 0);
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const clampedTick = Math.min(Math.max(tick, xMin), xMax);
      const ratio = (clampedTick - xMin) / (xMax - xMin);
      return plotLeft + ratio * plotWidth;
    },
    [chartSize.width, domain.x, hasSecondaryAxis],
  );

  const getTickFromX = useCallback(
    (x: number) => {
      const [xMin, xMax] = domain.x;
      if (!chartSize.width || xMax === xMin) {
        return null;
      }
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotRight = chartSize.width - CHART_MARGIN.right - (hasSecondaryAxis ? Y_AXIS_WIDTH : 0);
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const clampedX = Math.min(Math.max(x, plotLeft), plotRight);
      const ratio = (clampedX - plotLeft) / plotWidth;
      return Math.round(xMin + ratio * (xMax - xMin));
    },
    [chartSize.width, domain.x, hasSecondaryAxis],
  );

  const getPlotBounds = useCallback((): PlotBounds | null => {
    if (!chartSize.width || !chartSize.height) {
      return null;
    }
    const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
    const plotRight = chartSize.width - CHART_MARGIN.right - (hasSecondaryAxis ? Y_AXIS_WIDTH : 0);
    const plotTop = CHART_MARGIN.top;
    const plotBottom = chartSize.height - (CHART_MARGIN.bottom + X_AXIS_HEIGHT);
    if (plotRight <= plotLeft || plotBottom <= plotTop) {
      return null;
    }
    return { plotLeft, plotRight, plotTop, plotBottom };
  }, [chartSize.height, chartSize.width, hasSecondaryAxis]);

  const getAxisTargetFromPoint = useCallback(
    (x: number, y: number): AxisTarget | null => {
      const bounds = getPlotBounds();
      if (!bounds) {
        return null;
      }
      if (y >= bounds.plotTop && y <= bounds.plotBottom) {
        const leftAxisStart = CHART_MARGIN.left;
        const leftAxisEnd = CHART_MARGIN.left + Y_AXIS_WIDTH;
        if (x >= leftAxisStart && x <= leftAxisEnd) {
          return "left";
        }
        if (hasSecondaryAxis) {
          const rightAxisStart = chartSize.width - CHART_MARGIN.right - Y_AXIS_WIDTH;
          const rightAxisEnd = chartSize.width - CHART_MARGIN.right;
          if (x >= rightAxisStart && x <= rightAxisEnd) {
            return "right";
          }
        }
      }
      const xAxisTop = bounds.plotBottom;
      const xAxisBottom = bounds.plotBottom + X_AXIS_HEIGHT + CHART_MARGIN.bottom;
      if (y >= xAxisTop && y <= xAxisBottom && x >= bounds.plotLeft && x <= bounds.plotRight) {
        return "bottom";
      }
      return null;
    },
    [chartSize.width, getPlotBounds, hasSecondaryAxis],
  );

  const getAxisValueFromY = useCallback(
    (y: number, axisDomain: [number, number]) => {
      const bounds = getPlotBounds();
      if (!bounds) {
        return null;
      }
      const clampedY = Math.min(Math.max(y, bounds.plotTop), bounds.plotBottom);
      const ratio = (bounds.plotBottom - clampedY) / Math.max(1, bounds.plotBottom - bounds.plotTop);
      const [min, max] = axisDomain;
      return min + ratio * (max - min);
    },
    [getPlotBounds],
  );

  const findAnnotationNearX = useCallback(
    (x: number) => {
      const [xMin, xMax] = domain.x;
      if (!chartSize.width || xMax === xMin) {
        return null;
      }
      const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
      const plotRight = chartSize.width - CHART_MARGIN.right - (hasSecondaryAxis ? Y_AXIS_WIDTH : 0);
      const plotWidth = Math.max(1, plotRight - plotLeft);
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
    [annotations, chartSize.width, domain.x, hasSecondaryAxis, windowEnd, windowStart],
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
      const localY = event.clientY - rect.top;
      const bounds = getPlotBounds();
      if (!bounds || localX < bounds.plotLeft || localX > bounds.plotRight) {
        return;
      }
      const [xMin, xMax] = domain.x;
      const plotWidth = Math.max(1, bounds.plotRight - bounds.plotLeft);
      const ratio = (localX - bounds.plotLeft) / plotWidth;
      const tick = Math.round(xMin + ratio * (xMax - xMin));
      const existing = findAnnotationNearX(localX);
      if (existing) {
        setActiveAnnotationId(existing.id);
        setAnnotationPanelPosition({ x: localX, y: localY });
        return;
      }
      const id = buildAnnotationId();
      onAddAnnotation({ id, tick });
      setActiveAnnotationId(null);
      setAnnotationPanelPosition(null);
    },
    [buildAnnotationId, domain.x, findAnnotationNearX, getPlotBounds, onAddAnnotation],
  );

  const handleChartDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!chartContainerRef.current) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const axisTarget = getAxisTargetFromPoint(localX, localY);
      if (!axisTarget) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (axisTarget === "bottom") {
        if (onWindowRangeChange && data.length > 0) {
          const minTick = Math.min(...data.map((point) => point.tick));
          const maxTick = Math.max(...data.map((point) => point.tick));
          onWindowRangeChange(minTick, maxTick);
        }
        return;
      }
      if (axisTarget === "right") {
        setManualYSecondaryDomain(null);
      } else {
        setManualYPrimaryDomain(null);
      }
    },
    [data, getAxisTargetFromPoint, onWindowRangeChange],
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
      event.preventDefault();
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const axisTarget = getAxisTargetFromPoint(localX, localY);
      if (axisTarget) {
        if (axisTarget === "bottom") {
          const anchorTick = getTickFromX(localX);
          if (anchorTick !== null) {
            axisDragStateRef.current = {
              axis: "bottom",
              startY: localY,
              anchorTick,
              startWindowStart: windowStart,
              startWindowEnd: windowEnd,
              dragged: false,
            };
            setIsAxisDragging(true);
            setAxisHoverTarget(axisTarget);
            setActiveAnnotationId(null);
            setHoverAnnotationId(null);
            return;
          }
        } else {
          const axisDomain = axisTarget === "right" ? domain.ySecondary : domain.yPrimary;
          const anchorValue = getAxisValueFromY(localY, axisDomain);
          if (anchorValue !== null) {
            axisDragStateRef.current = {
              axis: axisTarget,
              startY: localY,
              anchorValue,
              startDomain: axisDomain,
              dragged: false,
            };
            setIsAxisDragging(true);
            setAxisHoverTarget(axisTarget);
            setActiveAnnotationId(null);
            setHoverAnnotationId(null);
            return;
          }
        }
      }
      const bounds = getPlotBounds();
      if (!bounds || localX < bounds.plotLeft || localX > bounds.plotRight) {
        return;
      }
      const clampedY = Math.min(Math.max(localY, bounds.plotTop), bounds.plotBottom);
      selectionStateRef.current = {
        startX: localX,
        endX: localX,
        startY: clampedY,
        endY: clampedY,
        dragged: false,
      };
      setActiveAnnotationId(null);
      setHoverAnnotationId(null);
      setIsSelecting(true);
    },
    [
      domain.yPrimary,
      domain.ySecondary,
      getAxisTargetFromPoint,
      getAxisValueFromY,
      getPlotBounds,
      getTickFromX,
      windowEnd,
      windowStart,
    ],
  );

  const applyAxisDragZoom = useCallback((localX: number, localY: number) => {
    const drag = axisDragStateRef.current;
    if (!drag) {
      return;
    }
    if (drag.axis === "bottom") {
      const deltaY = localY - drag.startY;
      if (!drag.dragged && Math.abs(deltaY) > 2) {
        drag.dragged = true;
      }
      // Up zooms in, down zooms out.
      const zoomFactor = Math.exp(deltaY * AXIS_ZOOM_SENSITIVITY);
      const startSpan = Math.max(1, drag.startWindowEnd - drag.startWindowStart + 1);
      const minimumSideSpan = Math.max(1, startSpan * 0.05);
      const spanToStart = Math.max(drag.anchorTick - drag.startWindowStart, minimumSideSpan);
      const spanToEnd = Math.max(drag.startWindowEnd - drag.anchorTick, minimumSideSpan);
      let nextStart = drag.anchorTick - spanToStart * zoomFactor;
      let nextEnd = drag.anchorTick + spanToEnd * zoomFactor;
      if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextEnd <= nextStart) {
        return;
      }
      if (nextEnd - nextStart < 1) {
        const mid = (nextStart + nextEnd) / 2;
        nextStart = mid - 0.5;
        nextEnd = mid + 0.5;
      }
      if (!onWindowRangeChange) {
        return;
      }
      onWindowRangeChange(Math.floor(nextStart), Math.ceil(nextEnd));
      return;
    }
    const deltaY = localY - drag.startY;
    if (!drag.dragged && Math.abs(deltaY) > 2) {
      drag.dragged = true;
    }
    const zoomFactor = Math.exp(deltaY * AXIS_ZOOM_SENSITIVITY);
    const [startMin, startMax] = drag.startDomain;
    const startSpan = Math.max(MIN_DOMAIN_SPAN, startMax - startMin);
    const minimumSideSpan = Math.max(MIN_DOMAIN_SPAN / 2, startSpan * 0.05);
    const spanToMin = Math.max(drag.anchorValue - startMin, minimumSideSpan);
    const spanToMax = Math.max(startMax - drag.anchorValue, minimumSideSpan);
    let nextMin = drag.anchorValue - spanToMin * zoomFactor;
    let nextMax = drag.anchorValue + spanToMax * zoomFactor;
    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) {
      return;
    }
    if (nextMax - nextMin < MIN_DOMAIN_SPAN) {
      const half = MIN_DOMAIN_SPAN / 2;
      nextMin = drag.anchorValue - half;
      nextMax = drag.anchorValue + half;
    }
    const nextDomain: [number, number] = [nextMin, nextMax];
    if (drag.axis === "right") {
      setManualYSecondaryDomain(nextDomain);
    } else {
      setManualYPrimaryDomain(nextDomain);
    }
  }, [onWindowRangeChange]);

  const handleChartMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!chartContainerRef.current || isDraggingPanel) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const hoveredAxis = getAxisTargetFromPoint(localX, localY);
      setAxisHoverTarget(hoveredAxis);
      if (axisDragStateRef.current) {
        applyAxisDragZoom(localX, localY);
        return;
      }
      if (selectionStateRef.current) {
        const bounds = getPlotBounds();
        if (!bounds) {
          return;
        }
        const clampedX = Math.min(Math.max(localX, bounds.plotLeft), bounds.plotRight);
        const clampedY = Math.min(Math.max(localY, bounds.plotTop), bounds.plotBottom);
        const selection = selectionStateRef.current;
        selection.endX = clampedX;
        selection.endY = clampedY;
        if (
          !selection.dragged &&
          (Math.abs(selection.endX - selection.startX) > 4 ||
            Math.abs(selection.endY - selection.startY) > 4)
        ) {
          selection.dragged = true;
          suppressClickRef.current = true;
        }
        if (selection.dragged) {
          setSelectionRange({
            startX: selection.startX,
            endX: selection.endX,
            startY: selection.startY,
            endY: selection.endY,
          });
        }
        return;
      }
      if (hoveredAxis) {
        setHoverAnnotationId(null);
        return;
      }
      const annotation = findAnnotationNearX(localX);
      setHoverAnnotationId(annotation ? annotation.id : null);
    },
    [applyAxisDragZoom, findAnnotationNearX, getAxisTargetFromPoint, getPlotBounds, isDraggingPanel],
  );

  const handleChartMouseLeave = useCallback(() => {
    if (!axisDragStateRef.current) {
      setAxisHoverTarget(null);
    }
    if (!selectionStateRef.current) {
      setHoverAnnotationId(null);
    }
  }, []);

  useEffect(() => {
    if (!isSelecting) {
      return;
    }
    const handleMouseUp = () => {
      const selection = selectionStateRef.current;
      selectionStateRef.current = null;
      setSelectionRange(null);
      setIsSelecting(false);
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
      const yTopPx = Math.min(selection.startY, selection.endY);
      const yBottomPx = Math.max(selection.startY, selection.endY);
      const yPrimaryTop = getAxisValueFromY(yTopPx, domain.yPrimary);
      const yPrimaryBottom = getAxisValueFromY(yBottomPx, domain.yPrimary);
      if (
        yPrimaryTop !== null &&
        yPrimaryBottom !== null &&
        Number.isFinite(yPrimaryTop) &&
        Number.isFinite(yPrimaryBottom)
      ) {
        let nextMin = Math.min(yPrimaryBottom, yPrimaryTop);
        let nextMax = Math.max(yPrimaryBottom, yPrimaryTop);
        if (nextMax - nextMin < MIN_DOMAIN_SPAN) {
          const mid = (nextMin + nextMax) / 2;
          nextMin = mid - MIN_DOMAIN_SPAN / 2;
          nextMax = mid + MIN_DOMAIN_SPAN / 2;
        }
        setManualYPrimaryDomain([nextMin, nextMax]);
      }
      if (hasSecondaryAxis) {
        const ySecondaryTop = getAxisValueFromY(yTopPx, domain.ySecondary);
        const ySecondaryBottom = getAxisValueFromY(yBottomPx, domain.ySecondary);
        if (
          ySecondaryTop !== null &&
          ySecondaryBottom !== null &&
          Number.isFinite(ySecondaryTop) &&
          Number.isFinite(ySecondaryBottom)
        ) {
          let nextMin = Math.min(ySecondaryBottom, ySecondaryTop);
          let nextMax = Math.max(ySecondaryBottom, ySecondaryTop);
          if (nextMax - nextMin < MIN_DOMAIN_SPAN) {
            const mid = (nextMin + nextMax) / 2;
            nextMin = mid - MIN_DOMAIN_SPAN / 2;
            nextMax = mid + MIN_DOMAIN_SPAN / 2;
          }
          setManualYSecondaryDomain([nextMin, nextMax]);
        }
      }
      onWindowRangeChange(start, end);
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!chartContainerRef.current || !selectionStateRef.current) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const bounds = getPlotBounds();
      if (!bounds) {
        return;
      }
      const clampedX = Math.min(Math.max(localX, bounds.plotLeft), bounds.plotRight);
      const localY = event.clientY - rect.top;
      const clampedY = Math.min(Math.max(localY, bounds.plotTop), bounds.plotBottom);
      const selection = selectionStateRef.current;
      selection.endX = clampedX;
      selection.endY = clampedY;
      if (
        !selection.dragged &&
        (Math.abs(selection.endX - selection.startX) > 4 ||
          Math.abs(selection.endY - selection.startY) > 4)
      ) {
        selection.dragged = true;
        suppressClickRef.current = true;
      }
      if (selection.dragged) {
        setSelectionRange({
          startX: selection.startX,
          endX: selection.endX,
          startY: selection.startY,
          endY: selection.endY,
        });
      }
    };
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [
    domain.yPrimary,
    domain.ySecondary,
    getAxisValueFromY,
    getPlotBounds,
    getTickFromX,
    hasSecondaryAxis,
    isSelecting,
    onWindowRangeChange,
  ]);

  useEffect(() => {
    if (!isAxisDragging) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      if (!chartContainerRef.current || !axisDragStateRef.current) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      applyAxisDragZoom(localX, localY);
    };
    const handleMouseUp = () => {
      axisDragStateRef.current = null;
      setIsAxisDragging(false);
      setAxisHoverTarget(null);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [applyAxisDragZoom, isAxisDragging]);

  const activeAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === activeAnnotationId) ?? null,
    [annotations, activeAnnotationId],
  );

  const activeAnnotationPanel = useMemo(() => {
    if (!activeAnnotation || !chartSize.width) {
      return null;
    }
    if (annotationPanelPosition) {
      const panelWidth = panelRef.current?.offsetWidth ?? 180;
      const panelHeight = panelRef.current?.offsetHeight ?? 64;
      const left = Math.min(
        Math.max(annotationPanelPosition.x, 8),
        Math.max(8, chartSize.width - panelWidth - 8),
      );
      const top = Math.min(
        Math.max(annotationPanelPosition.y, 8),
        Math.max(8, chartSize.height - panelHeight - 8),
      );
      return {
        left,
        top,
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
  }, [activeAnnotation, annotationPanelPosition, chartSize.height, chartSize.width, getAnnotationX]);

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
            isAxisDragging || axisHoverTarget
              ? "cursor-ns-resize"
              : hoverAnnotationId
                ? "cursor-pointer"
                : "cursor-crosshair",
          )}
          onMouseDown={handleChartMouseDown}
          onClick={handleChartClick}
          onDoubleClick={handleChartDoubleClick}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
        >
          <div className="absolute inset-0 z-10">
            <ResponsiveContainer width="100%" height="100%" debounce={0}>
              <ChartLines
                data={visibleData}
                selectedMetrics={selectedMetrics}
                domain={domain}
                hasSecondaryAxis={hasSecondaryAxis}
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
              const axisLineColor = "hsl(var(--muted-foreground) / 0.45)";
              const axisLineGradient =
                "linear-gradient(to top," +
                " hsl(var(--muted-foreground) / 0.45) 0%," +
                " hsl(var(--muted-foreground) / 0.45) 80%," +
                " hsl(var(--muted-foreground) / 0.2) 90%," +
                " hsl(var(--muted-foreground) / 0.02) 100% )";
              const isLabeled = Boolean(annotation.label);
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
                      "h-full w-[2px]",
                      hoverAnnotationId === annotation.id && "w-[3px]",
                    )}
                    style={{ background: isLabeled ? axisLineColor : axisLineGradient }}
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
              className="pointer-events-none absolute z-20"
              style={{
                left: `${Math.min(selectionRange.startX, selectionRange.endX)}px`,
                top: `${Math.min(selectionRange.startY, selectionRange.endY)}px`,
                width: `${Math.abs(selectionRange.endX - selectionRange.startX)}px`,
                height: `${Math.abs(selectionRange.endY - selectionRange.startY)}px`,
              }}
            >
              <div className="h-full w-full bg-primary/15 border border-primary/30" />
            </div>
          )}
          {activeAnnotation && activeAnnotationPanel && (
            <div
              data-annotation-panel
              className="absolute z-30 w-fit rounded-md border border-muted/40 bg-background p-1.5 text-xs shadow-md"
              style={{ left: activeAnnotationPanel.left, top: activeAnnotationPanel.top }}
              onClick={(event) => event.stopPropagation()}
              ref={panelRef}
            >
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_11px] items-start gap-1">
                  <div
                    className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-grab select-none"
                    onMouseDown={handlePanelMouseDown}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                    <span>{activeAnnotationPanel.tick}</span>
                  </div>
                  <button
                    type="button"
                    className="justify-self-end flex h-[11px] w-[11px] items-center justify-center text-[10px] text-muted-foreground hover:text-foreground leading-none"
                    onClick={() => setActiveAnnotationId(null)}
                    aria-label="Close annotation editor"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_11px] items-center gap-1">
                  <Input
                    ref={annotationInputRef}
                    value={activeAnnotation.label ?? ""}
                    onChange={(event) => {
                      onAddAnnotation?.({
                        id: activeAnnotation.id,
                        tick: activeAnnotation.tick,
                        label: event.target.value,
                        color: activeAnnotation.color,
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setActiveAnnotationId(null);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setActiveAnnotationId(null);
                      }
                    }}
                    className="h-7 w-[140px] text-xs focus-visible:ring-1 focus-visible:ring-muted/40 focus-visible:ring-offset-0"
                  />
                  <div className="flex h-7 w-[11px] flex-col justify-center gap-0.5">
                    <button
                      type="button"
                      className="group flex items-center justify-center bg-transparent p-0"
                      onClick={() => {
                        onRemoveAnnotation?.({ id: activeAnnotation.id });
                        setActiveAnnotationId(null);
                      }}
                      aria-label="Remove annotation"
                    >
                    <span className="block h-[11px] w-[11px] rounded-[2px] bg-red-500/40 transition-colors group-hover:bg-red-500/80" />
                    </button>
                    <button
                      type="button"
                      className="group flex items-center justify-center bg-transparent p-0"
                      onClick={() => setActiveAnnotationId(null)}
                      aria-label="Done editing annotation"
                    >
                    <span className="block h-[11px] w-[11px] rounded-full bg-emerald-500/40 transition-colors group-hover:bg-emerald-500/80" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
