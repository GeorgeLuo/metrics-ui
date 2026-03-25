import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import { Check, Copy } from "lucide-react";
import type {
  CaptureSession,
  EquationsPaneCard,
  VisualizationFrameState,
  VisualizationState,
} from "@shared/schema";
import { resolveEquationsMathExpression } from "@shared/equations-math";
import { buildEquationsFrameGridDocument } from "@shared/equations-framegrid-document";
import type { EquationHitBoxClickSignal } from "@/components/home/equation-interaction.types";
import { InjectedVisualization, type InjectedVisualizationDebug } from "@/components/injected-visualization";
import { SubappFloatingFrame } from "@/components/floating-frame";
import { FrameGrid, type FrameGridDebugSnapshot } from "@/components/frame-grid";
import type { SidebarMode } from "@/lib/dashboard/subapp-shell";
import { DASHBOARD_STORAGE_KEYS } from "@/lib/dashboard/storage";
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
  type SelectionEndpoints,
  type TextHighlightOverlayLayer,
  areSelectedTextHighlightsEqual,
  areTextHighlightOverlayLayersEqual,
  buildSelectionEndpointsFromSelection,
  buildSelectionHighlight,
  resolveTextHighlightOverlayLayers,
} from "./equations-main-panel/text-highlight";

type EquationsMainPanelProps = {
  sidebarMode: SidebarMode;
  equationsPane: VisualizationState["equationsPane"];
  frameGridLayoutDebug?: boolean;
  equationsSignalBlocksDebug?: boolean;
  visualizationFrame: VisualizationFrameState | null;
  visualizationCapture: CaptureSession | null;
  currentTick: number;
  onVisualizationDebugChange?: (debug: InjectedVisualizationDebug) => void;
  onFrameGridDebugChange?: (debug: FrameGridDebugSnapshot) => void;
  equationHitBoxClick?: EquationHitBoxClickSignal | null;
  onEquationHitBoxSelect?: (signal: EquationHitBoxClickSignal | null) => void;
  onEquationTextHighlightSelect?: (
    highlight: VisualizationState["equationsPane"]["context"]["selectedTextHighlight"],
  ) => void;
  onVisualizationFrameSelect?: (frame: VisualizationFrameState) => void;
};

type PendingTextHighlightGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  hadExistingHighlight: boolean;
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
  visualizationCapture,
  currentTick,
  onVisualizationDebugChange,
  onFrameGridDebugChange,
  equationHitBoxClick,
  onEquationHitBoxSelect,
  onEquationTextHighlightSelect,
  onVisualizationFrameSelect,
}: EquationsMainPanelProps) {
  const contentAreaRef = useRef<HTMLElement | null>(null);
  const interactionSignalCopyResetTimerRef = useRef<number | null>(null);
  const pendingTextHighlightGestureRef = useRef<PendingTextHighlightGesture | null>(null);
  const [interactionSignalCopyState, setInteractionSignalCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [selectedTextHighlightOverlayLayers, setSelectedTextHighlightOverlayLayers] = useState<TextHighlightOverlayLayer[]>([]);

  const frameGridDocument = buildEquationsFrameGridDocument(equationsPane, {
    detailsFallbackBody: sidebarMode === "analysis" ? "Library" : "Setup",
  });

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

  const updateSelectedTextHighlightOverlayLayers = (nextLayers: TextHighlightOverlayLayer[]) => {
    setSelectedTextHighlightOverlayLayers((current) => (
      areTextHighlightOverlayLayersEqual(current, nextLayers) ? current : nextLayers
    ));
  };

  const clearSelectedTextHighlight = () => {
    updateSelectedTextHighlightOverlayLayers([]);
    if (equationsPane.context.selectedTextHighlight !== null) {
      onEquationTextHighlightSelect?.(null);
    }
  };

  const refreshSelectedTextHighlightOverlay = () => {
    const container = contentAreaRef.current;
    const highlight = equationsPane.context.selectedTextHighlight;
    if (!container || !highlight) {
      updateSelectedTextHighlightOverlayLayers([]);
      return;
    }

    updateSelectedTextHighlightOverlayLayers(
      resolveTextHighlightOverlayLayers(container, highlight),
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

    updateSelectedTextHighlightOverlayLayers(overlayLayers);
    if (!areSelectedTextHighlightsEqual(equationsPane.context.selectedTextHighlight, highlight)) {
      onEquationTextHighlightSelect?.(highlight);
    }
  };

  const reconcileBrowserSelection = () => {
    if (typeof window === "undefined") {
      return;
    }

    const pendingGesture = pendingTextHighlightGestureRef.current;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (
        pendingGesture?.hadExistingHighlight
        && !pendingGesture.moved
        && equationsPane.context.selectedTextHighlight !== null
      ) {
        clearSelectedTextHighlight();
      }
      pendingTextHighlightGestureRef.current = null;
      return;
    }

    const container = contentAreaRef.current;
    const range = selection.getRangeAt(0).cloneRange();
    if (!container || !container.contains(range.commonAncestorContainer)) {
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

    pendingTextHighlightGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      hadExistingHighlight: equationsPane.context.selectedTextHighlight !== null,
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
  }, [equationsPane, sidebarMode, equationsSignalBlocksDebug]);

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

  const renderCard = (
    itemId: string,
    card: EquationsPaneCard,
    options?: { fallbackBody?: string },
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
    const variant = getCardVariant(itemId);
    const isEquationCard = variant === "equation";
    const isLiteralCard = variant === "literal";
    const presentation = card.presentation ?? "standard";
    const isFreeformCard = presentation === "freeform";
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
          "relative h-full w-full rounded-xl p-4 md:p-5",
          "overflow-hidden backdrop-blur-[2px]",
          isEquationCard || isFreeformCard ? "bg-background/88" : "bg-card/78",
        ].join(" ")}
        data-equations-item-id={itemId}
      >
        <div className="flex h-full w-full min-h-0 flex-col gap-3">
          {title ? (
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
      <section
        ref={contentAreaRef}
        className="relative flex-1 min-h-0"
        data-testid="equations-main-panel"
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
        {selectedTextHighlightOverlayLayers.map((layer, layerIndex) => createPortal(
          <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
            {layer.rects.map((rect, rectIndex) => (
              <div
                key={`equations-highlight-${layerIndex}-${rectIndex}`}
                className="absolute rounded-[2px] border"
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
          `equations-highlight-layer-${layerIndex}`,
        ))}
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
        <SubappFloatingFrame
          title="Interaction Signal"
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
          <SubappFloatingFrame
            title="Visualization Frame"
            containerRef={contentAreaRef}
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
            dragHint="Drag this visualization within the equations area."
            popoutable
            popoutWindowName="metrics-ui-equations-visualization-frame"
            popoutWindowTitle="Metrics UI - Equations Visualization Frame"
            dockRequestToken={Number.isFinite(visualizationDockRequestToken) ? visualizationDockRequestToken : undefined}
            resizable
            minSize={{ width: 280, height: 220 }}
            resizeHint="Drag an edge or corner to resize this visualization."
          >
            <InjectedVisualization
              frame={visualizationFrame}
              capture={visualizationCapture}
              currentTick={currentTick}
              onDebugChange={onVisualizationDebugChange}
            />
          </SubappFloatingFrame>
        ) : null}
      </section>
    </main>
  );
}
