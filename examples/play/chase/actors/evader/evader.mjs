import { EDGE_LOCK_EPSILON } from "../../config/constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../decision-model/core/math.ts";
import { getGroundBounds } from "../../world/world.mjs";

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
