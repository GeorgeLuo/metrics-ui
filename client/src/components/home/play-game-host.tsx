import { useEffect, useRef, useState } from "react";

type PlayGameHostProps = {
  gameLabel?: string;
  moduleUrl: string | null;
  columns: number;
  rows: number;
};

type PlayGameRuntimeContext = {
  container: HTMLElement;
  columns: number;
  rows: number;
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

export function PlayGameHost({
  gameLabel = "game",
  moduleUrl,
  columns,
  rows,
}: PlayGameHostProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        gameInstance = module.createPlayGame({ container, columns, rows });
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
      }
    };
  }, [columns, gameLabel, moduleUrl, rows]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-background"
      data-testid="play-game-host"
    >
      <div ref={mountRef} className="absolute inset-0" />
      {loadError ? (
        <div className="absolute inset-x-4 top-4 rounded border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
