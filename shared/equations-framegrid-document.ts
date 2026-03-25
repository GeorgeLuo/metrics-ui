import type {
  EquationsFrameGridDocument,
  EquationsFrameGridItem,
  EquationsPaneCard,
  EquationsPaneCell,
  EquationsParallelWalkthroughPattern,
  EquationsParallelWalkthroughStep,
  EquationsPanePlacement,
  EquationsPaneState,
  FrameGridFitMode,
} from "./schema";
import {
  cloneEquationsMathExpression,
  normalizeEquationsMathExpression,
} from "./equations-math";
import {
  cloneEquationsPaneCardBlock,
  cloneEquationsMappingEntry,
  cloneEquationsPiecewiseRow,
  normalizeEquationsPaneCardBlocks,
  normalizeEquationsMappingEntries,
  normalizeEquationsPiecewiseRows,
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

function normalizeOptionalPositiveNumberTuple2(value: unknown): [number, number] | undefined {
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
  const piecewiseRows = normalizeEquationsPiecewiseRows(raw.piecewiseRows);
  const blocks = normalizeEquationsPaneCardBlocks(raw.blocks);
  if (col + colSpan > grid[0] || row + rowSpan > grid[1]) {
    return null;
  }
  return {
    id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `item-${index}`,
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof raw.body === "string" ? raw.body : "",
    ...(raw.presentation === "piecewise" || raw.presentation === "freeform"
      ? { presentation: raw.presentation }
      : {}),
    ...(math ? { math } : {}),
    ...(mappings ? { mappings } : {}),
    ...(piecewiseRows ? { piecewiseRows } : {}),
    ...(blocks ? { blocks } : {}),
    col,
    row,
    colSpan,
    rowSpan,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeParallelWalkthroughStep(
  value: unknown,
): EquationsParallelWalkthroughStep | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsParallelWalkthroughStep>;
  const left = normalizeEquationsPaneCardBlocks(raw.left);
  const right = normalizeEquationsPaneCardBlocks(raw.right);
  if (!left || left.length === 0 || !right || right.length === 0) {
    return null;
  }
  const fractions = normalizeOptionalPositiveNumberTuple2(raw.fractions);
  return {
    left,
    right,
    ...(normalizeOptionalString(raw.leftTitle) !== undefined ? { leftTitle: normalizeOptionalString(raw.leftTitle) } : {}),
    ...(normalizeOptionalString(raw.rightTitle) !== undefined ? { rightTitle: normalizeOptionalString(raw.rightTitle) } : {}),
    ...(fractions ? { fractions } : {}),
  };
}

function prependTitleBlock(
  title: string | undefined,
  blocks: ReturnType<typeof normalizeEquationsPaneCardBlocks>,
) {
  if (!blocks) {
    return [];
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    return blocks;
  }
  return [
    {
      kind: "text" as const,
      value: title.trim(),
    },
    ...blocks,
  ];
}

function normalizeParallelWalkthroughDocument(
  value: unknown,
  fallback: EquationsFrameGridDocument,
): EquationsFrameGridDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsParallelWalkthroughPattern>;
  if (raw.pattern !== "parallel_walkthrough" || !Array.isArray(raw.steps)) {
    return null;
  }

  const steps = raw.steps
    .map((step) => normalizeParallelWalkthroughStep(step))
    .filter((step): step is EquationsParallelWalkthroughStep => step !== null);
  if (steps.length === 0) {
    return null;
  }

  const documentFractions = normalizeOptionalPositiveNumberTuple2(raw.fractions) ?? [5, 7];
  const intro = normalizeEquationsPaneCardBlocks(raw.intro);
  const introTitle = normalizeOptionalString(raw.introTitle);
  const blocks = steps.map((step) => ({
    kind: "split" as const,
    left: prependTitleBlock(step.leftTitle, step.left),
    right: prependTitleBlock(step.rightTitle, step.right),
    fractions: step.fractions ?? documentFractions,
  }));

  if (intro && intro.length > 0) {
    return {
      spec: {
        frameAspect: [4, 3],
        frameBorderDiv: [0, 0],
        grid: [1, 6],
        cellBorderDiv: [0, 0],
        fitMode: "contain",
      },
      items: [
        {
          id: "header",
          title: introTitle ?? "",
          body: "",
          presentation: "freeform",
          blocks: intro,
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        {
          id: "workspace",
          title: typeof raw.title === "string" ? raw.title : fallback.items[0]?.title ?? "Walkthrough",
          body: "",
          presentation: "freeform",
          blocks,
          col: 0,
          row: 1,
          colSpan: 1,
          rowSpan: 5,
        },
      ],
    };
  }

  return {
    spec: {
      frameAspect: [4, 3],
      frameBorderDiv: [0, 0],
      grid: [1, 1],
      cellBorderDiv: [0, 0],
      fitMode: "contain",
    },
    items: [
      {
        id: "workspace",
        title: typeof raw.title === "string" ? raw.title : fallback.items[0]?.title ?? "Walkthrough",
        body: "",
        presentation: "freeform",
        blocks,
        col: 0,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
      },
    ],
  };
}

function cloneDocumentItem(item: EquationsFrameGridItem): EquationsFrameGridItem {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    ...(item.presentation ? { presentation: item.presentation } : {}),
    ...(item.math ? { math: cloneEquationsMathExpression(item.math) } : {}),
    ...(item.mappings ? { mappings: item.mappings.map(cloneEquationsMappingEntry) } : {}),
    ...(item.piecewiseRows ? { piecewiseRows: item.piecewiseRows.map(cloneEquationsPiecewiseRow) } : {}),
    ...(item.blocks ? { blocks: item.blocks.map(cloneEquationsPaneCardBlock) } : {}),
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
  const patternDocument = normalizeParallelWalkthroughDocument(value, fallback);
  if (patternDocument) {
    return patternDocument;
  }

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
    ...(card.presentation ? { presentation: card.presentation } : {}),
    ...(card.math ? { math: cloneEquationsMathExpression(card.math) } : {}),
    ...(card.mappings ? { mappings: card.mappings.map(cloneEquationsMappingEntry) } : {}),
    ...(card.piecewiseRows ? { piecewiseRows: card.piecewiseRows.map(cloneEquationsPiecewiseRow) } : {}),
    ...(card.blocks ? { blocks: card.blocks.map(cloneEquationsPaneCardBlock) } : {}),
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
    ...(cell.presentation ? { presentation: cell.presentation } : {}),
    ...(cell.math ? { math: cloneEquationsMathExpression(cell.math) } : {}),
    ...(cell.mappings ? { mappings: cell.mappings.map(cloneEquationsMappingEntry) } : {}),
    ...(cell.piecewiseRows ? { piecewiseRows: cell.piecewiseRows.map(cloneEquationsPiecewiseRow) } : {}),
    ...(cell.blocks ? { blocks: cell.blocks.map(cloneEquationsPaneCardBlock) } : {}),
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
