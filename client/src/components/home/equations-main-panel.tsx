import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import { Check, Copy, Expand, Minimize2 } from "lucide-react";
import type {
  CaptureSession,
  EquationsPaneCard,
  EquationsPaneCardBlock,
  EquationsPaneCardSlotId,
  EquationsReferenceFrameState,
  EquationsPaneTopicReferenceBlock,
  VisualizationFrameState,
  VisualizationState,
} from "@shared/schema";
import { resolveEquationsMathExpression } from "@shared/equations-math";
import { buildEquationsFrameGridDocument } from "@shared/equations-framegrid-document";
import { cloneEquationsPaneCardBlock } from "@shared/equations-mappings";
import type { EquationHitBoxClickSignal } from "@/components/home/equation-interaction.types";
import { InjectedVisualization, type InjectedVisualizationDebug } from "@/components/injected-visualization";
import { SubappFloatingFrame, ViewportFloatingFrame } from "@/components/floating-frame";
import { FrameGrid, type FrameGridDebugSnapshot } from "@/components/frame-grid";
import type { SidebarMode } from "@/lib/dashboard/subapp-shell";
import { DASHBOARD_STORAGE_KEYS } from "@/lib/dashboard/storage";
import { getEquationsTopicOptionById, type EquationsTopicOption } from "@/lib/equations/topic-catalog";
import {
  buildEquationsTopicDocument,
  buildEquationsTextbookTopicDocuments,
  getEquationsTextbookTopicAnchorId,
} from "@/lib/equations/textbook-view";
import {
  type CardVariant,
  collectFreeformBlockFormulaBySelectionId,
  FreeformCardContent,
  MappedCardContent,
  PiecewiseEquationContent,
  renderCardAsLatex,
} from "./equations-main-panel/card-content";
import { FitToCellContent, type FitAlign, type FitMode } from "./equations-main-panel/fit-to-cell-content";
import {
  appendSelectedTextHighlight,
  type SelectionEndpoints,
  type TextHighlightOverlayEntry,
  areSelectedTextHighlightCollectionsEqual,
  areTextHighlightOverlayEntriesEqual,
  buildSelectionEndpointsFromSelection,
  buildSelectionHighlight,
  findTextHighlightKeyAtPoint,
  findEquationsHighlightSurface,
  isWithinEquationsHighlightSurface,
  removeSelectedTextHighlightByKey,
  resolveTextHighlightOverlayEntries,
  resolveTextHighlightOverlayLayers,
} from "./equations-main-panel/text-highlight";

type EquationsMainPanelProps = {
  sidebarMode: SidebarMode;
  equationsPane: VisualizationState["equationsPane"];
  frameGridLayoutDebug?: boolean;
  equationsSignalBlocksDebug?: boolean;
  visualizationFrame: VisualizationFrameState | null;
  referenceFrame: VisualizationState["equationsPane"]["context"]["referenceFrame"];
  visualizationCapture: CaptureSession | null;
  currentTick: number;
  onVisualizationDebugChange?: (debug: InjectedVisualizationDebug) => void;
  onFrameGridDebugChange?: (debug: FrameGridDebugSnapshot) => void;
  equationHitBoxClick?: EquationHitBoxClickSignal | null;
  onEquationHitBoxSelect?: (signal: EquationHitBoxClickSignal | null) => void;
  onEquationTextHighlightsSelect?: (
    highlights: VisualizationState["equationsPane"]["context"]["selectedTextHighlights"],
  ) => void;
  hiddenTextHighlightIds?: number[];
  onVisualizationFrameSelect?: (frame: VisualizationFrameState | null) => void;
  onReferenceFrameSelect?: (frame: EquationsReferenceFrameState | null) => void;
  textbookScrollAnchorId?: string | null;
  textbookScrollRequestKey?: number;
  textbookTopicOptions?: EquationsTopicOption[];
};

type PendingTextHighlightGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  clickedHighlightKey: string | null;
};

async function copyTextToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined"
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable in this environment.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!success) {
    throw new Error("Clipboard copy command failed.");
  }
}

export function EquationsMainPanel({
  sidebarMode,
  equationsPane,
  frameGridLayoutDebug = false,
  equationsSignalBlocksDebug = false,
  visualizationFrame,
  referenceFrame,
  visualizationCapture,
  currentTick,
  onVisualizationDebugChange,
  onFrameGridDebugChange,
  equationHitBoxClick,
  onEquationHitBoxSelect,
  onEquationTextHighlightsSelect,
  hiddenTextHighlightIds = [],
  onVisualizationFrameSelect,
  onReferenceFrameSelect,
  textbookScrollAnchorId = null,
  textbookScrollRequestKey = 0,
  textbookTopicOptions = [],
}: EquationsMainPanelProps) {
  const contentAreaRef = useRef<HTMLElement | null>(null);
  const interactionSignalCopyResetTimerRef = useRef<number | null>(null);
  const pendingTextHighlightGestureRef = useRef<PendingTextHighlightGesture | null>(null);
  const [interactionSignalCopyState, setInteractionSignalCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [selectedTextHighlightOverlayEntries, setSelectedTextHighlightOverlayEntries] = useState<TextHighlightOverlayEntry[]>([]);
  const [referenceFrameScope, setReferenceFrameScope] = useState<"focus" | "topic">("focus");

  const frameGridDocument = buildEquationsFrameGridDocument(equationsPane, {
    detailsFallbackBody: sidebarMode === "analysis" ? "Library" : "Setup",
  });
  const isTextbookView = equationsPane.viewMode === "textbook";
  const textbookTopicDocuments = useMemo(
    () => (
      isTextbookView
        ? buildEquationsTextbookTopicDocuments(textbookTopicOptions)
        : []
    ),
    [isTextbookView, textbookTopicOptions],
  );
  const visibleTextHighlights = equationsPane.context.selectedTextHighlights.filter((highlight) => (
    typeof highlight.highlightId !== "number" || !hiddenTextHighlightIds.includes(highlight.highlightId)
  ));

  const freeformBlockFormulaBySelectionId = new Map<string, string>();
  frameGridDocument.items.forEach((item) => {
    const itemId = item.id ?? "workspace";
    const blocks = Array.isArray(item.blocks) ? item.blocks : [];
    collectFreeformBlockFormulaBySelectionId(itemId, blocks, freeformBlockFormulaBySelectionId);
  });

  const workspaceItem = frameGridDocument.items.find((item) => item.id === "workspace");
  const selectedDocumentItem = equationHitBoxClick
    ? frameGridDocument.items.find((item) => item.id === equationHitBoxClick.itemId)
    : null;
  const fallbackFormulaLatex = workspaceItem
    ? renderCardAsLatex(workspaceItem)
    : renderCardAsLatex(equationsPane.content.workspace);
  const selectedFormulaLatex = equationHitBoxClick
    ? freeformBlockFormulaBySelectionId.get(equationHitBoxClick.itemId)
      ?? (selectedDocumentItem ? renderCardAsLatex(selectedDocumentItem) : fallbackFormulaLatex)
    : fallbackFormulaLatex;
  const selectedHitBoxLatex = equationHitBoxClick
    ? equationHitBoxClick.hitBox.latex.trim()
      || equationHitBoxClick.hitBox.sequence.trim()
      || equationHitBoxClick.hitBox.label.trim()
    : "";
  const selectedHitBoxLatexMarkup = equationHitBoxClick
    && equationHitBoxClick.hitBox.latex.trim().length > 0
    ? katex.renderToString(equationHitBoxClick.hitBox.latex, {
        displayMode: true,
        output: "htmlAndMathml",
        throwOnError: false,
        trust: false,
      })
    : null;
  const interactionSignalClipboardText = [
    selectedFormulaLatex.trim().length > 0 ? `Formula: ${selectedFormulaLatex}` : null,
    selectedHitBoxLatex.length > 0 ? `Partial: ${selectedHitBoxLatex}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const visualizationDockRequestToken = visualizationFrame?.updatedAt
    ? Date.parse(visualizationFrame.updatedAt)
    : undefined;
  const referenceDockRequestToken = referenceFrame?.updatedAt
    ? Date.parse(referenceFrame.updatedAt)
    : undefined;

  const updateSelectedTextHighlightOverlayEntries = (nextEntries: TextHighlightOverlayEntry[]) => {
    setSelectedTextHighlightOverlayEntries((current) => (
      areTextHighlightOverlayEntriesEqual(current, nextEntries) ? current : nextEntries
    ));
  };

  const removeSelectedTextHighlight = (highlightKey: string) => {
    const nextHighlights = removeSelectedTextHighlightByKey(
      equationsPane.context.selectedTextHighlights,
      highlightKey,
    );
    if (
      areSelectedTextHighlightCollectionsEqual(
        equationsPane.context.selectedTextHighlights,
        nextHighlights,
      )
    ) {
      return;
    }

    updateSelectedTextHighlightOverlayEntries(
      contentAreaRef.current
        ? resolveTextHighlightOverlayEntries(contentAreaRef.current, nextHighlights)
        : [],
    );
    onEquationTextHighlightsSelect?.(nextHighlights);
  };

  const refreshSelectedTextHighlightOverlay = () => {
    const container = contentAreaRef.current;
    const highlights = visibleTextHighlights;
    if (!container || highlights.length === 0) {
      updateSelectedTextHighlightOverlayEntries([]);
      return;
    }

    updateSelectedTextHighlightOverlayEntries(
      resolveTextHighlightOverlayEntries(container, highlights),
    );
  };

  const commitSelectedTextHighlight = (
    range: Range,
    selectionEndpoints?: SelectionEndpoints | null,
  ) => {
    const container = contentAreaRef.current;
    if (!container) {
      return;
    }

    const highlight = buildSelectionHighlight(range, selectionEndpoints);
    if (!highlight) {
      return;
    }

    const overlayLayers = resolveTextHighlightOverlayLayers(container, highlight);
    if (overlayLayers.length === 0) {
      return;
    }

    const nextHighlights = appendSelectedTextHighlight(
      equationsPane.context.selectedTextHighlights,
      highlight,
    );
    const nextOverlayEntries = resolveTextHighlightOverlayEntries(container, nextHighlights);
    if (nextOverlayEntries.length === 0) {
      return;
    }

    updateSelectedTextHighlightOverlayEntries(nextOverlayEntries);
    if (
      !areSelectedTextHighlightCollectionsEqual(
        equationsPane.context.selectedTextHighlights,
        nextHighlights,
      )
    ) {
      onEquationTextHighlightsSelect?.(nextHighlights);
    }
  };

  const reconcileBrowserSelection = () => {
    if (typeof window === "undefined") {
      return;
    }

    const pendingGesture = pendingTextHighlightGestureRef.current;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (pendingGesture?.clickedHighlightKey && !pendingGesture.moved) {
        removeSelectedTextHighlight(pendingGesture.clickedHighlightKey);
      }
      pendingTextHighlightGestureRef.current = null;
      return;
    }

    const container = contentAreaRef.current;
    const range = selection.getRangeAt(0).cloneRange();
    if (!container || !isWithinEquationsHighlightSurface(container, range.commonAncestorContainer)) {
      pendingTextHighlightGestureRef.current = null;
      selection.removeAllRanges();
      return;
    }

    const browserSelectionEndpoints = buildSelectionEndpointsFromSelection(selection);
    commitSelectedTextHighlight(range, browserSelectionEndpoints);
    pendingTextHighlightGestureRef.current = null;
    selection.removeAllRanges();
  };

  const handlePanelPointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const isInsideFloatingFrame = Boolean(target?.closest("[data-floating-frame-root='true']"));
    const isInsideHighlightableFrame = Boolean(findEquationsHighlightSurface(target));
    if (isInsideFloatingFrame && !isInsideHighlightableFrame) {
      return;
    }

    pendingTextHighlightGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      clickedHighlightKey: findTextHighlightKeyAtPoint(
        selectedTextHighlightOverlayEntries,
        event.clientX,
        event.clientY,
      ),
    };
  };

  const handlePanelPointerMoveCapture = (event: ReactPointerEvent<HTMLElement>) => {
    const pendingGesture = pendingTextHighlightGestureRef.current;
    if (!pendingGesture || pendingGesture.pointerId !== event.pointerId || pendingGesture.moved) {
      return;
    }

    if (
      Math.abs(event.clientX - pendingGesture.startX) > 3
      || Math.abs(event.clientY - pendingGesture.startY) > 3
    ) {
      pendingGesture.moved = true;
    }
  };

  useEffect(() => {
    setInteractionSignalCopyState("idle");
    if (interactionSignalCopyResetTimerRef.current !== null) {
      window.clearTimeout(interactionSignalCopyResetTimerRef.current);
      interactionSignalCopyResetTimerRef.current = null;
    }
  }, [interactionSignalClipboardText]);

  useEffect(() => () => {
    if (interactionSignalCopyResetTimerRef.current !== null) {
      window.clearTimeout(interactionSignalCopyResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    refreshSelectedTextHighlightOverlay();
    window.addEventListener("resize", refreshSelectedTextHighlightOverlay);
    return () => {
      window.removeEventListener("resize", refreshSelectedTextHighlightOverlay);
    };
  }, [equationsPane, sidebarMode, equationsSignalBlocksDebug, hiddenTextHighlightIds]);

  useEffect(() => {
    setReferenceFrameScope("focus");
  }, [
    referenceFrame?.topicId,
    referenceFrame?.itemId,
    referenceFrame?.anchorId,
    referenceFrame?.updatedAt,
  ]);

  useEffect(() => {
    if (!textbookScrollAnchorId) {
      return;
    }

    const container = contentAreaRef.current;
    if (!container) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const escapedAnchor = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(textbookScrollAnchorId)
        : textbookScrollAnchorId.replace(/["\\]/g, "\\$&");
      const target = container.querySelector<HTMLElement>(`[data-equations-anchor-id="${escapedAnchor}"]`);
      if (!target) {
        return;
      }
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [textbookScrollAnchorId, textbookScrollRequestKey]);

  const handleCopyInteractionSignal = async () => {
    if (!interactionSignalClipboardText) {
      return;
    }

    try {
      await copyTextToClipboard(interactionSignalClipboardText);
      setInteractionSignalCopyState("copied");
    } catch {
      setInteractionSignalCopyState("error");
    }

    if (interactionSignalCopyResetTimerRef.current !== null) {
      window.clearTimeout(interactionSignalCopyResetTimerRef.current);
    }
    interactionSignalCopyResetTimerRef.current = window.setTimeout(() => {
      setInteractionSignalCopyState("idle");
      interactionSignalCopyResetTimerRef.current = null;
    }, 1500);
  };

  const getCardVariant = (itemId: string): CardVariant => {
    if (itemId === "workspace") {
      return "equation";
    }
    if (itemId === "details") {
      return "literal";
    }
    if (itemId === "notes") {
      return "meaning";
    }
    if (itemId === "footer") {
      return "concept";
    }
    return "meaning";
  };

  const normalizeTopicSlot = (value?: string): EquationsPaneCardSlotId => {
    if (value === "details" || value === "notes" || value === "footer") {
      return value;
    }
    return "workspace";
  };

  const findAnchoredBlock = (
    blocks: EquationsPaneCardBlock[],
    anchorId: string,
  ): EquationsPaneCardBlock | null => {
    for (const block of blocks) {
      if (block.anchorId === anchorId) {
        return block;
      }
      if (block.kind === "split") {
        const leftMatch = findAnchoredBlock(block.left, anchorId);
        if (leftMatch) {
          return leftMatch;
        }
        const rightMatch = findAnchoredBlock(block.right, anchorId);
        if (rightMatch) {
          return rightMatch;
        }
      }
    }
    return null;
  };

  const buildCardFromReferencedBlock = (
    block: EquationsPaneCardBlock,
  ): EquationsPaneCard => ({
    title: "",
    body: "",
    presentation: "freeform",
    blocks: [cloneEquationsPaneCardBlock(block)],
  });

  const resolveTopicReference = (
    block: EquationsPaneTopicReferenceBlock,
  ) => {
    const topic = getEquationsTopicOptionById(block.topicId);
    if (!topic) {
      return null;
    }
    if (topic.payload.kind !== "semantic_layout") {
      const sortedItems = [...topic.payload.document.items].sort((left, right) => {
        if (left.row !== right.row) {
          return left.row - right.row;
        }
        if (left.col !== right.col) {
          return left.col - right.col;
        }
        return (left.id ?? "").localeCompare(right.id ?? "");
      });
      return {
        topicId: topic.topicId,
        documentTitle: topic.label,
        documentItems: sortedItems,
      };
    }

    const slot = block.slot ?? "workspace";
    return {
      topicId: topic.topicId,
      slot,
      card: topic.payload.content[slot],
      variant: getCardVariant(slot),
    };
  };

  const resolveReferenceFrame = (
    frame: EquationsReferenceFrameState | null,
  ): {
    frameTitle: string;
    sourceLabel: string;
    kind: "card" | "topic";
    itemId?: string;
    itemTitle?: string;
    card?: EquationsPaneCard;
    document?: ReturnType<typeof buildEquationsTopicDocument>;
  } | null => {
    if (!frame) {
      return null;
    }

    const topic = getEquationsTopicOptionById(frame.topicId);
    if (!topic) {
      return null;
    }

    if (referenceFrameScope === "topic") {
      return {
        frameTitle: frame.title?.trim() || topic.label,
        sourceLabel: topic.label,
        kind: "topic",
        document: buildEquationsTopicDocument(topic),
      };
    }

    if (topic.payload.kind === "semantic_layout") {
      const slot = normalizeTopicSlot(frame.itemId);
      const card = topic.payload.content[slot];
      if (frame.anchorId) {
        const blocks = Array.isArray(card.blocks) ? card.blocks : [];
        const anchoredBlock = findAnchoredBlock(blocks, frame.anchorId);
        if (!anchoredBlock) {
          return null;
        }
        return {
          frameTitle: frame.title?.trim() || topic.label,
          sourceLabel: topic.label,
          kind: "card",
          itemId: `reference:${topic.topicId}:${slot}:anchor:${frame.anchorId}`,
          itemTitle: card.title,
          card: buildCardFromReferencedBlock(anchoredBlock),
        };
      }

      return {
        frameTitle: frame.title?.trim() || topic.label,
        sourceLabel: topic.label,
        kind: "card",
        itemId: `reference:${topic.topicId}:${slot}`,
        itemTitle: card.title,
        card,
      };
    }

    const document = topic.payload.document;
    const requestedItemId = typeof frame.itemId === "string" && frame.itemId.trim().length > 0
      ? frame.itemId.trim()
      : null;
    const item = requestedItemId
      ? document.items.find((entry) => entry.id === requestedItemId)
      : document.items.find((entry) => entry.id === "workspace") ?? document.items[0] ?? null;
    if (!item) {
      return null;
    }

    if (frame.anchorId) {
      const blocks = Array.isArray(item.blocks) ? item.blocks : [];
      const anchoredBlock = findAnchoredBlock(blocks, frame.anchorId);
      if (!anchoredBlock) {
        return null;
      }
      return {
        frameTitle: frame.title?.trim() || topic.label,
        sourceLabel: topic.label,
        kind: "card",
        itemId: `reference:${topic.topicId}:${item.id ?? "workspace"}:anchor:${frame.anchorId}`,
        itemTitle: item.title,
        card: buildCardFromReferencedBlock(anchoredBlock),
      };
    }

    return {
      frameTitle: frame.title?.trim() || topic.label,
      sourceLabel: topic.label,
      kind: "card",
      itemId: `reference:${topic.topicId}:${item.id ?? "workspace"}`,
      itemTitle: item.title,
      card: item,
    };
  };

  const renderCard = (
    itemId: string,
    card: EquationsPaneCard,
    options?: { fallbackBody?: string; variantItemId?: string },
  ) => {
    const math = resolveEquationsMathExpression(card.math);
    const mappings = Array.isArray(card.mappings) ? card.mappings : [];
    const piecewiseRows = Array.isArray(card.piecewiseRows) ? card.piecewiseRows : [];
    const blocks = Array.isArray(card.blocks) ? card.blocks : [];
    const hasMappings = mappings.length > 0;
    const hasPiecewiseRows = piecewiseRows.length > 0;
    const hasBlocks = blocks.length > 0;
    const body = card.body.trim().length > 0 ? card.body : options?.fallbackBody ?? "";
    const title = card.title.trim().length > 0 ? card.title : "";
    const variant = getCardVariant(options?.variantItemId ?? itemId);
    const isEquationCard = variant === "equation";
    const isLiteralCard = variant === "literal";
    const presentation = card.presentation ?? "standard";
    const isFreeformCard = presentation === "freeform";
    const useTextbookChrome = isTextbookView && isFreeformCard && itemId === "workspace";
    const isPiecewiseEquation = isEquationCard && presentation === "piecewise";
    const mathMarkup = !hasMappings && !hasPiecewiseRows && !hasBlocks && math
      ? katex.renderToString(math.latex, {
          displayMode: math.displayMode,
          output: "htmlAndMathml",
          throwOnError: false,
          trust: false,
        })
      : null;
    const fitMode: FitMode = isEquationCard && !isFreeformCard ? "intrinsic" : "wrap";
    const fitAlign: FitAlign = isEquationCard && !isFreeformCard ? "center" : "start";

    return (
      <article
        className={[
          "relative h-full w-full overflow-hidden",
          useTextbookChrome
            ? "rounded-none bg-transparent p-1 md:p-2"
            : [
                "rounded-xl p-4 md:p-5",
                "backdrop-blur-[2px]",
                isEquationCard || isFreeformCard ? "bg-background/88" : "bg-card/78",
              ].join(" "),
        ].join(" ")}
        data-equations-item-id={itemId}
      >
        <div className={`flex h-full w-full min-h-0 flex-col ${useTextbookChrome ? "gap-0" : "gap-3"}`}>
          {title && !useTextbookChrome ? (
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
          ) : null}
          <FitToCellContent mode={fitMode} align={fitAlign}>
            <div
              className={[
                "flex flex-col gap-3",
                isPiecewiseEquation
                  ? "items-start justify-center text-left"
                  : isFreeformCard
                    ? "items-start text-left"
                  : isEquationCard
                    ? "items-center justify-center text-center"
                    : "items-start text-left",
              ].join(" ")}
            >
              {mathMarkup ? (
                <div
                  className="relative max-w-full overflow-x-auto text-foreground"
                  data-equations-selection-root="1"
                  data-equations-item-id={itemId}
                  data-equations-selection-id={itemId}
                  dangerouslySetInnerHTML={{ __html: mathMarkup }}
                />
              ) : null}
              {isPiecewiseEquation && hasPiecewiseRows ? (
                <PiecewiseEquationContent
                  itemId={itemId}
                  lhsMappings={mappings}
                  rows={piecewiseRows}
                  showAllSignalBlocks={equationsSignalBlocksDebug}
                  selectedHitBox={equationHitBoxClick}
                  onSelect={onEquationHitBoxSelect}
                />
              ) : isFreeformCard && hasBlocks ? (
                <FreeformCardContent
                  itemId={itemId}
                  blocks={blocks}
                  showAllSignalBlocks={equationsSignalBlocksDebug}
                  selectedHitBox={equationHitBoxClick}
                  onSelect={onEquationHitBoxSelect}
                  onVisualizationLinkSelect={onVisualizationFrameSelect}
                  onReferenceFrameSelect={onReferenceFrameSelect}
                  resolveTopicReference={resolveTopicReference}
                  density={useTextbookChrome ? "textbook" : "standard"}
                />
              ) : hasMappings ? (
                <MappedCardContent
                  itemId={itemId}
                  mappings={mappings}
                  variant={variant}
                  presentation={presentation}
                  showAllSignalBlocks={equationsSignalBlocksDebug}
                  selectedHitBox={equationHitBoxClick}
                  onSelect={onEquationHitBoxSelect}
                />
              ) : null}
              {!hasMappings && !hasPiecewiseRows && !hasBlocks && body ? (
                <div
                  className={[
                    "relative whitespace-pre-line break-words",
                    isLiteralCard
                      ? "font-mono text-[11px] leading-5 text-foreground/78"
                      : isEquationCard
                        ? "max-w-[32ch] text-sm leading-relaxed text-muted-foreground"
                        : "text-[13px] leading-5 text-foreground/82",
                  ].join(" ")}
                  data-equations-selection-root="1"
                  data-equations-item-id={itemId}
                  data-equations-selection-id={itemId}
                >
                  {body}
                </div>
              ) : null}
            </div>
          </FitToCellContent>
        </div>
      </article>
    );
  };

  return (
    <main className="flex-1 flex flex-col px-4 pt-4 pb-1 gap-4 overflow-hidden min-h-0">
      {/*
        Resolve once per render so the frame and its close/open behavior stay purely state-driven.
      */}
      <section
        ref={contentAreaRef}
        className="relative flex-1 min-h-0"
        data-testid="equations-main-panel"
        data-equations-highlight-surface="1"
        onPointerDownCapture={handlePanelPointerDownCapture}
        onPointerMoveCapture={handlePanelPointerMoveCapture}
        onMouseUp={() => {
          window.requestAnimationFrame(() => {
            reconcileBrowserSelection();
          });
        }}
        onKeyUp={() => {
          window.requestAnimationFrame(() => {
            reconcileBrowserSelection();
          });
        }}
      >
        {selectedTextHighlightOverlayEntries.flatMap((entry) => entry.layers.flatMap((layer, layerIndex) => {
          if (!layer.host.isConnected) {
            return [];
          }

          return createPortal(
            <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
              {layer.rects.map((rect, rectIndex) => (
                <div
                  key={`equations-highlight-${entry.key}-${layerIndex}-${rectIndex}`}
                  className="absolute rounded-[2px] border"
                  data-equations-highlight-key={entry.key}
                  style={{
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    backgroundColor: "var(--equations-highlight-fill)",
                    borderColor: "var(--equations-highlight-stroke)",
                  }}
                />
              ))}
            </div>,
            layer.host,
            `equations-highlight-layer-${entry.key}-${layerIndex}`,
          );
        }))}
        {isTextbookView ? (
          <div
            className="h-full min-h-0 overflow-y-auto overflow-x-hidden pr-2"
            data-equations-highlight-overlay-host="1"
          >
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-10">
              {textbookTopicDocuments.map(({ topic, document }, topicIndex) => (
                <section
                  key={topic.id}
                  className="flex flex-col gap-2"
                  data-equations-anchor-id={getEquationsTextbookTopicAnchorId(topic.id)}
                >
                  <div className="sticky top-0 z-20 bg-background px-2 py-1 text-[13px] font-semibold leading-6 text-foreground">
                    {topic.label}
                  </div>
                  <div
                    className="relative w-full"
                    style={{ aspectRatio: `${document.spec.frameAspect[0]} / ${document.spec.frameAspect[1]}` }}
                  >
                    <FrameGrid
                      spec={document.spec}
                      debugId={`equations-textbook-${topic.id}`}
                      layoutDebug={frameGridLayoutDebug}
                      showOuterFrame={frameGridLayoutDebug}
                      showContentFrame={frameGridLayoutDebug}
                      onDebug={topicIndex === 0 ? onFrameGridDebugChange : undefined}
                    >
                      {document.items.map((item) => {
                        const sourceItemId = item.id ?? "workspace";
                        const textbookItemId = `textbook:${topic.id}:${sourceItemId}`;
                        return (
                          <FrameGrid.Item
                            key={`${topic.id}-${sourceItemId}`}
                            col={item.col}
                            row={item.row}
                            colSpan={item.colSpan}
                            rowSpan={item.rowSpan}
                          >
                            {renderCard(textbookItemId, item, { variantItemId: sourceItemId })}
                          </FrameGrid.Item>
                        );
                      })}
                    </FrameGrid>
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <FrameGrid
            spec={frameGridDocument.spec}
            debugId="equations-main"
            layoutDebug={frameGridLayoutDebug}
            showOuterFrame={false}
            showContentFrame={false}
            onDebug={onFrameGridDebugChange}
          >
            {frameGridDocument.items.map((item) => (
              <FrameGrid.Item
                key={item.id}
                col={item.col}
                row={item.row}
                colSpan={item.colSpan}
                rowSpan={item.rowSpan}
              >
                {renderCard(item.id ?? "workspace", item)}
              </FrameGrid.Item>
            ))}
          </FrameGrid>
        )}
        <SubappFloatingFrame
          title="Interaction Signal"
          isVisible={Boolean(equationHitBoxClick)}
          containerRef={contentAreaRef}
          defaultPosition={{ x: 16, y: 16 }}
          dataTestId="equations-interaction-signal-window"
          stateStorageKey={DASHBOARD_STORAGE_KEYS.equationsInteractionSignalFrame}
          className="w-[280px] min-w-[220px] max-w-[calc(100%-16px)] border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm"
          headerClassName="border-b border-border/50 bg-muted/40"
          titleClassName="text-xs text-foreground"
          dragHandleClassName="text-muted-foreground hover:text-foreground"
          controlButtonClassName="text-muted-foreground hover:text-foreground"
          contentClassName="!px-2 !py-2 text-foreground"
          contentMinHeight={0}
          dragHint="Drag this signal window within the equations area."
          closeable
          closeHint="Close this interaction signal window."
          onClose={() => onEquationHitBoxSelect?.(null)}
        >
          {equationHitBoxClick ? (
            <div className="flex flex-col gap-2" data-testid="equation-click-signal">
              {selectedHitBoxLatexMarkup ? (
                <div
                  className="group/interaction-signal relative w-full overflow-hidden rounded-sm border border-border/50 bg-background/60 px-2 py-2 text-foreground"
                >
                  <button
                    type="button"
                    onClick={handleCopyInteractionSignal}
                    className={[
                      "absolute right-1 top-1 left-auto z-20 flex h-6 w-6 items-center justify-center rounded-sm border border-border/50 bg-background/85 p-0",
                      "text-muted-foreground opacity-0 transition-opacity hover:bg-background",
                      "group-hover/interaction-signal:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
                      interactionSignalCopyState === "error" ? "text-destructive" : "hover:text-foreground",
                    ].join(" ")}
                    aria-label="Copy selected interaction signal to clipboard"
                    title="Copy selected interaction signal to clipboard"
                  >
                    {interactionSignalCopyState === "copied" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <div className="w-full overflow-x-auto" dangerouslySetInnerHTML={{ __html: selectedHitBoxLatexMarkup }} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-xs leading-relaxed text-muted-foreground">
              Equation interaction metadata appears here when the active document provides it.
            </div>
          )}
        </SubappFloatingFrame>
        {visualizationFrame ? (
          <ViewportFloatingFrame
            title="Visualization Frame"
            defaultPosition={{ x: 20, y: 170 }}
            defaultSize={{ width: 340, height: 300 }}
            dataTestId="equations-visualization-frame"
            stateStorageKey={DASHBOARD_STORAGE_KEYS.equationsVisualizationFloatingFrame}
            className="border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm"
            headerClassName="border-b border-border/50 bg-muted/40"
            titleClassName="text-xs text-foreground"
            dragHandleClassName="text-muted-foreground hover:text-foreground"
            controlButtonClassName="text-muted-foreground hover:text-foreground"
            contentClassName="!px-2 !py-2"
            contentMinHeight={0}
            contentFill
            dragHint="Drag this visualization anywhere in the web app viewport."
            popoutable
            popoutWindowName="metrics-ui-equations-visualization-frame"
            popoutWindowTitle="Metrics UI - Equations Visualization Frame"
            dockRequestToken={Number.isFinite(visualizationDockRequestToken) ? visualizationDockRequestToken : undefined}
            resizable
            closeable
            minSize={{ width: 280, height: 220 }}
            resizeHint="Drag an edge or corner to resize this visualization."
            closeHint="Close this equations visualization."
            onClose={() => onVisualizationFrameSelect?.(null)}
          >
            <InjectedVisualization
              frame={visualizationFrame}
              capture={visualizationCapture}
              currentTick={currentTick}
              onDebugChange={onVisualizationDebugChange}
            />
          </ViewportFloatingFrame>
        ) : null}
        {(() => {
          const resolvedReferenceFrame = resolveReferenceFrame(referenceFrame);
          if (!referenceFrame) {
            return null;
          }

          return (
            <ViewportFloatingFrame
              title={resolvedReferenceFrame?.frameTitle ?? "Reference Frame"}
              defaultPosition={{ x: 80, y: 220 }}
              defaultSize={{ width: 420, height: 320 }}
              dataTestId="equations-reference-frame"
              stateStorageKey={DASHBOARD_STORAGE_KEYS.equationsReferenceFloatingFrame}
              className="border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm"
              headerClassName="border-b border-border/50 bg-muted/40"
              titleClassName="text-xs text-foreground"
              dragHandleClassName="text-muted-foreground hover:text-foreground"
              controlButtonClassName="text-muted-foreground hover:text-foreground"
              headerActions={[
                {
                  id: resolvedReferenceFrame?.kind === "topic" ? "focus-selection" : "expand-to-full-context",
                  label: resolvedReferenceFrame?.kind === "topic" ? "Focus excerpt" : "Expand to full context",
                  hint: resolvedReferenceFrame?.kind === "topic"
                    ? "Return this frame to the focused referenced excerpt."
                    : "Expand this frame to the full referenced topic.",
                  icon: resolvedReferenceFrame?.kind === "topic"
                    ? <Minimize2 className="w-3 h-3" />
                    : <Expand className="w-3 h-3" />,
                  onClick: () => {
                    setReferenceFrameScope(
                      resolvedReferenceFrame?.kind === "topic" ? "focus" : "topic",
                    );
                  },
                },
              ]}
              contentClassName="!px-2 !py-2"
              contentSelectable
              contentMinHeight={0}
              contentFill
              dragHint="Drag this reference anywhere in the web app viewport."
              dockRequestToken={Number.isFinite(referenceDockRequestToken) ? referenceDockRequestToken : undefined}
              resizable
              closeable
              minSize={{ width: 300, height: 220 }}
              resizeHint="Drag an edge or corner to resize this reference."
              closeHint="Close this equations reference."
              onClose={() => onReferenceFrameSelect?.(null)}
            >
              {resolvedReferenceFrame ? (
                <div
                  className="flex h-full min-h-0 flex-col gap-2 overflow-hidden"
                  data-equations-highlight-surface="1"
                >
                  <div className="px-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {resolvedReferenceFrame.sourceLabel}
                    {resolvedReferenceFrame.kind === "card"
                      && resolvedReferenceFrame.itemTitle
                      && resolvedReferenceFrame.itemTitle.trim().length > 0
                      ? ` / ${resolvedReferenceFrame.itemTitle}`
                      : ""}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto" data-equations-highlight-overlay-host="1">
                    {resolvedReferenceFrame.kind === "card" && resolvedReferenceFrame.itemId && resolvedReferenceFrame.card ? (
                      renderCard(resolvedReferenceFrame.itemId, resolvedReferenceFrame.card)
                    ) : resolvedReferenceFrame.document ? (
                      <div
                        className="relative mx-auto w-full"
                        style={{
                          aspectRatio: `${resolvedReferenceFrame.document.spec.frameAspect[0]} / ${resolvedReferenceFrame.document.spec.frameAspect[1]}`,
                        }}
                      >
                        <FrameGrid
                          spec={resolvedReferenceFrame.document.spec}
                          debugId={`equations-reference-topic-${referenceFrame.topicId}`}
                          layoutDebug={frameGridLayoutDebug}
                          showOuterFrame={false}
                          showContentFrame={false}
                        >
                          {resolvedReferenceFrame.document.items.map((item) => {
                            const sourceItemId = item.id ?? "workspace";
                            const referenceItemId = `reference-topic:${referenceFrame.topicId}:${sourceItemId}`;
                            return (
                              <FrameGrid.Item
                                key={`${referenceFrame.topicId}-${sourceItemId}`}
                                col={item.col}
                                row={item.row}
                                colSpan={item.colSpan}
                                rowSpan={item.rowSpan}
                              >
                                {renderCard(referenceItemId, item, { variantItemId: sourceItemId })}
                              </FrameGrid.Item>
                            );
                          })}
                        </FrameGrid>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs leading-relaxed text-muted-foreground">
                  Referenced topic block unavailable.
                </div>
              )}
            </ViewportFloatingFrame>
          );
        })()}
      </section>
    </main>
  );
}
