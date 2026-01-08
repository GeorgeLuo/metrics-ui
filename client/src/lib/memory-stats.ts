import type {
  CaptureRecord,
  ComponentNode,
  DataPoint,
  ComponentTreeStats,
  ChartDataStats,
} from "@shared/schema";

export interface ValueStats {
  objectProps: number;
  leafValues: number;
  numeric: number;
  string: number;
  boolean: number;
  nulls: number;
  arrays: number;
  arrayValues: number;
  objects: number;
  stringChars: number;
}

export interface CaptureStats extends ValueStats {
  records: number;
  tickCount: number;
  componentNodes: number;
}

export interface PerformanceMemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export function createEmptyCaptureStats(): CaptureStats {
  return {
    records: 0,
    tickCount: 0,
    componentNodes: 0,
    objectProps: 0,
    leafValues: 0,
    numeric: 0,
    string: 0,
    boolean: 0,
    nulls: 0,
    arrays: 0,
    arrayValues: 0,
    objects: 0,
    stringChars: 0,
  };
}

export function appendRecordStats(stats: CaptureStats, record: CaptureRecord): void {
  stats.records += 1;
  stats.tickCount = Math.max(stats.tickCount, record.tick);
  accumulateValueStats(record, stats);
}

export function accumulateValueStats(value: unknown, stats: ValueStats): void {
  if (value === null || value === undefined) {
    stats.leafValues += 1;
    stats.nulls += 1;
    return;
  }

  const valueType = typeof value;
  if (valueType === "number") {
    stats.leafValues += 1;
    stats.numeric += 1;
    return;
  }

  if (valueType === "string") {
    stats.leafValues += 1;
    stats.string += 1;
    stats.stringChars += value.length;
    return;
  }

  if (valueType === "boolean") {
    stats.leafValues += 1;
    stats.boolean += 1;
    return;
  }

  if (Array.isArray(value)) {
    stats.arrays += 1;
    stats.arrayValues += value.length;
    value.forEach((entry) => accumulateValueStats(entry, stats));
    return;
  }

  if (valueType === "object") {
    stats.objects += 1;
    Object.entries(value as Record<string, unknown>).forEach(([, entry]) => {
      stats.objectProps += 1;
      accumulateValueStats(entry, stats);
    });
  }
}

export function countComponentNodes(nodes: ComponentNode[]): number {
  let total = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    total += 1;
    if (node.children.length > 0) {
      stack.push(...node.children);
    }
  }
  return total;
}

export function analyzeComponentTree(nodes: ComponentNode[]): ComponentTreeStats {
  const stats: ComponentTreeStats = {
    nodes: 0,
    leaves: 0,
    numericLeaves: 0,
    stringLeaves: 0,
    booleanLeaves: 0,
    nullLeaves: 0,
    arrayNodes: 0,
    objectNodes: 0,
    maxDepth: 0,
    pathSegments: 0,
    pathChars: 0,
    idChars: 0,
    labelChars: 0,
  };

  const stack: Array<{ node: ComponentNode; depth: number }> = nodes.map((node) => ({
    node,
    depth: 1,
  }));

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    const { node, depth } = entry;

    stats.nodes += 1;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.pathSegments += node.path.length;
    stats.pathChars += node.path.reduce((sum, part) => sum + part.length, 0);
    stats.idChars += node.id.length;
    stats.labelChars += node.label.length;

    if (node.valueType === "array") {
      stats.arrayNodes += 1;
    } else if (node.valueType === "object") {
      stats.objectNodes += 1;
    }

    if (node.isLeaf) {
      stats.leaves += 1;
      switch (node.valueType) {
        case "number":
          stats.numericLeaves += 1;
          break;
        case "string":
          stats.stringLeaves += 1;
          break;
        case "boolean":
          stats.booleanLeaves += 1;
          break;
        case "null":
          stats.nullLeaves += 1;
          break;
        default:
          break;
      }
    }

    if (node.children.length > 0) {
      node.children.forEach((child) => {
        stack.push({ node: child, depth: depth + 1 });
      });
    }
  }

  return stats;
}

export function analyzeChartData(data: DataPoint[]): ChartDataStats {
  const metricKeys = new Set<string>();
  let totalObjectProps = 0;
  let totalMetricKeys = 0;
  let keysPerPointMin = Number.POSITIVE_INFINITY;
  let keysPerPointMax = 0;
  let numericValues = 0;
  let nullValues = 0;
  let nonNumericValues = 0;

  data.forEach((point) => {
    const keys = Object.keys(point);
    totalObjectProps += keys.length;
    let metricCount = 0;

    keys.forEach((key) => {
      if (key === "tick") {
        return;
      }
      metricCount += 1;
      metricKeys.add(key);
      const value = (point as Record<string, unknown>)[key];
      if (value === null) {
        nullValues += 1;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        numericValues += 1;
      } else {
        nonNumericValues += 1;
      }
    });

    keysPerPointMin = Math.min(keysPerPointMin, metricCount);
    keysPerPointMax = Math.max(keysPerPointMax, metricCount);
    totalMetricKeys += metricCount;
  });

  const points = data.length;
  const keysPerPointAvg = points > 0 ? totalMetricKeys / points : 0;

  return {
    points,
    totalObjectProps,
    totalMetricKeys,
    uniqueMetricKeys: metricKeys.size,
    keysPerPointMin: Number.isFinite(keysPerPointMin) ? keysPerPointMin : 0,
    keysPerPointMax,
    keysPerPointAvg,
    numericValues,
    nullValues,
    nonNumericValues,
  };
}

export function readPerformanceMemory(): PerformanceMemorySnapshot | null {
  if (typeof performance === "undefined") {
    return null;
  }

  const memory = (performance as Performance & { memory?: PerformanceMemorySnapshot }).memory;
  if (!memory) {
    return null;
  }

  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}
