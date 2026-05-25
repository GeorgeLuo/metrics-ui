import { useCallback, useRef, useState } from "react";
import { PlayFloatingFrameLayer } from "./play-floating-frame-layer";
import { usePlayFloatingFrames } from "./use-play-floating-frames";
import { usePlayGameModule } from "./use-play-game-module";
import { usePlaySidebarBridge } from "./use-play-sidebar-bridge";
import type { PlayGameHostProps, PlayViewportSpec } from "./types";

export function PlayGameHost({
  gameLabel = "game",
  moduleUrl,
  columns,
  rows,
  onViewportSpecChange,
  onSidebarSectionsChange,
  onSidebarActionHandlerChange,
  onDebugSnapshotChange,
}: PlayGameHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mountElement, setMountElement] = useState<HTMLDivElement | null>(null);
  const {
    floatingFrames,
    createFloatingFrame,
    closeFloatingFrame,
    clearFloatingFrames,
  } = usePlayFloatingFrames();
  const {
    setSidebarSections,
    setSidebarActionHandler,
    clearSidebarActionHandlers,
    clearPendingSidebarPublish,
  } = usePlaySidebarBridge({
    onSidebarSectionsChange,
    onSidebarActionHandlerChange,
  });
  const setDebugSnapshot = useCallback((snapshot: unknown) => {
    onDebugSnapshotChange?.(snapshot);
  }, [onDebugSnapshotChange]);
  const setViewportSpec = useCallback((spec: PlayViewportSpec | null) => {
    onViewportSpecChange?.(spec);
  }, [onViewportSpecChange]);

  const loadError = usePlayGameModule({
    container: mountElement,
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
  });

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-background"
      data-testid="play-game-host"
    >
      <div ref={setMountElement} className="absolute inset-0" />
      <PlayFloatingFrameLayer
        gameLabel={gameLabel}
        containerRef={hostRef}
        frames={floatingFrames}
        onCloseFrame={closeFloatingFrame}
      />
      {loadError ? (
        <div className="absolute inset-x-4 top-4 rounded border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
