import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  computeFrameGridLayout,
  resolveItemRect,
} from "@/components/frame-grid/compute-frame-grid-layout";
import type {
  ContainerSize,
  FrameGridDebugSnapshot,
  FrameGridItemPlacement,
  FrameGridItemProps,
  FrameGridProps,
  FrameGridResolvedItem,
} from "@/components/frame-grid/frame-grid.types";

function warnDev(message: string): void {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[FrameGrid] ${message}`);
  }
}

function computeInset(size: number, divisor: number): number {
  return divisor === 0 ? 0 : size / divisor;
}

function formatDebugNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) >= 100 || Number.isInteger(value)) {
    return value.toFixed(0);
  }
  return value.toFixed(2).replace(/\.?0+$/, "");
}

type ParsedItem = {
  key: string;
  placement: FrameGridItemPlacement;
  children: ReactNode;
};

type FrameGridItemType = {
  __frameGridItem?: true;
  displayName?: string;
};

function isFrameGridItemElement(
  child: ReactNode,
): child is ReactElement<FrameGridItemProps> {
  if (!isValidElement<FrameGridItemProps>(child)) {
    return false;
  }
  const type = child.type as FrameGridItemType | string;
  if (!type || typeof type === "string") {
    return false;
  }
  return type.__frameGridItem === true || type.displayName === "FrameGrid.Item";
}

function parseItems(children: ReactNode): ParsedItem[] {
  return Children.toArray(children)
    .filter(isFrameGridItemElement)
    .map((child, index) => ({
      key: child.key ? String(child.key) : `frame-grid-item-${index}`,
      placement: {
        col: child.props.col,
        row: child.props.row,
        colSpan: child.props.colSpan ?? 1,
        rowSpan: child.props.rowSpan ?? 1,
      },
      children: child.props.children,
    }));
}

function validatePlacement(
  placement: FrameGridItemPlacement,
  gridCols: number,
  gridRows: number,
): string | null {
  const { col, row, colSpan, rowSpan } = placement;
  if (!Number.isInteger(col) || col < 0) {
    return `invalid col: ${col}`;
  }
  if (!Number.isInteger(row) || row < 0) {
    return `invalid row: ${row}`;
  }
  if (!Number.isInteger(colSpan) || colSpan < 1) {
    return `invalid colSpan: ${colSpan}`;
  }
  if (!Number.isInteger(rowSpan) || rowSpan < 1) {
    return `invalid rowSpan: ${rowSpan}`;
  }
  if (col + colSpan > gridCols) {
    return `item exceeds grid columns (${col} + ${colSpan} > ${gridCols})`;
  }
  if (row + rowSpan > gridRows) {
    return `item exceeds grid rows (${row} + ${rowSpan} > ${gridRows})`;
  }
  return null;
}

function useContainerSize(containerRef: React.RefObject<HTMLDivElement>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [containerRef]);

  return size;
}

export function FrameGridItem(_props: FrameGridItemProps) {
  return null;
}

FrameGridItem.__frameGridItem = true;
FrameGridItem.displayName = "FrameGrid.Item";

function FrameGridRoot({
  spec,
  className,
  style,
  children,
  debugId,
  layoutDebug = false,
  showOuterFrame = true,
  showContentFrame = true,
  showCellGrid = false,
  onDebug,
  renderItem,
}: FrameGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const container = useContainerSize(containerRef);
  const effectiveShowOuterFrame = layoutDebug || showOuterFrame;
  const effectiveShowContentFrame = layoutDebug || showContentFrame;
  const effectiveShowCellGrid = layoutDebug || showCellGrid;

  const parsedItems = useMemo(() => parseItems(children), [children]);

  const computed = useMemo(() => {
    if (container.width <= 0 || container.height <= 0) {
      return null;
    }

    try {
      const layout = computeFrameGridLayout(spec, container);
      const [gridCols, gridRows] = spec.grid;
      const occupancy: boolean[][] = Array.from({ length: gridRows }, () =>
        Array.from({ length: gridCols }, () => false),
      );

      const resolved: Array<ParsedItem & { rect: FrameGridResolvedItem["rect"] }> = [];

      for (const item of parsedItems) {
        const error = validatePlacement(item.placement, gridCols, gridRows);
        if (error) {
          warnDev(`Skipping item "${item.key}" (${error})`);
          continue;
        }

        let overlaps = false;
        for (
          let row = item.placement.row;
          row < item.placement.row + item.placement.rowSpan;
          row += 1
        ) {
          for (
            let col = item.placement.col;
            col < item.placement.col + item.placement.colSpan;
            col += 1
          ) {
            if (occupancy[row][col]) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) {
            break;
          }
        }

        if (overlaps) {
          warnDev(`Skipping item "${item.key}" due to overlap`);
          continue;
        }

        for (
          let row = item.placement.row;
          row < item.placement.row + item.placement.rowSpan;
          row += 1
        ) {
          for (
            let col = item.placement.col;
            col < item.placement.col + item.placement.colSpan;
            col += 1
          ) {
            occupancy[row][col] = true;
          }
        }

        resolved.push({
          ...item,
          rect: resolveItemRect(layout, item.placement),
        });
      }

      return { layout, resolved };
    } catch (error) {
      warnDev(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [container, parsedItems, spec]);

  const debugSnapshot = useMemo<FrameGridDebugSnapshot>(() => {
    const expectedCellCount = spec.grid[0] * spec.grid[1];
    const renderedCellCount = effectiveShowCellGrid && computed ? computed.layout.cells.length : 0;

    if (!computed) {
      return {
        debugId,
        spec,
        container,
        showOuterFrame: effectiveShowOuterFrame,
        showContentFrame: effectiveShowContentFrame,
        showCellGrid: effectiveShowCellGrid,
        expectedCellCount,
        renderedCellCount,
        layout: null,
        checks: {
          frameBorderXDelta: null,
          frameBorderYDelta: null,
          contentWidthDelta: null,
          contentHeightDelta: null,
          cellWidthDelta: null,
          cellHeightDelta: null,
          cellBorderXDelta: null,
          cellBorderYDelta: null,
          centerDeltaX: null,
          centerDeltaY: null,
          containFitsContainer: null,
        },
        generatedAt: new Date().toISOString(),
      };
    }

    const { layout } = computed;
    const [frameBorderDivX, frameBorderDivY] = spec.frameBorderDiv;
    const [gridCols, gridRows] = spec.grid;
    const [cellBorderDivX, cellBorderDivY] = spec.cellBorderDiv;

    const expectedFrameBorderX = computeInset(layout.frame.width, frameBorderDivX);
    const expectedFrameBorderY = computeInset(layout.frame.height, frameBorderDivY);
    const expectedContentWidth = layout.frame.width - 2 * layout.frameBorderX;
    const expectedContentHeight = layout.frame.height - 2 * layout.frameBorderY;
    const expectedCellWidth = layout.content.width / gridCols;
    const expectedCellHeight = layout.content.height / gridRows;
    const expectedCellBorderX = computeInset(layout.cellWidth, cellBorderDivX);
    const expectedCellBorderY = computeInset(layout.cellHeight, cellBorderDivY);
    const frameCenterX = layout.frame.x + layout.frame.width / 2;
    const frameCenterY = layout.frame.y + layout.frame.height / 2;
    const containerCenterX = container.width / 2;
    const containerCenterY = container.height / 2;

    const containFitsContainer =
      spec.fitMode === "contain"
        ? layout.frame.width <= container.width + 1e-6
          && layout.frame.height <= container.height + 1e-6
        : null;

      return {
        debugId,
        spec,
        container,
        showOuterFrame: effectiveShowOuterFrame,
        showContentFrame: effectiveShowContentFrame,
        showCellGrid: effectiveShowCellGrid,
        expectedCellCount,
        renderedCellCount,
        layout: {
          frame: layout.frame,
          content: layout.content,
          frameBorderX: layout.frameBorderX,
          frameBorderY: layout.frameBorderY,
          cellWidth: layout.cellWidth,
          cellHeight: layout.cellHeight,
          cellBorderX: layout.cellBorderX,
          cellBorderY: layout.cellBorderY,
          cellCount: layout.cells.length,
        },
        checks: {
          frameBorderXDelta: layout.frameBorderX - expectedFrameBorderX,
          frameBorderYDelta: layout.frameBorderY - expectedFrameBorderY,
          contentWidthDelta: layout.content.width - expectedContentWidth,
          contentHeightDelta: layout.content.height - expectedContentHeight,
          cellWidthDelta: layout.cellWidth - expectedCellWidth,
          cellHeightDelta: layout.cellHeight - expectedCellHeight,
          cellBorderXDelta: layout.cellBorderX - expectedCellBorderX,
          cellBorderYDelta: layout.cellBorderY - expectedCellBorderY,
          centerDeltaX: frameCenterX - containerCenterX,
          centerDeltaY: frameCenterY - containerCenterY,
          containFitsContainer,
        },
        generatedAt: new Date().toISOString(),
    };
  }, [
    computed,
    container,
    debugId,
    effectiveShowOuterFrame,
    effectiveShowContentFrame,
    effectiveShowCellGrid,
    spec,
  ]);

  useEffect(() => {
    onDebug?.(debugSnapshot);
  }, [debugSnapshot, onDebug]);

  const rootClassName = className ? `relative h-full w-full overflow-hidden ${className}` : "relative h-full w-full overflow-hidden";

  return (
    <div ref={containerRef} className={rootClassName} style={style}>
      {computed ? (
        <>
          {effectiveShowOuterFrame ? (
            <div
              className={`pointer-events-none absolute rounded-sm ${
                layoutDebug ? "z-10 border border-amber-500/90" : "border border-border/70"
              }`}
              style={{
                left: computed.layout.frame.x,
                top: computed.layout.frame.y,
                width: computed.layout.frame.width,
                height: computed.layout.frame.height,
              }}
            />
          ) : null}
          {effectiveShowContentFrame ? (
            <div
              className={`pointer-events-none absolute rounded-[2px] ${
                layoutDebug ? "z-10 border border-emerald-500/85" : "border border-border/35"
              }`}
              style={{
                left: computed.layout.content.x,
                top: computed.layout.content.y,
                width: computed.layout.content.width,
                height: computed.layout.content.height,
              }}
            />
          ) : null}
          {computed.resolved.map((item) => {
            const resolvedItem: FrameGridResolvedItem = {
              placement: item.placement,
              rect: item.rect,
            };
            return (
              <div
                key={item.key}
                className="absolute z-[1] overflow-hidden flex items-center justify-center text-foreground"
                style={{
                  left: item.rect.x,
                  top: item.rect.y,
                  width: item.rect.width,
                  height: item.rect.height,
                }}
              >
                {renderItem ? renderItem(resolvedItem) : item.children}
              </div>
            );
          })}
          {effectiveShowCellGrid
            ? computed.layout.cells.map((cell) => (
                <Fragment key={cell.index}>
                  {layoutDebug ? (
                    <div
                      className="pointer-events-none absolute z-10 rounded-[2px] border border-sky-500/35 border-dashed"
                      style={{
                        left: cell.rect.x,
                        top: cell.rect.y,
                        width: cell.rect.width,
                        height: cell.rect.height,
                      }}
                    />
                  ) : null}
                  <div
                    className={`pointer-events-none absolute rounded-[2px] ${
                      layoutDebug ? "z-10 border border-sky-500/70" : "border border-border/30"
                    }`}
                    style={{
                      left: cell.rect.x + cell.borderX,
                      top: cell.rect.y + cell.borderY,
                      width: Math.max(0, cell.rect.width - 2 * cell.borderX),
                      height: Math.max(0, cell.rect.height - 2 * cell.borderY),
                    }}
                  />
                </Fragment>
              ))
            : null}
          {layoutDebug ? (
            <div className="pointer-events-none absolute right-2 bottom-2 z-20 rounded-sm border border-border/80 bg-background/92 px-2 py-1 font-mono text-[10px] leading-4 text-foreground shadow-sm backdrop-blur-sm">
              <div>{`container ${formatDebugNumber(container.width)} x ${formatDebugNumber(container.height)}`}</div>
              <div>{`frame ${formatDebugNumber(computed.layout.frame.width)} x ${formatDebugNumber(computed.layout.frame.height)} @ ${formatDebugNumber(computed.layout.frame.x)},${formatDebugNumber(computed.layout.frame.y)}`}</div>
              <div>{`content ${formatDebugNumber(computed.layout.content.width)} x ${formatDebugNumber(computed.layout.content.height)} @ ${formatDebugNumber(computed.layout.content.x)},${formatDebugNumber(computed.layout.content.y)}`}</div>
              <div>{`grid ${spec.grid[0]} x ${spec.grid[1]}`}</div>
              <div>{`frameBorderX ${formatDebugNumber(computed.layout.frameBorderX)}`}</div>
              <div>{`frameBorderY ${formatDebugNumber(computed.layout.frameBorderY)}`}</div>
              <div>{`cellWidth ${formatDebugNumber(computed.layout.cellWidth)}`}</div>
              <div>{`cellHeight ${formatDebugNumber(computed.layout.cellHeight)}`}</div>
              <div>{`cellBorderX ${formatDebugNumber(computed.layout.cellBorderX)}`}</div>
              <div>{`cellBorderY ${formatDebugNumber(computed.layout.cellBorderY)}`}</div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type FrameGridComponent = ((props: FrameGridProps) => ReactElement) & {
  Item: typeof FrameGridItem;
};

export const FrameGrid = Object.assign(FrameGridRoot, {
  Item: FrameGridItem,
}) as FrameGridComponent;

export { computeFrameGridLayout, resolveItemRect };
export type {
  CellLayout,
  ContainerSize,
  FrameGridDebugChecks,
  FrameGridDebugSnapshot,
  FitMode,
  FrameGridItemPlacement,
  FrameGridItemProps,
  FrameGridLayout,
  FrameGridProps,
  FrameGridResolvedItem,
  FrameGridSpec,
  Rect,
} from "@/components/frame-grid/frame-grid.types";

export default FrameGrid;
