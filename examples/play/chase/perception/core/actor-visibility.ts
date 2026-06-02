import {
  CAR_BOUND_RADIUS,
  FIELD_OF_VIEW_DISTANCE,
} from "../../config/constants.mjs";
import {
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
  type VectorXZ,
} from "../../decision-model/core/math.ts";
import type { ObservedActor } from "../../decision-model/observer-world/interfaces.ts";
import { isLineOfSightBlockedByObstacles } from "../../world/world.mjs";

const EMPTY_OBSTACLES = Object.freeze({ walls: Object.freeze([]) });

/**
 * Computes the actor-to-actor observation that the decision model can trust.
 *
 * This belongs outside the decision model because it interprets simulator truth:
 * field of view, line of sight, and physical actor radius.
 */
export function getObservedActor(
  actorPosition: VectorXZ | null | undefined,
  subjectPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
  obstacles: unknown,
): ObservedActor {
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
