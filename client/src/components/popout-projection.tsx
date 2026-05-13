import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  buildPopoutWindowFeatures,
  copyPopoutStyleNodes,
  createPopoutContainer,
  getAccessiblePopoutDocument,
  startPopoutErrorDiagnostics,
} from "@/lib/popout-window";

interface PopoutProjectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  windowName: string;
  title: string;
  children: ReactNode;
  width?: number;
  height?: number;
}

function syncProjectionStyles(popup: Window, title: string) {
  const popupDocument = getAccessiblePopoutDocument(popup);
  if (!popupDocument) {
    return;
  }
  try {
    popupDocument.title = title;
    popupDocument.documentElement.className = document.documentElement.className;
    popupDocument.body.className = document.body.className;
    popupDocument.body.style.margin = "0";
    popupDocument.body.style.width = "100vw";
    popupDocument.body.style.height = "100vh";
    popupDocument.body.style.overflow = "hidden";

    copyPopoutStyleNodes({
      targetDocument: popupDocument,
      markerAttribute: "data-popout-projection-style",
    });
  } catch {
    // Popout windows can be closed or navigated while style sync is queued.
  }
}

export function PopoutProjection({
  open,
  onOpenChange,
  windowName,
  title,
  children,
  width,
  height,
}: PopoutProjectionProps) {
  const popupRef = useRef<Window | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const clearRefs = useCallback(() => {
    popupRef.current = null;
    containerRef.current = null;
  }, []);

  const closePopup = useCallback(() => {
    const popup = popupRef.current;
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // ignore close errors
      }
    }
    clearRefs();
  }, [clearRefs]);

  useEffect(() => {
    if (!open) {
      closePopup();
      return;
    }
    const existing = popupRef.current;
    if (existing && !existing.closed && containerRef.current) {
      syncProjectionStyles(existing, title);
      try {
        existing.focus();
      } catch {
        // ignore focus errors
      }
      return;
    }

    startPopoutErrorDiagnostics(`popout-projection:${windowName}`);
    const popup = window.open("about:blank", windowName, buildPopoutWindowFeatures({ width, height }));
    if (!popup) {
      onOpenChange(false);
      return;
    }

    const container = createPopoutContainer(popup);
    if (!container) {
      try {
        popup.close();
      } catch {
        // ignore close errors
      }
      clearRefs();
      onOpenChange(false);
      return;
    }

    const handleBeforeUnload = () => {
      clearRefs();
      onOpenChange(false);
    };
    popup.addEventListener("beforeunload", handleBeforeUnload, { once: true });

    popupRef.current = popup;
    containerRef.current = container;
    syncProjectionStyles(popup, title);
    try {
      popup.focus();
    } catch {
      // ignore focus errors
    }
  }, [clearRefs, closePopup, height, onOpenChange, open, title, width, windowName]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const popup = popupRef.current;
    if (!popup || popup.closed) {
      return;
    }
    syncProjectionStyles(popup, title);
    const observer = new MutationObserver(() => {
      const target = popupRef.current;
      if (!target || target.closed) {
        return;
      }
      syncProjectionStyles(target, title);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, [open, title]);

  useEffect(() => {
    return () => {
      closePopup();
    };
  }, [closePopup]);

  if (!open || !containerRef.current) {
    return null;
  }
  return createPortal(
    <div className="h-full w-full bg-background overflow-hidden">{children}</div>,
    containerRef.current,
  );
}
