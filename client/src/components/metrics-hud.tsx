import type { SelectedMetric, DataPoint } from "@shared/schema";

function sanitizeKey(key: string): string {
  return key.replace(/\./g, "_");
}

interface MetricsHUDProps {
  currentData: DataPoint | null;
  selectedMetrics: SelectedMetric[];
  currentTick: number;
}

export function MetricsHUD({ currentData, selectedMetrics, currentTick }: MetricsHUDProps) {
  if (selectedMetrics.length === 0 || !currentData) {
    return null;
  }

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
          const sanitizedKey = sanitizeKey(metric.fullPath);
          const value = currentData[sanitizedKey];
          const displayValue =
            typeof value === "number"
              ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : value ?? "—";

          return (
            <div key={metric.fullPath} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: metric.color }}
              />
              <span className="text-xs text-muted-foreground truncate flex-1">{metric.label}</span>
              <span className="font-mono text-sm font-medium" data-testid={`hud-value-${metric.fullPath}`}>
                {displayValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
