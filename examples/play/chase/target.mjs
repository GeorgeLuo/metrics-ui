import {
  DEFAULT_TARGET_DRIFT_WEIGHT,
  DEFAULT_TARGET_DRIFT_X_PHASE_PER_FRAME,
  DEFAULT_TARGET_DRIFT_Z_PHASE_PER_FRAME,
  DEFAULT_TARGET_WALL_AVOID_WEIGHT,
  EDGE_LOCK_EPSILON,
} from "./constants.mjs";
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

function getTargetPolicyValue(policy, key, fallback) {
  const numericValue = Number(policy?.[key]);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function getDriftDirection(frameIndex, policy) {
  const safeFrameIndex = Number.isFinite(frameIndex) ? frameIndex : 0;
  const driftXPhasePerFrame = getTargetPolicyValue(
    policy,
    "driftXPhasePerFrame",
    DEFAULT_TARGET_DRIFT_X_PHASE_PER_FRAME,
  );
  const driftZPhasePerFrame = getTargetPolicyValue(
    policy,
    "driftZPhasePerFrame",
    DEFAULT_TARGET_DRIFT_Z_PHASE_PER_FRAME,
  );
  const driftXPhaseOffset = getTargetPolicyValue(policy, "driftXPhaseOffset", 0);
  const driftZPhaseOffset = getTargetPolicyValue(policy, "driftZPhaseOffset", 0);
  return normalizeVector(
    Math.sin(safeFrameIndex * driftXPhasePerFrame + driftXPhaseOffset),
    Math.cos(safeFrameIndex * driftZPhasePerFrame + driftZPhaseOffset),
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
  frameIndex,
  obstacles,
  policy = {},
) {
  const drift = getDriftDirection(frameIndex, policy);
  const wallPressure = getWorldWallPressure(targetPosition, columns, rows, obstacles);
  const driftWeight = getTargetPolicyValue(policy, "driftWeight", DEFAULT_TARGET_DRIFT_WEIGHT);
  const wallAvoidWeight = getTargetPolicyValue(
    policy,
    "wallAvoidWeight",
    DEFAULT_TARGET_WALL_AVOID_WEIGHT,
  );
  const wallDirection = {
    x: wallPressure.direction.x * wallPressure.magnitude * wallAvoidWeight,
    z: wallPressure.direction.z * wallPressure.magnitude * wallAvoidWeight,
  };
  const direction = normalizeVector(
    drift.x * driftWeight + wallDirection.x + currentDirection.x,
    drift.z * driftWeight + wallDirection.z + currentDirection.z,
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
      policyId: typeof policy?.id === "string" ? policy.id : "baseline-drift-wall-avoid",
      wallAvoidanceActive: wallPressure.active,
      nearestWall: wallPressure.nearestWall,
      nearestDistance: wallPressure.nearestDistance,
    },
  };
}

export function getTargetDirection(
  targetPosition,
  currentDirection,
  columns,
  rows,
  frameIndex,
  obstacles,
  policy,
) {
  return getTargetMovementDecision(
    targetPosition,
    currentDirection,
    columns,
    rows,
    frameIndex,
    obstacles,
    policy,
  ).direction;
}
