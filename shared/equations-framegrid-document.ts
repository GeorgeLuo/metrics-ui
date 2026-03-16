import type {
  EquationsFrameGridDocument,
  EquationsFrameGridItem,
  EquationsPaneCard,
  EquationsPaneCell,
  EquationsPanePlacement,
  EquationsPaneState,
  FrameGridFitMode,
} from "./schema";
import {
  cloneEquationsMathExpression,
  normalizeEquationsMathExpression,
} from "./equations-math";
import {
  cloneEquationsMappingEntry,
  normalizeEquationsMappingEntries,
} from "./equations-mappings";

type BuildEquationsFrameGridDocumentOptions = {
  detailsFallbackBody?: string;
  frameBorderDiv?: [number, number];
  cellBorderDiv?: [number, number];
  fitMode?: FrameGridFitMode;
};

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizePositiveNumberTuple2(
  value: unknown,
  fallback: [number, number],
): [number, number] {
  if (
    Array.isArray(value)
    && value.length === 2
    && isFinitePositiveNumber(value[0])
    && isFinitePositiveNumber(value[1])
  ) {
    return [value[0], value[1]];
  }
  return [...fallback] as [number, number];
}

function normalizePositiveIntegerTuple2(
  value: unknown,
  fallback: [number, number],
): [number, number] {
  if (
    Array.isArray(value)
    && value.length === 2
    && isFinitePositiveInteger(value[0])
    && isFinitePositiveInteger(value[1])
  ) {
    return [value[0], value[1]];
  }
  return [...fallback] as [number, number];
}

function normalizeNonNegativeIntegerTuple2(
  value: unknown,
  fallback: [number, number],
): [number, number] {
  if (
    Array.isArray(value)
    && value.length === 2
    && isFiniteNonNegativeInteger(value[0])
    && isFiniteNonNegativeInteger(value[1])
  ) {
    return [value[0], value[1]];
  }
  return [...fallback] as [number, number];
}

function normalizeFitMode(value: unknown, fallback: FrameGridFitMode): FrameGridFitMode {
  return value === "cover" ? "cover" : value === "contain" ? "contain" : fallback;
}

function normalizeDocumentItem(
  value: unknown,
  index: number,
  grid: [number, number],
): EquationsFrameGridItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsFrameGridItem>;
  const col = isFiniteNonNegativeInteger(raw.col) ? raw.col : 0;
  const row = isFiniteNonNegativeInteger(raw.row) ? raw.row : 0;
  const colSpan = isFinitePositiveInteger(raw.colSpan) ? raw.colSpan : 1;
  const rowSpan = isFinitePositiveInteger(raw.rowSpan) ? raw.rowSpan : 1;
  const math = normalizeEquationsMathExpression(raw.math);
  const mappings = normalizeEquationsMappingEntries(raw.mappings);
  if (col + colSpan > grid[0] || row + rowSpan > grid[1]) {
    return null;
  }
  return {
    id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `item-${index}`,
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof raw.body === "string" ? raw.body : "",
    ...(math ? { math } : {}),
    ...(mappings ? { mappings } : {}),
    col,
    row,
    colSpan,
    rowSpan,
  };
}

function cloneDocumentItem(item: EquationsFrameGridItem): EquationsFrameGridItem {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    ...(item.math ? { math: cloneEquationsMathExpression(item.math) } : {}),
    ...(item.mappings ? { mappings: item.mappings.map(cloneEquationsMappingEntry) } : {}),
    col: item.col,
    row: item.row,
    colSpan: item.colSpan,
    rowSpan: item.rowSpan,
  };
}

export const DEFAULT_EQUATIONS_FRAMEGRID_DOCUMENT: EquationsFrameGridDocument = {
  spec: {
    frameAspect: [16, 9],
    frameBorderDiv: [0, 0],
    grid: [1, 1],
    cellBorderDiv: [0, 0],
    fitMode: "contain",
  },
  items: [
    {
      id: "workspace",
      title: "Equation",
      body: "",
      col: 0,
      row: 0,
      colSpan: 1,
      rowSpan: 1,
    },
  ],
};

export function cloneEquationsFrameGridDocument(
  document: EquationsFrameGridDocument,
): EquationsFrameGridDocument {
  return {
    spec: {
      frameAspect: [...document.spec.frameAspect] as [number, number],
      frameBorderDiv: [...document.spec.frameBorderDiv] as [number, number],
      grid: [...document.spec.grid] as [number, number],
      cellBorderDiv: [...document.spec.cellBorderDiv] as [number, number],
      fitMode: document.spec.fitMode,
    },
    items: document.items.map(cloneDocumentItem),
  };
}

export function normalizeEquationsFrameGridDocument(
  value: unknown,
  fallback: EquationsFrameGridDocument = DEFAULT_EQUATIONS_FRAMEGRID_DOCUMENT,
): EquationsFrameGridDocument {
  const raw = value && typeof value === "object"
    ? value as Partial<EquationsFrameGridDocument>
    : {};
  const spec: Partial<EquationsFrameGridDocument["spec"]> =
    raw.spec && typeof raw.spec === "object"
      ? raw.spec
      : {};
  const grid = normalizePositiveIntegerTuple2(spec.grid, fallback.spec.grid);
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item, index) => normalizeDocumentItem(item, index, grid))
        .filter((item): item is EquationsFrameGridItem => item !== null)
    : fallback.items.map(cloneDocumentItem);

  return {
    spec: {
      frameAspect: normalizePositiveNumberTuple2(spec.frameAspect, fallback.spec.frameAspect),
      frameBorderDiv: normalizeNonNegativeIntegerTuple2(spec.frameBorderDiv, fallback.spec.frameBorderDiv),
      grid,
      cellBorderDiv: normalizeNonNegativeIntegerTuple2(spec.cellBorderDiv, fallback.spec.cellBorderDiv),
      fitMode: normalizeFitMode(spec.fitMode, fallback.spec.fitMode),
    },
    items,
  };
}

function toDocumentItem(
  id: string,
  placement: EquationsPanePlacement,
  card: EquationsPaneCard,
): EquationsFrameGridItem {
  return {
    id,
    title: card.title,
    body: card.body,
    ...(card.math ? { math: cloneEquationsMathExpression(card.math) } : {}),
    ...(card.mappings ? { mappings: card.mappings.map(cloneEquationsMappingEntry) } : {}),
    col: placement.col,
    row: placement.row,
    colSpan: placement.colSpan,
    rowSpan: placement.rowSpan,
  };
}

function toCellDocumentItem(cell: EquationsPaneCell, index: number): EquationsFrameGridItem {
  return {
    id: typeof cell.id === "string" && cell.id.trim().length > 0 ? cell.id.trim() : `cell-${index}`,
    title: cell.title,
    body: cell.body,
    ...(cell.math ? { math: cloneEquationsMathExpression(cell.math) } : {}),
    ...(cell.mappings ? { mappings: cell.mappings.map(cloneEquationsMappingEntry) } : {}),
    col: cell.col,
    row: cell.row,
    colSpan: cell.colSpan,
    rowSpan: cell.rowSpan,
  };
}

export function buildEquationsFrameGridDocument(
  state: EquationsPaneState,
  options?: BuildEquationsFrameGridDocumentOptions,
): EquationsFrameGridDocument {
  if (state.document) {
    return cloneEquationsFrameGridDocument(state.document);
  }

  const document: EquationsFrameGridDocument = {
    spec: {
      frameAspect: [...state.dimensions.frameAspect] as [number, number],
      frameBorderDiv: options?.frameBorderDiv ?? [0, 0],
      grid: [...state.dimensions.grid] as [number, number],
      cellBorderDiv: options?.cellBorderDiv ?? [0, 0],
      fitMode: options?.fitMode ?? "contain",
    },
    items: [],
  };

  if (state.cells.length > 0) {
    document.items = state.cells.map(toCellDocumentItem);
    return document;
  }

  const isSingleCellGrid =
    state.dimensions.grid[0] === 1 && state.dimensions.grid[1] === 1;

  if (isSingleCellGrid) {
    document.items = [
      toDocumentItem("workspace", { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, state.content.workspace),
    ];
    return document;
  }

  document.items = [
    toDocumentItem("workspace", state.dimensions.workspace, state.content.workspace),
    toDocumentItem("details", state.dimensions.details, {
      ...state.content.details,
      body:
        state.content.details.body.trim().length > 0
          ? state.content.details.body
          : options?.detailsFallbackBody ?? "",
    }),
    toDocumentItem("notes", state.dimensions.notes, state.content.notes),
    toDocumentItem("footer", state.dimensions.footer, state.content.footer),
  ];
  return document;
}
