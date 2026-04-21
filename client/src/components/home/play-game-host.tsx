import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SubappFloatingFrame, ViewportFloatingFrame } from "@/components/floating-frame";
import {
  normalizePlaySidebarSections,
  type PlaySidebarSection,
} from "@/lib/play/sidebar-sections";

type PlayGameHostProps = {
  gameLabel?: string;
  moduleUrl: string | null;
  columns: number;
  rows: number;
  onSidebarSectionsChange?: (sections: PlaySidebarSection[]) => void;
  onSidebarActionHandlerChange?: (handler: ((actionId: string, value?: unknown) => void) | null) => void;
};

type PlayFloatingFrameSize = {
  width: number;
  height: number;
};

type PlayFloatingFramePosition = {
  x: number;
  y: number;
};

type PlayFloatingFrameOptions = {
  id: string;
  title: string;
  bounds?: "subapp" | "viewport";
  defaultPosition?: PlayFloatingFramePosition;
  defaultSize?: PlayFloatingFrameSize;
  minSize?: PlayFloatingFrameSize;
  minimizable?: boolean;
  resizable?: boolean;
  popoutable?: boolean;
  closeable?: boolean;
  onClose?: () => void;
};

type PlayFloatingFrameHandle = {
  mount: HTMLDivElement;
  close: () => void;
  setTitle: (title: string) => void;
};

type PlayFloatingFrameRecord = PlayFloatingFrameOptions & {
  mount: HTMLDivElement;
};

type PlayGameRuntimeContext = {
  container: HTMLElement;
  columns: number;
  rows: number;
  createFloatingFrame: (options: PlayFloatingFrameOptions) => PlayFloatingFrameHandle;
  setSidebarSections: (sections: unknown) => void;
  setSidebarActionHandler: (actionId: string, handler: ((value?: unknown) => void) | null) => void;
};

type PlayGameInstance = {
  dispose?: () => void;
};

type PlayGameModule = {
  createPlayGame?: (context: PlayGameRuntimeContext) => PlayGameInstance | void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRuntimeId(id: string, fallback: string | null): string | null {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || fallback;
}

function normalizeFrameId(id: string): string {
  return normalizeRuntimeId(id, "frame") ?? "frame";
}

function normalizeSidebarActionId(id: string): string | null {
  return normalizeRuntimeId(id, null);
}

function makeFrameMount(): HTMLDivElement {
  const mount = document.createElement("div");
  Object.assign(mount.style, {
    position: "relative",
    width: "100%",
    height: "100%",
    minWidth: "0",
    minHeight: "0",
    overflow: "hidden",
  });
  return mount;
}

function PlayFloatingFrameMount({ mount }: { mount: HTMLDivElement }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.replaceChildren(mount);
    return () => {
      if (mount.parentElement === container) {
        container.removeChild(mount);
      }
    };
  }, [mount]);

  return <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden" />;
}

export function PlayGameHost({
  gameLabel = "game",
  moduleUrl,
  columns,
  rows,
  onSidebarSectionsChange,
  onSidebarActionHandlerChange,
}: PlayGameHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sidebarActionHandlersRef = useRef<Map<string, (value?: unknown) => void>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [floatingFrames, setFloatingFrames] = useState<PlayFloatingFrameRecord[]>([]);

  const closeFloatingFrame = useCallback((frameId: string) => {
    setFloatingFrames((prev) => {
      const frame = prev.find((candidate) => candidate.id === frameId);
      frame?.onClose?.();
      frame?.mount.replaceChildren();
      return prev.filter((candidate) => candidate.id !== frameId);
    });
  }, []);

  const createFloatingFrame = useCallback((options: PlayFloatingFrameOptions) => {
    const id = normalizeFrameId(options.id);
    const mount = makeFrameMount();
    const frame: PlayFloatingFrameRecord = {
      ...options,
      id,
      title: options.title.trim() || "Frame",
      mount,
    };

    setFloatingFrames((prev) => {
      const replacedFrame = prev.find((candidate) => candidate.id === id);
      replacedFrame?.mount.replaceChildren();
      return [...prev.filter((candidate) => candidate.id !== id), frame];
    });

    return {
      mount,
      close: () => closeFloatingFrame(id),
      setTitle: (title: string) => {
        setFloatingFrames((prev) =>
          prev.map((candidate) =>
            candidate.id === id
              ? { ...candidate, title: title.trim() || candidate.title }
              : candidate,
          ),
        );
      },
    };
  }, [closeFloatingFrame]);

  const setSidebarSections = useCallback((sections: unknown) => {
    onSidebarSectionsChange?.(normalizePlaySidebarSections(sections));
  }, [onSidebarSectionsChange]);

  const setSidebarActionHandler = useCallback((actionId: string, handler: ((value?: unknown) => void) | null) => {
    const normalizedActionId = normalizeSidebarActionId(actionId);
    if (!normalizedActionId) {
      return;
    }
    if (handler) {
      sidebarActionHandlersRef.current.set(normalizedActionId, handler);
    } else {
      sidebarActionHandlersRef.current.delete(normalizedActionId);
    }
  }, []);

  const dispatchSidebarAction = useCallback((actionId: string, value?: unknown) => {
    const normalizedActionId = normalizeSidebarActionId(actionId);
    if (!normalizedActionId) {
      return;
    }
    sidebarActionHandlersRef.current.get(normalizedActionId)?.(value);
  }, []);

  useEffect(() => {
    onSidebarActionHandlerChange?.(dispatchSidebarAction);
    return () => {
      onSidebarActionHandlerChange?.(null);
    };
  }, [dispatchSidebarAction, onSidebarActionHandlerChange]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !moduleUrl) {
      return;
    }

    let isDisposed = false;
    let gameInstance: PlayGameInstance | void;
    setLoadError(null);
    sidebarActionHandlersRef.current.clear();
    setSidebarSections([]);
    container.replaceChildren();

    import(/* @vite-ignore */ moduleUrl)
      .then((module: PlayGameModule) => {
        if (isDisposed) {
          return;
        }
        if (typeof module.createPlayGame !== "function") {
          throw new Error(`Play game module for ${gameLabel} must export createPlayGame().`);
        }
        gameInstance = module.createPlayGame({
          container,
          columns,
          rows,
          createFloatingFrame,
          setSidebarSections,
          setSidebarActionHandler,
        });
      })
      .catch((error: unknown) => {
        if (!isDisposed) {
          setLoadError(getErrorMessage(error));
        }
      });

    return () => {
      isDisposed = true;
      try {
        gameInstance?.dispose?.();
      } finally {
        container.replaceChildren();
        setFloatingFrames((prev) => {
          prev.forEach((frame) => frame.mount.replaceChildren());
          return [];
        });
        sidebarActionHandlersRef.current.clear();
        setSidebarSections([]);
      }
    };
  }, [columns, createFloatingFrame, gameLabel, moduleUrl, rows, setSidebarActionHandler, setSidebarSections]);

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-background"
      data-testid="play-game-host"
    >
      <div ref={mountRef} className="absolute inset-0" />
      {floatingFrames.map((frame) => {
        const storageScope = frame.bounds === "viewport" ? "viewport" : "subapp";
        const floatingFrameProps = {
          title: frame.title,
          defaultPosition: frame.defaultPosition ?? { x: 16, y: 16 },
          defaultSize: frame.defaultSize ?? { width: 300, height: 220 },
          dataTestId: `play-floating-frame-${frame.id}`,
          stateStorageKey: `play-floating-frame:${gameLabel}:${storageScope}:${frame.id}`,
          className: "border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm",
          headerClassName: "border-b border-border/50 bg-muted/40",
          titleClassName: "text-xs text-foreground",
          dragHandleClassName: "text-muted-foreground hover:text-foreground",
          controlButtonClassName: "text-muted-foreground hover:text-foreground",
          contentClassName: "!p-0 overflow-hidden bg-background text-foreground",
          contentFill: true,
          contentMinHeight: 0,
          dragHint: frame.bounds === "viewport"
            ? `Drag ${frame.title} within the webapp.`
            : `Drag ${frame.title} within the Play area.`,
          minimizable: frame.minimizable ?? true,
          resizable: frame.resizable ?? true,
          minSize: frame.minSize ?? { width: 180, height: 140 },
          resizeHint: `Resize ${frame.title}.`,
          popoutable: frame.popoutable ?? false,
          popoutWindowName: `metrics-ui-play-${frame.id}`,
          popoutWindowTitle: `Metrics UI - ${frame.title}`,
          closeable: frame.closeable ?? false,
          closeHint: `Close ${frame.title}.`,
          onClose: frame.closeable ? () => closeFloatingFrame(frame.id) : undefined,
        };
        const content = <PlayFloatingFrameMount mount={frame.mount} />;
        if (frame.bounds === "viewport") {
          const viewportFrame = (
            <ViewportFloatingFrame {...floatingFrameProps}>
              {content}
            </ViewportFloatingFrame>
          );
          return typeof document === "undefined"
            ? viewportFrame
            : createPortal(viewportFrame, document.body, frame.id);
        }
        return (
          <SubappFloatingFrame key={frame.id} {...floatingFrameProps} containerRef={hostRef}>
            {content}
          </SubappFloatingFrame>
        );
      })}
      {loadError ? (
        <div className="absolute inset-x-4 top-4 rounded border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
