import { useCallback, useEffect, useState } from "react";
import type {
  PlayFloatingFrameOptions,
  PlayFloatingFrameHandle,
  PlayGameInstance,
  PlayGameModule,
  PlayViewportSpec,
} from "./types";

type UsePlayGameModuleOptions = {
  container: HTMLElement | null;
  moduleUrl: string | null;
  gameLabel: string;
  columns: number;
  rows: number;
  createFloatingFrame: (options: PlayFloatingFrameOptions) => PlayFloatingFrameHandle;
  setSidebarSections: (sections: unknown) => void;
  setSidebarActionHandler: (actionId: string, handler: ((value?: unknown) => void) | null) => void;
  clearSidebarActionHandlers: () => void;
  clearPendingSidebarPublish: () => void;
  clearFloatingFrames: () => void;
  setDebugSnapshot: (snapshot: unknown) => void;
  setViewportSpec: (spec: PlayViewportSpec | null) => void;
  setFrontViewSnapshotHandler: (
    handler: PlayGameInstance["getFrontViewSnapshot"] | null,
  ) => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePlayGameModule({
  container,
  moduleUrl,
  gameLabel,
  columns,
  rows,
  createFloatingFrame,
  setSidebarSections,
  setSidebarActionHandler,
  clearSidebarActionHandlers,
  clearPendingSidebarPublish,
  clearFloatingFrames,
  setDebugSnapshot,
  setViewportSpec,
  setFrontViewSnapshotHandler,
}: UsePlayGameModuleOptions) {
  const [loadError, setLoadError] = useState<string | null>(null);

  const clearRuntimeState = useCallback(() => {
    clearFloatingFrames();
    clearSidebarActionHandlers();
    clearPendingSidebarPublish();
    setSidebarSections([]);
    setDebugSnapshot(null);
    setViewportSpec(null);
    setFrontViewSnapshotHandler(null);
  }, [
    clearFloatingFrames,
    clearPendingSidebarPublish,
    clearSidebarActionHandlers,
    setDebugSnapshot,
    setFrontViewSnapshotHandler,
    setSidebarSections,
    setViewportSpec,
  ]);

  useEffect(() => {
    if (!container || !moduleUrl) {
      return;
    }

    let isDisposed = false;
    let gameInstance: PlayGameInstance | void;
    setLoadError(null);
    clearRuntimeState();
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
          setDebugSnapshot,
          setViewportSpec,
          frames: { createFloatingFrame },
          sidebar: {
            setSections: setSidebarSections,
            setActionHandler: setSidebarActionHandler,
          },
          debug: { setSnapshot: setDebugSnapshot },
          viewport: { setSpec: setViewportSpec },
        });
        setFrontViewSnapshotHandler(gameInstance?.getFrontViewSnapshot ?? null);
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
        clearRuntimeState();
      }
    };
  }, [
    clearRuntimeState,
    columns,
    container,
    createFloatingFrame,
    gameLabel,
    moduleUrl,
    rows,
    setDebugSnapshot,
    setFrontViewSnapshotHandler,
    setSidebarActionHandler,
    setSidebarSections,
    setViewportSpec,
  ]);

  return loadError;
}
