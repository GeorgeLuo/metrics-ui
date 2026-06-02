import {
  CHASER_MAP_OBSERVATION_CELL_SIZE,
  FIELD_OF_VIEW_DISTANCE,
} from "../../config/constants.mjs";
import type { VectorXZ } from "../../decision-model/core/math.ts";
import {
  type ObservedMapAreaCell,
} from "../../decision-model/observer-world/interfaces.ts";
import {
  getCoverageBounds,
  isPointVisibleThroughMap,
  type ObstacleLike,
  type WorldContext,
} from "./map-geometry.ts";

function getCellVertices(cellX: number, cellZ: number): VectorXZ[] {
  const minX = cellX * CHASER_MAP_OBSERVATION_CELL_SIZE;
  const minZ = cellZ * CHASER_MAP_OBSERVATION_CELL_SIZE;
  const maxX = minX + CHASER_MAP_OBSERVATION_CELL_SIZE;
  const maxZ = minZ + CHASER_MAP_OBSERVATION_CELL_SIZE;
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
}

function createObservedMapAreaCell(cellX: number, cellZ: number): ObservedMapAreaCell {
  return {
    id: `${cellX}:${cellZ}`,
    cellX,
    cellZ,
    center: {
      x: (cellX + 0.5) * CHASER_MAP_OBSERVATION_CELL_SIZE,
      z: (cellZ + 0.5) * CHASER_MAP_OBSERVATION_CELL_SIZE,
    },
    vertices: getCellVertices(cellX, cellZ),
  };
}

/** Returns map area cells visible to the actor in the current frame. */
export function getVisibleMapAreaCells(
  actorPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
  {
    columns,
    rows,
  }: WorldContext = {},
): ObservedMapAreaCell[] {
  if (!actorPosition || !actorLookDirection || !Number.isFinite(fieldOfViewAngleRadians)) {
    return [];
  }

  const bounds = getCoverageBounds(actorPosition, columns, rows);
  const minCellX = Math.floor(Math.max(
    bounds.minX,
    actorPosition.x - FIELD_OF_VIEW_DISTANCE,
  ) / CHASER_MAP_OBSERVATION_CELL_SIZE);
  const maxCellX = Math.floor(Math.min(
    bounds.maxX,
    actorPosition.x + FIELD_OF_VIEW_DISTANCE,
  ) / CHASER_MAP_OBSERVATION_CELL_SIZE);
  const minCellZ = Math.floor(Math.max(
    bounds.minZ,
    actorPosition.z - FIELD_OF_VIEW_DISTANCE,
  ) / CHASER_MAP_OBSERVATION_CELL_SIZE);
  const maxCellZ = Math.floor(Math.min(
    bounds.maxZ,
    actorPosition.z + FIELD_OF_VIEW_DISTANCE,
  ) / CHASER_MAP_OBSERVATION_CELL_SIZE);
  const cells: ObservedMapAreaCell[] = [];

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const cell = createObservedMapAreaCell(cellX, cellZ);
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
