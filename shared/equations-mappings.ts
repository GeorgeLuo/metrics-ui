import type {
  EquationsHitBoxCategory,
  EquationsHitBoxDefinition,
  EquationsMappingEntry,
} from "./schema";

function isEquationsHitBoxCategory(value: unknown): value is EquationsHitBoxCategory {
  return (
    value === "term"
    || value === "operator"
    || value === "function"
    || value === "delimiter"
    || value === "summation"
  );
}

export function cloneEquationsHitBoxDefinition(
  hitBox: EquationsHitBoxDefinition,
): EquationsHitBoxDefinition {
  return {
    id: hitBox.id,
    label: hitBox.label,
    sequence: hitBox.sequence,
    category: hitBox.category,
    latex: hitBox.latex,
  };
}

export function normalizeEquationsHitBoxDefinition(
  value: unknown,
): EquationsHitBoxDefinition | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsHitBoxDefinition>;
  if (
    typeof raw.id !== "string"
    || raw.id.trim().length === 0
    || typeof raw.label !== "string"
    || typeof raw.sequence !== "string"
    || !isEquationsHitBoxCategory(raw.category)
    || typeof raw.latex !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id.trim(),
    label: raw.label,
    sequence: raw.sequence,
    category: raw.category,
    latex: raw.latex,
  };
}

export function cloneEquationsMappingEntry(
  entry: EquationsMappingEntry,
): EquationsMappingEntry {
  return {
    kind: entry.kind,
    value: entry.value,
    ...(typeof entry.displayMode === "boolean" ? { displayMode: entry.displayMode } : {}),
    ...(entry.hitBox ? { hitBox: cloneEquationsHitBoxDefinition(entry.hitBox) } : {}),
  };
}

export function normalizeEquationsMappingEntry(
  value: unknown,
): EquationsMappingEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsMappingEntry>;
  if (raw.kind !== "text" && raw.kind !== "latex") {
    return null;
  }
  if (typeof raw.value !== "string") {
    return null;
  }
  if (raw.kind === "latex" && raw.value.trim().length === 0) {
    return null;
  }
  const hitBox = normalizeEquationsHitBoxDefinition(raw.hitBox);
  return {
    kind: raw.kind,
    value: raw.value,
    ...(typeof raw.displayMode === "boolean" ? { displayMode: raw.displayMode } : {}),
    ...(hitBox ? { hitBox } : {}),
  };
}

export function normalizeEquationsMappingEntries(
  value: unknown,
): EquationsMappingEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => normalizeEquationsMappingEntry(entry))
    .filter((entry): entry is EquationsMappingEntry => entry !== null);
  return normalized;
}
