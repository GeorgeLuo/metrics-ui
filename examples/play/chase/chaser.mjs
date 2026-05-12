import {
  CAR_BOUND_RADIUS,
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
  FIELD_OF_VIEW_DISTANCE,
  EVADER_ESTIMATE_MIN_MOVE_DISTANCE,
  EVADER_SPEED_ESTIMATE_ALPHA,
  EVADER_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
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

export function createActorLocationMemory() {
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

export function createObservedEvaderMotionMemory(
  evaderDirection = { x: 0, z: 0 },
) {
  const safeEvaderDirection = evaderDirection
    ? { ...evaderDirection }
    : { x: 0, z: 0 };
  return {
    speedEstimateUnitsPerFrame: DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
    speedObservationCount: 0,
    lastObservedDirection: safeEvaderDirection,
    previousObservedDirection: null,
    observedTurnRadiansPerFrame: 0,
    lastObservedPosition: null,
    observationCount: 0,
    motionObservationCount: 0,
  };
}

export function getActorPerception(
  actorPosition,
  subjectPosition,
  actorLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  if (!actorPosition || !subjectPosition || !actorLookDirection) {
    return { visible: false, absent: !subjectPosition };
  }

  const offsetX = subjectPosition.x - actorPosition.x;
  const offsetZ = subjectPosition.z - actorPosition.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance <= CAR_BOUND_RADIUS) {
    return { visible: true, bearingRadians: 0, distance };
  }

  const subjectDirection = normalizeVector(offsetX, offsetZ);
  const bearingRadians = normalizeAngleDelta(
    vectorToAngle(subjectDirection) - vectorToAngle(actorLookDirection),
  );
  const subjectAngularRadius = Math.atan2(CAR_BOUND_RADIUS, distance);
  const isVisible =
    distance <= FIELD_OF_VIEW_DISTANCE + CAR_BOUND_RADIUS
    && Math.abs(bearingRadians) <= fieldOfViewAngleRadians / 2 + subjectAngularRadius;
  const isOccluded = isVisible
    && isLineOfSightBlockedByObstacles(actorPosition, subjectPosition, obstacles);

  return isVisible && !isOccluded
    ? { visible: true, bearingRadians, distance }
    : { visible: false };
}

export function getChaserEvaderPerception(
  chaserPosition,
  evaderPosition,
  chaserLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  return getActorPerception(
    chaserPosition,
    evaderPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
  );
}

export function getPerceivedActorPosition(actorPosition, actorLookDirection, actorPerception) {
  const bearingDirection = angleToVector(
    vectorToAngle(actorLookDirection) + actorPerception.bearingRadians,
  );
  return {
    x: actorPosition.x + bearingDirection.x * actorPerception.distance,
    z: actorPosition.z + bearingDirection.z * actorPerception.distance,
  };
}

export function updateActorLocationMemory(
  locationMemory,
  actorPerception,
  actorPosition,
  actorLookDirection,
) {
  if (!locationMemory) {
    return null;
  }

  if (actorPerception.visible) {
    const observationGapFrames = locationMemory.position
      ? Math.max(1, locationMemory.framesSinceObservation + 1)
      : 1;
    locationMemory.visible = true;
    locationMemory.position = getPerceivedActorPosition(
      actorPosition,
      actorLookDirection,
      actorPerception,
    );
    locationMemory.bearingRadians = actorPerception.bearingRadians;
    locationMemory.distance = actorPerception.distance;
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

export function updateObservedEvaderMotionMemory(
  observedEvaderMotion,
  evaderLocationMemory,
) {
  if (!observedEvaderMotion) {
    return null;
  }

  if (evaderLocationMemory?.visible && evaderLocationMemory.position) {
    observedEvaderMotion.observationCount += 1;
    const observedPosition = evaderLocationMemory.position;

    if (observedEvaderMotion.lastObservedPosition) {
      const observedDelta = normalizeVector(
        observedPosition.x - observedEvaderMotion.lastObservedPosition.x,
        observedPosition.z - observedEvaderMotion.lastObservedPosition.z,
      );
      const observedMoveDistance = Math.hypot(
        observedPosition.x - observedEvaderMotion.lastObservedPosition.x,
        observedPosition.z - observedEvaderMotion.lastObservedPosition.z,
      );
      if (observedMoveDistance >= EVADER_ESTIMATE_MIN_MOVE_DISTANCE) {
        const observationGapFrames = Math.max(
          1,
          Number(evaderLocationMemory?.observationGapFrames) || 1,
        );
        const observedSpeedPerFrame = observedMoveDistance / observationGapFrames;
        const clampedObservedSpeed = Math.min(
          EVADER_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
          Math.max(0, observedSpeedPerFrame),
        );
        observedEvaderMotion.speedEstimateUnitsPerFrame = observedEvaderMotion.speedObservationCount > 0
          ? observedEvaderMotion.speedEstimateUnitsPerFrame
            + (clampedObservedSpeed - observedEvaderMotion.speedEstimateUnitsPerFrame)
              * EVADER_SPEED_ESTIMATE_ALPHA
          : clampedObservedSpeed;
        observedEvaderMotion.speedObservationCount += 1;
        const previousObservedDirection = observedEvaderMotion.lastObservedDirection
          ? { ...observedEvaderMotion.lastObservedDirection }
          : null;
        observedEvaderMotion.previousObservedDirection = previousObservedDirection;
        observedEvaderMotion.lastObservedDirection = observedDelta;
        observedEvaderMotion.observedTurnRadiansPerFrame = previousObservedDirection
          ? normalizeAngleDelta(
            vectorToAngle(observedDelta) - vectorToAngle(previousObservedDirection),
          ) / observationGapFrames
          : 0;
        observedEvaderMotion.motionObservationCount += 1;
      }
    }

    observedEvaderMotion.lastObservedPosition = observedPosition;
  }

  return observedEvaderMotion;
}
