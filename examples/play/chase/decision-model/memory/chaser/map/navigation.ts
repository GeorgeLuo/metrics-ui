/**
 * Route and geometry queries over chaser map memory.
 *
 * This file does not own map facts; it interprets remembered cells and walls
 * for knowledge-acquisition actions.
 */
import {
  CAR_BOUND_RADIUS,
  FIELD_OF_VIEW_DISTANCE,
} from "../../../../config/constants.mjs";
import {
  KNOWN_AREA_CELL_SIZE,
  type BoundsXZ,
  type MapAreaMemory,
  type MapObstacleMemory,
} from "./memory.ts";
import { getFieldBounds, getGroundBounds, getWallBounds } from "../../../../world/world.mjs";
import type { VectorXZ } from "../../../core/math.ts";

const CARDINAL_OFFSETS = Object.freeze([
  { x: 0, z: -1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
]);

type MapCell = {
  cellX: number;
  cellZ: number;
};

/** Route through remembered traversable cells. */
type KnownMapRoute = {
  reachable: true;
  areaIds: string[];
  waypoints: VectorXZ[];
  cost: number;
};

/** Lookup keyed by `MapAreaMemory.id` for remembered map cells. */
type KnownAreaLookup = Map<string, MapAreaMemory>;

/** Builds the stable id used for remembered map cells. */
export function getMapCellId(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`;
}

/** Converts integer cell coordinates into the cell center in world space. */
export function getMapCellCenter(cellX: number, cellZ: number): VectorXZ {
  return {
    x: (cellX + 0.5) * KNOWN_AREA_CELL_SIZE,
    z: (cellZ + 0.5) * KNOWN_AREA_CELL_SIZE,
  };
}

/** Converts a world position into the containing remembered map cell. */
export function getMapCellForPosition(position: Partial<VectorXZ> | null | undefined): MapCell | null {
  if (!position) {
    return null;
  }
  const x = Number(position.x);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  return {
    cellX: Math.floor(x / KNOWN_AREA_CELL_SIZE),
    cellZ: Math.floor(z / KNOWN_AREA_CELL_SIZE),
  };
}

/** Tests whether a world position is inside x/z bounds. */
export function isPositionInsideBounds(position: VectorXZ, bounds: BoundsXZ): boolean {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

/** Returns remembered wall bounds inflated by optional padding. */
export function getRememberedWallBounds(
  obstacles: Partial<MapObstacleMemory> | null | undefined,
  padding = 0,
): BoundsXZ[] {
  return (Array.isArray(obstacles?.walls) ? obstacles.walls : []).map((wall) =>
    getWallBounds(wall, padding));
}

/** Tests whether a remembered map cell is blocked by remembered walls. */
export function isMapCellInsideRememberedWall(
  cellX: number,
  cellZ: number,
  obstacles: Partial<MapObstacleMemory> | null | undefined,
  padding = CAR_BOUND_RADIUS,
): boolean {
  const center = getMapCellCenter(cellX, cellZ);
  return getRememberedWallBounds(obstacles, padding).some((bounds) =>
    isPositionInsideBounds(center, bounds));
}

/** Resolves a remembered area's world center, deriving it if needed. */
function getAreaCenter(area: MapAreaMemory): VectorXZ {
  return area.center ?? getMapCellCenter(area.cellX, area.cellZ);
}

/** Returns traversable bounds from the configured world or remembered cells. */
export function getGroundBoundsOrMemoryBounds(
  columns?: number,
  rows?: number,
  knownAreas: MapAreaMemory[] = [],
): BoundsXZ {
  if (Number.isFinite(columns) && Number.isFinite(rows)) {
    return getGroundBounds(columns, rows);
  }
  if (knownAreas.length === 0) {
    return {
      minX: -FIELD_OF_VIEW_DISTANCE,
      maxX: FIELD_OF_VIEW_DISTANCE,
      minZ: -FIELD_OF_VIEW_DISTANCE,
      maxZ: FIELD_OF_VIEW_DISTANCE,
    };
  }
  return knownAreas.reduce((bounds, area) => ({
    minX: Math.min(bounds.minX, getAreaCenter(area).x),
    maxX: Math.max(bounds.maxX, getAreaCenter(area).x),
    minZ: Math.min(bounds.minZ, getAreaCenter(area).z),
    maxZ: Math.max(bounds.maxZ, getAreaCenter(area).z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
}

/** Returns full field bounds from the configured world or remembered cells. */
export function getFieldBoundsOrMemoryBounds(
  columns?: number,
  rows?: number,
  knownAreas: MapAreaMemory[] = [],
): BoundsXZ {
  if (Number.isFinite(columns) && Number.isFinite(rows)) {
    return getFieldBounds(columns, rows);
  }
  if (knownAreas.length === 0) {
    return {
      minX: -FIELD_OF_VIEW_DISTANCE,
      maxX: FIELD_OF_VIEW_DISTANCE,
      minZ: -FIELD_OF_VIEW_DISTANCE,
      maxZ: FIELD_OF_VIEW_DISTANCE,
    };
  }
  return knownAreas.reduce((bounds, area) => ({
    minX: Math.min(bounds.minX, getAreaCenter(area).x),
    maxX: Math.max(bounds.maxX, getAreaCenter(area).x),
    minZ: Math.min(bounds.minZ, getAreaCenter(area).z),
    maxZ: Math.max(bounds.maxZ, getAreaCenter(area).z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
}

function getCellDistance(first: MapCell, second: MapCell): number {
  return Math.abs(first.cellX - second.cellX) + Math.abs(first.cellZ - second.cellZ);
}

function getPositionDistance(first: VectorXZ, second: VectorXZ): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function isMapCellTraversable(
  cellX: number,
  cellZ: number,
  obstacles: Partial<MapObstacleMemory> | null | undefined,
  bounds: BoundsXZ | null = null,
): boolean {
  const center = getMapCellCenter(cellX, cellZ);
  return (!bounds || isPositionInsideBounds(center, bounds))
    && !isMapCellInsideRememberedWall(cellX, cellZ, obstacles);
}

/** Finds the nearest traversable remembered cell for an arbitrary position. */
function getNearestKnownArea(
  knownAreasById: KnownAreaLookup,
  position: Partial<VectorXZ> | null | undefined,
  obstacles: Partial<MapObstacleMemory> | null | undefined,
  bounds: BoundsXZ | null = null,
): MapAreaMemory | null {
  const positionCell = getMapCellForPosition(position);
  if (!positionCell) {
    return null;
  }
  const exactArea = knownAreasById.get(getMapCellId(positionCell.cellX, positionCell.cellZ));
  if (
    exactArea
    && isMapCellTraversable(exactArea.cellX, exactArea.cellZ, obstacles, bounds)
  ) {
    return exactArea;
  }
  return [...knownAreasById.values()]
    .filter((area) => isMapCellTraversable(area.cellX, area.cellZ, obstacles, bounds))
    .sort((first, second) =>
      getPositionDistance(getAreaCenter(first), position as VectorXZ)
        - getPositionDistance(getAreaCenter(second), position as VectorXZ)
      || first.id.localeCompare(second.id))
    [0] ?? null;
}

/** Creates a stable lookup from remembered area records. */
function createKnownAreaLookup(knownAreas: MapAreaMemory[] | null | undefined): KnownAreaLookup {
  return new Map((Array.isArray(knownAreas) ? knownAreas : [])
    .filter((area) => area?.id)
    .map((area) => [area.id, area]));
}

/** Returns cardinal neighbors that are both remembered and traversable. */
function getTraversableKnownNeighbors(
  area: MapAreaMemory,
  knownAreasById: KnownAreaLookup,
  obstacles: Partial<MapObstacleMemory> | null | undefined,
  bounds: BoundsXZ | null = null,
): MapAreaMemory[] {
  return CARDINAL_OFFSETS
    .map((offset) => {
      const cellX = area.cellX + offset.x;
      const cellZ = area.cellZ + offset.z;
      if (!isMapCellTraversable(cellX, cellZ, obstacles, bounds)) {
        return null;
      }
      return knownAreasById.get(getMapCellId(cellX, cellZ)) ?? null;
    })
    .filter((neighbor): neighbor is MapAreaMemory => Boolean(neighbor));
}

/** Reconstructs a route from a predecessor map produced by graph search. */
function reconstructRoute(
  cameFrom: Map<string, string>,
  knownAreasById: KnownAreaLookup,
  targetId: string,
): MapAreaMemory[] {
  const route: MapAreaMemory[] = [];
  let currentId: string | null = targetId;
  while (currentId) {
    const area = knownAreasById.get(currentId);
    if (!area) {
      break;
    }
    route.push(area);
    currentId = cameFrom.get(currentId) ?? null;
  }
  return route.reverse();
}

/** Precomputes reachable routes through remembered traversable cells. */
export function createKnownMapRouteIndex({
  knownAreas,
  obstacles,
  startPosition,
  bounds = null,
}: {
  knownAreas?: MapAreaMemory[];
  obstacles?: Partial<MapObstacleMemory> | null;
  startPosition?: Partial<VectorXZ> | null;
  bounds?: BoundsXZ | null;
} = {}): {
  getRouteToArea: (targetArea?: MapAreaMemory | null) => KnownMapRoute | null;
} {
  const knownAreasById = createKnownAreaLookup(knownAreas);
  const startArea = getNearestKnownArea(knownAreasById, startPosition, obstacles, bounds);
  if (
    !startArea
    || !isMapCellTraversable(startArea.cellX, startArea.cellZ, obstacles, bounds)
  ) {
    return {
      getRouteToArea: () => null,
    };
  }

  const queue = [startArea.id];
  const visitedIds = new Set([startArea.id]);
  const cameFrom = new Map<string, string>();
  const costById = new Map([[startArea.id, 0]]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const currentId = queue[queueIndex];
    const currentArea = knownAreasById.get(currentId);
    if (!currentArea) {
      continue;
    }
    for (const neighbor of getTraversableKnownNeighbors(
      currentArea,
      knownAreasById,
      obstacles,
      bounds,
    )) {
      if (visitedIds.has(neighbor.id)) {
        continue;
      }
      visitedIds.add(neighbor.id);
      cameFrom.set(neighbor.id, currentId);
      costById.set(neighbor.id, (costById.get(currentId) ?? 0) + 1);
      queue.push(neighbor.id);
    }
  }

  return {
    getRouteToArea: (targetArea) => {
      if (!targetArea?.id || !visitedIds.has(targetArea.id)) {
        return null;
      }
      const areas = reconstructRoute(cameFrom, knownAreasById, targetArea.id);
      return {
        reachable: true,
        areaIds: areas.map((area) => area.id),
        waypoints: areas.map((area) => ({ ...getAreaCenter(area) })),
        cost: costById.get(targetArea.id) ?? 0,
      };
    },
  };
}

/** Finds one route through remembered traversable cells to a target area. */
export function findKnownMapRoute({
  knownAreas,
  obstacles,
  startPosition,
  targetArea,
  bounds = null,
}: {
  knownAreas?: MapAreaMemory[];
  obstacles?: Partial<MapObstacleMemory> | null;
  startPosition?: Partial<VectorXZ> | null;
  targetArea?: MapAreaMemory | null;
  bounds?: BoundsXZ | null;
} = {}): KnownMapRoute | null {
  if (!startPosition || !targetArea?.id) {
    return null;
  }
  const knownAreasById = createKnownAreaLookup(knownAreas);
  const startArea = getNearestKnownArea(knownAreasById, startPosition, obstacles, bounds);
  const target = knownAreasById.get(targetArea.id);
  if (!startArea || !target) {
    return null;
  }
  if (
    !isMapCellTraversable(startArea.cellX, startArea.cellZ, obstacles, bounds)
    || !isMapCellTraversable(target.cellX, target.cellZ, obstacles, bounds)
  ) {
    return null;
  }

  const openIds = new Set([startArea.id]);
  const closedIds = new Set();
  const cameFrom = new Map<string, string>();
  const gScore = new Map([[startArea.id, 0]]);
  const fScore = new Map([[startArea.id, getCellDistance(startArea, target)]]);

  while (openIds.size > 0) {
    const currentId = [...openIds].sort((first, second) =>
      (fScore.get(first) ?? Number.POSITIVE_INFINITY)
        - (fScore.get(second) ?? Number.POSITIVE_INFINITY)
      || first.localeCompare(second))[0];
    const currentArea = knownAreasById.get(currentId);
    if (!currentArea) {
      openIds.delete(currentId);
      continue;
    }
    if (currentId === target.id) {
      const areas = reconstructRoute(cameFrom, knownAreasById, currentId);
      return {
        reachable: true,
        areaIds: areas.map((area) => area.id),
        waypoints: areas.map((area) => ({ ...getAreaCenter(area) })),
        cost: gScore.get(currentId) ?? 0,
      };
    }

    openIds.delete(currentId);
    closedIds.add(currentId);
    for (const neighbor of getTraversableKnownNeighbors(
      currentArea,
      knownAreasById,
      obstacles,
      bounds,
    )) {
      if (closedIds.has(neighbor.id)) {
        continue;
      }
      const tentativeGScore = (gScore.get(currentId) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentativeGScore >= (gScore.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }
      cameFrom.set(neighbor.id, currentId);
      gScore.set(neighbor.id, tentativeGScore);
      fScore.set(neighbor.id, tentativeGScore + getCellDistance(neighbor, target));
      openIds.add(neighbor.id);
    }
  }

  return null;
}
