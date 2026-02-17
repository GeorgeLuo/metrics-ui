import { useState, useCallback, useRef, useEffect } from "react";
import { GripVertical } from "lucide-react";
import type { SelectedMetric, DataPoint, CaptureSession } from "@shared/schema";
import { cn } from "@/lib/utils";

function sanitizeKey(key: string): string {
  return key.replace(/\./g, "_");
}

const HUD_MAX_VISIBLE_ROWS = 10;
const HUD_ROW_AREA_MAX_HEIGHT_PX = 300;
const HUD_DEFAULT_POSITION = { x: 16, y: 16 };

interface MetricsHUDProps {
  currentData: DataPoint | null;
  selectedMetrics: SelectedMetric[];
  currentTick: number;
  captures: CaptureSession[];
  isVisible: boolean;
  highlightedMetricKey?: string | null;
  analysisKeys?: Set<string>;
  onToggleAnalysisMetric?: (metric: SelectedMetric) => void;
  onToggleMetricAxis?: (metric: SelectedMetric) => void;
  isMetricOnSecondaryAxis?: (metric: SelectedMetric) => boolean;
  onDeselectMetric?: (captureId: string, fullPath: string) => void;
  onHoverMetric?: (metricKey: string | null) => void;
}

export function MetricsHUD({
  currentData,
  selectedMetrics,
  currentTick,
  captures,
  isVisible,
  highlightedMetricKey,
  analysisKeys,
  onToggleAnalysisMetric,
  onToggleMetricAxis,
  isMetricOnSecondaryAxis,
  onDeselectMetric,
  onHoverMetric,
}: MetricsHUDProps) {
  const [position, setPosition] = useState(HUD_DEFAULT_POSITION);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isVisible) {
      setPosition(HUD_DEFAULT_POSITION);
      setIsDragging(false);
    }
  }, [isVisible]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPosition({
        x: moveEvent.clientX - dragOffset.current.x,
        y: moveEvent.clientY - dragOffset.current.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [position]);

  if (!isVisible || selectedMetrics.length === 0) {
    return null;
  }

  const dataPoint = currentData ?? ({} as DataPoint);
  const shouldScrollRows = selectedMetrics.length > HUD_MAX_VISIBLE_ROWS;

  const getDataKey = (metric: SelectedMetric): string => {
    return `${metric.captureId}_${sanitizeKey(metric.fullPath)}`;
  };

  const getCaptureFilename = (captureId: string): string => {
    const capture = captures.find(c => c.id === captureId);
    if (!capture) return captureId;
    const name = capture.filename.replace('.jsonl', '');
    return name.length > 6 ? name.substring(0, 6) : name;
  };

  return (
    <div
      className="absolute bg-background/80 backdrop-blur-sm p-3 min-w-44 z-20 select-none"
      style={{
        top: position.y,
        right: "auto",
        left: position.x,
        cursor: isDragging ? "grabbing" : "default",
      }}
      data-testid="metrics-hud"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 hover:bg-muted/50 rounded"
          onMouseDown={handleMouseDown}
        >
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
        <div className="text-xs text-muted-foreground font-mono tracking-tight">
          {currentTick.toLocaleString()}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-col gap-1.5",
          shouldScrollRows && "overflow-y-auto overscroll-contain pr-1",
        )}
        style={
          shouldScrollRows
            ? { maxHeight: `${HUD_ROW_AREA_MAX_HEIGHT_PX}px` }
            : undefined
        }
        onMouseLeave={() => onHoverMetric?.(null)}
      >
        {selectedMetrics.map((metric) => {
          const dataKey = getDataKey(metric);
          const value = dataPoint[dataKey];
          const displayValue =
            typeof value === "number"
              ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : value ?? "—";
          const captureName = getCaptureFilename(metric.captureId);

          const isHighlighted = highlightedMetricKey === dataKey;
          const analysisKey = `${metric.captureId}::${metric.fullPath}`;
          const isAnalysisSelected = analysisKeys?.has(analysisKey) ?? false;
          const isSecondaryAxis = isMetricOnSecondaryAxis?.(metric) ?? metric.axis === "y2";

          return (
            <div
              key={`${metric.captureId}-${metric.fullPath}`}
              className={cn(
                "flex items-center gap-2 rounded-sm px-1 -mx-1 cursor-pointer",
                isAnalysisSelected && "bg-muted/50 text-foreground",
                isHighlighted ? "text-foreground" : "text-muted-foreground",
              )}
              onMouseEnter={() => onHoverMetric?.(dataKey)}
              onClick={() => onToggleAnalysisMetric?.(metric)}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: metric.color }}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">
                {captureName}: {metric.label}
              </span>
              <span className="font-mono text-xs font-medium" data-testid={`hud-value-${metric.captureId}-${metric.fullPath}`}>
                {displayValue}
              </span>
              {onToggleMetricAxis && (
                <button
                  type="button"
                  className={cn(
                    "text-[10px] font-mono px-1",
                    isSecondaryAxis
                      ? "text-foreground bg-muted/70"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleMetricAxis(metric);
                  }}
                  aria-label={`Toggle secondary axis for ${captureName}: ${metric.label}`}
                  title={`Toggle secondary axis for ${captureName}: ${metric.label}`}
                >
                  Y2
                </button>
              )}
              {onDeselectMetric && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeselectMetric(metric.captureId, metric.fullPath);
                  }}
                  aria-label={`Remove ${captureName}: ${metric.label}`}
                  title={`Remove ${captureName}: ${metric.label}`}
                >
                  x
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
