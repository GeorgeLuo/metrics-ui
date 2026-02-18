import type { DerivationGroup, SelectedMetric } from "@shared/schema";
import {
  cloneMetric,
  getMetricIdentityKey,
  normalizeMetricList,
  uniqueMetrics,
} from "@/lib/dashboard/metric-utils";

export function getDerivationGroupInputMetrics(group: DerivationGroup): SelectedMetric[] {
  return Array.isArray(group.metrics) ? group.metrics : [];
}

export function getDerivationGroupDerivedMetrics(group: DerivationGroup): SelectedMetric[] {
  return Array.isArray(group.derivedMetrics) ? group.derivedMetrics : [];
}

export function getDerivationGroupDisplayMetrics(group: DerivationGroup): SelectedMetric[] {
  return uniqueMetrics([
    ...getDerivationGroupInputMetrics(group),
    ...getDerivationGroupDerivedMetrics(group),
  ]);
}

function metricOutputKey(metric: Pick<SelectedMetric, "path" | "label">): string {
  const fromPath = metric.path[metric.path.length - 1];
  if (typeof fromPath === "string" && fromPath.trim().length > 0) {
    return fromPath;
  }
  return metric.label;
}

export function buildDerivedMetricLabel(
  groupName: string,
  metric: Pick<SelectedMetric, "path" | "label">,
): string {
  const baseName = groupName.trim().length > 0 ? groupName.trim() : "Derivation";
  return `${baseName}.${metricOutputKey(metric)}`;
}

export function resolveDerivedGroupIdForCapture(
  captureId: string,
  groups: DerivationGroup[],
  outputGroupByCapture?: Map<string, string>,
): string {
  const mappedGroupId = outputGroupByCapture?.get(captureId) ?? "";
  if (mappedGroupId && groups.some((group) => group.id === mappedGroupId)) {
    return mappedGroupId;
  }

  for (const group of groups) {
    const pluginId = typeof group.pluginId === "string" ? group.pluginId.trim() : "";
    if (pluginId) {
      const baseCaptureId = `derive-${group.id}-${pluginId}`;
      if (captureId === baseCaptureId || captureId.startsWith(`${baseCaptureId}-`)) {
        return group.id;
      }
    }
    const hasDerivedMetricFromCapture = getDerivationGroupDerivedMetrics(group).some(
      (metric) => metric.captureId === captureId,
    );
    if (hasDerivedMetricFromCapture) {
      return group.id;
    }
  }

  return "";
}

export function normalizeDerivationGroups(raw: unknown): DerivationGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const groups: DerivationGroup[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    if (!id) {
      return;
    }
    const name = typeof candidate.name === "string" ? candidate.name : id;
    const pluginId = typeof candidate.pluginId === "string" ? candidate.pluginId : undefined;
    const normalizedPluginId = pluginId?.trim() ?? "";
    const metrics = normalizeMetricList(candidate.metrics);
    const derivedMetrics = normalizeMetricList(candidate.derivedMetrics);

    let inputMetrics = metrics;
    let outputMetrics = derivedMetrics;
    // Backward compatibility with legacy state where derived metrics were stored in metrics[].
    if (outputMetrics.length === 0 && normalizedPluginId.length > 0) {
      const derivedPrefix = `derive-${id}-${normalizedPluginId}`;
      inputMetrics = [];
      outputMetrics = [];
      metrics.forEach((metric) => {
        if (
          metric.captureId === derivedPrefix
          || metric.captureId.startsWith(`${derivedPrefix}-`)
        ) {
          outputMetrics.push(metric);
        } else {
          inputMetrics.push(metric);
        }
      });
    }

    // Keep input/output sets disjoint. If a metric is already tracked as a derived
    // output, it should not also be treated as an input for the same group.
    const derivedMetricKeys = new Set(outputMetrics.map((metric) => getMetricIdentityKey(metric)));
    if (derivedMetricKeys.size > 0) {
      inputMetrics = inputMetrics.filter((metric) => !derivedMetricKeys.has(getMetricIdentityKey(metric)));
    }

    groups.push({
      id,
      name,
      metrics: uniqueMetrics(inputMetrics),
      derivedMetrics: uniqueMetrics(outputMetrics),
      pluginId: normalizedPluginId.length > 0 ? normalizedPluginId : undefined,
    });
  });
  return groups;
}

export function cloneDerivationMetric(metric: SelectedMetric): SelectedMetric {
  return cloneMetric(metric);
}
