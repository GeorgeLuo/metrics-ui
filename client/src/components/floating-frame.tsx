import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ExternalLink, GripVertical, Minimize2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { buildPopoutWindowFeatures } from "@/lib/popout-window";
import { readStorageJson, writeStorageJson } from "@/lib/dashboard/storage";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type FloatingFramePositionMode = "viewport" | "container";
type FloatingFrameStoredState = {
  position: Point;
  minimized: boolean;
  size?: Size;
};
type FloatingFrameResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";
type FloatingFrameBounds = {
  leftMin: number;
  topMin: number;
  rightMax: number;
  bottomMax: number;
};

export interface FloatingFrameProps {
  title: string;
  children?: ReactNode;
  isVisible?: boolean;
  defaultPosition?: Point;
  defaultSize?: Size;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  dragHandleClassName?: string;
  controlButtonClassName?: string;
  headerRight?: ReactNode;
  dataTestId?: string;
  minimizable?: boolean;
  closeable?: boolean;
  defaultMinimized?: boolean;
  popoutable?: boolean;
  popoutWindowName?: string;
  popoutWindowTitle?: string;
  contentFill?: boolean;
  onPopoutChange?: (isPoppedOut: boolean) => void;
  dockRequestToken?: number;
  positionMode?: FloatingFramePositionMode;
  containerRef?: RefObject<HTMLElement | null>;
  contentMinHeight?: number;
  dragHint?: string;
  stateStorageKey?: string;
  resizable?: boolean;
  minSize?: Size;
  resizeHint?: string;
  onClose?: () => void;
  closeHint?: string;
}

const DEFAULT_POSITION: Point = { x: 24, y: 72 };
const DEFAULT_RESIZE_MIN_SIZE: Size = { width: 260, height: 160 };
const VIEWPORT_PADDING = 8;

function isPoint(value: unknown): value is Point {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as Point).x === "number"
    && Number.isFinite((value as Point).x)
    && typeof (value as Point).y === "number"
    && Number.isFinite((value as Point).y),
  );
}

function isSize(value: unknown): value is Size {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as Size).width === "number"
    && Number.isFinite((value as Size).width)
    && typeof (value as Size).height === "number"
    && Number.isFinite((value as Size).height),
  );
}

function readFloatingFrameStoredState(storageKey: string | undefined): FloatingFrameStoredState | null {
  if (!storageKey) {
    return null;
  }
  const raw = readStorageJson<unknown>(storageKey);
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<FloatingFrameStoredState>;
  if (!isPoint(candidate.position) || typeof candidate.minimized !== "boolean") {
    return null;
  }
  return {
    position: candidate.position,
    minimized: candidate.minimized,
    ...(isSize(candidate.size) ? { size: candidate.size } : {}),
  };
}

function resolveContainerNode(
  containerRef: RefObject<HTMLElement | null> | undefined,
  frame: HTMLDivElement | null,
): HTMLElement | null {
  if (containerRef?.current instanceof HTMLElement) {
    return containerRef.current;
  }
  if (frame?.offsetParent instanceof HTMLElement) {
    return frame.offsetParent;
  }
  return null;
}

function getFloatingFrameBounds(
  positionMode: FloatingFramePositionMode,
  containerRef?: RefObject<HTMLElement | null>,
  frame?: HTMLDivElement | null,
): FloatingFrameBounds | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (positionMode === "container") {
    const container = resolveContainerNode(containerRef, frame ?? null);
    if (!container) {
      return null;
    }
    return {
      leftMin: 0,
      topMin: 0,
      rightMax: container.clientWidth,
      bottomMax: container.clientHeight,
    };
  }
  return {
    leftMin: VIEWPORT_PADDING,
    topMin: VIEWPORT_PADDING,
    rightMax: window.innerWidth - VIEWPORT_PADDING,
    bottomMax: window.innerHeight - VIEWPORT_PADDING,
  };
}

function clampPosition(
  frame: HTMLDivElement | null,
  position: Point,
  positionMode: FloatingFramePositionMode,
  containerRef?: RefObject<HTMLElement | null>,
): Point {
  if (typeof window === "undefined") {
    return position;
  }
  const width = frame?.offsetWidth ?? 300;
  const height = frame?.offsetHeight ?? 140;
  if (positionMode === "container") {
    const container = resolveContainerNode(containerRef, frame);
    if (!container) {
      return position;
    }
    const maxX = Math.max(0, container.clientWidth - width);
    const maxY = Math.max(0, container.clientHeight - height);
    return {
      x: Math.min(Math.max(0, position.x), maxX),
      y: Math.min(Math.max(0, position.y), maxY),
    };
  }
  const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
  const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
  return {
    x: Math.min(Math.max(VIEWPORT_PADDING, position.x), maxX),
    y: Math.min(Math.max(VIEWPORT_PADDING, position.y), maxY),
  };
}

function clampFloatingFrameRect(
  rect: { position: Point; size: Size },
  minSize: Size,
  positionMode: FloatingFramePositionMode,
  containerRef?: RefObject<HTMLElement | null>,
  frame?: HTMLDivElement | null,
): { position: Point; size: Size } {
  const bounds = getFloatingFrameBounds(positionMode, containerRef, frame);
  if (!bounds) {
    return rect;
  }

  const maxWidth = Math.max(minSize.width, bounds.rightMax - bounds.leftMin);
  const maxHeight = Math.max(minSize.height, bounds.bottomMax - bounds.topMin);
  const width = Math.min(Math.max(minSize.width, rect.size.width), maxWidth);
  const height = Math.min(Math.max(minSize.height, rect.size.height), maxHeight);
  const x = Math.min(Math.max(bounds.leftMin, rect.position.x), bounds.rightMax - width);
  const y = Math.min(Math.max(bounds.topMin, rect.position.y), bounds.bottomMax - height);

  return {
    position: { x, y },
    size: { width, height },
  };
}

function resolveResizeRect(
  direction: FloatingFrameResizeDirection,
  startPosition: Point,
  startSize: Size,
  pointerDelta: Point,
  minSize: Size,
  bounds: FloatingFrameBounds,
): { position: Point; size: Size } {
  const startLeft = startPosition.x;
  const startTop = startPosition.y;
  const startRight = startPosition.x + startSize.width;
  const startBottom = startPosition.y + startSize.height;

  let nextLeft = startLeft;
  let nextRight = startRight;
  let nextTop = startTop;
  let nextBottom = startBottom;

  if (direction.includes("e")) {
    nextRight = Math.min(
      bounds.rightMax,
      Math.max(startLeft + minSize.width, startRight + pointerDelta.x),
    );
  }
  if (direction.includes("w")) {
    nextLeft = Math.max(
      bounds.leftMin,
      Math.min(startRight - minSize.width, startLeft + pointerDelta.x),
    );
  }
  if (direction.includes("s")) {
    nextBottom = Math.min(
      bounds.bottomMax,
      Math.max(startTop + minSize.height, startBottom + pointerDelta.y),
    );
  }
  if (direction.includes("n")) {
    nextTop = Math.max(
      bounds.topMin,
      Math.min(startBottom - minSize.height, startTop + pointerDelta.y),
    );
  }

  return {
    position: { x: nextLeft, y: nextTop },
    size: {
      width: nextRight - nextLeft,
      height: nextBottom - nextTop,
    },
  };
}

export function FloatingFrame({
  title,
  children,
  isVisible = true,
  defaultPosition = DEFAULT_POSITION,
  defaultSize,
  className,
  contentClassName,
  headerClassName,
  titleClassName,
  dragHandleClassName,
  controlButtonClassName,
  headerRight,
  dataTestId = "floating-frame",
  minimizable = true,
  closeable = false,
  defaultMinimized = false,
  popoutable = false,
  popoutWindowName = "metrics-ui-floating-frame",
  popoutWindowTitle,
  contentFill = false,
  onPopoutChange,
  dockRequestToken,
  positionMode = "viewport",
  containerRef,
  contentMinHeight = 140,
  dragHint = "Drag this frame anywhere on the page.",
  stateStorageKey,
  resizable = false,
  minSize,
  resizeHint = "Drag the frame edge to resize.",
  onClose,
  closeHint = "Close this floating frame.",
}: FloatingFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const popoutWindowRef = useRef<Window | null>(null);
  const popoutContainerRef = useRef<HTMLDivElement | null>(null);
  const sizeStateEnabled = resizable || isSize(defaultSize);
  const resolvedMinSize = {
    width: minSize?.width ?? DEFAULT_RESIZE_MIN_SIZE.width,
    height: minSize?.height ?? Math.max(DEFAULT_RESIZE_MIN_SIZE.height, contentMinHeight + 36),
  };
  const [position, setPosition] = useState<Point>(() =>
    readFloatingFrameStoredState(stateStorageKey)?.position ?? defaultPosition,
  );
  const [size, setSize] = useState<Size | null>(() =>
    sizeStateEnabled
      ? readFloatingFrameStoredState(stateStorageKey)?.size ?? defaultSize ?? null
      : null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(() =>
    readFloatingFrameStoredState(stateStorageKey)?.minimized ?? defaultMinimized,
  );
  const [isPoppedOut, setIsPoppedOut] = useState(false);
  const lastDockRequestTokenRef = useRef<number | undefined>(dockRequestToken);

  const syncPopoutDocumentStyles = useCallback(() => {
    const popup = popoutWindowRef.current;
    if (!popup || popup.closed) {
      return;
    }
    popup.document.title = popoutWindowTitle ?? title;
    popup.document.documentElement.className = document.documentElement.className;
    popup.document.body.className = document.body.className;
    popup.document.body.style.margin = "0";
    popup.document.body.style.width = "100vw";
    popup.document.body.style.height = "100vh";
    popup.document.body.style.overflow = "hidden";

    const existingNodes = popup.document.querySelectorAll("[data-floating-frame-style='1']");
    existingNodes.forEach((node) => node.remove());
    const styleNodes = document.head.querySelectorAll("style, link[rel='stylesheet']");
    styleNodes.forEach((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.setAttribute("data-floating-frame-style", "1");
      popup.document.head.appendChild(clone);
    });
  }, [popoutWindowTitle, title]);

  const clearPopoutState = useCallback(() => {
    popoutContainerRef.current = null;
    popoutWindowRef.current = null;
    setIsPoppedOut(false);
    setIsMinimized(false);
    onPopoutChange?.(false);
  }, [onPopoutChange]);

  const closePopout = useCallback(() => {
    const popup = popoutWindowRef.current;
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // ignore close errors
      }
    }
    clearPopoutState();
  }, [clearPopoutState]);

  const openPopout = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const existing = popoutWindowRef.current;
    if (existing && !existing.closed && popoutContainerRef.current) {
      try {
        existing.focus();
      } catch {
        // ignore focus errors
      }
      setIsMinimized(false);
      setIsPoppedOut(true);
      onPopoutChange?.(true);
      return;
    }

    const popup = window.open(
      "",
      popoutWindowName,
      buildPopoutWindowFeatures(),
    );
    if (!popup) {
      return;
    }

    popup.document.body.innerHTML = "";
    const container = popup.document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    popup.document.body.appendChild(container);

    const handleBeforeUnload = () => {
      clearPopoutState();
    };
    popup.addEventListener("beforeunload", handleBeforeUnload, { once: true });

    popoutWindowRef.current = popup;
    popoutContainerRef.current = container;
    setIsMinimized(false);
    setIsPoppedOut(true);
    onPopoutChange?.(true);
    syncPopoutDocumentStyles();

    try {
      popup.focus();
    } catch {
      // ignore focus errors
    }
  }, [clearPopoutState, onPopoutChange, popoutWindowName, syncPopoutDocumentStyles]);

  const handlePopoutToggle = useCallback(() => {
    if (isPoppedOut) {
      closePopout();
      return;
    }
    openPopout();
  }, [closePopout, isPoppedOut, openPopout]);

  const handleClose = useCallback(() => {
    if (isPoppedOut) {
      closePopout();
    }
    onClose?.();
  }, [closePopout, isPoppedOut, onClose]);

  useEffect(() => {
    const stored = readFloatingFrameStoredState(stateStorageKey);
    setPosition(stored?.position ?? defaultPosition);
    setIsMinimized(stored?.minimized ?? defaultMinimized);
    setSize(sizeStateEnabled ? stored?.size ?? defaultSize ?? null : null);
  }, [
    defaultMinimized,
    defaultPosition.x,
    defaultPosition.y,
    defaultSize?.height,
    defaultSize?.width,
    sizeStateEnabled,
    stateStorageKey,
  ]);

  useEffect(() => {
    if (!stateStorageKey) {
      return;
    }
    writeStorageJson(stateStorageKey, {
      position,
      minimized: isMinimized,
      ...(sizeStateEnabled && size ? { size } : {}),
    } satisfies FloatingFrameStoredState);
  }, [isMinimized, position, size, sizeStateEnabled, stateStorageKey]);

  const syncFrameBounds = useCallback(() => {
    if (isMinimized || !size) {
      const next = clampPosition(frameRef.current, position, positionMode, containerRef);
      if (next.x !== position.x || next.y !== position.y) {
        setPosition(next);
      }
      return;
    }
    const next = clampFloatingFrameRect(
      { position, size },
      resolvedMinSize,
      positionMode,
      containerRef,
      frameRef.current,
    );
    if (next.position.x !== position.x || next.position.y !== position.y) {
      setPosition(next.position);
    }
    if (next.size.width !== size.width || next.size.height !== size.height) {
      setSize(next.size);
    }
  }, [containerRef, isMinimized, position, positionMode, resolvedMinSize, size]);

  useLayoutEffect(() => {
    if (!isVisible || isPoppedOut) {
      return;
    }
    syncFrameBounds();
  }, [isVisible, isPoppedOut, syncFrameBounds]);

  useEffect(() => {
    if (!isVisible || isPoppedOut) {
      return;
    }
    const handleResize = () => {
      syncFrameBounds();
    };
    const container = resolveContainerNode(containerRef, frameRef.current);
    const observer =
      positionMode === "container" && typeof ResizeObserver !== "undefined" && container
        ? new ResizeObserver(handleResize)
        : null;
    if (observer && container) {
      observer.observe(container);
    }
    if (frameRef.current) {
      observer?.observe(frameRef.current);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [containerRef, isVisible, isPoppedOut, positionMode, syncFrameBounds]);

  useEffect(() => {
    if (!isPoppedOut) {
      return;
    }
    syncPopoutDocumentStyles();
    const observer = new MutationObserver(() => {
      syncPopoutDocumentStyles();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, [isPoppedOut, syncPopoutDocumentStyles]);

  useEffect(() => {
    if (!isVisible) {
      closePopout();
    }
  }, [closePopout, isVisible]);

  useEffect(() => {
    return () => {
      closePopout();
    };
  }, [closePopout]);

  useEffect(() => {
    if (dockRequestToken === undefined) {
      return;
    }
    if (lastDockRequestTokenRef.current === dockRequestToken) {
      return;
    }
    lastDockRequestTokenRef.current = dockRequestToken;
    if (isPoppedOut) {
      closePopout();
      return;
    }
    setIsMinimized(false);
  }, [closePopout, dockRequestToken, isPoppedOut]);

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (isPoppedOut) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target
        && target !== event.currentTarget
        && target.closest("button, a, input, select, textarea, [role='button'], [data-floating-frame-control='true']")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      try {
        event.currentTarget.setPointerCapture(pointerId);
      } catch {
        // no-op: pointer capture can fail in some embedded/browser contexts
      }
      setIsDragging(true);
      dragOffset.current = {
        x: event.clientX - position.x,
        y: event.clientY - position.y,
      };

      const handleDragMove = (moveEvent: PointerEvent | MouseEvent) => {
        const next = {
          x: moveEvent.clientX - dragOffset.current.x,
          y: moveEvent.clientY - dragOffset.current.y,
        };
        setPosition(clampPosition(frameRef.current, next, positionMode, containerRef));
      };

      const handleDragEnd = () => {
        setIsDragging(false);
        window.removeEventListener("pointermove", handleDragMove as EventListener);
        window.removeEventListener("pointerup", handleDragEnd);
        window.removeEventListener("pointercancel", handleDragEnd);
        window.removeEventListener("blur", handleDragEnd);
        document.removeEventListener("mouseleave", handleDragEnd);
        try {
          event.currentTarget.releasePointerCapture(pointerId);
        } catch {
          // no-op
        }
      };

      window.addEventListener("pointermove", handleDragMove as EventListener, { passive: true });
      window.addEventListener("pointerup", handleDragEnd);
      window.addEventListener("pointercancel", handleDragEnd);
      window.addEventListener("blur", handleDragEnd);
      document.addEventListener("mouseleave", handleDragEnd);
    },
    [containerRef, isPoppedOut, position.x, position.y, positionMode],
  );

  const handleResizeStart = useCallback(
    (direction: FloatingFrameResizeDirection) =>
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (isPoppedOut) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();

        const bounds = getFloatingFrameBounds(positionMode, containerRef, frameRef.current);
        if (!bounds) {
          return;
        }
        const pointerId = event.pointerId;
        const startPosition = position;
        const measuredSize =
          size ?? {
            width: frameRef.current?.offsetWidth ?? resolvedMinSize.width,
            height: frameRef.current?.offsetHeight ?? resolvedMinSize.height,
          };

        try {
          event.currentTarget.setPointerCapture(pointerId);
        } catch {
          // no-op
        }
        setIsResizing(true);

        const handleResizeMove = (moveEvent: PointerEvent | MouseEvent) => {
          const next = resolveResizeRect(
            direction,
            startPosition,
            measuredSize,
            {
              x: moveEvent.clientX - event.clientX,
              y: moveEvent.clientY - event.clientY,
            },
            resolvedMinSize,
            bounds,
          );
          setPosition(next.position);
          setSize(next.size);
        };

        const handleResizeEnd = () => {
          setIsResizing(false);
          window.removeEventListener("pointermove", handleResizeMove as EventListener);
          window.removeEventListener("pointerup", handleResizeEnd);
          window.removeEventListener("pointercancel", handleResizeEnd);
          window.removeEventListener("blur", handleResizeEnd);
          document.removeEventListener("mouseleave", handleResizeEnd);
          try {
            event.currentTarget.releasePointerCapture(pointerId);
          } catch {
            // no-op
          }
        };

        window.addEventListener("pointermove", handleResizeMove as EventListener, { passive: true });
        window.addEventListener("pointerup", handleResizeEnd);
        window.addEventListener("pointercancel", handleResizeEnd);
        window.addEventListener("blur", handleResizeEnd);
        document.addEventListener("mouseleave", handleResizeEnd);
      },
    [containerRef, isPoppedOut, position, positionMode, resolvedMinSize, size],
  );

  if (!isVisible) {
    return null;
  }

  const resizeHandles: Array<{
    direction: FloatingFrameResizeDirection;
    className: string;
    cursor: string;
  }> = [
    { direction: "n", className: "left-3 right-3 top-0 h-1.5", cursor: "ns-resize" },
    { direction: "s", className: "bottom-0 left-3 right-3 h-1.5", cursor: "ns-resize" },
    { direction: "e", className: "right-0 top-3 bottom-3 w-1.5", cursor: "ew-resize" },
    { direction: "w", className: "left-0 top-3 bottom-3 w-1.5", cursor: "ew-resize" },
    { direction: "ne", className: "right-0 top-0 h-3.5 w-3.5", cursor: "nesw-resize" },
    { direction: "nw", className: "left-0 top-0 h-3.5 w-3.5", cursor: "nwse-resize" },
    { direction: "se", className: "bottom-0 right-0 h-3.5 w-3.5", cursor: "nwse-resize" },
    { direction: "sw", className: "bottom-0 left-0 h-3.5 w-3.5", cursor: "nesw-resize" },
  ];

  const content = (
    <div
      ref={frameRef}
      data-floating-frame-root="true"
      className={cn(
        contentFill ? "flex flex-col" : "",
        isPoppedOut
          ? "h-full w-full border border-slate-400/80 bg-slate-200/95 text-black shadow-xl select-none"
          : positionMode === "container"
            ? "absolute z-20 min-w-[260px] max-w-[420px] border border-slate-400/80 bg-slate-200/95 text-black shadow-xl select-none"
            : "fixed z-30 min-w-[260px] max-w-[420px] border border-slate-400/80 bg-slate-200/95 text-black shadow-xl select-none",
        className,
      )}
      style={
        isPoppedOut
          ? {
              width: "100%",
              maxWidth: "100%",
              minWidth: "100%",
              height: "100%",
              cursor: "default",
            }
          : {
              left: position.x,
              top: position.y,
              cursor: isDragging ? "grabbing" : isResizing ? "grabbing" : "default",
              ...(size
                ? {
                    width: `${size.width}px`,
                    height: isMinimized ? "auto" : `${size.height}px`,
                    maxWidth: "none",
                  }
                : {}),
              ...(isMinimized
                ? {
                    height: "auto",
                    minHeight: "0px",
                  }
                : {}),
            }
      }
      data-testid={dataTestId}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-slate-400/60 px-2 py-1.5",
          !isPoppedOut ? "cursor-grab active:cursor-grabbing" : "",
          headerClassName,
        )}
        onPointerDown={!isPoppedOut ? handleDragStart : undefined}
        data-hint={!isPoppedOut ? dragHint : undefined}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {!isPoppedOut ? (
            <span
              className={cn("p-0.5 text-black/70 hover:text-black", dragHandleClassName)}
              aria-hidden="true"
            >
              <GripVertical className="w-3 h-3" />
            </span>
          ) : null}
          <div className={cn("truncate text-xs text-black", titleClassName)}>{title}</div>
        </div>
        <div className="relative z-30 flex items-center gap-1.5 shrink-0">
          {popoutable ? (
            <button
              type="button"
              className={cn("relative z-30 p-0.5 text-black/70 hover:text-black", controlButtonClassName)}
              onClick={handlePopoutToggle}
              aria-label={isPoppedOut ? `Dock ${title}` : `Pop out ${title}`}
              data-hint={isPoppedOut ? "Dock this frame back into the dashboard." : "Pop this frame into a linked window."}
              data-floating-frame-control="true"
            >
              {isPoppedOut ? <Minimize2 className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
            </button>
          ) : null}
          {headerRight}
          {closeable ? (
            <button
              type="button"
              className={cn("relative z-30 p-0.5 text-black/70 hover:text-black", controlButtonClassName)}
              onClick={handleClose}
              aria-label={`Close ${title}`}
              data-hint={closeHint}
              data-floating-frame-control="true"
            >
              <X className="w-3 h-3" />
            </button>
          ) : null}
          {minimizable && !isPoppedOut ? (
            <button
              type="button"
              className={cn(
                "relative z-30 inline-flex items-center justify-center self-center shrink-0 leading-none p-0.5 text-black/70 hover:text-black",
                controlButtonClassName,
              )}
              onClick={() => setIsMinimized((prev) => !prev)}
              aria-label={isMinimized ? `Expand ${title}` : `Minimize ${title}`}
              data-hint={isMinimized ? "Expand this floating frame." : "Minimize this floating frame."}
              data-floating-frame-control="true"
            >
              {isMinimized ? (
                <span
                  className="block h-2.5 w-2.5 border border-current"
                  aria-hidden="true"
                />
              ) : (
                <span
                  className="block w-3 border-t border-current"
                  aria-hidden="true"
                />
              )}
            </button>
          ) : null}
        </div>
      </div>
      {!isMinimized ? (
        <div
          className={cn(
            "px-3 py-2 text-xs text-black",
            contentFill ? "flex-1 min-h-0 h-0" : "",
            contentClassName,
          )}
          style={contentMinHeight > 0 ? { minHeight: `${contentMinHeight}px` } : undefined}
        >
          {children}
        </div>
      ) : null}
      {!isPoppedOut && resizable && !isMinimized ? (
        <>
          {resizeHandles.map((handle) => (
            <button
              key={handle.direction}
              type="button"
              className={cn("absolute z-20 block bg-transparent p-0", handle.className)}
              style={{ cursor: handle.cursor }}
              onPointerDown={handleResizeStart(handle.direction)}
              aria-label={`Resize ${title}`}
              data-hint={resizeHint}
            />
          ))}
        </>
      ) : null}
    </div>
  );

  if (isPoppedOut && popoutContainerRef.current) {
    return createPortal(content, popoutContainerRef.current);
  }
  return content;
}

export type ViewportFloatingFrameProps = Omit<FloatingFrameProps, "positionMode" | "containerRef">;

export function ViewportFloatingFrame(props: ViewportFloatingFrameProps) {
  return <FloatingFrame {...props} positionMode="viewport" />;
}

export type SubappFloatingFrameProps =
  Omit<FloatingFrameProps, "positionMode"> & {
    containerRef: RefObject<HTMLElement | null>;
  };

export function SubappFloatingFrame({
  containerRef,
  ...props
}: SubappFloatingFrameProps) {
  return (
    <FloatingFrame
      {...props}
      positionMode="container"
      containerRef={containerRef}
    />
  );
}
