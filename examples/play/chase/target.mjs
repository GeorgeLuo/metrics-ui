import { EDGE_LOCK_EPSILON } from "./constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "./math.mjs";
import {
  getGroundBounds,
  getWorldWallPressure,
} from "./world.mjs";

export function steerDirectionToward(currentDirection, desiredDirection, maxDelta) {
  if (desiredDirection.x === 0 && desiredDirection.z === 0) {
    return currentDirection;
  }

  const currentAngle = vectorToAngle(currentDirection);
  const desiredAngle = vectorToAngle(desiredDirection);
  const delta = normalizeAngleDelta(desiredAngle - currentAngle);
  const clampedDelta = Math.min(Math.abs(delta), maxDelta) * Math.sign(delta);
  return angleToVector(currentAngle + clampedDelta);
}

function getDriftDirection(timestamp) {
  return normalizeVector(
    Math.sin(timestamp * 0.0007),
    Math.cos(timestamp * 0.0005),
  );
}

export function constrainDirectionToBounds(position, direction, columns, rows) {
  const bounds = getGroundBounds(columns, rows);
  let x = direction.x;
  let z = direction.z;

  if (position.x >= bounds.maxX - EDGE_LOCK_EPSILON && x > 0) {
    x = -Math.max(0.35, Math.abs(z) * 0.5);
  } else if (position.x <= bounds.minX + EDGE_LOCK_EPSILON && x < 0) {
    x = Math.max(0.35, Math.abs(z) * 0.5);
  }

  if (position.z >= bounds.maxZ - EDGE_LOCK_EPSILON && z > 0) {
    z = -Math.max(0.35, Math.abs(x) * 0.5);
  } else if (position.z <= bounds.minZ + EDGE_LOCK_EPSILON && z < 0) {
    z = Math.max(0.35, Math.abs(x) * 0.5);
  }

  const constrained = normalizeVector(x, z);
  return constrained.x === 0 && constrained.z === 0
    ? normalizeVector(-position.x, -position.z)
    : constrained;
}

export function getTargetMovementDecision(
  targetPosition,
  currentDirection,
  columns,
  rows,
  timestamp,
  obstacles,
) {
  const drift = getDriftDirection(timestamp);
  const wallPressure = getWorldWallPressure(targetPosition, columns, rows, obstacles);
  const wallDirection = {
    x: wallPressure.direction.x * wallPressure.magnitude * 2.5,
    z: wallPressure.direction.z * wallPressure.magnitude * 2.5,
  };
  const direction = normalizeVector(
    drift.x * 0.45 + wallDirection.x + currentDirection.x,
    drift.z * 0.45 + wallDirection.z + currentDirection.z,
  );
  const constrainedDirection = constrainDirectionToBounds(
    targetPosition,
    direction.x === 0 && direction.z === 0 ? drift : direction,
    columns,
    rows,
  );

  return {
    direction: constrainedDirection,
    debug: {
      wallAvoidanceActive: wallPressure.active,
      nearestWall: wallPressure.nearestWall,
      nearestDistance: wallPressure.nearestDistance,
    },
  };
}

export function getTargetDirection(targetPosition, currentDirection, columns, rows, timestamp, obstacles) {
  return getTargetMovementDecision(
    targetPosition,
    currentDirection,
    columns,
    rows,
    timestamp,
    obstacles,
  ).direction;
}
