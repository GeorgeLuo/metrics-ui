import { useEffect, useMemo, useState } from "react";
import { FrameGrid, type FrameGridDebugSnapshot, type FrameGridSpec } from "@/components/frame-grid";
import {
  PlayGameHost,
  type PlayFrontViewSnapshotHandler,
  type PlayGameCommandHandler,
  type PlayGameUsageHandler,
  type PlaySidebarActionHandler,
  type PlayViewportSpec,
} from "@/components/home/play-game-host";
import type { PlaySidebarSection } from "@/lib/play/sidebar-sections";
import {
  DEFAULT_PLAY_GRID,
  normalizePlayGameCatalog,
  type PlayGameCatalogEntry,
} from "@shared/play-catalog";

export const PLAY_FRAME_GRID_SPEC: FrameGridSpec = {
  frameAspect: DEFAULT_PLAY_GRID,
  frameBorderDiv: [0, 0],
  grid: DEFAULT_PLAY_GRID,
  cellBorderDiv: [0, 0],
  fitMode: "contain",
};

type PlayMainPanelProps = {
  frameGridLayoutDebug?: boolean;
  onFrameGridDebugChange?: (debug: FrameGridDebugSnapshot) => void;
  onSidebarSectionsChange?: (sections: PlaySidebarSection[]) => void;
  onSidebarActionHandlerChange?: (handler: PlaySidebarActionHandler | null) => void;
  onDebugSnapshotChange?: (snapshot: unknown) => void;
  onFrontViewSnapshotHandlerChange?: (handler: PlayFrontViewSnapshotHandler | null) => void;
  onGameCommandHandlerChange?: (handler: PlayGameCommandHandler | null) => void;
  onGameUsageHandlerChange?: (handler: PlayGameUsageHandler | null) => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isIntegerPlayGrid(value: PlayViewportSpec["grid"]): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && Number.isInteger(value[0])
    && Number.isInteger(value[1])
    && value[0] > 0
    && value[1] > 0;
}

export function PlayMainPanel({
  frameGridLayoutDebug = false,
  onFrameGridDebugChange,
  onSidebarSectionsChange,
  onSidebarActionHandlerChange,
  onDebugSnapshotChange,
  onFrontViewSnapshotHandlerChange,
  onGameCommandHandlerChange,
  onGameUsageHandlerChange,
}: PlayMainPanelProps) {
  const [games, setGames] = useState<PlayGameCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [viewportSpecOverride, setViewportSpecOverride] = useState<PlayViewportSpec | null>(null);

  useEffect(() => {
    let isDisposed = false;

    fetch("/api/play/games")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Play game catalog request failed with ${response.status}.`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (isDisposed) {
          return;
        }
        setGames(normalizePlayGameCatalog(payload, { moduleField: "moduleUrl" }));
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        if (!isDisposed) {
          setCatalogError(getErrorMessage(error));
          setGames([]);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  const selectedGame = games[0] ?? null;
  const [hostColumns, hostRows] = selectedGame?.grid ?? DEFAULT_PLAY_GRID;
  const [columns, rows] = isIntegerPlayGrid(viewportSpecOverride?.grid)
    ? viewportSpecOverride.grid
    : [hostColumns, hostRows];
  const frameGridSpec = useMemo<FrameGridSpec>(() => ({
    ...PLAY_FRAME_GRID_SPEC,
    frameAspect: viewportSpecOverride?.frameAspect ?? selectedGame?.frameAspect ?? DEFAULT_PLAY_GRID,
    grid: [columns, rows],
  }), [columns, rows, selectedGame?.frameAspect, viewportSpecOverride?.frameAspect]);

  useEffect(() => {
    setViewportSpecOverride(null);
  }, [selectedGame?.id]);

  return (
    <main
      className="flex min-h-0 flex-1 overflow-hidden bg-background"
      data-testid="play-main-panel"
    >
      <FrameGrid
        spec={frameGridSpec}
        debugId="play-main"
        layoutDebug={frameGridLayoutDebug}
        showOuterFrame={frameGridLayoutDebug}
        showContentFrame={frameGridLayoutDebug}
        showCellGrid
        onDebug={onFrameGridDebugChange}
      >
        <FrameGrid.Item
          col={0}
          row={0}
          colSpan={columns}
          rowSpan={rows}
        >
          {catalogError ? (
            <div className="flex h-full w-full items-start justify-start bg-background p-4 text-xs text-destructive">
              {catalogError}
            </div>
          ) : (
            <PlayGameHost
              gameLabel={selectedGame?.label}
              moduleUrl={selectedGame?.moduleUrl ?? null}
              columns={hostColumns}
              rows={hostRows}
              onViewportSpecChange={setViewportSpecOverride}
              onSidebarSectionsChange={onSidebarSectionsChange}
              onSidebarActionHandlerChange={onSidebarActionHandlerChange}
              onDebugSnapshotChange={onDebugSnapshotChange}
              onFrontViewSnapshotHandlerChange={onFrontViewSnapshotHandlerChange}
              onGameCommandHandlerChange={onGameCommandHandlerChange}
              onGameUsageHandlerChange={onGameUsageHandlerChange}
            />
          )}
        </FrameGrid.Item>
      </FrameGrid>
    </main>
  );
}
