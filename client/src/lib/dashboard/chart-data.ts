import type {
  CaptureRecord,
  CaptureSession,
  ComponentNode,
  DataPoint,
  SelectedMetric,
} from "@shared/schema";
import { buildComponentTreeFromEntities } from "@shared/component-tree";
import { sanitizeMetricPathKey } from "@/lib/dashboard/metric-utils";

export interface MetricCoverageEntry {
  numericCount: number;
  total: number;
  lastTick: number | null;
}

export type MetricCoverageByCapture = Record<string, Record<string, MetricCoverageEntry>>;

export function parseComponentTree(records: CaptureRecord[]): ComponentNode[] {
  if (records.length === 0) {
    return [];
  }

  const firstRecord =
    records.find((record) => record.entities && Object.keys(record.entities).length > 0)
    ?? records[0];
  if (!firstRecord) {
    return [];
  }

  return buildComponentTreeFromEntities(firstRecord.entities || {});
}

export function extractDataPoints(
  captures: CaptureSession[],
  selectedMetrics: SelectedMetric[],
): { data: DataPoint[]; coverage: MetricCoverageByCapture } {
  const tickMap = new Map<number, DataPoint>();
  const coverage: MetricCoverageByCapture = {};

  const activeCaptures = captures.filter((capture) => capture.isActive);

  activeCaptures.forEach((capture) => {
    const captureMetrics = selectedMetrics.filter((metric) => metric.captureId === capture.id);
    if (captureMetrics.length === 0) {
      return;
    }
    if (!coverage[capture.id]) {
      coverage[capture.id] = {};
    }
    const captureCoverage = coverage[capture.id];
    const totalFrames = capture.records.length;
    captureMetrics.forEach((metric) => {
      captureCoverage[metric.fullPath] = {
        numericCount: 0,
        total: totalFrames,
        lastTick: null,
      };
    });

    capture.records.forEach((record) => {
      if (!tickMap.has(record.tick)) {
        tickMap.set(record.tick, { tick: record.tick });
      }

      const point = tickMap.get(record.tick)!;

      captureMetrics.forEach((metric) => {
        const pathParts = metric.path;
        let value: unknown = record.entities;

        for (const part of pathParts) {
          if (value && typeof value === "object" && part in value) {
            value = (value as Record<string, unknown>)[part];
          } else {
            value = null;
            break;
          }
        }

        const dataKey = `${capture.id}_${sanitizeMetricPathKey(metric.fullPath)}`;
        if (typeof value === "number") {
          point[dataKey] = value;
          const metricCoverage = captureCoverage[metric.fullPath];
          if (metricCoverage) {
            metricCoverage.numericCount += 1;
            metricCoverage.lastTick = record.tick;
          }
        } else {
          point[dataKey] = null;
        }
      });
    });
  });

  return {
    data: Array.from(tickMap.values()).sort((a, b) => a.tick - b.tick),
    coverage,
  };
}
