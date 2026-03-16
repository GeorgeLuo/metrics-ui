import type {
  CellLayout,
  ContainerSize,
  FrameGridItemPlacement,
  FrameGridLayout,
  FrameGridSpec,
  Rect,
} from "./frame-grid.types";

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`Expected integer for ${label}: ${value}`);
  }
}

function fitFrame(
  frameAspect: [number, number],
  container: ContainerSize,
  fitMode: "contain" | "cover",
): Rect {
  const [aspectW, aspectH] = frameAspect;
  const targetAspect = aspectW / aspectH;
  const containerAspect = container.width / container.height;

  let width = container.width;
  let height = container.height;

  if (fitMode === "contain") {
    if (containerAspect > targetAspect) {
      height = container.height;
      width = height * targetAspect;
    } else {
      width = container.width;
      height = width / targetAspect;
    }
  } else if (containerAspect > targetAspect) {
    width = container.width;
    height = width / targetAspect;
  } else {
    height = container.height;
    width = height * targetAspect;
  }

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

export function computeFrameGridLayout(
  spec: FrameGridSpec,
  container: ContainerSize,
): FrameGridLayout {
  assertPositive(container.width, "container width");
  assertPositive(container.height, "container height");

  const [aspectW, aspectH] = spec.frameAspect;
  const [frameBorderDivX, frameBorderDivY] = spec.frameBorderDiv;
  const [gridCols, gridRows] = spec.grid;
  const [cellBorderDivX, cellBorderDivY] = spec.cellBorderDiv;

  assertPositive(aspectW, "frame aspect width");
  assertPositive(aspectH, "frame aspect height");
  assertNonNegative(frameBorderDivX, "frame border divisor x");
  assertNonNegative(frameBorderDivY, "frame border divisor y");
  assertPositive(gridCols, "grid columns");
  assertPositive(gridRows, "grid rows");
  assertNonNegative(cellBorderDivX, "cell border divisor x");
  assertNonNegative(cellBorderDivY, "cell border divisor y");
  assertInteger(gridCols, "grid columns");
  assertInteger(gridRows, "grid rows");

  const frame = fitFrame(spec.frameAspect, container, spec.fitMode);
  const frameBorderX = frameBorderDivX === 0 ? 0 : frame.width / frameBorderDivX;
  const frameBorderY = frameBorderDivY === 0 ? 0 : frame.height / frameBorderDivY;

  const content = {
    x: frame.x + frameBorderX,
    y: frame.y + frameBorderY,
    width: frame.width - 2 * frameBorderX,
    height: frame.height - 2 * frameBorderY,
  };

  assertPositive(content.width, "content width");
  assertPositive(content.height, "content height");

  const cellWidth = content.width / gridCols;
  const cellHeight = content.height / gridRows;
  const cellBorderX = cellBorderDivX === 0 ? 0 : cellWidth / cellBorderDivX;
  const cellBorderY = cellBorderDivY === 0 ? 0 : cellHeight / cellBorderDivY;

  const cells: CellLayout[] = [];
  for (let row = 0; row < gridRows; row += 1) {
    for (let col = 0; col < gridCols; col += 1) {
      const index = row * gridCols + col;
      cells.push({
        index,
        row,
        col,
        rect: {
          x: content.x + col * cellWidth,
          y: content.y + row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        },
        borderX: cellBorderX,
        borderY: cellBorderY,
      });
    }
  }

  return {
    frame,
    content,
    frameBorderX,
    frameBorderY,
    cellWidth,
    cellHeight,
    cellBorderX,
    cellBorderY,
    cells,
  };
}

export function resolveItemRect(layout: FrameGridLayout, placement: FrameGridItemPlacement): Rect {
  return {
    x: layout.content.x + placement.col * layout.cellWidth,
    y: layout.content.y + placement.row * layout.cellHeight,
    width: layout.cellWidth * placement.colSpan,
    height: layout.cellHeight * placement.rowSpan,
  };
}
