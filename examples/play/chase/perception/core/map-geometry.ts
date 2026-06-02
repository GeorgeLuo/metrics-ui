import { FIELD_OF_VIEW_DISTANCE } from "../../config/constants.mjs";
import {
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
  type VectorXZ,
} from "../../decision-model/core/math.ts";
import type {
  BoundsXZ,
  ObservedMapWall,
} from "../../decision-model/observer-world/interfaces.ts";
import {
  getFieldBounds,
  isLineOfSightBlockedByObstacles,
} from "../../world/world.mjs";

export type WorldContext = {
  columns?: number;
  rows?: number;
};

export type PointPerception =
  | { visible: false }
  | { visible: true; bearingRadians: number; distance: number };

export type ObstacleLike = {
  walls?: Array<Partial<ObservedMapWall>>;
};

/** Normalizes simulator obstacle input into the shape expected by map perception. */
export function asObstacleLike(obstacles: unknown): ObstacleLike | null {
  return obstacles && typeof obstacles === "object"
    ? obstacles as ObstacleLike
    : null;
}

/** Returns obstacle walls from a possibly partial obstacle collection. */
export function getObstacleWalls(
  obstacles: ObstacleLike | null | undefined,
): Array<Partial<ObservedMapWall>> {
  return Array.isArray(obstacles?.walls) ? obstacles.walls : [];
}

/** Computes point visibility from actor pose and FOV. */
export function getPointPerception(
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

/** Resolves the map bounds to sample for the current observation. */
export function getCoverageBounds(
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

/** Tests whether a map point is visible and not occluded by obstacles. */
export function isPointVisibleThroughMap(
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
