import { useCallback, useEffect, useRef, useState } from "react";
import { SubappFloatingFrame } from "@/components/floating-frame";

type PlayGameHostProps = {
  gameLabel?: string;
  moduleUrl: string | null;
  columns: number;
  rows: number;
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

function normalizeFrameId(id: string): string {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "frame";
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
}: PlayGameHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !moduleUrl) {
      return;
    }

    let isDisposed = false;
    let gameInstance: PlayGameInstance | void;
    setLoadError(null);
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
      }
    };
  }, [columns, createFloatingFrame, gameLabel, moduleUrl, rows]);

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-background"
      data-testid="play-game-host"
    >
      <div ref={mountRef} className="absolute inset-0" />
      {floatingFrames.map((frame) => (
        <SubappFloatingFrame
          key={frame.id}
          title={frame.title}
          containerRef={hostRef}
          defaultPosition={frame.defaultPosition ?? { x: 16, y: 16 }}
          defaultSize={frame.defaultSize ?? { width: 300, height: 220 }}
          dataTestId={`play-floating-frame-${frame.id}`}
          stateStorageKey={`play-floating-frame:${gameLabel}:${frame.id}`}
          className="border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm"
          headerClassName="border-b border-border/50 bg-muted/40"
          titleClassName="text-xs text-foreground"
          dragHandleClassName="text-muted-foreground hover:text-foreground"
          controlButtonClassName="text-muted-foreground hover:text-foreground"
          contentClassName="!p-0 overflow-hidden bg-background text-foreground"
          contentFill
          contentMinHeight={0}
          dragHint={`Drag ${frame.title} within the Play area.`}
          minimizable={frame.minimizable ?? true}
          resizable={frame.resizable ?? true}
          minSize={frame.minSize ?? { width: 180, height: 140 }}
          resizeHint={`Resize ${frame.title}.`}
          popoutable={frame.popoutable ?? false}
          popoutWindowName={`metrics-ui-play-${frame.id}`}
          popoutWindowTitle={`Metrics UI - ${frame.title}`}
          closeable={frame.closeable ?? false}
          closeHint={`Close ${frame.title}.`}
          onClose={frame.closeable ? () => closeFloatingFrame(frame.id) : undefined}
        >
          <PlayFloatingFrameMount mount={frame.mount} />
        </SubappFloatingFrame>
      ))}
      {loadError ? (
        <div className="absolute inset-x-4 top-4 rounded border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
