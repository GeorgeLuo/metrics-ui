import type { RefObject } from "react";
import { SubappFloatingFrame } from "@/components/floating-frame";
import type { SelectedMetric, DataPoint, CaptureSession } from "@shared/schema";
import { DASHBOARD_STORAGE_KEYS } from "@/lib/dashboard/storage";
import { cn } from "@/lib/utils";
import { sanitizeMetricPathKey } from "@/lib/dashboard/metric-utils";

const HUD_MAX_VISIBLE_ROWS = 10;
const HUD_ROW_AREA_MAX_HEIGHT_PX = 300;
const HUD_DEFAULT_POSITION = { x: 16, y: 16 };

interface MetricsHUDProps {
  currentData: DataPoint | null;
  selectedMetrics: SelectedMetric[];
  currentTick: number;
  captures: CaptureSession[];
  isVisible: boolean;
  activeDerivationGroupName?: string;
  highlightedMetricKey?: string | null;
  analysisKeys?: Set<string>;
  onToggleAnalysisMetric?: (metric: SelectedMetric) => void;
  onToggleMetricAxis?: (metric: SelectedMetric) => void;
  isMetricOnSecondaryAxis?: (metric: SelectedMetric) => boolean;
  onDeselectMetric?: (captureId: string, fullPath: string) => void;
  onHoverMetric?: (metricKey: string | null) => void;
  containerRef: RefObject<HTMLElement | null>;
}

export function MetricsHUD({
  currentData,
  selectedMetrics,
  currentTick,
  captures,
  isVisible,
  activeDerivationGroupName,
  highlightedMetricKey,
  analysisKeys,
  onToggleAnalysisMetric,
  onToggleMetricAxis,
  isMetricOnSecondaryAxis,
  onDeselectMetric,
  onHoverMetric,
  containerRef,
}: MetricsHUDProps) {
  if (!isVisible || selectedMetrics.length === 0) {
    return null;
  }

  const dataPoint = currentData ?? ({} as DataPoint);
  const shouldScrollRows = selectedMetrics.length > HUD_MAX_VISIBLE_ROWS;

  const getDataKey = (metric: SelectedMetric): string => {
    return `${metric.captureId}_${sanitizeMetricPathKey(metric.fullPath)}`;
  };

  const getCaptureFilename = (captureId: string): string => {
    const capture = captures.find((entry) => entry.id === captureId);
    if (!capture) {
      return captureId;
    }
    const name = capture.filename.replace(".jsonl", "");
    return name.length > 6 ? name.substring(0, 6) : name;
  };

  return (
    <SubappFloatingFrame
      title={currentTick.toLocaleString()}
      containerRef={containerRef}
      defaultPosition={HUD_DEFAULT_POSITION}
      dataTestId="metrics-hud"
      stateStorageKey={DASHBOARD_STORAGE_KEYS.metricsHudFrame}
      className="min-w-[176px] max-w-[360px] border-0 bg-background/80 text-foreground shadow-md backdrop-blur-sm"
      headerClassName="border-b-0 px-2 py-1"
      titleClassName="font-mono tracking-tight text-muted-foreground"
      dragHandleClassName="rounded p-0.5 -ml-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      controlButtonClassName="text-muted-foreground hover:text-foreground"
      contentClassName="!px-3 !pb-3 !pt-0 text-foreground"
      contentMinHeight={0}
      dragHint="Drag the HUD within the metrics area."
    >
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
          const groupName =
            typeof activeDerivationGroupName === "string" && activeDerivationGroupName.trim().length > 0
              ? activeDerivationGroupName.trim()
              : "active derivation group";
          const rowHint = isAnalysisSelected
            ? `Click to remove this metric from ${groupName}.`
            : `Click to add this metric to ${groupName}.`;

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
              data-hint={rowHint}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: metric.color }}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">
                {captureName}: {metric.label}
              </span>
              <span
                className="font-mono text-xs font-medium"
                data-testid={`hud-value-${metric.captureId}-${metric.fullPath}`}
              >
                {displayValue}
              </span>
              {onToggleMetricAxis ? (
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
              ) : null}
              {onDeselectMetric ? (
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
              ) : null}
            </div>
          );
        })}
      </div>
    </SubappFloatingFrame>
  );
}
