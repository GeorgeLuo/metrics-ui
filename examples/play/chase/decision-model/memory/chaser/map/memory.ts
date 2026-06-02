/**
 * Chaser map memory construction from field-of-view observations.
 *
 * Persistent knowledge and recency are deliberately separate: `knownAreas`
 * retains map facts, while `recentlyObservedAreas` ages by frame.
 */
import { CHASER_MAP_OBSERVATION_CELL_SIZE } from "../../../../config/constants.mjs";
import type { VectorXZ } from "../../../core/math.ts";
import {
  type BoundsXZ as ObservedBoundsXZ,
  type ObservedMap,
  type ObservedMapAreaCell,
  type ObservedMapObstacleSet,
  type ObservedMapWall,
} from "../../../observer-world/interfaces.ts";
import type {
  MemoryFrameIndex,
  TemporalRecordBase,
} from "../../core/interfaces.ts";
import {
  normalizeMemoryFrameIndex,
  createTemporalRecord,
  upsertTemporalRecords,
} from "../../core/temporal-record.ts";
import { applyRetentionPolicy } from "../../core/temporal-window.ts";

/** Side length for remembered map-area cells in world units. */
export const KNOWN_AREA_CELL_SIZE = CHASER_MAP_OBSERVATION_CELL_SIZE;
/** Default frame age before an area is no longer considered recently seen. */
export const RECENT_VISITATION_MAX_AGE_FRAMES = 600;

/** Axis-aligned x/z bounds for remembered or configured map space. */
export type BoundsXZ = ObservedBoundsXZ;

/** Remembered obstacle wall observed through the actor's field of view. */
export type MapWallMemory = ObservedMapWall;

/** Remembered obstacle collection available to map-memory consumers. */
export type MapObstacleMemory = ObservedMapObstacleSet;

/** Visible map cell produced by the current frame's map perception. */
export type MapAreaCell = ObservedMapAreaCell;

/** Durable remembered map cell with first/last observation metadata. */
export type MapAreaMemory = TemporalRecordBase & {
  cellX: number;
  cellZ: number;
  center?: VectorXZ;
  vertices: VectorXZ[];
};

/** Chaser map model split into persistent knowledge and recency memory. */
export type MapShapeMemory = {
  obstacles: MapObstacleMemory;
  observedWallIds: string[];
  knownAreas: MapAreaMemory[];
  knownAreaIds: string[];
  knownAreaObservationCount: number;
  recentlyObservedAreas: MapAreaMemory[];
  recentlyObservedAreaIds: string[];
  recentVisitationMaxAgeFrames: number;
  observationCount: number;
  lastObservationFrame: MemoryFrameIndex;
};

/** Current-frame trusted map facts from the actor's observation source. */
export type MapPerception = ObservedMap;

/** Creates empty chaser map memory. */
export function createMapShapeMemory(): MapShapeMemory {
  return {
    obstacles: { walls: [] },
    observedWallIds: [],
    knownAreas: [],
    knownAreaIds: [],
    knownAreaObservationCount: 0,
    recentlyObservedAreas: [],
    recentlyObservedAreaIds: [],
    recentVisitationMaxAgeFrames: RECENT_VISITATION_MAX_AGE_FRAMES,
    observationCount: 0,
    lastObservationFrame: null,
  };
}

function getRecentVisitationMaxAgeFrames(
  mapShapeMemory: Pick<MapShapeMemory, "recentVisitationMaxAgeFrames"> | null | undefined,
): number {
  const maxAgeFrames = Number(mapShapeMemory?.recentVisitationMaxAgeFrames);
  return Number.isFinite(maxAgeFrames) && maxAgeFrames >= 0
    ? maxAgeFrames
    : RECENT_VISITATION_MAX_AGE_FRAMES;
}

/** Converts a visible cell into a durable temporal memory record. */
function createMapAreaMemory(cell: MapAreaCell, frameIndex: MemoryFrameIndex): MapAreaMemory {
  return createTemporalRecord(
    cell.id,
    {
      cellX: cell.cellX,
      cellZ: cell.cellZ,
      center: { ...cell.center },
      vertices: cell.vertices.map((vertex) => ({ ...vertex })),
    },
    frameIndex,
  );
}

/** Applies the recency window without deleting persistent map knowledge. */
function pruneRecentlyObservedAreas(mapShapeMemory: MapShapeMemory, frameIndex: unknown): void {
  const currentFrame = normalizeMemoryFrameIndex(frameIndex);
  if (currentFrame === null) {
    return;
  }
  const maxAgeFrames = getRecentVisitationMaxAgeFrames(mapShapeMemory);
  mapShapeMemory.recentlyObservedAreas = applyRetentionPolicy(
    mapShapeMemory.recentlyObservedAreas ?? [],
    {
      currentFrameIndex: currentFrame,
      getFrameIndex: (area) => area.lastObservedFrame,
      retentionPolicy: { maxAgeFrames },
    },
  );
  mapShapeMemory.recentlyObservedAreaIds = mapShapeMemory.recentlyObservedAreas
    .map((area) => area.id);
}

/** Merges a map perception frame into persistent and recent map memory. */
export function updateMapShapeMemory(
  mapShapeMemory: MapShapeMemory | null | undefined,
  mapPerception: Partial<MapPerception> | null | undefined,
  frameIndex: unknown = null,
): MapShapeMemory | null {
  if (!mapShapeMemory) {
    return null;
  }

  const visibleWalls = Array.isArray(mapPerception?.visibleWalls)
    ? mapPerception.visibleWalls
    : [];
  const visibleAreaCells = Array.isArray(mapPerception?.visibleArea?.cells)
    ? mapPerception.visibleArea.cells
    : [];
  if (visibleWalls.length === 0 && visibleAreaCells.length === 0) {
    pruneRecentlyObservedAreas(mapShapeMemory, frameIndex);
    return mapShapeMemory;
  }

  const wallsById = new Map(
    (mapShapeMemory.obstacles?.walls ?? []).map((wall) => [wall.id, wall]),
  );
  for (const entry of visibleWalls) {
    if (!entry?.wall?.id) {
      continue;
    }
    wallsById.set(entry.wall.id, { ...entry.wall });
  }

  mapShapeMemory.obstacles = { walls: [...wallsById.values()] };
  mapShapeMemory.observedWallIds = mapShapeMemory.obstacles.walls.map((wall) => wall.id);

  if (visibleAreaCells.length > 0) {
    const currentFrame = normalizeMemoryFrameIndex(frameIndex);
    const observedAreas = visibleAreaCells.map((cell) =>
      createMapAreaMemory(cell, currentFrame));

    mapShapeMemory.knownAreas = upsertTemporalRecords(
      mapShapeMemory.knownAreas ?? [],
      observedAreas,
      { frameIndex: currentFrame },
    ).sort((first, second) =>
      first.id.localeCompare(second.id));
    mapShapeMemory.knownAreaIds = mapShapeMemory.knownAreas.map((area) => area.id);

    mapShapeMemory.recentlyObservedAreas = upsertTemporalRecords(
      mapShapeMemory.recentlyObservedAreas ?? [],
      observedAreas,
      { frameIndex: currentFrame },
    ).sort(
      (first, second) => first.id.localeCompare(second.id),
    );
    mapShapeMemory.recentlyObservedAreaIds = mapShapeMemory.recentlyObservedAreas.map((area) =>
      area.id);
    mapShapeMemory.knownAreaObservationCount =
      (Number(mapShapeMemory.knownAreaObservationCount) || 0) + visibleAreaCells.length;
  }

  pruneRecentlyObservedAreas(mapShapeMemory, frameIndex);
  mapShapeMemory.observationCount =
    (Number(mapShapeMemory.observationCount) || 0) + visibleWalls.length + visibleAreaCells.length;
  mapShapeMemory.lastObservationFrame = normalizeMemoryFrameIndex(frameIndex);
  return mapShapeMemory;
}
