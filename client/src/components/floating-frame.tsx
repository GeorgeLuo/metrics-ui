import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, GripVertical, Minimize2 } from "lucide-react";
import { createPortal } from "react-dom";
import { buildPopoutWindowFeatures } from "@/lib/popout-window";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number };

interface FloatingFrameProps {
  title: string;
  children?: ReactNode;
  isVisible?: boolean;
  defaultPosition?: Point;
  className?: string;
  contentClassName?: string;
  headerRight?: ReactNode;
  dataTestId?: string;
  minimizable?: boolean;
  defaultMinimized?: boolean;
  popoutable?: boolean;
  popoutWindowName?: string;
  popoutWindowTitle?: string;
}

const DEFAULT_POSITION: Point = { x: 24, y: 72 };
const VIEWPORT_PADDING = 8;

function clampPosition(frame: HTMLDivElement | null, position: Point): Point {
  if (typeof window === "undefined") {
    return position;
  }
  const width = frame?.offsetWidth ?? 300;
  const height = frame?.offsetHeight ?? 140;
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
  headerRight,
  dataTestId = "floating-frame",
  minimizable = true,
  defaultMinimized = false,
  popoutable = false,
  popoutWindowName = "metrics-ui-floating-frame",
  popoutWindowTitle,
}: FloatingFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const popoutWindowRef = useRef<Window | null>(null);
  const popoutContainerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Point>(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);
  const [isPoppedOut, setIsPoppedOut] = useState(false);

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
  }, []);

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
      setIsPoppedOut(true);
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
    setIsPoppedOut(true);
    syncPopoutDocumentStyles();

    try {
      popup.focus();
    } catch {
      // ignore focus errors
    }
  }, [clearPopoutState, popoutWindowName, syncPopoutDocumentStyles]);

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
    setPosition((prev) => clampPosition(frameRef.current, prev));
  }, [isVisible, isPoppedOut]);

  useEffect(() => {
    if (!isVisible || isPoppedOut) {
      return;
    }
    const handleResize = () => {
      setPosition((prev) => clampPosition(frameRef.current, prev));
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isVisible, isPoppedOut]);

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

  const handleDragStart = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (isPoppedOut) {
        return;
      }
      event.preventDefault();
      setIsDragging(true);
      dragOffset.current = {
        x: event.clientX - position.x,
        y: event.clientY - position.y,
      };

      const handleDragMove = (moveEvent: MouseEvent) => {
        const next = {
          x: moveEvent.clientX - dragOffset.current.x,
          y: moveEvent.clientY - dragOffset.current.y,
        };
        setPosition(clampPosition(frameRef.current, next));
      };

      const handleDragEnd = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleDragMove);
        document.removeEventListener("mouseup", handleDragEnd);
      };

      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
    },
    [isPoppedOut, position.x, position.y],
  );

  if (!isVisible) {
    return null;
  }

  const content = (
    <div
      ref={frameRef}
      className={cn(
        isPoppedOut
          ? "h-full w-full border border-slate-400/80 bg-slate-200/95 text-black shadow-xl select-none"
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
            }
      }
      data-testid={dataTestId}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-400/60 px-2 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {!isPoppedOut ? (
            <button
              type="button"
              className="cursor-grab active:cursor-grabbing p-0.5 text-black/70 hover:text-black"
              onMouseDown={handleDragStart}
              aria-label={`Drag ${title}`}
              data-hint="Drag this frame anywhere on the page."
            >
              <GripVertical className="w-3 h-3" />
            </button>
          ) : null}
          <div className="truncate text-xs text-black">{title}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {popoutable ? (
            <button
              type="button"
              className="p-0.5 text-black/70 hover:text-black"
              onClick={handlePopoutToggle}
              aria-label={isPoppedOut ? `Dock ${title}` : `Pop out ${title}`}
              data-hint={isPoppedOut ? "Dock this frame back into the dashboard." : "Pop this frame into a linked window."}
            >
              {isPoppedOut ? <Minimize2 className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
            </button>
          ) : null}
          {headerRight}
          {minimizable ? (
            <button
              type="button"
              className="p-0.5 text-black/70 hover:text-black"
              onClick={() => setIsMinimized((prev) => !prev)}
              aria-label={isMinimized ? `Expand ${title}` : `Minimize ${title}`}
              data-hint={isMinimized ? "Expand this floating frame." : "Minimize this floating frame."}
            >
              {isMinimized ? (
                <span
                  className="inline-block h-2.5 w-2.5 border border-black/80 align-middle"
                  aria-hidden="true"
                />
              ) : (
                <span
                  className="inline-block w-3 border-t border-black/80 align-middle"
                  aria-hidden="true"
                />
              )}
            </button>
          ) : null}
        </div>
      </div>
      {!isMinimized ? (
        <div className={cn("px-3 py-2 text-xs text-black min-h-[140px]", contentClassName)}>{children}</div>
      ) : null}
    </div>
  );

  if (isPoppedOut && popoutContainerRef.current) {
    return createPortal(content, popoutContainerRef.current);
  }
  return content;
}
