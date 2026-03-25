import type {
  EquationsHitBoxCategory,
  EquationsHitBoxDefinition,
  EquationsMappingEntry,
  EquationsPaneCardBlock,
  EquationsPiecewiseRow,
} from "./schema";
import {
  cloneVisualizationFrameState,
  normalizeVisualizationFrameState,
} from "./visualization-frame-state";

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizePositiveNumberTuple2(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value)
    && value.length === 2
    && isFinitePositiveNumber(value[0])
    && isFinitePositiveNumber(value[1])
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}

function isEquationsHitBoxCategory(value: unknown): value is EquationsHitBoxCategory {
  return (
    value === "term"
    || value === "operator"
    || value === "function"
    || value === "delimiter"
    || value === "summation"
    || value === "branch"
    || value === "condition"
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

export function cloneEquationsPiecewiseRow(
  row: EquationsPiecewiseRow,
): EquationsPiecewiseRow {
  return {
    expression: row.expression.map(cloneEquationsMappingEntry),
    ...(row.condition ? { condition: row.condition.map(cloneEquationsMappingEntry) } : {}),
  };
}

export function cloneEquationsPaneCardBlock(
  block: EquationsPaneCardBlock,
): EquationsPaneCardBlock {
  if (block.kind === "text") {
    const visualizationFrame = block.visualizationFrame
      ? cloneVisualizationFrameState(block.visualizationFrame)
      : undefined;
    return {
      kind: "text",
      value: block.value,
      ...(visualizationFrame ? { visualizationFrame } : {}),
      ...(typeof block.visualizationLabel === "string" ? { visualizationLabel: block.visualizationLabel } : {}),
    };
  }
  if (block.kind === "math") {
    return {
      kind: "math",
      latex: block.latex,
      ...(typeof block.displayMode === "boolean" ? { displayMode: block.displayMode } : {}),
    };
  }
  if (block.kind === "split") {
    return {
      kind: "split",
      left: block.left.map(cloneEquationsPaneCardBlock),
      right: block.right.map(cloneEquationsPaneCardBlock),
      ...(block.fractions ? { fractions: [...block.fractions] as [number, number] } : {}),
    };
  }
  return {
    kind: "mappings",
    mappings: block.mappings.map(cloneEquationsMappingEntry),
  };
}

export function normalizeEquationsPaneCardBlock(
  value: unknown,
): EquationsPaneCardBlock | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsPaneCardBlock>;
  if (raw.kind === "text") {
    if (typeof raw.value !== "string") {
      return null;
    }
    const visualizationFrame = normalizeVisualizationFrameState(
      (raw as { visualizationFrame?: unknown }).visualizationFrame,
    );
    const visualizationLabel = typeof (raw as { visualizationLabel?: unknown }).visualizationLabel === "string"
      && (raw as { visualizationLabel: string }).visualizationLabel.trim().length > 0
      ? (raw as { visualizationLabel: string }).visualizationLabel.trim()
      : undefined;
    return {
      kind: "text",
      value: raw.value,
      ...(visualizationFrame ? { visualizationFrame } : {}),
      ...(visualizationFrame && visualizationLabel ? { visualizationLabel } : {}),
    };
  }
  if (raw.kind === "math") {
    if (typeof raw.latex !== "string" || raw.latex.trim().length === 0) {
      return null;
    }
    return {
      kind: "math",
      latex: raw.latex,
      ...(typeof raw.displayMode === "boolean" ? { displayMode: raw.displayMode } : {}),
    };
  }
  if (raw.kind === "mappings") {
    const mappings = normalizeEquationsMappingEntries(raw.mappings);
    if (!mappings || mappings.length === 0) {
      return null;
    }
    return {
      kind: "mappings",
      mappings,
    };
  }
  if (raw.kind === "split") {
    const left = normalizeEquationsPaneCardBlocks(raw.left);
    const right = normalizeEquationsPaneCardBlocks(raw.right);
    if (!left || left.length === 0 || !right || right.length === 0) {
      return null;
    }
    const fractions = normalizePositiveNumberTuple2(raw.fractions);
    return {
      kind: "split",
      left,
      right,
      ...(fractions ? { fractions } : {}),
    };
  }
  return null;
}

export function normalizeEquationsPaneCardBlocks(
  value: unknown,
): EquationsPaneCardBlock[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => normalizeEquationsPaneCardBlock(entry))
    .filter((entry): entry is EquationsPaneCardBlock => entry !== null);
  return normalized;
}

export function normalizeEquationsPiecewiseRows(
  value: unknown,
): EquationsPiecewiseRow[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const raw = entry as Partial<EquationsPiecewiseRow>;
      const expression = normalizeEquationsMappingEntries(raw.expression);
      const condition = normalizeEquationsMappingEntries(raw.condition);
      if (!expression || expression.length === 0) {
        return null;
      }
      return {
        expression,
        ...(condition && condition.length > 0 ? { condition } : {}),
      };
    })
    .filter((entry): entry is EquationsPiecewiseRow => entry !== null);
  return normalized;
}
