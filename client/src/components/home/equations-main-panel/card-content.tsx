import type { ReactNode } from "react";
import katex from "katex";
import { ExternalLink } from "lucide-react";
import type {
  EquationsMappingEntry,
  EquationsPaneCard,
  EquationsPaneCardBlock,
  EquationsPaneCardPresentation,
  EquationsPiecewiseRow,
  VisualizationFrameState,
} from "@shared/schema";
import { resolveEquationsMathExpression } from "@shared/equations-math";
import type { EquationHitBoxClickSignal } from "@/components/home/equation-interaction.types";
import { FitToWidthContent } from "./fit-to-cell-content";

export type CardVariant = "equation" | "literal" | "meaning" | "concept";

type FreeformBlockPathSegment = number | "left" | "right";

function splitTrailingInlineSegment(value: string): {
  leadingText: string;
  trailingText: string;
} {
  const trimmed = value.replace(/\s+$/u, "");
  const match = /^(.*?)(\S+)$/su.exec(trimmed);
  if (!match) {
    return { leadingText: value, trailingText: "" };
  }
  return {
    leadingText: match[1],
    trailingText: match[2],
  };
}

function InlineVisualizationLauncher({
  label,
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="relative ml-[0.15em] inline-flex h-[0.95em] w-[0.95em] items-center justify-center align-baseline text-sky-700 transition-colors hover:text-sky-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 dark:text-yellow-300 dark:hover:text-yellow-200"
      style={{ top: "0.08em" }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={label ?? "Open visualization"}
      title={label ?? "Open visualization"}
    >
      <ExternalLink className="h-[0.95em] w-[0.95em]" strokeWidth={2.2} />
    </button>
  );
}

function isMultiLineDisplayMath(latex: string, displayMode?: boolean): boolean {
  if (displayMode === false) {
    return false;
  }

  return (
    /\\begin\{(?:aligned|align|split|array|cases|gathered)\}/.test(latex)
    || /\\\\/.test(latex)
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

function renderPiecewiseBrace(rows: EquationsPiecewiseRow[]): string {
  const toLatex = (entries: EquationsMappingEntry[]): string =>
    entries
      .map((entry) => {
        if (entry.kind === "latex") {
          return entry.value;
        }
        if (entry.value.trim().length === 0) {
          return "";
        }
        return "\\,";
      })
      .join(" ");

  const placeholderRows = rows.map((row) => {
    const expression = toLatex(row.expression);
    const condition = toLatex(row.condition ?? []);
    const rowLatex = [expression, condition].filter((value) => value.length > 0).join("\\quad ");
    return `\\vphantom{${rowLatex.length > 0 ? rowLatex : "x"}}`;
  });

  return katex.renderToString(
    String.raw`\left\{\begin{array}{l}${placeholderRows.join(String.raw`\\`)}\end{array}\right.`,
    {
      displayMode: true,
      output: "htmlAndMathml",
      throwOnError: false,
      trust: false,
    },
  );
}

function joinMappingsAsLatex(mappings: EquationsMappingEntry[]): string {
  return mappings.map((entry) => entry.value).join("");
}

function renderBlockAsLatex(block: EquationsPaneCardBlock): string {
  if (block.kind === "text") {
    return "";
  }
  if (block.kind === "math") {
    return block.latex.trim();
  }
  if (block.kind === "split") {
    return [
      ...block.right.map((entry) => renderBlockAsLatex(entry)),
      ...block.left.map((entry) => renderBlockAsLatex(entry)),
    ].find((value) => value.length > 0) ?? "";
  }
  return joinMappingsAsLatex(block.mappings).trim();
}

function buildFreeformBlockScopeId(
  itemId: string,
  path: FreeformBlockPathSegment[],
): string | null {
  const sideSegments = path.filter(
    (segment): segment is "left" | "right" => segment === "left" || segment === "right",
  );
  if (sideSegments.length === 0) {
    return null;
  }
  return `${itemId}::scope:${sideSegments.join(":")}`;
}

function buildFreeformBlockSelectionId(
  itemId: string,
  path: FreeformBlockPathSegment[],
): string {
  return `${itemId}::block:${path.join(":")}`;
}

export function collectFreeformBlockFormulaBySelectionId(
  itemId: string,
  blocks: EquationsPaneCardBlock[],
  formulas: Map<string, string>,
  path: FreeformBlockPathSegment[] = [],
): void {
  blocks.forEach((block, index) => {
    const nextPath = [...path, index] as FreeformBlockPathSegment[];
    if (block.kind === "mappings") {
      const latex = renderBlockAsLatex(block);
      if (latex.length > 0) {
        formulas.set(buildFreeformBlockSelectionId(itemId, nextPath), latex);
      }
      return;
    }
    if (block.kind === "split") {
      collectFreeformBlockFormulaBySelectionId(itemId, block.left, formulas, [...nextPath, "left"]);
      collectFreeformBlockFormulaBySelectionId(itemId, block.right, formulas, [...nextPath, "right"]);
    }
  });
}

export function renderCardAsLatex(
  card: Pick<EquationsPaneCard, "presentation" | "math" | "mappings" | "piecewiseRows" | "blocks" | "body">,
): string {
  const math = resolveEquationsMathExpression(card.math);
  if (math) {
    return math.latex;
  }

  const mappings = Array.isArray(card.mappings) ? card.mappings : [];
  const piecewiseRows = Array.isArray(card.piecewiseRows) ? card.piecewiseRows : [];
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  if (card.presentation === "piecewise" && piecewiseRows.length > 0) {
    const lhs = joinMappingsAsLatex(mappings).trim();
    const rows = piecewiseRows.map((row) => {
      const expression = joinMappingsAsLatex(row.expression).trim();
      const condition = joinMappingsAsLatex(row.condition ?? []).trim();
      return condition.length > 0
        ? `${expression} & ${condition}`
        : expression;
    });
    const piecewiseLatex = String.raw`\begin{cases}${rows.join(String.raw`\\`)}\end{cases}`;
    return lhs.length > 0 ? `${lhs} ${piecewiseLatex}` : piecewiseLatex;
  }

  if (mappings.length > 0) {
    return joinMappingsAsLatex(mappings).trim();
  }

  if (blocks.length > 0) {
    return blocks
      .map((block) => renderBlockAsLatex(block))
      .find((value) => value.length > 0) ?? "";
  }

  return card.body.trim();
}

function MappedSequence({
  itemId,
  mappings,
  variant,
  containerClassName,
  showAllSignalBlocks,
  selectedHitBox,
  onSelect,
  selectionItemId,
  selectionId,
  selectionRoot = true,
}: {
  itemId: string;
  mappings: EquationsMappingEntry[];
  variant: CardVariant;
  containerClassName: string;
  showAllSignalBlocks?: boolean;
  selectedHitBox?: EquationHitBoxClickSignal | null;
  onSelect?: (signal: EquationHitBoxClickSignal | null) => void;
  selectionItemId?: string;
  selectionId?: string;
  selectionRoot?: boolean;
}) {
  const selectedHitBoxId = selectedHitBox?.hitBox.id ?? null;
  const selectedItemId = selectedHitBox?.itemId ?? null;

  return (
    <div
      className={["relative", containerClassName].join(" ")}
      {...(selectionRoot
        ? {
            "data-equations-selection-root": "1",
            "data-equations-item-id": selectionItemId ?? itemId,
            "data-equations-selection-id": selectionId ?? (selectionItemId ?? itemId),
          }
        : {})}
    >
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
            className="align-middle"
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
          <span
            key={`${itemId}-mapping-${index}`}
            role="button"
            tabIndex={0}
            className={[
              "select-text cursor-pointer align-middle rounded-md border px-0.5 py-0.5 text-inherit transition-colors",
              "border-emerald-500/35 bg-emerald-500/[0.035]",
              "focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-emerald-500/60",
              showAllSignalBlocks
                ? "rounded-md border border-emerald-500/80 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.18)] dark:border-emerald-300/90 dark:bg-emerald-300/12 dark:shadow-[0_0_0_1px_rgba(110,231,183,0.24)]"
                : "",
              isSameSelection
                ? "border-emerald-600/80 bg-emerald-500/14 ring-inset ring-1 ring-emerald-600/45 dark:border-emerald-300/95 dark:bg-emerald-300/16 dark:ring-emerald-300/45"
                : isActive
                  ? "border-emerald-500/60 bg-emerald-500/10 ring-inset ring-1 ring-emerald-500/30 dark:border-emerald-300/75 dark:bg-emerald-300/12 dark:ring-emerald-300/30"
                  : "hover:border-emerald-500/55 hover:bg-emerald-500/08 dark:hover:border-emerald-300/65 dark:hover:bg-emerald-300/10",
            ].join(" ")}
            onClick={() => {
              if (typeof window !== "undefined") {
                const activeSelection = window.getSelection();
                if (activeSelection && !activeSelection.isCollapsed) {
                  return;
                }
              }
              onSelect?.(isSameSelection ? null : { itemId, hitBox });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              onSelect?.(isSameSelection ? null : { itemId, hitBox });
            }}
            aria-label={`Select equation mapping ${hitBox.label}`}
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}

export function MappedCardContent({
  itemId,
  mappings,
  variant,
  presentation,
  showAllSignalBlocks,
  selectedHitBox,
  onSelect,
}: {
  itemId: string;
  mappings: EquationsMappingEntry[];
  variant: CardVariant;
  presentation?: EquationsPaneCardPresentation;
  showAllSignalBlocks?: boolean;
  selectedHitBox?: EquationHitBoxClickSignal | null;
  onSelect?: (signal: EquationHitBoxClickSignal | null) => void;
}) {
  const containerClassName = [
    "max-w-full whitespace-pre-wrap break-words",
    variant === "literal"
      ? "font-mono text-[11px] leading-5 text-foreground/78"
      : variant === "equation"
        ? presentation === "piecewise"
          ? "text-left leading-[2.2] text-foreground"
          : "text-center leading-[2.2] text-foreground"
        : "text-[13px] leading-5 text-foreground/82",
  ].join(" ");

  return (
    <MappedSequence
      itemId={itemId}
      mappings={mappings}
      variant={variant}
      containerClassName={containerClassName}
      showAllSignalBlocks={showAllSignalBlocks}
      selectedHitBox={selectedHitBox}
      onSelect={onSelect}
    />
  );
}

export function PiecewiseEquationContent({
  itemId,
  lhsMappings,
  rows,
  showAllSignalBlocks,
  selectedHitBox,
  onSelect,
}: {
  itemId: string;
  lhsMappings: EquationsMappingEntry[];
  rows: EquationsPiecewiseRow[];
  showAllSignalBlocks?: boolean;
  selectedHitBox?: EquationHitBoxClickSignal | null;
  onSelect?: (signal: EquationHitBoxClickSignal | null) => void;
}) {
  const braceMarkup = renderPiecewiseBrace(rows);

  return (
    <div
      className="flex max-w-full items-start gap-4 text-left text-foreground"
      data-equations-selection-root="1"
      data-equations-item-id={itemId}
      data-equations-selection-id={itemId}
    >
      <MappedSequence
        itemId={itemId}
        mappings={lhsMappings}
        variant="equation"
        containerClassName="max-w-full whitespace-pre-wrap break-words pt-3 leading-[2.2]"
        showAllSignalBlocks={showAllSignalBlocks}
        selectedHitBox={selectedHitBox}
        onSelect={onSelect}
        selectionRoot={false}
      />
      <div className="flex items-stretch gap-3">
        <div
          className="select-none pt-1 text-foreground/60"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: braceMarkup }}
        >
        </div>
        <div className="grid min-w-0 grid-cols-[max-content_max-content] items-start gap-x-6 gap-y-3 pt-2">
          {rows.map((row, index) => (
            <div key={`${itemId}-piecewise-row-${index}`} className="contents">
              <MappedSequence
                itemId={itemId}
                mappings={row.expression}
                variant="equation"
                containerClassName="max-w-full whitespace-pre-wrap break-words leading-[2.2] text-left text-foreground"
                showAllSignalBlocks={showAllSignalBlocks}
                selectedHitBox={selectedHitBox}
                onSelect={onSelect}
                selectionRoot={false}
              />
              <MappedSequence
                itemId={itemId}
                mappings={row.condition ?? []}
                variant="equation"
                containerClassName="max-w-full whitespace-pre-wrap break-words pt-1 leading-[2.2] text-left text-foreground/82"
                showAllSignalBlocks={showAllSignalBlocks}
                selectedHitBox={selectedHitBox}
                onSelect={onSelect}
                selectionRoot={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FreeformCardContent({
  itemId,
  blocks,
  showAllSignalBlocks,
  selectedHitBox,
  onSelect,
  onVisualizationLinkSelect,
}: {
  itemId: string;
  blocks: EquationsPaneCardBlock[];
  showAllSignalBlocks?: boolean;
  selectedHitBox?: EquationHitBoxClickSignal | null;
  onSelect?: (signal: EquationHitBoxClickSignal | null) => void;
  onVisualizationLinkSelect?: (frame: VisualizationFrameState) => void;
}) {
  const renderBlockStack = (
    entries: EquationsPaneCardBlock[],
    path: FreeformBlockPathSegment[],
  ): ReactNode => (
    <div className="flex max-w-full flex-col gap-4 text-left">
      {entries.map((block, index) => {
        const nextPath = [...path, index] as FreeformBlockPathSegment[];
        if (block.kind === "text") {
          const selectionId = buildFreeformBlockSelectionId(itemId, nextPath);
          const visualizationFrame = block.visualizationFrame;
          const { leadingText, trailingText } = visualizationFrame
            ? splitTrailingInlineSegment(block.value)
            : { leadingText: block.value, trailingText: "" };
          return (
            <div
              key={`${itemId}-${nextPath.join("-")}-text`}
              className="whitespace-pre-wrap text-[13px] leading-6 text-foreground/82"
              data-equations-selection-root="1"
              data-equations-item-id={itemId}
              data-equations-selection-id={selectionId}
            >
              {visualizationFrame && trailingText ? (
                <>
                  <span>{leadingText}</span>
                  <span className="inline-flex items-baseline whitespace-nowrap">
                    {trailingText}
                    <InlineVisualizationLauncher
                      label={block.visualizationLabel}
                      onClick={() => {
                        onVisualizationLinkSelect?.(visualizationFrame);
                      }}
                    />
                  </span>
                </>
              ) : (
                <span>{block.value}</span>
              )}
              {visualizationFrame ? (
                !trailingText ? (
                  <InlineVisualizationLauncher
                    label={block.visualizationLabel}
                    onClick={() => {
                      onVisualizationLinkSelect?.(visualizationFrame);
                    }}
                  />
                ) : null
              ) : null}
            </div>
          );
        }

        if (block.kind === "math") {
          const selectionId = buildFreeformBlockSelectionId(itemId, nextPath);
          const markup = katex.renderToString(block.latex, {
            displayMode: block.displayMode ?? true,
            output: "htmlAndMathml",
            throwOnError: false,
            trust: false,
          });
          const mathContent = (
            <div
              className="relative flow-root max-w-full overflow-visible py-1 text-foreground"
              data-equations-selection-root="1"
              data-equations-item-id={itemId}
              data-equations-selection-id={selectionId}
              dangerouslySetInnerHTML={{ __html: markup }}
            />
          );

          if (isMultiLineDisplayMath(block.latex, block.displayMode)) {
            return (
              <div key={`${itemId}-${nextPath.join("-")}-math`} className="max-w-full text-foreground">
                {mathContent}
              </div>
            );
          }

          return (
            <FitToWidthContent
              key={`${itemId}-${nextPath.join("-")}-math`}
              className="text-foreground"
              contentClassName="py-1"
            >
              {mathContent}
            </FitToWidthContent>
          );
        }

        if (block.kind === "split") {
          const leftSelectionId = buildFreeformBlockSelectionId(itemId, [...nextPath, "left"]);
          const rightSelectionId = buildFreeformBlockSelectionId(itemId, [...nextPath, "right"]);
          const leftScopeId = buildFreeformBlockScopeId(itemId, [...nextPath, "left"]);
          const rightScopeId = buildFreeformBlockScopeId(itemId, [...nextPath, "right"]);
          const fractions = block.fractions ?? [1, 1];
          return (
            <div
              key={`${itemId}-${nextPath.join("-")}-split`}
              className="grid items-start gap-5 md:gap-6"
              style={{
                gridTemplateColumns: `minmax(0, ${fractions[0]}fr) minmax(0, ${fractions[1]}fr)`,
              }}
            >
              <div
                className="min-w-0"
                data-equations-item-id={itemId}
                data-equations-selection-id={leftSelectionId}
                {...(leftScopeId ? { "data-equations-selection-scope-id": leftScopeId } : {})}
              >
                {renderBlockStack(block.left, [...nextPath, "left"])}
              </div>
              <div
                className="min-w-0"
                data-equations-item-id={itemId}
                data-equations-selection-id={rightSelectionId}
                {...(rightScopeId ? { "data-equations-selection-scope-id": rightScopeId } : {})}
              >
                {renderBlockStack(block.right, [...nextPath, "right"])}
              </div>
            </div>
          );
        }

        const blockSelectionItemId = buildFreeformBlockSelectionId(itemId, nextPath);
        const formulaLike = block.mappings.some((entry) => entry.kind === "latex");
        return (
          <MappedSequence
            key={`${itemId}-${nextPath.join("-")}-mappings`}
            itemId={blockSelectionItemId}
            mappings={block.mappings}
            variant={formulaLike ? "equation" : "meaning"}
            containerClassName={[
              "max-w-full whitespace-pre-wrap break-words",
              formulaLike
                ? "overflow-x-auto text-left leading-[2.1] text-foreground"
                : "text-[13px] leading-6 text-foreground/82",
            ].join(" ")}
            showAllSignalBlocks={showAllSignalBlocks}
            selectedHitBox={selectedHitBox}
            onSelect={onSelect}
            selectionItemId={itemId}
            selectionId={blockSelectionItemId}
          />
        );
      })}
    </div>
  );

  return (
    <div className="max-w-full">
      {renderBlockStack(blocks, [])}
    </div>
  );
}
