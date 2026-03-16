import { type ReactNode, useEffect, useRef, useState } from "react";
import katex from "katex";
import type {
  EquationsMappingEntry,
  EquationsPaneCard,
  VisualizationState,
} from "@shared/schema";
import { resolveEquationsMathExpression } from "@shared/equations-math";
import { buildEquationsFrameGridDocument } from "@shared/equations-framegrid-document";
import type { EquationHitBoxClickSignal } from "@/components/home/equation-interaction.types";
import type { SidebarMode } from "@/lib/dashboard/subapp-shell";
import { SubappFloatingFrame } from "@/components/floating-frame";
import { FrameGrid, type FrameGridDebugSnapshot } from "@/components/frame-grid";

type EquationsMainPanelProps = {
  sidebarMode: SidebarMode;
  equationsPane: VisualizationState["equationsPane"];
  frameGridLayoutDebug?: boolean;
  onFrameGridDebugChange?: (debug: FrameGridDebugSnapshot) => void;
  equationHitBoxClick?: EquationHitBoxClickSignal | null;
  onEquationHitBoxSelect?: (signal: EquationHitBoxClickSignal | null) => void;
};

type FitMode = "intrinsic" | "wrap";
type FitAlign = "center" | "start";
type CardVariant = "equation" | "literal" | "representation" | "framing";

function FitToCellContent({
  children,
  mode,
  align,
}: {
  children: ReactNode;
  mode: FitMode;
  align: FitAlign;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      return;
    }

    let frame = 0;
    const scheduleMeasure = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const availableWidth = container.clientWidth;
        const availableHeight = container.clientHeight;
        const naturalWidth = content.scrollWidth;
        const naturalHeight = content.scrollHeight;

        if (
          availableWidth <= 0
          || availableHeight <= 0
          || naturalWidth <= 0
          || naturalHeight <= 0
        ) {
          setScale(1);
          return;
        }

        const widthScale = mode === "wrap" ? 1 : availableWidth / naturalWidth;
        const nextScale = Math.min(1, widthScale, availableHeight / naturalHeight);
        setScale((current) => (Math.abs(current - nextScale) < 0.01 ? current : nextScale));
      });
    };

    scheduleMeasure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleMeasure);
      return () => {
        if (frame !== 0) {
          window.cancelAnimationFrame(frame);
        }
        window.removeEventListener("resize", scheduleMeasure);
      };
    }

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(container);
    observer.observe(content);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, [align, mode]);

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
      <div
        ref={contentRef}
        className={[
          "absolute",
          align === "center" ? "left-1/2 top-1/2" : "left-0 top-0",
          mode === "intrinsic" ? "w-max max-w-none" : "w-full",
        ].join(" ")}
        style={{
          width: mode === "wrap" ? `${100 / Math.max(scale, 0.01)}%` : undefined,
          transform:
            align === "center"
              ? `translate(-50%, -50%) scale(${scale})`
              : `scale(${scale})`,
          transformOrigin: align === "center" ? "center center" : "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function renderMappingLatex(
  entry: EquationsMappingEntry,
  options?: { preferDisplayStyle?: boolean },
): string | null {
  if (entry.kind !== "latex") {
    return null;
  }
  const latex = options?.preferDisplayStyle && entry.displayMode === undefined
    ? `{\\displaystyle ${entry.value}}`
    : entry.value;
  return katex.renderToString(latex, {
    displayMode: entry.displayMode ?? false,
    output: "htmlAndMathml",
    throwOnError: false,
    trust: false,
  });
}

function MappedCardContent({
  itemId,
  mappings,
  variant,
  selectedHitBox,
  onSelect,
}: {
  itemId: string;
  mappings: EquationsMappingEntry[];
  variant: CardVariant;
  selectedHitBox?: EquationHitBoxClickSignal | null;
  onSelect?: (signal: EquationHitBoxClickSignal | null) => void;
}) {
  const selectedHitBoxId = selectedHitBox?.hitBox.id ?? null;
  const selectedItemId = selectedHitBox?.itemId ?? null;
  const containerClassName = [
    "max-w-full whitespace-pre-wrap break-words",
    variant === "literal"
      ? "font-mono text-[11px] leading-5 text-foreground/78"
      : variant === "equation"
        ? "text-center leading-[2.2] text-foreground"
        : "text-[13px] leading-5 text-foreground/82",
  ].join(" ");

  return (
    <div className={containerClassName}>
      {mappings.map((entry, index) => {
        const markup = renderMappingLatex(entry, {
          preferDisplayStyle: variant === "equation",
        });
        const hitBox = entry.hitBox;
        const isActive = Boolean(hitBox && hitBox.id === selectedHitBoxId);
        const isSameSelection = Boolean(
          hitBox
          && hitBox.id === selectedHitBoxId
          && itemId === selectedItemId,
        );
        const content = markup ? (
          <span
            className="inline-block align-middle"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ) : (
          <span className="whitespace-pre-wrap">{entry.value}</span>
        );

        if (!hitBox) {
          return (
            <span key={`${itemId}-mapping-${index}`} className="inline">
              {content}
            </span>
          );
        }

        return (
          <button
            key={`${itemId}-mapping-${index}`}
            type="button"
            className={[
              "inline-flex items-center align-middle rounded-sm bg-transparent px-0.5 py-0.5 text-inherit transition-colors",
              "focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-ring/60",
              isSameSelection
                ? "bg-accent/34 ring-inset ring-1 ring-ring/55"
                : isActive
                  ? "bg-accent/18 ring-inset ring-1 ring-ring/30"
                  : "hover:bg-accent/14",
            ].join(" ")}
            onClick={() => onSelect?.(isSameSelection ? null : { itemId, hitBox })}
            aria-label={`Select equation mapping ${hitBox.label}`}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

export function EquationsMainPanel({
  sidebarMode,
  equationsPane,
  frameGridLayoutDebug = false,
  onFrameGridDebugChange,
  equationHitBoxClick,
  onEquationHitBoxSelect,
}: EquationsMainPanelProps) {
  const contentAreaRef = useRef<HTMLElement | null>(null);
  const frameGridDocument = buildEquationsFrameGridDocument(equationsPane, {
    detailsFallbackBody: sidebarMode === "analysis" ? "Library" : "Setup",
  });
  const selectedHitBoxLatexMarkup = equationHitBoxClick
    && equationHitBoxClick.hitBox.latex.trim().length > 0
    ? katex.renderToString(equationHitBoxClick.hitBox.latex, {
        displayMode: true,
        output: "htmlAndMathml",
        throwOnError: false,
        trust: false,
      })
    : null;

  const getCardVariant = (itemId: string) => {
    if (itemId === "workspace") {
      return "equation";
    }
    if (itemId === "details") {
      return "literal";
    }
    if (itemId === "notes" || itemId === "footer") {
      return "representation";
    }
    return "framing";
  };

  const renderCard = (
    itemId: string,
    card: EquationsPaneCard,
    options?: { fallbackBody?: string },
  ) => {
    const math = resolveEquationsMathExpression(card.math);
    const mappings = Array.isArray(card.mappings) ? card.mappings : [];
    const hasMappings = mappings.length > 0;
    const body = card.body.trim().length > 0 ? card.body : options?.fallbackBody ?? "";
    const title = card.title.trim().length > 0 ? card.title : "";
    const variant: CardVariant = getCardVariant(itemId);
    const isEquationCard = variant === "equation";
    const isLiteralCard = variant === "literal";
    const mathMarkup = !hasMappings && math
      ? katex.renderToString(math.latex, {
          displayMode: math.displayMode,
          output: "htmlAndMathml",
          throwOnError: false,
          trust: false,
        })
      : null;
    const fitMode: FitMode = isEquationCard ? "intrinsic" : "wrap";
    const fitAlign: FitAlign = isEquationCard ? "center" : "start";

    return (
      <article
        className={[
          "h-full w-full rounded-xl p-4 md:p-5",
          "overflow-hidden backdrop-blur-[2px]",
          isEquationCard ? "bg-background/88" : "bg-card/78",
        ].join(" ")}
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
                isEquationCard ? "items-center justify-center text-center" : "items-start text-left",
              ].join(" ")}
            >
              {mathMarkup ? (
                <div
                  className="max-w-full overflow-x-auto text-foreground"
                  dangerouslySetInnerHTML={{ __html: mathMarkup }}
                />
              ) : null}
              {hasMappings ? (
                <MappedCardContent
                  itemId={itemId}
                  mappings={mappings}
                  variant={variant}
                  selectedHitBox={equationHitBoxClick}
                  onSelect={onEquationHitBoxSelect}
                />
              ) : null}
              {!hasMappings && body ? (
                <div
                  className={[
                    "whitespace-pre-line break-words",
                    isLiteralCard
                      ? "font-mono text-[11px] leading-5 text-foreground/78"
                      : isEquationCard
                        ? "max-w-[32ch] text-sm leading-relaxed text-muted-foreground"
                        : "text-[13px] leading-5 text-foreground/82",
                  ].join(" ")}
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
      >
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
                  className="rounded-sm border border-border/50 bg-background/60 px-2 py-2 text-foreground"
                  dangerouslySetInnerHTML={{ __html: selectedHitBoxLatexMarkup }}
                />
              ) : null}
              <div className="font-mono text-sm leading-relaxed text-foreground">
                {equationHitBoxClick.hitBox.sequence}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground leading-relaxed">
              Equation interaction metadata appears here when the active document provides it.
            </div>
          )}
        </SubappFloatingFrame>
      </section>
    </main>
  );
}
