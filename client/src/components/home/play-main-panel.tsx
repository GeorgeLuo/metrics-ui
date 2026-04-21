import { useEffect, useState } from "react";
import { FrameGrid, type FrameGridDebugSnapshot, type FrameGridSpec } from "@/components/frame-grid";
import { PlayGameHost } from "@/components/home/play-game-host";
import type { PlaySidebarSection } from "@/lib/play/sidebar-sections";

type PlayPair = [number, number];

type PlayGameCatalogEntry = {
  id: string;
  label: string;
  description?: string;
  moduleUrl: string;
  frameAspect: PlayPair;
  grid: PlayPair;
};

const FALLBACK_GRID: PlayPair = [9, 6];

export const PLAY_FRAME_GRID_SPEC: FrameGridSpec = {
  frameAspect: FALLBACK_GRID,
  frameBorderDiv: [0, 0],
  grid: FALLBACK_GRID,
  cellBorderDiv: [0, 0],
  fitMode: "contain",
};

type PlayMainPanelProps = {
  frameGridLayoutDebug?: boolean;
  onFrameGridDebugChange?: (debug: FrameGridDebugSnapshot) => void;
  onSidebarSectionsChange?: (sections: PlaySidebarSection[]) => void;
  onSidebarActionHandlerChange?: (handler: ((actionId: string, value?: unknown) => void) | null) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizePair(value: unknown, fallback: PlayPair): PlayPair {
  if (!Array.isArray(value) || value.length < 2) {
    return fallback;
  }
  const first = Number(value[0]);
  const second = Number(value[1]);
  return Number.isFinite(first) && Number.isFinite(second) && first > 0 && second > 0
    ? [first, second]
    : fallback;
}

function normalizeGameEntry(value: unknown): PlayGameCatalogEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : id;
  const moduleUrl = typeof record.moduleUrl === "string" && record.moduleUrl.trim()
    ? record.moduleUrl.trim()
    : null;
  if (!id || !label || !moduleUrl) {
    return null;
  }

  return {
    id,
    label,
    description: typeof record.description === "string" ? record.description : undefined,
    moduleUrl,
    frameAspect: normalizePair(record.frameAspect, FALLBACK_GRID),
    grid: normalizePair(record.grid, FALLBACK_GRID),
  };
}

function normalizeGameCatalog(payload: unknown): PlayGameCatalogEntry[] {
  const record = asRecord(payload);
  const rawGames = Array.isArray(record?.games) ? record.games : [];
  return rawGames.flatMap((game) => {
    const entry = normalizeGameEntry(game);
    return entry ? [entry] : [];
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PlayMainPanel({
  frameGridLayoutDebug = false,
  onFrameGridDebugChange,
  onSidebarSectionsChange,
  onSidebarActionHandlerChange,
}: PlayMainPanelProps) {
  const [games, setGames] = useState<PlayGameCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

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
        setGames(normalizeGameCatalog(payload));
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
  const [columns, rows] = selectedGame?.grid ?? FALLBACK_GRID;
  const frameGridSpec: FrameGridSpec = {
    ...PLAY_FRAME_GRID_SPEC,
    frameAspect: selectedGame?.frameAspect ?? FALLBACK_GRID,
    grid: [columns, rows],
  };

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
              columns={columns}
              rows={rows}
              onSidebarSectionsChange={onSidebarSectionsChange}
              onSidebarActionHandlerChange={onSidebarActionHandlerChange}
            />
          )}
        </FrameGrid.Item>
      </FrameGrid>
    </main>
  );
}
