import type { SelectedMetric, DataPoint, CaptureSession } from "@shared/schema";

function sanitizeKey(key: string): string {
  return key.replace(/\./g, "_");
}

interface MetricsHUDProps {
  currentData: DataPoint | null;
  selectedMetrics: SelectedMetric[];
  currentTick: number;
  captures: CaptureSession[];
}

export function MetricsHUD({ currentData, selectedMetrics, currentTick, captures }: MetricsHUDProps) {
  if (selectedMetrics.length === 0 || !currentData) {
    return null;
  }

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
      className="absolute top-4 right-4 bg-background/80 backdrop-blur-sm p-3 min-w-44 z-20"
      data-testid="metrics-hud"
    >
      <div className="text-xs text-muted-foreground mb-2 font-mono tracking-tight">
        {currentTick.toLocaleString()}
      </div>
      <div className="flex flex-col gap-1.5">
        {selectedMetrics.map((metric) => {
          const dataKey = getDataKey(metric);
          const value = currentData[dataKey];
          const displayValue =
            typeof value === "number"
              ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : value ?? "—";
          const captureName = getCaptureFilename(metric.captureId);

          return (
            <div key={`${metric.captureId}-${metric.fullPath}`} className="flex items-center gap-2">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
