import {
  CAR_BOUND_RADIUS,
  FIELD_OF_VIEW_DISTANCE,
} from "../../../config/constants.mjs";
import { KNOWN_AREA_CELL_SIZE } from "./map-memory.mjs";
import { getFieldBounds, getGroundBounds, getWallBounds } from "../../../world/world.mjs";

const CARDINAL_OFFSETS = Object.freeze([
  { x: 0, z: -1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
]);

export function getMapCellId(cellX, cellZ) {
  return `${cellX}:${cellZ}`;
}

export function getMapCellCenter(cellX, cellZ) {
  return {
    x: (cellX + 0.5) * KNOWN_AREA_CELL_SIZE,
    z: (cellZ + 0.5) * KNOWN_AREA_CELL_SIZE,
  };
}

export function getMapCellForPosition(position) {
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

export function isPositionInsideBounds(position, bounds) {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

export function getRememberedWallBounds(obstacles, padding = 0) {
  return (Array.isArray(obstacles?.walls) ? obstacles.walls : []).map((wall) =>
    getWallBounds(wall, padding));
}

export function isMapCellInsideRememberedWall(cellX, cellZ, obstacles, padding = CAR_BOUND_RADIUS) {
  const center = getMapCellCenter(cellX, cellZ);
  return getRememberedWallBounds(obstacles, padding).some((bounds) =>
    isPositionInsideBounds(center, bounds));
}

export function getGroundBoundsOrMemoryBounds(columns, rows, knownAreas = []) {
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
    minX: Math.min(bounds.minX, area.center.x),
    maxX: Math.max(bounds.maxX, area.center.x),
    minZ: Math.min(bounds.minZ, area.center.z),
    maxZ: Math.max(bounds.maxZ, area.center.z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
}

export function getFieldBoundsOrMemoryBounds(columns, rows, knownAreas = []) {
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
    minX: Math.min(bounds.minX, area.center.x),
    maxX: Math.max(bounds.maxX, area.center.x),
    minZ: Math.min(bounds.minZ, area.center.z),
    maxZ: Math.max(bounds.maxZ, area.center.z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
}

function getCellDistance(first, second) {
  return Math.abs(first.cellX - second.cellX) + Math.abs(first.cellZ - second.cellZ);
}

function getPositionDistance(first, second) {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function isMapCellTraversable(cellX, cellZ, obstacles, bounds = null) {
  const center = getMapCellCenter(cellX, cellZ);
  return (!bounds || isPositionInsideBounds(center, bounds))
    && !isMapCellInsideRememberedWall(cellX, cellZ, obstacles);
}

function getNearestKnownArea(knownAreasById, position, obstacles, bounds = null) {
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
      getPositionDistance(first.center, position) - getPositionDistance(second.center, position)
      || first.id.localeCompare(second.id))
    [0] ?? null;
}

function createKnownAreaLookup(knownAreas) {
  return new Map((Array.isArray(knownAreas) ? knownAreas : [])
    .filter((area) => area?.id)
    .map((area) => [area.id, area]));
}

function getTraversableKnownNeighbors(area, knownAreasById, obstacles, bounds = null) {
  return CARDINAL_OFFSETS
    .map((offset) => {
      const cellX = area.cellX + offset.x;
      const cellZ = area.cellZ + offset.z;
      if (!isMapCellTraversable(cellX, cellZ, obstacles, bounds)) {
        return null;
      }
      return knownAreasById.get(getMapCellId(cellX, cellZ)) ?? null;
    })
    .filter(Boolean);
}

function reconstructRoute(cameFrom, knownAreasById, targetId) {
  const route = [];
  let currentId = targetId;
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

export function createKnownMapRouteIndex({
  knownAreas,
  obstacles,
  startPosition,
  bounds = null,
} = {}) {
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
  const cameFrom = new Map();
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
        waypoints: areas.map((area) => ({ ...area.center })),
        cost: costById.get(targetArea.id) ?? 0,
      };
    },
  };
}

export function findKnownMapRoute({
  knownAreas,
  obstacles,
  startPosition,
  targetArea,
  bounds = null,
} = {}) {
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
  const cameFrom = new Map();
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
        waypoints: areas.map((area) => ({ ...area.center })),
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
