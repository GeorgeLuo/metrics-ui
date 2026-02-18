import type { SelectedMetric } from "@shared/schema";

export function sanitizeMetricPathKey(key: string): string {
  return key.replace(/\./g, "_");
}

export function getMetricIdentityKey(
  metric: Pick<SelectedMetric, "captureId" | "fullPath">,
): string {
  return `${metric.captureId}::${metric.fullPath}`;
}

export function buildSeriesKey(captureId: string, fullPath: string): string {
  return `${captureId}::${fullPath}`;
}

export function normalizeMetricAxis(axis: unknown): "y2" | undefined {
  return axis === "y2" ? "y2" : undefined;
}

export function isSelectedMetricLike(metric: unknown): metric is SelectedMetric {
  if (!metric || typeof metric !== "object") {
    return false;
  }
  const value = metric as Record<string, unknown>;
  return (
    typeof value.captureId === "string" &&
    Array.isArray(value.path) &&
    typeof value.fullPath === "string" &&
    typeof value.label === "string" &&
    typeof value.color === "string" &&
    (value.axis === undefined || value.axis === "y1" || value.axis === "y2")
  );
}

export function uniqueMetrics(metrics: SelectedMetric[]): SelectedMetric[] {
  const seen = new Set<string>();
  const result: SelectedMetric[] = [];
  metrics.forEach((metric) => {
    const key = getMetricIdentityKey(metric);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(metric);
  });
  return result;
}

export function normalizeMetricList(metrics: unknown): SelectedMetric[] {
  if (!Array.isArray(metrics)) {
    return [];
  }
  const normalized = metrics
    .filter((entry) => isSelectedMetricLike(entry))
    .map((entry) => {
      const value = entry as SelectedMetric;
      return {
        captureId: value.captureId,
        path: Array.isArray(value.path) ? [...value.path] : [],
        fullPath: value.fullPath,
        label: value.label,
        color: value.color,
        axis: normalizeMetricAxis(value.axis),
      } satisfies SelectedMetric;
    });
  return uniqueMetrics(normalized);
}

export function cloneMetric(metric: SelectedMetric): SelectedMetric {
  return {
    captureId: metric.captureId,
    path: [...metric.path],
    fullPath: metric.fullPath,
    label: metric.label,
    color: metric.color,
    axis: normalizeMetricAxis(metric.axis),
  };
}
