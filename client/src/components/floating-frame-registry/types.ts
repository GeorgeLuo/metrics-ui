export type FloatingFrameRegistryFrameSize = {
  width: number;
  height: number;
};

export type FloatingFrameRegistryFramePosition = {
  x: number;
  y: number;
};

export type FloatingFrameRegistryFrameOptions = {
  id: string;
  title: string;
  bounds?: "subapp" | "viewport";
  defaultPosition?: FloatingFrameRegistryFramePosition;
  defaultSize?: FloatingFrameRegistryFrameSize;
  minSize?: FloatingFrameRegistryFrameSize;
  minimizable?: boolean;
  resizable?: boolean;
  popoutable?: boolean;
  closeable?: boolean;
  onClose?: () => void;
};

export type FloatingFrameRegistryFrameHandle = {
  mount: HTMLDivElement;
  close: () => void;
  setTitle: (title: string) => void;
};

export type FloatingFrameRegistryFrameRecord = FloatingFrameRegistryFrameOptions & {
  mount: HTMLDivElement;
};
