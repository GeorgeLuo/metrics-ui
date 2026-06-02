import {
  angleToVector,
  vectorToAngle,
  type VectorXZ,
} from "../../core/math.ts";
import type { ObservedActor } from "../../observer-world/interfaces.ts";

/** Per-frame visibility facts from one actor observing another actor. */
export type ActorPerception = ObservedActor;

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
