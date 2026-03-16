import type { CSSProperties, ReactNode } from "react";

export type FitMode = "contain" | "cover";

export type FrameGridSpec = {
  frameAspect: [number, number];
  frameBorderDiv: [number, number];
  grid: [number, number];
  cellBorderDiv: [number, number];
  fitMode: FitMode;
};

export type FrameGridProps = {
  spec: FrameGridSpec;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  debugId?: string;
  layoutDebug?: boolean;
  showOuterFrame?: boolean;
  showContentFrame?: boolean;
  showCellGrid?: boolean;
  onDebug?: (debug: FrameGridDebugSnapshot) => void;
  renderItem?: (item: FrameGridResolvedItem) => ReactNode;
};

export type FrameGridItemProps = {
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  children: ReactNode;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CellLayout = {
  index: number;
  row: number;
  col: number;
  rect: Rect;
  borderX: number;
  borderY: number;
};

export type FrameGridLayout = {
  frame: Rect;
  content: Rect;
  frameBorderX: number;
  frameBorderY: number;
  cellWidth: number;
  cellHeight: number;
  cellBorderX: number;
  cellBorderY: number;
  cells: CellLayout[];
};

export type FrameGridItemPlacement = {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type FrameGridResolvedItem = {
  placement: FrameGridItemPlacement;
  rect: Rect;
};

export type ContainerSize = {
  width: number;
  height: number;
};

export type FrameGridDebugChecks = {
  frameBorderXDelta: number | null;
  frameBorderYDelta: number | null;
  contentWidthDelta: number | null;
  contentHeightDelta: number | null;
  cellWidthDelta: number | null;
  cellHeightDelta: number | null;
  cellBorderXDelta: number | null;
  cellBorderYDelta: number | null;
  centerDeltaX: number | null;
  centerDeltaY: number | null;
  containFitsContainer: boolean | null;
};

export type FrameGridDebugSnapshot = {
  debugId?: string;
  spec: FrameGridSpec;
  container: ContainerSize;
  showOuterFrame: boolean;
  showContentFrame: boolean;
  showCellGrid: boolean;
  expectedCellCount: number;
  renderedCellCount: number;
  layout: {
    frame: Rect;
    content: Rect;
    frameBorderX: number;
    frameBorderY: number;
    cellWidth: number;
    cellHeight: number;
    cellBorderX: number;
    cellBorderY: number;
    cellCount: number;
  } | null;
  checks: FrameGridDebugChecks;
  generatedAt: string;
};
