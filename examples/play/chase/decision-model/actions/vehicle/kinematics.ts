import {
  DEFAULT_CAR_MAX_STEERING_ANGLE_RADIANS,
  DEFAULT_CAR_WHEELBASE_UNITS,
} from "../../../config/constants.mjs";
import {
  angleToVector,
  normalizeVector,
  vectorToAngle,
} from "../../core/math.ts";
import type { VectorXZ } from "../../observer-world/interfaces.ts";

/**
 * Flexible vehicle kinematics option bag.
 */
type VehicleKinematicsOptions = {
  position?: Partial<VectorXZ> | null;
  direction?: Partial<VectorXZ> | null;
  speedUnitsPerFrame?: number;
  throttle?: number;
  steering?: number;
  maxSteeringAngleRadians?: number;
  wheelbaseUnits?: number;
};

/**
 * Per-frame vehicle pose after applying bicycle-model steering.
 */
export type VehicleKinematicsFrame = {
  throttle: number;
  steering: number;
  position: VectorXZ;
  direction: VectorXZ;
};

function clampNumber(value: unknown, min: number, max: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }
  return Math.max(min, Math.min(max, numericValue));
}

/**
 * Clamps throttle or steering input to the normalized vehicle control range.
 */
export function clampUnit(value: unknown): number {
  return clampNumber(value, -1, 1);
}

/**
 * Normalizes an x/z vector-like value with a fallback.
 */
export function cloneVehicleVector(
  vector: Partial<VectorXZ> | null | undefined,
  fallback: VectorXZ,
): VectorXZ {
  const x = Number(vector?.x);
  const z = Number(vector?.z);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

/**
 * Normalizes a direction vector, falling back to a forward direction.
 */
export function cloneVehicleDirection(
  direction: Partial<VectorXZ> | null | undefined,
  fallback: VectorXZ = { x: 1, z: 0 },
): VectorXZ {
  const cloned = cloneVehicleVector(direction, fallback);
  const normalized = normalizeVector(cloned.x, cloned.z);
  return normalized.x === 0 && normalized.z === 0 ? { ...fallback } : normalized;
}

/**
 * Normalizes the maximum physical front-wheel steering angle.
 */
export function normalizeMaxSteeringAngleRadians(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : DEFAULT_CAR_MAX_STEERING_ANGLE_RADIANS;
}

/**
 * Advances one vehicle frame using a simple bicycle model.
 *
 * The executable action still provides normalized steering in the range -1..1.
 * That signal is interpreted as a physical front-wheel angle, then converted to
 * yaw based on distance traveled and wheelbase.
 */
export function stepVehicleBicycleFrame({
  position,
  direction,
  speedUnitsPerFrame,
  throttle,
  steering,
  maxSteeringAngleRadians,
  wheelbaseUnits = DEFAULT_CAR_WHEELBASE_UNITS,
}: VehicleKinematicsOptions = {}): VehicleKinematicsFrame {
  const currentPosition = cloneVehicleVector(position, { x: 0, z: 0 });
  const currentDirection = cloneVehicleDirection(direction);
  const resolvedThrottle = clampUnit(throttle);
  const resolvedSteering = clampUnit(steering);
  const speed = Math.max(0, Number(speedUnitsPerFrame) || 0);
  const wheelbase = Math.max(0.001, Number(wheelbaseUnits) || DEFAULT_CAR_WHEELBASE_UNITS);
  const maxSteeringAngle = normalizeMaxSteeringAngleRadians(maxSteeringAngleRadians);
  const distance = speed * resolvedThrottle;
  const isMoving = Math.abs(distance) > 0.001;
  let travelDirection = currentDirection;
  let nextDirection = currentDirection;

  if (isMoving && resolvedSteering !== 0 && maxSteeringAngle > 0) {
    const currentAngle = vectorToAngle(currentDirection);
    const frontWheelAngle = resolvedSteering * maxSteeringAngle;
    const yawDelta = (distance / wheelbase) * Math.tan(frontWheelAngle);
    travelDirection = angleToVector(currentAngle + yawDelta / 2);
    nextDirection = angleToVector(currentAngle + yawDelta);
  }

  return {
    throttle: resolvedThrottle,
    steering: resolvedSteering,
    position: {
      x: currentPosition.x + travelDirection.x * distance,
      z: currentPosition.z + travelDirection.z * distance,
    },
    direction: nextDirection,
  };
}
