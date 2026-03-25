import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

export type FitMode = "intrinsic" | "wrap";
export type FitAlign = "center" | "start";

export function FitToWidthContent({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ scale: 1, height: 0 });

  useLayoutEffect(() => {
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
        const naturalWidth = content.scrollWidth;
        const naturalHeight = content.scrollHeight;

        if (availableWidth <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
          setLayout({ scale: 1, height: 0 });
          return;
        }

        const nextScale = Math.min(1, availableWidth / naturalWidth);
        const nextHeight = naturalHeight * nextScale;
        setLayout((current) => (
          Math.abs(current.scale - nextScale) < 0.01 && Math.abs(current.height - nextHeight) < 0.5
            ? current
            : { scale: nextScale, height: nextHeight }
        ));
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
  }, []);

  return (
    <div
      ref={containerRef}
      className={["relative max-w-full overflow-hidden", className ?? ""].filter(Boolean).join(" ")}
      data-equations-highlight-overlay-host="1"
      style={layout.height > 0 ? { height: `${layout.height}px` } : undefined}
    >
      <div
        ref={contentRef}
        className={["absolute left-0 top-0 w-max max-w-none", contentClassName ?? ""].filter(Boolean).join(" ")}
        style={{
          transform: layout.scale === 1 ? undefined : `scale(${layout.scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function FitToCellContent({
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
    if (mode === "wrap") {
      setScale(1);
      return;
    }

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

        const widthScale = availableWidth / naturalWidth;
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
  }, [mode]);

  if (mode === "wrap") {
    return (
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-1">
        <div className="relative w-full pb-3" data-equations-highlight-overlay-host="1">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
      <div
        ref={contentRef}
        className={[
          "absolute",
          align === "center" ? "left-1/2 top-1/2" : "left-0 top-0",
          "w-max max-w-none",
        ].join(" ")}
        style={{
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
