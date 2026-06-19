import {
  constrainDirectionToBounds,
  steerDirectionToward,
} from "./evader.mjs";
import { normalizeAngleDelta, vectorToAngle } from "../../decision-model/core/math.ts";

/**
 * @typedef {import("../../decision-model/actions/vehicle/interfaces.ts").VehicleSteeringAction} VehicleSteeringAction
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSteeringInputToward(currentDirection, resolvedDirection, maxSteeringAngleRadians) {
  const safeMaxSteeringAngle = Number(maxSteeringAngleRadians) || 0;
  if (!currentDirection || !resolvedDirection || safeMaxSteeringAngle <= 0) {
    return 0;
  }

  const delta = normalizeAngleDelta(
    vectorToAngle(resolvedDirection) - vectorToAngle(currentDirection),
  );
  return clamp(delta / safeMaxSteeringAngle, -1, 1);
}

/**
 * @returns {VehicleSteeringAction}
 */
export function planEvaderVehicleAction({
  position,
  currentDirection,
  desiredDirection,
  maxSteeringAngleRadians,
  columns,
  rows,
} = {}) {
  const boundedDesiredDirection = constrainDirectionToBounds(
    position,
    desiredDirection ?? currentDirection ?? { x: 0, z: 0 },
    columns,
    rows,
  );
  const nextDirection = constrainDirectionToBounds(
    position,
    steerDirectionToward(
      currentDirection ?? { x: 0, z: 0 },
      boundedDesiredDirection,
      maxSteeringAngleRadians,
    ),
    columns,
    rows,
  );

  return {
    forward: true,
    steering: getSteeringInputToward(
      currentDirection,
      nextDirection,
      maxSteeringAngleRadians,
    ),
    desiredDirection: boundedDesiredDirection,
    nextDirection,
  };
}
