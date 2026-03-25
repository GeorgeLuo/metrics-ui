import type {
  EquationsFrameGridDocument,
  EquationsPaneCard,
  EquationsPaneCardPatch,
  EquationsPaneCell,
  EquationsPaneContent,
  EquationsPaneContextState,
  EquationsPaneDimensions,
  EquationsPanePlacement,
  EquationsPaneSelectedHitBox,
  EquationsPaneSelectedTextHighlight,
  EquationsPanePlacementPatch,
  EquationsPaneState,
  EquationsPaneStatePatch,
  VisualizationFrameState,
} from "./schema";
import {
  cloneEquationsMathExpression,
  normalizeEquationsMathExpression,
} from "./equations-math";
import {
  cloneEquationsHitBoxDefinition,
  cloneEquationsPaneCardBlock,
  cloneEquationsMappingEntry,
  cloneEquationsPiecewiseRow,
  normalizeEquationsHitBoxDefinition,
  normalizeEquationsPaneCardBlocks,
  normalizeEquationsMappingEntries,
  normalizeEquationsPiecewiseRows,
} from "./equations-mappings";
import {
  cloneEquationsFrameGridDocument,
  DEFAULT_EQUATIONS_FRAMEGRID_DOCUMENT,
  normalizeEquationsFrameGridDocument,
} from "./equations-framegrid-document";
import {
  cloneVisualizationFrameState,
  normalizeVisualizationFrameState,
} from "./visualization-frame-state";

export const DEFAULT_EQUATIONS_PANE_STATE: EquationsPaneState = {
  dimensions: {
    frameAspect: [4, 3],
    grid: [2, 3],
    workspace: { col: 0, row: 0, colSpan: 1, rowSpan: 3 },
    details: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    notes: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    footer: { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
  },
  content: {
    workspace: {
      title: "LaTeX Form",
      body: "",
    },
    details: {
      title: "Literal Form",
      body:
        "Translate the notation into a literal spoken or textual sequence.",
    },
    notes: {
      title: "Meaning",
      body:
        "Group the symbols into the claim the equation is making, not just the order they appear in.",
    },
    footer: {
      title: "Concept",
      body:
        "Map the equation to the broader class of problems or ideas where it is useful.",
    },
  },
  cells: [],
  context: {
    selectedHitBox: null,
    selectedTextHighlight: null,
    visualizationFrame: null,
  },
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

function cloneCard(card: EquationsPaneCard): EquationsPaneCard {
  return {
    title: card.title,
    body: card.body,
    ...(card.presentation ? { presentation: card.presentation } : {}),
    ...(card.math ? { math: cloneEquationsMathExpression(card.math) } : {}),
    ...(card.mappings ? { mappings: card.mappings.map(cloneEquationsMappingEntry) } : {}),
    ...(card.piecewiseRows ? { piecewiseRows: card.piecewiseRows.map(cloneEquationsPiecewiseRow) } : {}),
    ...(card.blocks ? { blocks: card.blocks.map(cloneEquationsPaneCardBlock) } : {}),
  };
}

function clonePlacement(placement: EquationsPanePlacement): EquationsPanePlacement {
  return {
    col: placement.col,
    row: placement.row,
    colSpan: placement.colSpan,
    rowSpan: placement.rowSpan,
  };
}

function cloneCell(cell: EquationsPaneCell): EquationsPaneCell {
  return {
    id: cell.id,
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

function cloneSelectedHitBox(
  selectedHitBox: EquationsPaneSelectedHitBox,
): EquationsPaneSelectedHitBox {
  return {
    itemId: selectedHitBox.itemId,
    hitBox: cloneEquationsHitBoxDefinition(selectedHitBox.hitBox),
  };
}

function cloneSelectedTextHighlight(
  selectedTextHighlight: EquationsPaneSelectedTextHighlight,
): EquationsPaneSelectedTextHighlight {
  return {
    itemId: selectedTextHighlight.itemId,
    selectionId: selectedTextHighlight.selectionId,
    startOffset: selectedTextHighlight.startOffset,
    endOffset: selectedTextHighlight.endOffset,
    text: selectedTextHighlight.text,
    ...(selectedTextHighlight.contextBefore !== undefined
      ? { contextBefore: selectedTextHighlight.contextBefore }
      : {}),
    ...(selectedTextHighlight.contextAfter !== undefined
      ? { contextAfter: selectedTextHighlight.contextAfter }
      : {}),
  };
}

function cloneContext(context: EquationsPaneContextState): EquationsPaneContextState {
  return {
    selectedHitBox: context.selectedHitBox
      ? cloneSelectedHitBox(context.selectedHitBox)
      : null,
    selectedTextHighlight: context.selectedTextHighlight
      ? cloneSelectedTextHighlight(context.selectedTextHighlight)
      : null,
    visualizationFrame: context.visualizationFrame
      ? cloneVisualizationFrameState(context.visualizationFrame)
      : null,
  };
}

function cloneContent(content: EquationsPaneContent): EquationsPaneContent {
  return {
    workspace: cloneCard(content.workspace),
    details: cloneCard(content.details),
    notes: cloneCard(content.notes),
    footer: cloneCard(content.footer),
  };
}

function cloneDimensions(dimensions: EquationsPaneDimensions): EquationsPaneDimensions {
  return {
    frameAspect: [...dimensions.frameAspect] as [number, number],
    grid: [...dimensions.grid] as [number, number],
    workspace: clonePlacement(dimensions.workspace),
    details: clonePlacement(dimensions.details),
    notes: clonePlacement(dimensions.notes),
    footer: clonePlacement(dimensions.footer),
  };
}

export function cloneEquationsPaneState(state: EquationsPaneState): EquationsPaneState {
  return {
    dimensions: cloneDimensions(state.dimensions),
    content: cloneContent(state.content),
    cells: state.cells.map(cloneCell),
    context: cloneContext(state.context),
    ...(state.document ? { document: cloneEquationsFrameGridDocument(state.document) } : {}),
  };
}

function cloneDocumentToCells(document: EquationsFrameGridDocument): EquationsPaneCell[] {
  return document.items.map((item) => ({
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
  }));
}

function mergeDocumentPlacements(
  base: EquationsPaneDimensions,
  document: EquationsFrameGridDocument,
): EquationsPaneDimensions {
  const findPlacement = (id: string, fallback: EquationsPanePlacement): EquationsPanePlacement => {
    const item = document.items.find((entry) => entry.id === id);
    if (!item) {
      return clonePlacement(fallback);
    }
    return {
      col: item.col,
      row: item.row,
      colSpan: item.colSpan,
      rowSpan: item.rowSpan,
    };
  };

  return {
    frameAspect: [...document.spec.frameAspect] as [number, number],
    grid: [...document.spec.grid] as [number, number],
    workspace: findPlacement("workspace", base.workspace),
    details: findPlacement("details", base.details),
    notes: findPlacement("notes", base.notes),
    footer: findPlacement("footer", base.footer),
  };
}

function mergeDocumentContent(
  base: EquationsPaneContent,
  document: EquationsFrameGridDocument,
): EquationsPaneContent {
  const findCard = (id: string, fallback: EquationsPaneCard): EquationsPaneCard => {
    const item = document.items.find((entry) => entry.id === id);
    if (!item) {
      return cloneCard(fallback);
    }
    return {
      title: item.title,
      body: item.body,
      ...(item.presentation ? { presentation: item.presentation } : {}),
      ...(item.math ? { math: cloneEquationsMathExpression(item.math) } : {}),
      ...(item.mappings ? { mappings: item.mappings.map(cloneEquationsMappingEntry) } : {}),
      ...(item.piecewiseRows ? { piecewiseRows: item.piecewiseRows.map(cloneEquationsPiecewiseRow) } : {}),
      ...(item.blocks ? { blocks: item.blocks.map(cloneEquationsPaneCardBlock) } : {}),
    };
  };

  return {
    workspace: findCard("workspace", base.workspace),
    details: findCard("details", base.details),
    notes: findCard("notes", base.notes),
    footer: findCard("footer", base.footer),
  };
}

function mergeCard(base: EquationsPaneCard, patch: unknown): EquationsPaneCard {
  if (!patch || typeof patch !== "object") {
    return cloneCard(base);
  }
  const raw = patch as EquationsPaneCardPatch;
  const hasMath = Object.prototype.hasOwnProperty.call(raw, "math");
  const nextMath = hasMath
    ? normalizeEquationsMathExpression(raw.math)
    : base.math
      ? cloneEquationsMathExpression(base.math)
      : undefined;
  const hasMappings = Object.prototype.hasOwnProperty.call(raw, "mappings");
  const nextMappings = hasMappings
    ? normalizeEquationsMappingEntries(raw.mappings)
    : base.mappings
      ? base.mappings.map(cloneEquationsMappingEntry)
      : undefined;
  const hasPiecewiseRows = Object.prototype.hasOwnProperty.call(raw, "piecewiseRows");
  const nextPiecewiseRows = hasPiecewiseRows
    ? normalizeEquationsPiecewiseRows(raw.piecewiseRows)
    : base.piecewiseRows
      ? base.piecewiseRows.map(cloneEquationsPiecewiseRow)
      : undefined;
  const hasBlocks = Object.prototype.hasOwnProperty.call(raw, "blocks");
  const nextBlocks = hasBlocks
    ? normalizeEquationsPaneCardBlocks(raw.blocks)
    : base.blocks
      ? base.blocks.map(cloneEquationsPaneCardBlock)
      : undefined;
  const hasPresentation = Object.prototype.hasOwnProperty.call(raw, "presentation");
  const nextPresentation = hasPresentation
    ? raw.presentation === "piecewise" || raw.presentation === "freeform"
      ? raw.presentation
      : undefined
    : base.presentation;
  return {
    title: typeof raw.title === "string" ? raw.title : base.title,
    body: typeof raw.body === "string" ? raw.body : base.body,
    ...(nextPresentation ? { presentation: nextPresentation } : {}),
    ...(nextMath ? { math: nextMath } : {}),
    ...(nextMappings ? { mappings: nextMappings } : {}),
    ...(nextPiecewiseRows ? { piecewiseRows: nextPiecewiseRows } : {}),
    ...(nextBlocks ? { blocks: nextBlocks } : {}),
  };
}

function normalizeSelectedHitBox(value: unknown): EquationsPaneSelectedHitBox | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsPaneSelectedHitBox>;
  const hitBox = normalizeEquationsHitBoxDefinition(raw.hitBox);
  if (typeof raw.itemId !== "string" || raw.itemId.trim().length === 0 || !hitBox) {
    return null;
  }
  return {
    itemId: raw.itemId.trim(),
    hitBox,
  };
}

function normalizeSelectedTextHighlight(value: unknown): EquationsPaneSelectedTextHighlight | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<EquationsPaneSelectedTextHighlight>;
  const itemId = typeof raw.itemId === "string" ? raw.itemId.trim() : "";
  const selectionId = typeof raw.selectionId === "string" ? raw.selectionId.trim() : "";
  const startOffset =
    typeof raw.startOffset === "number" && Number.isInteger(raw.startOffset) && raw.startOffset >= 0
      ? raw.startOffset
      : null;
  const endOffset =
    typeof raw.endOffset === "number" && Number.isInteger(raw.endOffset) && raw.endOffset >= 0
      ? raw.endOffset
      : null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!itemId || !selectionId || startOffset === null || endOffset === null || endOffset < startOffset || !text) {
    return null;
  }
  const contextBefore =
    typeof raw.contextBefore === "string" && raw.contextBefore.length > 0
      ? raw.contextBefore
      : undefined;
  const contextAfter =
    typeof raw.contextAfter === "string" && raw.contextAfter.length > 0
      ? raw.contextAfter
      : undefined;
  return {
    itemId,
    selectionId,
    startOffset,
    endOffset,
    text,
    ...(contextBefore !== undefined ? { contextBefore } : {}),
    ...(contextAfter !== undefined ? { contextAfter } : {}),
  };
}

function mergeContext(
  base: EquationsPaneContextState,
  patch: unknown,
): EquationsPaneContextState {
  if (!patch || typeof patch !== "object") {
    return cloneContext(base);
  }
  const raw = patch as Partial<EquationsPaneContextState>;
  const hasSelectedHitBox = Object.prototype.hasOwnProperty.call(raw, "selectedHitBox");
  const hasSelectedTextHighlight = Object.prototype.hasOwnProperty.call(raw, "selectedTextHighlight");
  const hasVisualizationFrame = Object.prototype.hasOwnProperty.call(raw, "visualizationFrame");
  return {
    selectedHitBox: hasSelectedHitBox
      ? normalizeSelectedHitBox(raw.selectedHitBox)
      : base.selectedHitBox
        ? cloneSelectedHitBox(base.selectedHitBox)
        : null,
    selectedTextHighlight: hasSelectedTextHighlight
      ? normalizeSelectedTextHighlight(raw.selectedTextHighlight)
      : base.selectedTextHighlight
        ? cloneSelectedTextHighlight(base.selectedTextHighlight)
        : null,
    visualizationFrame: hasVisualizationFrame
      ? normalizeVisualizationFrameState(raw.visualizationFrame)
      : base.visualizationFrame
        ? cloneVisualizationFrameState(base.visualizationFrame)
        : null,
  };
}

function mergePlacement(
  base: EquationsPanePlacement,
  patch: unknown,
): EquationsPanePlacement {
  if (!patch || typeof patch !== "object") {
    return clonePlacement(base);
  }
  const raw = patch as EquationsPanePlacementPatch;
  return {
    col: isFiniteNonNegativeInteger(raw.col) ? raw.col : base.col,
    row: isFiniteNonNegativeInteger(raw.row) ? raw.row : base.row,
    colSpan: isFinitePositiveInteger(raw.colSpan) ? raw.colSpan : base.colSpan,
    rowSpan: isFinitePositiveInteger(raw.rowSpan) ? raw.rowSpan : base.rowSpan,
  };
}

function mergePositiveNumberTuple2(
  base: [number, number],
  patch: unknown,
): [number, number] {
  if (
    Array.isArray(patch)
    && patch.length === 2
    && isFinitePositiveNumber(patch[0])
    && isFinitePositiveNumber(patch[1])
  ) {
    return [patch[0], patch[1]];
  }
  return [...base] as [number, number];
}

function mergePositiveIntegerTuple2(
  base: [number, number],
  patch: unknown,
): [number, number] {
  if (
    Array.isArray(patch)
    && patch.length === 2
    && isFinitePositiveInteger(patch[0])
    && isFinitePositiveInteger(patch[1])
  ) {
    return [patch[0], patch[1]];
  }
  return [...base] as [number, number];
}

function normalizeCellArray(
  value: unknown,
  grid: [number, number],
): EquationsPaneCell[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const [gridCols, gridRows] = grid;
  const normalized: EquationsPaneCell[] = [];

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const raw = entry as Partial<EquationsPaneCell>;
    const col = isFiniteNonNegativeInteger(raw.col) ? raw.col : 0;
    const row = isFiniteNonNegativeInteger(raw.row) ? raw.row : 0;
    const colSpan = isFinitePositiveInteger(raw.colSpan) ? raw.colSpan : 1;
    const rowSpan = isFinitePositiveInteger(raw.rowSpan) ? raw.rowSpan : 1;
    const math = normalizeEquationsMathExpression(raw.math);
    const mappings = normalizeEquationsMappingEntries(raw.mappings);
    const piecewiseRows = normalizeEquationsPiecewiseRows(raw.piecewiseRows);
    const blocks = normalizeEquationsPaneCardBlocks(raw.blocks);
    if (col + colSpan > gridCols || row + rowSpan > gridRows) {
      return;
    }
    normalized.push({
      id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `cell-${index}`,
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
    });
  });

  return normalized;
}

export function mergeEquationsPaneStatePatch(
  base: EquationsPaneState,
  patch: EquationsPaneStatePatch | null | undefined,
  options?: { replace?: boolean },
): EquationsPaneState {
  const seed = options?.replace ? DEFAULT_EQUATIONS_PANE_STATE : base;
  const rawPatch = patch ?? {};
  const nextDocument = rawPatch.document
    ? normalizeEquationsFrameGridDocument(
        rawPatch.document,
        seed.document ?? DEFAULT_EQUATIONS_FRAMEGRID_DOCUMENT,
      )
    : seed.document
      ? cloneEquationsFrameGridDocument(seed.document)
      : undefined;
  const nextDimensions: EquationsPaneDimensions = {
    frameAspect: mergePositiveNumberTuple2(seed.dimensions.frameAspect, rawPatch.dimensions?.frameAspect),
    grid: mergePositiveIntegerTuple2(seed.dimensions.grid, rawPatch.dimensions?.grid),
    workspace: mergePlacement(seed.dimensions.workspace, rawPatch.dimensions?.workspace),
    details: mergePlacement(seed.dimensions.details, rawPatch.dimensions?.details),
    notes: mergePlacement(seed.dimensions.notes, rawPatch.dimensions?.notes),
    footer: mergePlacement(seed.dimensions.footer, rawPatch.dimensions?.footer),
  };
  const nextState: EquationsPaneState = {
    dimensions: nextDimensions,
    content: {
      workspace: mergeCard(seed.content.workspace, rawPatch.content?.workspace),
      details: mergeCard(seed.content.details, rawPatch.content?.details),
      notes: mergeCard(seed.content.notes, rawPatch.content?.notes),
      footer: mergeCard(seed.content.footer, rawPatch.content?.footer),
    },
    cells: Array.isArray(rawPatch.cells)
      ? normalizeCellArray(rawPatch.cells, nextDimensions.grid)
      : seed.cells.map(cloneCell),
    context: mergeContext(seed.context, rawPatch.context),
    ...(nextDocument ? { document: nextDocument } : {}),
  };

  if (!nextDocument) {
    return nextState;
  }

  return {
    dimensions: mergeDocumentPlacements(nextState.dimensions, nextDocument),
    content: mergeDocumentContent(nextState.content, nextDocument),
    cells: cloneDocumentToCells(nextDocument),
    context: nextState.context,
    document: nextDocument,
  };
}

export function normalizeEquationsPaneState(value: unknown): EquationsPaneState {
  return mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, value as EquationsPaneStatePatch, {
    replace: true,
  });
}
