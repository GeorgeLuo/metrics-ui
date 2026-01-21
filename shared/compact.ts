import type { CaptureRecord } from "./schema";

export const DEFAULT_MAX_NUMERIC_DEPTH = Number.POSITIVE_INFINITY;
const MAX_ARRAY_ENTRIES = 200;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function compactValue(
  value: unknown,
  depth: number,
  maxDepth: number,
): unknown | undefined {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      return undefined;
    }
    const limited = value.slice(0, MAX_ARRAY_ENTRIES);
    const compacted = limited.map((item) => compactValue(item, depth + 1, maxDepth));
    if (compacted.every((entry) => entry === undefined)) {
      return undefined;
    }
    return compacted;
  }

  if (depth >= maxDepth) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const compacted = compactValue(child, depth + 1, maxDepth);
    if (compacted !== undefined) {
      result[key] = compacted;
    }
  }

  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
}

export function compactEntities(
  entities: Record<string, unknown> | null | undefined,
  maxDepth = DEFAULT_MAX_NUMERIC_DEPTH,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
    return result;
  }

  for (const [entityId, components] of Object.entries(
    entities as Record<string, unknown>,
  )) {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      continue;
    }
    const compactedComponents: Record<string, unknown> = {};
    for (const [componentId, componentValue] of Object.entries(
      components as Record<string, unknown>,
    )) {
      const compactedValue = compactValue(componentValue, 1, maxDepth);
      if (compactedValue !== undefined) {
        compactedComponents[componentId] = compactedValue;
      }
    }
    if (Object.keys(compactedComponents).length > 0) {
      result[entityId] = compactedComponents;
    }
  }

  return result;
}

export function compactRecord(
  record: CaptureRecord,
  maxDepth = DEFAULT_MAX_NUMERIC_DEPTH,
): CaptureRecord {
  return { tick: record.tick, entities: compactEntities(record.entities, maxDepth) };
}
