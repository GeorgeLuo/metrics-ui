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
} from "./world.mjs";

export function createTargetLocationMemory() {
  return {
    visible: false,
    position: null,
    bearingRadians: null,
    distance: null,
    observationCount: 0,
    framesSinceObservation: 0,
    observationGapFrames: 1,
  };
}

export function createObservedTargetMotionMemory(
  targetDirection = { x: 0, z: 0 },
) {
  const safeTargetDirection = targetDirection
    ? { ...targetDirection }
    : { x: 0, z: 0 };
  return {
    speedEstimateUnitsPerFrame: DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME,
    speedObservationCount: 0,
    lastObservedDirection: safeTargetDirection,
    previousObservedDirection: null,
    observedTurnRadiansPerFrame: 0,
    lastObservedPosition: null,
    observationCount: 0,
    motionObservationCount: 0,
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

export function getPerceivedTargetPosition(chaserPosition, chaserLookDirection, targetPerception) {
  const bearingDirection = angleToVector(
    vectorToAngle(chaserLookDirection) + targetPerception.bearingRadians,
  );
  return {
    x: chaserPosition.x + bearingDirection.x * targetPerception.distance,
    z: chaserPosition.z + bearingDirection.z * targetPerception.distance,
  };
}

export function updateTargetLocationMemory(
  locationMemory,
  targetPerception,
  chaserPosition,
  chaserLookDirection,
) {
  if (!locationMemory) {
    return null;
  }

  if (targetPerception.visible) {
    const observationGapFrames = locationMemory.position
      ? Math.max(1, locationMemory.framesSinceObservation + 1)
      : 1;
    locationMemory.visible = true;
    locationMemory.position = getPerceivedTargetPosition(
      chaserPosition,
      chaserLookDirection,
      targetPerception,
    );
    locationMemory.bearingRadians = targetPerception.bearingRadians;
    locationMemory.distance = targetPerception.distance;
    locationMemory.observationCount += 1;
    locationMemory.framesSinceObservation = 0;
    locationMemory.observationGapFrames = observationGapFrames;
    return locationMemory;
  }

  locationMemory.visible = false;
  locationMemory.bearingRadians = null;
  locationMemory.distance = null;
  if (locationMemory.position) {
    locationMemory.framesSinceObservation += 1;
  }
  return locationMemory;
}

export function updateObservedTargetMotionMemory(
  observedTargetMotion,
  targetLocationMemory,
) {
  if (!observedTargetMotion) {
    return null;
  }

  if (targetLocationMemory?.visible && targetLocationMemory.position) {
    observedTargetMotion.observationCount += 1;
    const observedPosition = targetLocationMemory.position;

    if (observedTargetMotion.lastObservedPosition) {
      const observedDelta = normalizeVector(
        observedPosition.x - observedTargetMotion.lastObservedPosition.x,
        observedPosition.z - observedTargetMotion.lastObservedPosition.z,
      );
      const observedMoveDistance = Math.hypot(
        observedPosition.x - observedTargetMotion.lastObservedPosition.x,
        observedPosition.z - observedTargetMotion.lastObservedPosition.z,
      );
      if (observedMoveDistance >= TARGET_ESTIMATE_MIN_MOVE_DISTANCE) {
        const observationGapFrames = Math.max(
          1,
          Number(targetLocationMemory?.observationGapFrames) || 1,
        );
        const observedSpeedPerFrame = observedMoveDistance / observationGapFrames;
        const clampedObservedSpeed = Math.min(
          TARGET_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
          Math.max(0, observedSpeedPerFrame),
        );
        observedTargetMotion.speedEstimateUnitsPerFrame = observedTargetMotion.speedObservationCount > 0
          ? observedTargetMotion.speedEstimateUnitsPerFrame
            + (clampedObservedSpeed - observedTargetMotion.speedEstimateUnitsPerFrame)
              * TARGET_SPEED_ESTIMATE_ALPHA
          : clampedObservedSpeed;
        observedTargetMotion.speedObservationCount += 1;
        const previousObservedDirection = observedTargetMotion.lastObservedDirection
          ? { ...observedTargetMotion.lastObservedDirection }
          : null;
        observedTargetMotion.previousObservedDirection = previousObservedDirection;
        observedTargetMotion.lastObservedDirection = observedDelta;
        observedTargetMotion.observedTurnRadiansPerFrame = previousObservedDirection
          ? normalizeAngleDelta(
            vectorToAngle(observedDelta) - vectorToAngle(previousObservedDirection),
          ) / observationGapFrames
          : 0;
        observedTargetMotion.motionObservationCount += 1;
      }
    }

    observedTargetMotion.lastObservedPosition = observedPosition;
  }

  return observedTargetMotion;
}
