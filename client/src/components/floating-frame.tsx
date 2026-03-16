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
import { ExternalLink, GripVertical, Minimize2 } from "lucide-react";
import { createPortal } from "react-dom";
import { buildPopoutWindowFeatures } from "@/lib/popout-window";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number };
type FloatingFramePositionMode = "viewport" | "container";

export interface FloatingFrameProps {
  title: string;
  children?: ReactNode;
  isVisible?: boolean;
  defaultPosition?: Point;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  dragHandleClassName?: string;
  controlButtonClassName?: string;
  headerRight?: ReactNode;
  dataTestId?: string;
  minimizable?: boolean;
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
}

const DEFAULT_POSITION: Point = { x: 24, y: 72 };
const VIEWPORT_PADDING = 8;

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

export function FloatingFrame({
  title,
  children,
  isVisible = true,
  defaultPosition = DEFAULT_POSITION,
  className,
  contentClassName,
  headerClassName,
  titleClassName,
  dragHandleClassName,
  controlButtonClassName,
  headerRight,
  dataTestId = "floating-frame",
  minimizable = true,
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
}: FloatingFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const popoutWindowRef = useRef<Window | null>(null);
  const popoutContainerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Point>(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);
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

  useEffect(() => {
    setPosition(defaultPosition);
  }, [defaultPosition.x, defaultPosition.y]);

  useLayoutEffect(() => {
    if (!isVisible || isPoppedOut) {
      return;
    }
    setPosition((prev) => clampPosition(frameRef.current, prev, positionMode, containerRef));
  }, [containerRef, isVisible, isPoppedOut, positionMode]);

  useEffect(() => {
    if (!isVisible || isPoppedOut) {
      return;
    }
    const handleResize = () => {
      setPosition((prev) => clampPosition(frameRef.current, prev, positionMode, containerRef));
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
  }, [containerRef, isVisible, isPoppedOut, positionMode]);

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
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (isPoppedOut) {
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

  if (!isVisible) {
    return null;
  }

  const content = (
    <div
      ref={frameRef}
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
              cursor: isDragging ? "grabbing" : "default",
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
      <div className={cn("flex items-center justify-between gap-2 border-b border-slate-400/60 px-2 py-1.5", headerClassName)}>
        <div className="flex items-center gap-1.5 min-w-0">
          {!isPoppedOut ? (
            <button
              type="button"
              className={cn(
                "cursor-grab active:cursor-grabbing p-0.5 text-black/70 hover:text-black",
                dragHandleClassName,
              )}
              onPointerDown={handleDragStart}
              aria-label={`Drag ${title}`}
              data-hint={dragHint}
            >
              <GripVertical className="w-3 h-3" />
            </button>
          ) : null}
          <div className={cn("truncate text-xs text-black", titleClassName)}>{title}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {popoutable ? (
            <button
              type="button"
              className={cn("p-0.5 text-black/70 hover:text-black", controlButtonClassName)}
              onClick={handlePopoutToggle}
              aria-label={isPoppedOut ? `Dock ${title}` : `Pop out ${title}`}
              data-hint={isPoppedOut ? "Dock this frame back into the dashboard." : "Pop this frame into a linked window."}
            >
              {isPoppedOut ? <Minimize2 className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
            </button>
          ) : null}
          {headerRight}
          {minimizable && !isPoppedOut ? (
            <button
              type="button"
              className={cn(
                "inline-flex items-center justify-center self-center shrink-0 leading-none p-0.5 text-black/70 hover:text-black",
                controlButtonClassName,
              )}
              onClick={() => setIsMinimized((prev) => !prev)}
              aria-label={isMinimized ? `Expand ${title}` : `Minimize ${title}`}
              data-hint={isMinimized ? "Expand this floating frame." : "Minimize this floating frame."}
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
