import {
  CAR_BOUND_RADIUS,
  FIELD_OF_VIEW_DISTANCE,
} from "../../../config/constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
  type VectorXZ,
} from "../../core/math.ts";
import { isLineOfSightBlockedByObstacles } from "../../../world/world.mjs";

const EMPTY_OBSTACLES = Object.freeze({ walls: Object.freeze([]) });

/** Per-frame visibility facts from one actor observing another actor. */
export type ActorPerception = {
  visible: boolean;
  absent?: boolean;
  bearingRadians?: number;
  distance?: number;
};

/** Latest known relative location state for an observed actor. */
export type ActorLocationMemory = {
  visible: boolean;
  position: VectorXZ | null;
  bearingRadians: number | null;
  distance: number | null;
  observationCount: number;
  framesSinceObservation: number;
  observationGapFrames: number;
};

/**
 * Creates memory for the latest perceived location of another actor.
 */
export function createActorLocationMemory(): ActorLocationMemory {
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

/**
 * Computes whether a subject actor is visible from an observer pose.
 */
export function getActorPerception(
  actorPosition: VectorXZ | null | undefined,
  subjectPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
  obstacles: unknown,
): ActorPerception {
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
    && isLineOfSightBlockedByObstacles(
      actorPosition,
      subjectPosition,
      obstacles ?? EMPTY_OBSTACLES,
    );

  return isVisible && !isOccluded
    ? { visible: true, bearingRadians, distance }
    : { visible: false };
}

/**
 * Resolves an observed relative bearing and distance into world position.
 */
export function getPerceivedActorPosition(
  actorPosition: VectorXZ,
  actorLookDirection: VectorXZ,
  actorPerception: ActorPerception,
): VectorXZ {
  const bearingDirection = angleToVector(
    vectorToAngle(actorLookDirection) + Number(actorPerception.bearingRadians),
  );
  return {
    x: actorPosition.x + bearingDirection.x * Number(actorPerception.distance),
    z: actorPosition.z + bearingDirection.z * Number(actorPerception.distance),
  };
}

/**
 * Updates latest-location memory from a perception sample.
 */
export function updateActorLocationMemory(
  locationMemory: ActorLocationMemory | null | undefined,
  actorPerception: ActorPerception,
  actorPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
): ActorLocationMemory | null {
  if (!locationMemory) {
    return null;
  }

  if (
    actorPerception.visible
    && actorPosition
    && actorLookDirection
    && Number.isFinite(actorPerception.bearingRadians)
    && Number.isFinite(actorPerception.distance)
  ) {
    const observationGapFrames = locationMemory.position
      ? Math.max(1, locationMemory.framesSinceObservation + 1)
      : 1;
    locationMemory.visible = true;
    locationMemory.position = getPerceivedActorPosition(
      actorPosition,
      actorLookDirection,
      actorPerception,
    );
    locationMemory.bearingRadians = Number(actorPerception.bearingRadians);
    locationMemory.distance = Number(actorPerception.distance);
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
