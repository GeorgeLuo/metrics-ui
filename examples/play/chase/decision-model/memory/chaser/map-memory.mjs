import { FIELD_OF_VIEW_DISTANCE } from "../../../config/constants.mjs";
import {
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../core/math.mjs";
import {
  getFieldBounds,
  getGroundBounds,
  getWallBounds,
  isLineOfSightBlockedByObstacles,
} from "../../../world/world.mjs";

export const KNOWN_AREA_CELL_SIZE = 0.3;
export const RECENT_VISITATION_MAX_AGE_FRAMES = 600;

export function createMapShapeMemory() {
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

function getObstacleWalls(obstacles) {
  return Array.isArray(obstacles?.walls) ? obstacles.walls : [];
}

function getWallId(wall, index) {
  return wall?.id ?? `obstacle-${index + 1}`;
}

function cloneObservedWall(wall, index) {
  return {
    id: getWallId(wall, index),
    x: Number(wall?.x) || 0,
    z: Number(wall?.z) || 0,
    width: Math.max(0, Number(wall?.width) || 0),
    depth: Math.max(0, Number(wall?.depth) || 0),
  };
}

function getWallSamplePoints(wall) {
  const bounds = getWallBounds(wall);
  return [
    { x: wall.x, z: wall.z },
    { x: bounds.minX, z: bounds.minZ },
    { x: bounds.minX, z: bounds.maxZ },
    { x: bounds.maxX, z: bounds.minZ },
    { x: bounds.maxX, z: bounds.maxZ },
    { x: wall.x, z: bounds.minZ },
    { x: wall.x, z: bounds.maxZ },
    { x: bounds.minX, z: wall.z },
    { x: bounds.maxX, z: wall.z },
  ];
}

function getPointPerception(
  actorPosition,
  point,
  actorLookDirection,
  fieldOfViewAngleRadians,
) {
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
  actorPosition,
  samplePoint,
  obstacles,
  observedWallId,
) {
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
  actorPosition,
  wall,
  wallId,
  actorLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  let nearestVisibleSample = null;

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

function getCoverageBounds(actorPosition, columns, rows) {
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

function getCellVertices(cellX, cellZ) {
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

function createKnownAreaCell(cellX, cellZ) {
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
  actorPosition,
  point,
  actorLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  return getPointPerception(
    actorPosition,
    point,
    actorLookDirection,
    fieldOfViewAngleRadians,
  ).visible
    && !isLineOfSightBlockedByObstacles(actorPosition, point, obstacles);
}

function getVisibleKnownAreaCells(
  actorPosition,
  actorLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
  {
    columns,
    rows,
  } = {},
) {
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
  const cells = [];

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

export function getMapShapePerception(
  actorPosition,
  actorLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
  worldContext = {},
) {
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

function getRecentVisitationMaxAgeFrames(mapShapeMemory) {
  const maxAgeFrames = Number(mapShapeMemory?.recentVisitationMaxAgeFrames);
  return Number.isFinite(maxAgeFrames) && maxAgeFrames >= 0
    ? maxAgeFrames
    : RECENT_VISITATION_MAX_AGE_FRAMES;
}

function getCurrentFrame(frameIndex) {
  return Number.isFinite(frameIndex) ? frameIndex : null;
}

function pruneRecentlyObservedAreas(mapShapeMemory, frameIndex) {
  const currentFrame = getCurrentFrame(frameIndex);
  if (currentFrame === null) {
    return;
  }
  const maxAgeFrames = getRecentVisitationMaxAgeFrames(mapShapeMemory);
  mapShapeMemory.recentlyObservedAreas = (mapShapeMemory.recentlyObservedAreas ?? [])
    .filter((area) =>
      Number.isFinite(area?.lastObservedFrame)
      && currentFrame - area.lastObservedFrame <= maxAgeFrames);
  mapShapeMemory.recentlyObservedAreaIds = mapShapeMemory.recentlyObservedAreas
    .map((area) => area.id);
}

export function updateMapShapeMemory(
  mapShapeMemory,
  mapPerception,
  frameIndex = null,
) {
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
    const currentFrame = getCurrentFrame(frameIndex);
    const knownAreasById = new Map((mapShapeMemory.knownAreas ?? []).map((area) => [
      area.id,
      area,
    ]));
    const recentlyObservedAreasById = new Map(
      (mapShapeMemory.recentlyObservedAreas ?? []).map((area) => [area.id, area]),
    );

    for (const cell of visibleAreaCells) {
      const vertices = cell.vertices.map((vertex) => ({ ...vertex }));
      const existingKnownArea = knownAreasById.get(cell.id);
      knownAreasById.set(cell.id, {
        id: cell.id,
        cellX: cell.cellX,
        cellZ: cell.cellZ,
        firstObservedFrame: existingKnownArea?.firstObservedFrame ?? currentFrame,
        lastObservedFrame: currentFrame,
        vertices,
      });
      recentlyObservedAreasById.set(cell.id, {
        id: cell.id,
        cellX: cell.cellX,
        cellZ: cell.cellZ,
        lastObservedFrame: currentFrame,
        vertices,
      });
    }

    mapShapeMemory.knownAreas = [...knownAreasById.values()].sort((first, second) =>
      first.id.localeCompare(second.id));
    mapShapeMemory.knownAreaIds = mapShapeMemory.knownAreas.map((area) => area.id);
    mapShapeMemory.recentlyObservedAreas = [...recentlyObservedAreasById.values()].sort(
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
  mapShapeMemory.lastObservationFrame = Number.isFinite(frameIndex) ? frameIndex : null;
  return mapShapeMemory;
}
