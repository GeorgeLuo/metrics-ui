import { useCallback, useRef, useState } from "react";
import {
  FloatingFrameRegistryLayer,
  useFloatingFrameRegistry,
} from "@/components/floating-frame-registry";
import { usePlayGameModule } from "./use-play-game-module";
import { usePlaySidebarBridge } from "./use-play-sidebar-bridge";
import type {
  PlayFrontViewSnapshotHandler,
  PlayGameCommandHandler,
  PlayGameUsageHandler,
  PlayGameHostProps,
  PlayViewportSpec,
} from "./types";

export function PlayGameHost({
  gameLabel = "game",
  moduleUrl,
  columns,
  rows,
  onViewportSpecChange,
  onSidebarSectionsChange,
  onSidebarActionHandlerChange,
  onDebugSnapshotChange,
  onFrontViewSnapshotHandlerChange,
  onGameCommandHandlerChange,
  onGameUsageHandlerChange,
}: PlayGameHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mountElement, setMountElement] = useState<HTMLDivElement | null>(null);
  const {
    floatingFrames,
    createFloatingFrame,
    closeFloatingFrame,
    clearFloatingFrames,
  } = useFloatingFrameRegistry();
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
  const setFrontViewSnapshotHandler = useCallback((
    handler: PlayFrontViewSnapshotHandler | null | undefined,
  ) => {
    onFrontViewSnapshotHandlerChange?.(handler ?? null);
  }, [onFrontViewSnapshotHandlerChange]);
  const setGameCommandHandler = useCallback((
    handler: PlayGameCommandHandler | null | undefined,
  ) => {
    onGameCommandHandlerChange?.(handler ?? null);
  }, [onGameCommandHandlerChange]);
  const setGameUsageHandler = useCallback((
    handler: PlayGameUsageHandler | null | undefined,
  ) => {
    onGameUsageHandlerChange?.(handler ?? null);
  }, [onGameUsageHandlerChange]);

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
    setFrontViewSnapshotHandler,
    setGameCommandHandler,
    setGameUsageHandler,
  });

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-background"
      data-testid="play-game-host"
    >
      <div ref={setMountElement} className="absolute inset-0" />
      <FloatingFrameRegistryLayer
        scopeId={gameLabel}
        containerRef={hostRef}
        frames={floatingFrames}
        onCloseFrame={closeFloatingFrame}
        dataTestIdPrefix="play-floating-frame"
        storageKeyPrefix="play-floating-frame"
        popoutWindowNamePrefix="metrics-ui-play"
        popoutWindowTitlePrefix="Metrics UI - "
        viewportDragScopeLabel="webapp"
        subappDragScopeLabel="Play area"
        className="border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm"
        headerClassName="border-b border-border/50 bg-muted/40"
        titleClassName="text-xs text-foreground"
        dragHandleClassName="text-muted-foreground hover:text-foreground"
        controlButtonClassName="text-muted-foreground hover:text-foreground"
        contentClassName="!p-0 overflow-hidden bg-background text-foreground"
      />
      {loadError ? (
        <div className="absolute inset-x-4 top-4 rounded border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
