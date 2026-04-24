import {
  CAR_BOUND_RADIUS,
  MOVEMENT_CONSENSUS_COUPLING,
  MOVEMENT_CONSENSUS_ITERATIONS,
  MOVEMENT_GOAL_WEIGHT,
  MOVEMENT_WALL_AVOID_WEIGHT,
  MOVEMENT_WALL_FOLLOW_WEIGHT,
  MOVEMENT_WALL_MIN_OUTWARD_DOT,
  MOVEMENT_WALL_UNSTICK_WEIGHT,
  WALL_AVOID_DISTANCE,
} from "./constants.mjs";
import { runKuramotoConsensus } from "./kuramoto.mjs";
import { normalizeVector } from "./math.mjs";
import { clampConfidence } from "./strategy-confidence.mjs";
import { getWorldWallPressure } from "./world.mjs";

const BOUNDARY_WALL_IDS = new Set(["left", "right", "top", "bottom"]);

function dot(first, second) {
  return (first?.x ?? 0) * (second?.x ?? 0) + (first?.z ?? 0) * (second?.z ?? 0);
}

function getLeftTangent(direction) {
  return normalizeVector(-direction.z, direction.x);
}

function getRightTangent(direction) {
  return normalizeVector(direction.z, -direction.x);
}

function getWallProximity(wallPressure) {
  if (!wallPressure?.active) {
    return 0;
  }
  const distance = Number(wallPressure.nearestDistance);
  if (!Number.isFinite(distance)) {
    return clampConfidence(wallPressure.magnitude);
  }
  return clampConfidence(1 - distance / WALL_AVOID_DISTANCE);
}

function getWallContactDistance(wallPressure) {
  return BOUNDARY_WALL_IDS.has(wallPressure?.nearestWall)
    ? 0.04
    : CAR_BOUND_RADIUS + 0.025;
}

export function createMovementSignal({
  id,
  direction,
  confidence = 1,
  weight = 1,
  metadata = {},
}) {
  const normalizedDirection = normalizeVector(direction?.x ?? 0, direction?.z ?? 0);
  const normalizedConfidence = clampConfidence(confidence);
  const normalizedWeight = Number(weight);
  if (
    (normalizedDirection.x === 0 && normalizedDirection.z === 0)
    || normalizedConfidence <= 0
    || !Number.isFinite(normalizedWeight)
    || normalizedWeight <= 0
  ) {
    return null;
  }

  return {
    id,
    direction: normalizedDirection,
    confidence: normalizedConfidence,
    weight: normalizedWeight * normalizedConfidence,
    ...metadata,
  };
}

export function chooseWallFollowTangent({
  wallNormal,
  preferredDirection,
  previousWallFollowSign = 1,
} = {}) {
  const normal = normalizeVector(wallNormal?.x ?? 0, wallNormal?.z ?? 0);
  if (normal.x === 0 && normal.z === 0) {
    return {
      direction: { x: 0, z: 0 },
      sign: previousWallFollowSign >= 0 ? 1 : -1,
    };
  }

  const preferred = normalizeVector(preferredDirection?.x ?? 0, preferredDirection?.z ?? 0);
  const left = getLeftTangent(normal);
  const right = getRightTangent(normal);
  const leftScore = dot(left, preferred);
  const rightScore = dot(right, preferred);
  let sign = previousWallFollowSign >= 0 ? 1 : -1;
  if (Math.abs(leftScore - rightScore) > 0.03) {
    sign = leftScore > rightScore ? 1 : -1;
  }

  return {
    direction: sign > 0 ? left : right,
    sign,
  };
}

export function buildLocalMovementSignals({
  position,
  goalDirection,
  columns,
  rows,
  obstacles,
  previousWallFollowSign = 1,
} = {}) {
  const normalizedGoal = normalizeVector(goalDirection?.x ?? 0, goalDirection?.z ?? 0);
  const signals = [];
  const goalSignal = createMovementSignal({
    id: "goal",
    direction: normalizedGoal,
    confidence: 1,
    weight: MOVEMENT_GOAL_WEIGHT,
  });
  if (goalSignal) {
    signals.push(goalSignal);
  }

  const wallPressure = position && Number.isFinite(columns) && Number.isFinite(rows)
    ? getWorldWallPressure(position, columns, rows, obstacles)
    : null;
  const wallNormal = normalizeVector(wallPressure?.direction?.x ?? 0, wallPressure?.direction?.z ?? 0);
  const wallProximity = getWallProximity(wallPressure);
  let wallFollowSign = previousWallFollowSign >= 0 ? 1 : -1;

  if (wallProximity > 0 && !(wallNormal.x === 0 && wallNormal.z === 0)) {
    const inwardGoalPressure = Math.max(0, -dot(normalizedGoal, wallNormal));
    const tangent = chooseWallFollowTangent({
      wallNormal,
      preferredDirection: normalizedGoal,
      previousWallFollowSign,
    });
    wallFollowSign = tangent.sign;

    signals.push(createMovementSignal({
      id: "avoid-wall",
      direction: wallNormal,
      confidence: Math.max(wallProximity * 0.55, inwardGoalPressure * wallProximity),
      weight: MOVEMENT_WALL_AVOID_WEIGHT,
      metadata: {
        nearestWall: wallPressure.nearestWall,
        nearestDistance: wallPressure.nearestDistance,
      },
    }));

    signals.push(createMovementSignal({
      id: "follow-wall",
      direction: tangent.direction,
      confidence: wallProximity * (0.3 + 0.7 * inwardGoalPressure),
      weight: MOVEMENT_WALL_FOLLOW_WEIGHT,
      metadata: {
        nearestWall: wallPressure.nearestWall,
        followSign: wallFollowSign,
      },
    }));

    const contactDistance = getWallContactDistance(wallPressure);
    if (
      Number.isFinite(wallPressure.nearestDistance)
      && wallPressure.nearestDistance <= contactDistance
    ) {
      signals.push(createMovementSignal({
        id: "unstick-wall",
        direction: wallNormal,
        confidence: 1,
        weight: MOVEMENT_WALL_UNSTICK_WEIGHT,
        metadata: {
          nearestWall: wallPressure.nearestWall,
          nearestDistance: wallPressure.nearestDistance,
        },
      }));
    }
  }

  return {
    signals: signals.filter(Boolean),
    wallPressure,
    wallFollowSign,
  };
}

export function constrainDirectionByLocalWalls({
  position,
  desiredDirection,
  preferredDirection,
  columns,
  rows,
  obstacles,
  wallPressure,
  wallFollowSign = 1,
} = {}) {
  const desired = normalizeVector(desiredDirection?.x ?? 0, desiredDirection?.z ?? 0);
  if (desired.x === 0 && desired.z === 0) {
    return desired;
  }

  const pressure = wallPressure ?? (
    position && Number.isFinite(columns) && Number.isFinite(rows)
      ? getWorldWallPressure(position, columns, rows, obstacles)
      : null
  );
  const wallNormal = normalizeVector(pressure?.direction?.x ?? 0, pressure?.direction?.z ?? 0);
  const wallProximity = getWallProximity(pressure);
  if (wallProximity <= 0 || (wallNormal.x === 0 && wallNormal.z === 0)) {
    return desired;
  }

  if (dot(desired, wallNormal) >= MOVEMENT_WALL_MIN_OUTWARD_DOT) {
    return desired;
  }

  const tangent = chooseWallFollowTangent({
    wallNormal,
    preferredDirection: preferredDirection ?? desired,
    previousWallFollowSign: wallFollowSign,
  }).direction;
  const tangentAlignment = dot(desired, tangent);
  const signedTangent = tangentAlignment >= 0
    ? tangent
    : { x: -tangent.x, z: -tangent.z };
  const isContactingWall = Number.isFinite(pressure.nearestDistance)
    && pressure.nearestDistance <= getWallContactDistance(pressure);
  const outwardBias = isContactingWall
    ? 0.55
    : 0.18 + 0.24 * wallProximity;

  return normalizeVector(
    signedTangent.x + wallNormal.x * outwardBias,
    signedTangent.z + wallNormal.z * outwardBias,
  );
}

export function planLocalMovementDirection({
  position,
  goalDirection,
  columns,
  rows,
  obstacles,
  previousWallFollowSign = 1,
} = {}) {
  const normalizedGoal = normalizeVector(goalDirection?.x ?? 0, goalDirection?.z ?? 0);
  const movement = buildLocalMovementSignals({
    position,
    goalDirection: normalizedGoal,
    columns,
    rows,
    obstacles,
    previousWallFollowSign,
  });
  const consensus = runKuramotoConsensus(movement.signals, {
    coupling: MOVEMENT_CONSENSUS_COUPLING,
    iterations: MOVEMENT_CONSENSUS_ITERATIONS,
  });
  const consensusDirection = consensus.direction.x === 0 && consensus.direction.z === 0
    ? normalizedGoal
    : consensus.direction;
  const direction = constrainDirectionByLocalWalls({
    position,
    desiredDirection: consensusDirection,
    preferredDirection: normalizedGoal,
    columns,
    rows,
    obstacles,
    wallPressure: movement.wallPressure,
    wallFollowSign: movement.wallFollowSign,
  });

  return {
    direction,
    consensus,
    signals: movement.signals,
    wallPressure: movement.wallPressure,
    wallFollowSign: movement.wallFollowSign,
  };
}
