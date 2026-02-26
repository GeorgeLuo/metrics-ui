import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buildPopoutWindowFeatures } from "@/lib/popout-window";

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
  popup.document.title = title;
  popup.document.documentElement.className = document.documentElement.className;
  popup.document.body.className = document.body.className;
  popup.document.body.style.margin = "0";
  popup.document.body.style.width = "100vw";
  popup.document.body.style.height = "100vh";
  popup.document.body.style.overflow = "hidden";

  const existingNodes = popup.document.querySelectorAll("[data-popout-projection-style='1']");
  existingNodes.forEach((node) => node.remove());
  const styleNodes = document.head.querySelectorAll("style, link[rel='stylesheet']");
  styleNodes.forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.setAttribute("data-popout-projection-style", "1");
    popup.document.head.appendChild(clone);
  });
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

    const popup = window.open("", windowName, buildPopoutWindowFeatures({ width, height }));
    if (!popup) {
      onOpenChange(false);
      return;
    }

    popup.document.body.innerHTML = "";
    const container = popup.document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    popup.document.body.appendChild(container);

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
