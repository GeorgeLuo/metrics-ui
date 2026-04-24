import {
  CAR_BOUND_RADIUS,
  DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME,
  FIELD_OF_VIEW_DISTANCE,
  TARGET_ESTIMATE_MIN_MOVE_DISTANCE,
  TARGET_SPEED_ESTIMATE_ALPHA,
  TARGET_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
} from "./constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "./math.mjs";
import {
  isLineOfSightBlockedByObstacles,
  resolveObstacleCollisions,
} from "./world.mjs";

export function createTargetMotionEstimate(targetPosition, targetDirection) {
  return {
    position: { ...targetPosition },
    direction: { ...targetDirection },
    speedEstimateUnitsPerFrame: DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME,
    speedObservationCount: 0,
    lastObservedDirection: { ...targetDirection },
    previousObservedDirection: null,
    observedTurnRateRadians: 0,
    lastObservedPosition: { ...targetPosition },
    observationCount: 0,
    motionObservationCount: 0,
    framesSinceObservation: 0,
  };
}

export function getChaserTargetPerception(
  chaserPosition,
  targetPosition,
  chaserLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  const offsetX = targetPosition.x - chaserPosition.x;
  const offsetZ = targetPosition.z - chaserPosition.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance <= CAR_BOUND_RADIUS) {
    return { visible: true, bearingRadians: 0, distance };
  }

  const targetDirection = normalizeVector(offsetX, offsetZ);
  const bearingRadians = normalizeAngleDelta(
    vectorToAngle(targetDirection) - vectorToAngle(chaserLookDirection),
  );
  const targetAngularRadius = Math.atan2(CAR_BOUND_RADIUS, distance);
  const isVisible =
    distance <= FIELD_OF_VIEW_DISTANCE + CAR_BOUND_RADIUS
    && Math.abs(bearingRadians) <= fieldOfViewAngleRadians / 2 + targetAngularRadius;
  const isOccluded = isVisible
    && isLineOfSightBlockedByObstacles(chaserPosition, targetPosition, obstacles);

  return isVisible && !isOccluded
    ? { visible: true, bearingRadians, distance }
    : { visible: false };
}

function getPerceivedTargetPosition(chaserPosition, chaserLookDirection, targetPerception) {
  const bearingDirection = angleToVector(
    vectorToAngle(chaserLookDirection) + targetPerception.bearingRadians,
  );
  return {
    x: chaserPosition.x + bearingDirection.x * targetPerception.distance,
    z: chaserPosition.z + bearingDirection.z * targetPerception.distance,
  };
}

export function updateTargetMotionEstimate(
  estimate,
  targetPerception,
  chaserPosition,
  chaserLookDirection,
  worldContext = {},
) {
  if (targetPerception.visible) {
    estimate.observationCount += 1;
    estimate.framesSinceObservation = 0;
    const observedPosition = getPerceivedTargetPosition(
      chaserPosition,
      chaserLookDirection,
      targetPerception,
    );

    if (estimate.lastObservedPosition) {
      const observedDelta = normalizeVector(
        observedPosition.x - estimate.lastObservedPosition.x,
        observedPosition.z - estimate.lastObservedPosition.z,
      );
      const observedMoveDistance = Math.hypot(
        observedPosition.x - estimate.lastObservedPosition.x,
        observedPosition.z - estimate.lastObservedPosition.z,
      );
      if (observedMoveDistance >= TARGET_ESTIMATE_MIN_MOVE_DISTANCE) {
        const observedSpeed = observedMoveDistance;
        const clampedObservedSpeed = Math.min(
          TARGET_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
          Math.max(0, observedSpeed),
        );
        estimate.speedEstimateUnitsPerFrame = estimate.speedObservationCount > 0
          ? estimate.speedEstimateUnitsPerFrame
            + (clampedObservedSpeed - estimate.speedEstimateUnitsPerFrame)
              * TARGET_SPEED_ESTIMATE_ALPHA
          : clampedObservedSpeed;
        estimate.speedObservationCount += 1;
        const previousObservedDirection = estimate.lastObservedDirection
          ? { ...estimate.lastObservedDirection }
          : null;
        estimate.previousObservedDirection = previousObservedDirection;
        estimate.lastObservedDirection = observedDelta;
        estimate.observedTurnRateRadians = previousObservedDirection
          ? normalizeAngleDelta(vectorToAngle(observedDelta) - vectorToAngle(previousObservedDirection))
          : 0;
        estimate.direction = observedDelta;
        estimate.motionObservationCount += 1;
      }
    }

    estimate.position = observedPosition;
    estimate.lastObservedPosition = observedPosition;
    return;
  }

  if (estimate.position && estimate.direction) {
    estimate.framesSinceObservation += 1;
    const speedEstimate = Number.isFinite(estimate.speedEstimateUnitsPerFrame)
      ? estimate.speedEstimateUnitsPerFrame
      : DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME;
    const nextPosition = {
      x: estimate.position.x + estimate.direction.x * speedEstimate,
      z: estimate.position.z + estimate.direction.z * speedEstimate,
    };
    const canResolveWorldCollision = worldContext.obstacles
      && Number.isFinite(worldContext.columns)
      && Number.isFinite(worldContext.rows);
    estimate.position = canResolveWorldCollision
      ? resolveObstacleCollisions(
        nextPosition,
        estimate.position,
        worldContext.columns,
        worldContext.rows,
        worldContext.obstacles,
      )
      : nextPosition;
  }
}
