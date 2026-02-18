import type { SelectedMetric } from "@shared/schema";

export function getValueAtPath(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const part of path) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setValueAtPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let current: Record<string, unknown> = target;
  path.forEach((part, index) => {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
}

export function deleteValueAtPath(target: Record<string, unknown>, path: string[]) {
  if (path.length === 0) {
    return;
  }
  const parents: Array<{ node: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    parents.push({ node: current, key: part });
    current = next as Record<string, unknown>;
  }
  delete current[path[path.length - 1]];
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const { node, key } = parents[i];
    const value = node[key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      delete node[key];
    } else {
      break;
    }
  }
}

export function buildEntitiesForMetrics(
  entities: Record<string, unknown>,
  metrics: SelectedMetric[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  metrics.forEach((metric) => {
    const value = getValueAtPath(entities, metric.path);
    if (value === undefined) {
      return;
    }
    setValueAtPath(result, metric.path, value);
  });
  return result as Record<string, Record<string, unknown>>;
}
