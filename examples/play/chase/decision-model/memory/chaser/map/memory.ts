/**
 * Chaser map memory construction from field-of-view observations.
 *
 * Persistent knowledge and recency are deliberately separate: `knownAreas`
 * retains map facts, while `recentlyObservedAreas` ages by frame.
 */
import { FIELD_OF_VIEW_DISTANCE } from "../../../../config/constants.mjs";
import {
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
  type VectorXZ,
} from "../../../core/math.ts";
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
import {
  getFieldBounds,
  getWallBounds,
  isLineOfSightBlockedByObstacles,
} from "../../../../world/world.mjs";

/** Side length for remembered map-area cells in world units. */
export const KNOWN_AREA_CELL_SIZE = 0.3;
/** Default frame age before an area is no longer considered recently seen. */
export const RECENT_VISITATION_MAX_AGE_FRAMES = 600;

/** Axis-aligned x/z bounds for remembered or configured map space. */
export type BoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/** Remembered obstacle wall observed through the actor's field of view. */
export type MapWallMemory = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
};

/** Remembered obstacle collection available to map-memory consumers. */
export type MapObstacleMemory = {
  walls: MapWallMemory[];
};

/** Visible map cell produced by the current frame's map perception. */
export type MapAreaCell = {
  id: string;
  cellX: number;
  cellZ: number;
  center: VectorXZ;
  vertices: VectorXZ[];
};

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

type WorldContext = {
  columns?: number;
  rows?: number;
};

/** Current-frame map facts visible from the actor's pose. */
type MapPerception = {
  visibleWalls: Array<{
    wall: MapWallMemory;
    sample: {
      point: VectorXZ;
      bearingRadians: number;
      distance: number;
    };
  }>;
  visibleArea: {
    cells: MapAreaCell[];
    observationCount: number;
  };
  observationCount: number;
};

/** Visibility result for a sampled point on a wall or area cell. */
type PointPerception =
  | { visible: false }
  | { visible: true; bearingRadians: number; distance: number };

/** Partial obstacle input from the world or remembered obstacle memory. */
type ObstacleLike = {
  walls?: Array<Partial<MapWallMemory>>;
};

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

function getObstacleWalls(obstacles: ObstacleLike | null | undefined): Array<Partial<MapWallMemory>> {
  return Array.isArray(obstacles?.walls) ? obstacles.walls : [];
}

function getWallId(wall: Partial<MapWallMemory> | null | undefined, index: number): string {
  return wall?.id ?? `obstacle-${index + 1}`;
}

function cloneObservedWall(wall: Partial<MapWallMemory>, index: number): MapWallMemory {
  return {
    id: getWallId(wall, index),
    x: Number(wall?.x) || 0,
    z: Number(wall?.z) || 0,
    width: Math.max(0, Number(wall?.width) || 0),
    depth: Math.max(0, Number(wall?.depth) || 0),
  };
}

function getWallSamplePoints(wall: Partial<MapWallMemory>): VectorXZ[] {
  const bounds = getWallBounds(wall);
  return [
    { x: Number(wall.x) || 0, z: Number(wall.z) || 0 },
    { x: bounds.minX, z: bounds.minZ },
    { x: bounds.minX, z: bounds.maxZ },
    { x: bounds.maxX, z: bounds.minZ },
    { x: bounds.maxX, z: bounds.maxZ },
    { x: Number(wall.x) || 0, z: bounds.minZ },
    { x: Number(wall.x) || 0, z: bounds.maxZ },
    { x: bounds.minX, z: Number(wall.z) || 0 },
    { x: bounds.maxX, z: Number(wall.z) || 0 },
  ];
}

function getPointPerception(
  actorPosition: VectorXZ | null | undefined,
  point: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
): PointPerception {
  if (!actorPosition || !point || !actorLookDirection) {
    return { visible: false };
  }

  const offsetX = point.x - actorPosition.x;
  const offsetZ = point.z - actorPosition.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance <= 0.000001) {
    return { visible: true, bearingRadians: 0, distance };
  }

  const pointDirection = normalizeVector(offsetX, offsetZ);
  const bearingRadians = normalizeAngleDelta(
    vectorToAngle(pointDirection) - vectorToAngle(actorLookDirection),
  );
  const visible = distance <= FIELD_OF_VIEW_DISTANCE
    && Math.abs(bearingRadians) <= fieldOfViewAngleRadians / 2;

  return visible
    ? { visible: true, bearingRadians, distance }
    : { visible: false };
}

function isSampleOccludedByOtherWalls(
  actorPosition: VectorXZ,
  samplePoint: VectorXZ,
  obstacles: ObstacleLike | null | undefined,
  observedWallId: string,
): boolean {
  const blockingWalls = getObstacleWalls(obstacles).filter((wall, index) =>
    getWallId(wall, index) !== observedWallId,
  );
  return blockingWalls.length > 0
    && isLineOfSightBlockedByObstacles(
      actorPosition,
      samplePoint,
      { walls: blockingWalls },
    );
}

function getVisibleWallSample(
  actorPosition: VectorXZ,
  wall: Partial<MapWallMemory>,
  wallId: string,
  actorLookDirection: VectorXZ,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
): MapPerception["visibleWalls"][number]["sample"] | null {
  let nearestVisibleSample: MapPerception["visibleWalls"][number]["sample"] | null = null;

  for (const samplePoint of getWallSamplePoints(wall)) {
    const samplePerception = getPointPerception(
      actorPosition,
      samplePoint,
      actorLookDirection,
      fieldOfViewAngleRadians,
    );
    if (!samplePerception.visible) {
      continue;
    }
    if (isSampleOccludedByOtherWalls(actorPosition, samplePoint, obstacles, wallId)) {
      continue;
    }
    if (
      !nearestVisibleSample
      || samplePerception.distance < nearestVisibleSample.distance
    ) {
      nearestVisibleSample = {
        point: { ...samplePoint },
        bearingRadians: samplePerception.bearingRadians,
        distance: samplePerception.distance,
      };
    }
  }

  return nearestVisibleSample;
}

function getCoverageBounds(
  actorPosition: VectorXZ,
  columns?: number,
  rows?: number,
): BoundsXZ {
  if (Number.isFinite(columns) && Number.isFinite(rows)) {
    return getFieldBounds(columns, rows);
  }
  return {
    minX: actorPosition.x - FIELD_OF_VIEW_DISTANCE,
    maxX: actorPosition.x + FIELD_OF_VIEW_DISTANCE,
    minZ: actorPosition.z - FIELD_OF_VIEW_DISTANCE,
    maxZ: actorPosition.z + FIELD_OF_VIEW_DISTANCE,
  };
}

function getCellVertices(cellX: number, cellZ: number): VectorXZ[] {
  const minX = cellX * KNOWN_AREA_CELL_SIZE;
  const minZ = cellZ * KNOWN_AREA_CELL_SIZE;
  const maxX = minX + KNOWN_AREA_CELL_SIZE;
  const maxZ = minZ + KNOWN_AREA_CELL_SIZE;
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
}

function createKnownAreaCell(cellX: number, cellZ: number): MapAreaCell {
  return {
    id: `${cellX}:${cellZ}`,
    cellX,
    cellZ,
    center: {
      x: (cellX + 0.5) * KNOWN_AREA_CELL_SIZE,
      z: (cellZ + 0.5) * KNOWN_AREA_CELL_SIZE,
    },
    vertices: getCellVertices(cellX, cellZ),
  };
}

function isPointVisibleThroughMap(
  actorPosition: VectorXZ,
  point: VectorXZ,
  actorLookDirection: VectorXZ,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
): boolean {
  return getPointPerception(
    actorPosition,
    point,
    actorLookDirection,
    fieldOfViewAngleRadians,
  ).visible
    && !isLineOfSightBlockedByObstacles(actorPosition, point, obstacles);
}

/**
 * Samples the field into visible remembered-area cells for this frame.
 */
function getVisibleKnownAreaCells(
  actorPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
  {
    columns,
    rows,
  }: WorldContext = {},
): MapAreaCell[] {
  if (!actorPosition || !actorLookDirection || !Number.isFinite(fieldOfViewAngleRadians)) {
    return [];
  }

  const bounds = getCoverageBounds(actorPosition, columns, rows);
  const minCellX = Math.floor(Math.max(
    bounds.minX,
    actorPosition.x - FIELD_OF_VIEW_DISTANCE,
  ) / KNOWN_AREA_CELL_SIZE);
  const maxCellX = Math.floor(Math.min(
    bounds.maxX,
    actorPosition.x + FIELD_OF_VIEW_DISTANCE,
  ) / KNOWN_AREA_CELL_SIZE);
  const minCellZ = Math.floor(Math.max(
    bounds.minZ,
    actorPosition.z - FIELD_OF_VIEW_DISTANCE,
  ) / KNOWN_AREA_CELL_SIZE);
  const maxCellZ = Math.floor(Math.min(
    bounds.maxZ,
    actorPosition.z + FIELD_OF_VIEW_DISTANCE,
  ) / KNOWN_AREA_CELL_SIZE);
  const cells: MapAreaCell[] = [];

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const cell = createKnownAreaCell(cellX, cellZ);
      if (
        cell.center.x < bounds.minX
        || cell.center.x > bounds.maxX
        || cell.center.z < bounds.minZ
        || cell.center.z > bounds.maxZ
      ) {
        continue;
      }
      if (
        isPointVisibleThroughMap(
          actorPosition,
          cell.center,
          actorLookDirection,
          fieldOfViewAngleRadians,
          obstacles,
        )
      ) {
        cells.push(cell);
      }
    }
  }

  return cells;
}

/** Builds the current frame's visible map facts from FOV and occlusion. */
export function getMapShapePerception(
  actorPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
  worldContext: WorldContext = {},
): MapPerception {
  if (!actorPosition || !actorLookDirection) {
    return {
      visibleWalls: [],
      visibleArea: { cells: [], observationCount: 0 },
      observationCount: 0,
    };
  }

  const visibleWalls = getObstacleWalls(obstacles).flatMap((wall, index) => {
    const id = getWallId(wall, index);
    const visibleSample = getVisibleWallSample(
      actorPosition,
      wall,
      id,
      actorLookDirection,
      fieldOfViewAngleRadians,
      obstacles,
    );
    return visibleSample
      ? [{
        wall: cloneObservedWall(wall, index),
        sample: visibleSample,
      }]
      : [];
  });
  const visibleAreaCells = getVisibleKnownAreaCells(
    actorPosition,
    actorLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
    worldContext,
  );

  return {
    visibleWalls,
    visibleArea: {
      cells: visibleAreaCells,
      observationCount: visibleAreaCells.length,
    },
    observationCount: visibleWalls.length + visibleAreaCells.length,
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
