import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { LineChart as LineChartIcon, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataPoint, SelectedMetric, CaptureSession } from "@shared/schema";
import { cn } from "@/lib/utils";

function sanitizeKey(key: string): string {
  return key.replace(/\./g, "_");
}

interface MetricsChartProps {
  data: DataPoint[];
  selectedMetrics: SelectedMetric[];
  currentTick: number;
  windowSize: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  isAutoZoom: boolean;
  captures: CaptureSession[];
}

export function MetricsChart({
  data,
  selectedMetrics,
  currentTick,
  windowSize,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  isAutoZoom,
  captures,
}: MetricsChartProps) {
  const visibleData = useMemo(() => {
    if (data.length === 0) return [];

    const startTick = Math.max(1, currentTick - windowSize + 1);
    return data.filter((d) => d.tick >= startTick && d.tick <= currentTick);
  }, [data, currentTick, windowSize]);

  const getDataKey = (metric: SelectedMetric): string => {
    return `${metric.captureId}_${sanitizeKey(metric.fullPath)}`;
  };

  const getCaptureFilename = (captureId: string): string => {
    const capture = captures.find(c => c.id === captureId);
    if (!capture) return captureId;
    const name = capture.filename.replace('.jsonl', '');
    return name.length > 8 ? name.substring(0, 8) : name;
  };

  const domain = useMemo(() => {
    if (data.length === 0) return { x: [0, 50], y: [0, 100] };

    const xMin = visibleData.length > 0 ? Math.min(...visibleData.map((d) => d.tick)) : 0;
    const xMax = visibleData.length > 0 ? Math.max(...visibleData.map((d) => d.tick)) : 50;

    let yMin = Infinity;
    let yMax = -Infinity;

    visibleData.forEach((point) => {
      selectedMetrics.forEach((metric) => {
        const dataKey = getDataKey(metric);
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
  }, [visibleData, selectedMetrics, data.length]);

  if (selectedMetrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <LineChartIcon className="w-12 h-12 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">No metrics selected</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full">
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
          className={cn(!isAutoZoom && "text-primary")}
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 p-4 pt-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
              labelFormatter={(label) => `Tick ${label}`}
              formatter={(value: number, name: string) => {
                const metric = selectedMetrics.find((m) => getDataKey(m) === name);
                const captureName = metric ? getCaptureFilename(metric.captureId) : '';
                const label = metric ? `${captureName}: ${metric.label}` : name;
                return [
                  typeof value === "number" ? value.toLocaleString() : value,
                  label,
                ];
              }}
            />
            <Legend
              verticalAlign="top"
              height={36}
              formatter={(value) => {
                const metric = selectedMetrics.find((m) => getDataKey(m) === value);
                if (!metric) return <span className="text-xs">{value}</span>;
                const captureName = getCaptureFilename(metric.captureId);
                return <span className="text-xs">{captureName}: {metric.label}</span>;
              }}
            />
            <ReferenceLine
              x={currentTick}
              stroke="hsl(var(--primary))"
              strokeDasharray="5 5"
              strokeWidth={2}
            />
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
        </ResponsiveContainer>
      </div>
    </div>
  );
}
