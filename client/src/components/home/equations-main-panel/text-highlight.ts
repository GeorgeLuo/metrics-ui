import type { EquationsPaneSelectedTextHighlight } from "@shared/schema";

type TextNodePosition = {
  textNode: Text;
  offset: number;
};

export type TextHighlightOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TextHighlightOverlayLayer = {
  host: HTMLElement;
  rects: TextHighlightOverlayRect[];
};

export type SelectionEndpoints = {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
};

const TEXT_HIGHLIGHT_CONTEXT_CHARS = 64;
const TEXT_HIGHLIGHT_RECT_EPSILON = 0.01;
const EQUATIONS_SCOPE_FILTER_SELECTION_MARKER = "::scope-filter:";

function collapseSelectionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimLeadingContext(value: string): string {
  const collapsed = collapseSelectionText(value);
  if (collapsed.length <= TEXT_HIGHLIGHT_CONTEXT_CHARS) {
    return collapsed;
  }
  return collapsed.slice(-TEXT_HIGHLIGHT_CONTEXT_CHARS);
}

function trimTrailingContext(value: string): string {
  const collapsed = collapseSelectionText(value);
  if (collapsed.length <= TEXT_HIGHLIGHT_CONTEXT_CHARS) {
    return collapsed;
  }
  return collapsed.slice(0, TEXT_HIGHLIGHT_CONTEXT_CHARS);
}

function findSelectionRoot(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    return node.closest<HTMLElement>("[data-equations-selection-root='1']");
  }

  return node.parentElement?.closest<HTMLElement>("[data-equations-selection-root='1']") ?? null;
}

function findSelectionScope(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    return node.closest<HTMLElement>("[data-equations-selection-scope-id]");
  }

  return node.parentElement?.closest<HTMLElement>("[data-equations-selection-scope-id]") ?? null;
}

function buildScopeFilteredSelectionId(itemId: string, scopeSelectionId: string): string {
  return `${itemId}${EQUATIONS_SCOPE_FILTER_SELECTION_MARKER}${scopeSelectionId}`;
}

function parseScopeFilteredSelectionId(
  itemId: string,
  selectionId: string,
): string | null {
  const prefix = `${itemId}${EQUATIONS_SCOPE_FILTER_SELECTION_MARKER}`;
  if (!selectionId.startsWith(prefix)) {
    return null;
  }
  const suffix = selectionId.slice(prefix.length).trim();
  return suffix.length > 0 ? suffix : null;
}

function findSelectionItem(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  let current: HTMLElement | null = node instanceof HTMLElement
    ? node
    : node.parentElement;
  let item: HTMLElement | null = null;

  while (current) {
    if (current.hasAttribute("data-equations-item-id")) {
      item = current;
    }
    current = current.parentElement;
  }

  return item;
}

function isSelectableTextNode(
  node: Node,
  container: Node,
  allowedScopeSelectionId?: string | null,
): node is Text {
  if (node.nodeType !== Node.TEXT_NODE || !container.contains(node)) {
    return false;
  }
  const textNode = node as Text;
  if ((textNode.textContent ?? "").length === 0) {
    return false;
  }
  const parent = textNode.parentElement;
  if (!parent) {
    return false;
  }
  if (parent.closest(".katex-mathml, script, style, noscript")) {
    return false;
  }
  if (allowedScopeSelectionId) {
    const scopeSelectionId = findSelectionScope(textNode)?.dataset.equationsSelectionScopeId?.trim() ?? null;
    if (scopeSelectionId !== null && scopeSelectionId !== allowedScopeSelectionId) {
      return false;
    }
  }
  return true;
}

function collectSelectableTextNodes(
  container: Node,
  allowedScopeSelectionId?: string | null,
): Text[] {
  if (typeof document === "undefined") {
    return [];
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (candidate) =>
      isSelectableTextNode(candidate, container, allowedScopeSelectionId)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text);
  }
  return textNodes;
}

function getFirstSelectableTextDescendant(
  root: Node,
  container: Node,
  allowedScopeSelectionId?: string | null,
): Text | null {
  if (isSelectableTextNode(root, container, allowedScopeSelectionId)) {
    return root;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (candidate) =>
      isSelectableTextNode(candidate, container, allowedScopeSelectionId)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  return (walker.nextNode() as Text | null) ?? null;
}

function getLastSelectableTextDescendant(
  root: Node,
  container: Node,
  allowedScopeSelectionId?: string | null,
): Text | null {
  if (isSelectableTextNode(root, container, allowedScopeSelectionId)) {
    return root;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (candidate) =>
      isSelectableTextNode(candidate, container, allowedScopeSelectionId)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  let last: Text | null = null;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    last = current as Text;
  }
  return last;
}

function resolveToSelectableTextPosition(
  container: Node,
  node: Node,
  offset: number,
  allowedScopeSelectionId?: string | null,
): TextNodePosition | null {
  if (isSelectableTextNode(node, container, allowedScopeSelectionId)) {
    return {
      textNode: node,
      offset: Math.max(0, Math.min(offset, node.textContent?.length ?? 0)),
    };
  }

  const baseNode = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  if (!baseNode) {
    return null;
  }

  const childNodes = baseNode.childNodes;
  if (offset < childNodes.length) {
    const first = getFirstSelectableTextDescendant(childNodes[offset], container, allowedScopeSelectionId);
    if (first) {
      return { textNode: first, offset: 0 };
    }
  }

  for (let index = Math.min(offset, childNodes.length) - 1; index >= 0; index -= 1) {
    const last = getLastSelectableTextDescendant(childNodes[index], container, allowedScopeSelectionId);
    if (last) {
      return {
        textNode: last,
        offset: last.textContent?.length ?? 0,
      };
    }
  }

  const textNodes = collectSelectableTextNodes(container, allowedScopeSelectionId);
  if (textNodes.length === 0 || typeof document === "undefined") {
    return null;
  }

  try {
    const boundary = document.createRange();
    boundary.setStart(container, 0);
    boundary.setEnd(node, offset);

    let lastBefore: Text | null = null;
    for (const textNode of textNodes) {
      const textStart = document.createRange();
      textStart.setStart(container, 0);
      textStart.setEnd(textNode, 0);
      if (boundary.compareBoundaryPoints(Range.END_TO_END, textStart) < 0) {
        return { textNode, offset: 0 };
      }
      lastBefore = textNode;
    }

    if (lastBefore) {
      return {
        textNode: lastBefore,
        offset: lastBefore.textContent?.length ?? 0,
      };
    }
  } catch {
    return null;
  }

  const fallback = textNodes[textNodes.length - 1];
  return {
    textNode: fallback,
    offset: fallback.textContent?.length ?? 0,
  };
}

function getSelectableTextOffset(
  container: Node,
  textNode: Text,
  offset: number,
  allowedScopeSelectionId?: string | null,
): number {
  const textNodes = collectSelectableTextNodes(container, allowedScopeSelectionId);
  let accumulated = 0;
  for (const node of textNodes) {
    if (node === textNode) {
      return accumulated + Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
    }
    accumulated += node.textContent?.length ?? 0;
  }
  return accumulated;
}

function getSelectablePlainText(
  container: Node,
  allowedScopeSelectionId?: string | null,
): string {
  return collectSelectableTextNodes(container, allowedScopeSelectionId)
    .map((node) => node.textContent ?? "")
    .join("");
}

export function buildSelectionEndpointsFromSelection(
  selection?: Selection | null,
): SelectionEndpoints | null {
  if (!selection) {
    return null;
  }

  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
}

function buildRangesFromHighlightOffsets(
  container: HTMLElement,
  highlight: EquationsPaneSelectedTextHighlight,
): Range[] {
  if (typeof document === "undefined") {
    return [];
  }

  const allowedScopeSelectionId = parseScopeFilteredSelectionId(highlight.itemId, highlight.selectionId);
  const textNodes = collectSelectableTextNodes(container, allowedScopeSelectionId);
  if (textNodes.length === 0) {
    return [];
  }

  const ranges: Range[] = [];
  let accumulated = 0;
  let currentRange:
    | {
        root: HTMLElement | null;
        startNode: Text;
        startOffset: number;
        endNode: Text;
        endOffset: number;
      }
    | null = null;

  for (const textNode of textNodes) {
    const length = textNode.textContent?.length ?? 0;
    const nodeStart = accumulated;
    const nodeEnd = accumulated + length;
    accumulated = nodeEnd;

    const overlapStart = Math.max(highlight.startOffset, nodeStart);
    const overlapEnd = Math.min(highlight.endOffset, nodeEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }

    const segmentRoot = findSelectionRoot(textNode) ?? container;
    const startOffset = overlapStart - nodeStart;
    const endOffset = overlapEnd - nodeStart;

    if (!currentRange || currentRange.root !== segmentRoot) {
      if (currentRange) {
        const range = document.createRange();
        range.setStart(currentRange.startNode, currentRange.startOffset);
        range.setEnd(currentRange.endNode, currentRange.endOffset);
        ranges.push(range);
      }

      currentRange = {
        root: segmentRoot,
        startNode: textNode,
        startOffset,
        endNode: textNode,
        endOffset,
      };
      continue;
    }

    currentRange.endNode = textNode;
    currentRange.endOffset = endOffset;
  }

  if (currentRange) {
    const range = document.createRange();
    range.setStart(currentRange.startNode, currentRange.startOffset);
    range.setEnd(currentRange.endNode, currentRange.endOffset);
    ranges.push(range);
  }

  return ranges;
}

function escapeAttributeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function findHighlightRootElement(
  container: HTMLElement,
  highlight: EquationsPaneSelectedTextHighlight,
): HTMLElement | null {
  if (
    highlight.selectionId === `${highlight.itemId}::item`
    || parseScopeFilteredSelectionId(highlight.itemId, highlight.selectionId)
  ) {
    return container.querySelector<HTMLElement>(
      `[data-equations-item-id="${escapeAttributeSelector(highlight.itemId)}"]`,
    );
  }

  return container.querySelector<HTMLElement>(
    [
      `[data-equations-item-id="${escapeAttributeSelector(highlight.itemId)}"]`,
      `[data-equations-selection-id="${escapeAttributeSelector(highlight.selectionId)}"]`,
    ].join(""),
  );
}

export function buildSelectionHighlight(
  range: Range,
  selectionEndpoints?: SelectionEndpoints | null,
): EquationsPaneSelectedTextHighlight | null {
  const startRoot = findSelectionRoot(range.startContainer);
  const endRoot = findSelectionRoot(range.endContainer);
  const startScope = findSelectionScope(range.startContainer);
  const endScope = findSelectionScope(range.endContainer);
  const startItem = findSelectionItem(range.startContainer);
  const endItem = findSelectionItem(range.endContainer);
  if (!startItem || !endItem || startItem !== endItem) {
    return null;
  }

  const isSingleRootSelection = Boolean(startRoot && endRoot && startRoot === endRoot);
  const startScopeSelectionId = startScope?.dataset.equationsSelectionScopeId?.trim() ?? null;
  const endScopeSelectionId = endScope?.dataset.equationsSelectionScopeId?.trim() ?? null;
  const isSingleScopeSelection = Boolean(
    startScopeSelectionId
    && endScopeSelectionId
    && startScopeSelectionId === endScopeSelectionId,
  );
  const anchorScope = findSelectionScope(selectionEndpoints?.anchorNode ?? null);
  const focusScope = findSelectionScope(selectionEndpoints?.focusNode ?? null);
  const anchorScopeSelectionId = anchorScope?.dataset.equationsSelectionScopeId?.trim() ?? null;
  const focusScopeSelectionId = focusScope?.dataset.equationsSelectionScopeId?.trim() ?? null;
  const scopeFilterSelectionId = anchorScopeSelectionId
    && (
      anchorScopeSelectionId !== focusScopeSelectionId
      || (startScopeSelectionId !== null && endScopeSelectionId !== null && startScopeSelectionId !== endScopeSelectionId)
    )
      ? anchorScopeSelectionId
      : null;
  const itemId = startItem.dataset.equationsItemId?.trim();
  const effectiveScopeSelectionId = scopeFilterSelectionId ?? (isSingleScopeSelection ? startScopeSelectionId : null);
  const rootElement = effectiveScopeSelectionId
    ? startItem
    : isSingleRootSelection && startRoot
      ? startRoot
      : startItem;
  const selectionId = effectiveScopeSelectionId && itemId
    ? buildScopeFilteredSelectionId(itemId, effectiveScopeSelectionId)
    : isSingleRootSelection
      ? rootElement.dataset.equationsSelectionId?.trim() ?? itemId
      : `${itemId}::item`;
  const startPosition = resolveToSelectableTextPosition(
    rootElement,
    range.startContainer,
    range.startOffset,
    effectiveScopeSelectionId,
  );
  const endPosition = resolveToSelectableTextPosition(
    rootElement,
    range.endContainer,
    range.endOffset,
    effectiveScopeSelectionId,
  );
  if (!itemId || !selectionId || !startPosition || !endPosition) {
    return null;
  }
  const startOffset = getSelectableTextOffset(
    rootElement,
    startPosition.textNode,
    startPosition.offset,
    effectiveScopeSelectionId,
  );
  const endOffset = getSelectableTextOffset(
    rootElement,
    endPosition.textNode,
    endPosition.offset,
    effectiveScopeSelectionId,
  );
  if (endOffset <= startOffset) {
    return null;
  }
  const plainText = getSelectablePlainText(rootElement, effectiveScopeSelectionId);
  const text = collapseSelectionText(plainText.slice(startOffset, endOffset));
  if (text.length === 0) {
    return null;
  }
  const contextBefore = trimLeadingContext(plainText.slice(0, startOffset));
  const contextAfter = trimTrailingContext(plainText.slice(endOffset));

  return {
    itemId,
    selectionId,
    startOffset,
    endOffset,
    text,
    ...(contextBefore.length > 0 ? { contextBefore } : {}),
    ...(contextAfter.length > 0 ? { contextAfter } : {}),
  };
}

function buildTextHighlightRects(
  ranges: Range[],
  container: HTMLElement,
): TextHighlightOverlayRect[] {
  const containerRect = container.getBoundingClientRect();
  const rawRects = ranges.flatMap((range) => (
    Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
      }))
  ));

  if (rawRects.length <= 1) {
    return rawRects;
  }

  const sortedRects = [...rawRects].sort((leftRect, rightRect) => (
    Math.abs(leftRect.top - rightRect.top) < 4
      ? leftRect.left - rightRect.left
      : leftRect.top - rightRect.top
  ));

  const mergedRects: TextHighlightOverlayRect[] = [];
  for (const rect of sortedRects) {
    const previous = mergedRects[mergedRects.length - 1];
    if (!previous) {
      mergedRects.push({ ...rect });
      continue;
    }

    const previousBottom = previous.top + previous.height;
    const rectBottom = rect.top + rect.height;
    const verticallyConnected = (
      rect.top <= previousBottom + 4
      && rectBottom >= previous.top - 4
    );
    const horizontallyConnected = rect.left <= previous.left + previous.width + 12;

    if (!verticallyConnected || !horizontallyConnected) {
      mergedRects.push({ ...rect });
      continue;
    }

    const nextLeft = Math.min(previous.left, rect.left);
    const nextTop = Math.min(previous.top, rect.top);
    const nextRight = Math.max(previous.left + previous.width, rect.left + rect.width);
    const nextBottom = Math.max(previousBottom, rectBottom);
    previous.left = nextLeft;
    previous.top = nextTop;
    previous.width = nextRight - nextLeft;
    previous.height = nextBottom - nextTop;
  }

  return mergedRects;
}

function isScrollableElement(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
}

function resolveTextHighlightOverlayHost(
  rootElement: HTMLElement,
  panelContainer: HTMLElement,
): HTMLElement {
  if (isScrollableElement(rootElement)) {
    return rootElement;
  }

  const scopedHost = rootElement.closest<HTMLElement>("[data-equations-highlight-overlay-host='1']");
  if (scopedHost) {
    return scopedHost;
  }

  return rootElement.closest<HTMLElement>("[data-equations-item-id]") ?? panelContainer;
}

function buildTextHighlightOverlayLayers(
  ranges: Range[],
  panelContainer: HTMLElement,
): TextHighlightOverlayLayer[] {
  const rangesByHost = new Map<HTMLElement, Range[]>();

  ranges.forEach((range) => {
    const segmentRoot = findSelectionRoot(range.startContainer)
      ?? findSelectionItem(range.startContainer)
      ?? panelContainer;
    const host = resolveTextHighlightOverlayHost(segmentRoot, panelContainer);
    const hostRanges = rangesByHost.get(host);
    if (hostRanges) {
      hostRanges.push(range);
      return;
    }
    rangesByHost.set(host, [range]);
  });

  return Array.from(rangesByHost.entries())
    .map(([host, hostRanges]) => ({
      host,
      rects: buildTextHighlightRects(hostRanges, host),
    }))
    .filter((layer) => layer.rects.length > 0);
}

export function resolveTextHighlightOverlayLayers(
  container: HTMLElement,
  highlight: EquationsPaneSelectedTextHighlight,
): TextHighlightOverlayLayer[] {
  const rootElement = findHighlightRootElement(container, highlight);
  if (!rootElement) {
    return [];
  }

  const ranges = buildRangesFromHighlightOffsets(rootElement, highlight);
  if (ranges.length === 0) {
    return [];
  }

  return buildTextHighlightOverlayLayers(ranges, container);
}

function areTextHighlightRectsEqual(
  current: TextHighlightOverlayRect[],
  next: TextHighlightOverlayRect[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((rect, index) => {
    const candidate = next[index];
    return (
      Math.abs(rect.left - candidate.left) < TEXT_HIGHLIGHT_RECT_EPSILON
      && Math.abs(rect.top - candidate.top) < TEXT_HIGHLIGHT_RECT_EPSILON
      && Math.abs(rect.width - candidate.width) < TEXT_HIGHLIGHT_RECT_EPSILON
      && Math.abs(rect.height - candidate.height) < TEXT_HIGHLIGHT_RECT_EPSILON
    );
  });
}

export function areTextHighlightOverlayLayersEqual(
  current: TextHighlightOverlayLayer[],
  next: TextHighlightOverlayLayer[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((layer, index) => {
    const candidate = next[index];
    return layer.host === candidate.host && areTextHighlightRectsEqual(layer.rects, candidate.rects);
  });
}

export function areSelectedTextHighlightsEqual(
  current: EquationsPaneSelectedTextHighlight | null,
  next: EquationsPaneSelectedTextHighlight | null,
): boolean {
  if (current === next) {
    return true;
  }

  if (!current || !next) {
    return false;
  }

  return (
    current.itemId === next.itemId
    && current.selectionId === next.selectionId
    && current.startOffset === next.startOffset
    && current.endOffset === next.endOffset
    && current.text === next.text
    && current.contextBefore === next.contextBefore
    && current.contextAfter === next.contextAfter
  );
}
