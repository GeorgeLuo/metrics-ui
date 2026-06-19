import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../core/math.ts";
import type { VectorXZ } from "../../observer-world/interfaces.ts";
import {
  clampUnit,
  cloneVehicleDirection,
  cloneVehicleVector,
  stepVehicleBicycleFrame,
} from "./kinematics.ts";
import type {
  VehicleActionFrame,
  VehicleActionProposal,
} from "./interfaces.ts";

export { clampUnit } from "./kinematics.ts";

/**
 * Flexible option bag for vehicle path helpers.
 *
 * Vehicle helpers deliberately keep target metadata open because actor-specific
 * proposal modules own those debug fields.
 */
type ActionPathOptions = Record<string, any>;

const DEFAULT_ACTION_PATH_HORIZON_FRAMES = 36;
const MAX_ACTION_PATH_HORIZON_FRAMES = 120;
const DEFAULT_VEHICLE_STEERING_DEADZONE_RADIANS = 0.08;

function getPositiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function normalizeActionPathHorizon(value: unknown): number {
  return Math.min(
    MAX_ACTION_PATH_HORIZON_FRAMES,
    getPositiveInteger(value, DEFAULT_ACTION_PATH_HORIZON_FRAMES),
  );
}

/**
 * Normalizes a possibly partial x/z position.
 */
export function clonePosition(
  position: Partial<VectorXZ> | null | undefined,
  fallback: VectorXZ = { x: 0, z: 0 },
): VectorXZ {
  return cloneVehicleVector(position, fallback);
}

/**
 * Normalizes a direction vector, falling back to a valid forward vector.
 */
export function cloneDirection(
  direction: Partial<VectorXZ> | null | undefined,
  fallback: VectorXZ = { x: 1, z: 0 },
): VectorXZ {
  return cloneVehicleDirection(direction, fallback);
}

/**
 * Converts a signed bearing into discrete steering input.
 */
export function getSteeringFromBearing(
  bearingRadians: number,
  deadzoneRadians = DEFAULT_VEHICLE_STEERING_DEADZONE_RADIANS,
): number {
  return bearingRadians > deadzoneRadians
    ? 1
    : bearingRadians < -deadzoneRadians
      ? -1
      : 0;
}

/**
 * Computes the unit direction from a position to a target position.
 */
export function getDirectionToPosition(
  fromPosition: VectorXZ,
  targetPosition: VectorXZ,
): VectorXZ {
  return normalizeVector(
    targetPosition.x - fromPosition.x,
    targetPosition.z - fromPosition.z,
  );
}

/**
 * Computes the signed angular difference from current to target direction.
 */
export function getBearingToDirection(
  currentDirection: VectorXZ,
  targetDirection: VectorXZ,
): number {
  return normalizeAngleDelta(vectorToAngle(targetDirection) - vectorToAngle(currentDirection));
}

/**
 * Resolves a relative observation bearing into an absolute direction.
 */
export function getDirectionFromPerception(
  currentDirection: VectorXZ,
  perception: { bearingRadians: number },
): VectorXZ {
  return angleToVector(
    vectorToAngle(currentDirection) + perception.bearingRadians,
  );
}

/**
 * Advances one vehicle frame using normalized throttle and steering controls.
 */
export function stepActionPathFrame({
  position,
  direction,
  throttle,
  steering,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
}: ActionPathOptions = {}): {
  throttle: number;
  steering: number;
  position: VectorXZ;
  direction: VectorXZ;
} {
  return stepVehicleBicycleFrame({
    position,
    direction,
    throttle,
    steering,
    speedUnitsPerFrame,
    maxSteeringAngleRadians,
  });
}

/**
 * Creates the debug/simulation frame shape for one predicted vehicle pose.
 */
export function createActionFrame({
  frameOffset,
  throttle,
  steering,
  position,
  direction,
  metadata = {},
}: ActionPathOptions = {}): VehicleActionFrame {
  const resolvedThrottle = clampUnit(throttle);
  const resolvedSteering = clampUnit(steering);
  return {
    frameOffset: Number(frameOffset) || 1,
    framesAhead: Number(frameOffset) || 1,
    throttle: resolvedThrottle,
    steer: resolvedSteering,
    steering: resolvedSteering,
    forward: resolvedThrottle > 0.001,
    reverse: resolvedThrottle < -0.001,
    predictedPosition: clonePosition(position),
    predictedDirection: cloneDirection(direction),
    ...metadata,
  };
}

/**
 * Builds a feasible vehicle path from frame-by-frame control callbacks.
 */
export function buildFeasibleActionPath({
  vehiclePosition,
  vehicleDirection,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
  horizonFrames,
  getFrameSteering,
  getFrameThrottle = () => 1,
  metadata = {},
}: ActionPathOptions = {}): VehicleActionFrame[] {
  let position = clonePosition(vehiclePosition);
  let direction = cloneDirection(vehicleDirection);
  const path: VehicleActionFrame[] = [];
  const frameCount = normalizeActionPathHorizon(horizonFrames);

  for (let frameOffset = 1; frameOffset <= frameCount; frameOffset += 1) {
    const steering = clampUnit(getFrameSteering?.({ position, direction, frameOffset }) ?? 0);
    const throttle = clampUnit(getFrameThrottle?.({ position, direction, frameOffset }) ?? 1);
    const nextFrame = stepActionPathFrame({
      position,
      direction,
      throttle,
      steering,
      speedUnitsPerFrame,
      maxSteeringAngleRadians,
    });
    position = nextFrame.position;
    direction = nextFrame.direction;
    path.push(createActionFrame({
      frameOffset,
      throttle: nextFrame.throttle,
      steering: nextFrame.steering,
      position,
      direction,
      metadata,
    }));
  }

  return path;
}

/**
 * Builds a feasible vehicle path that steers toward a target position.
 */
export function buildActionPathToPosition({
  vehiclePosition,
  vehicleDirection,
  targetPosition,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
  horizonFrames,
  metadata,
}: ActionPathOptions = {}): VehicleActionFrame[] {
  if (!targetPosition) {
    return [];
  }
  return buildFeasibleActionPath({
    vehiclePosition,
    vehicleDirection,
    speedUnitsPerFrame,
    maxSteeringAngleRadians,
    horizonFrames,
    metadata: {
      ...metadata,
      targetPosition: clonePosition(targetPosition),
    },
    getFrameSteering: ({ position, direction }: ActionPathOptions) => {
      const targetDirection = getDirectionToPosition(position, targetPosition);
      return getSteeringFromBearing(getBearingToDirection(direction, targetDirection));
    },
  });
}

/**
 * Builds a feasible vehicle path that turns toward a target direction.
 */
export function buildActionPathToDirection({
  vehiclePosition,
  vehicleDirection,
  targetDirection,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
  horizonFrames,
  metadata,
}: ActionPathOptions = {}): VehicleActionFrame[] {
  const normalizedTargetDirection = normalizeVector(targetDirection?.x ?? 0, targetDirection?.z ?? 0);
  if (normalizedTargetDirection.x === 0 && normalizedTargetDirection.z === 0) {
    return [];
  }
  return buildFeasibleActionPath({
    vehiclePosition,
    vehicleDirection,
    speedUnitsPerFrame,
    maxSteeringAngleRadians,
    horizonFrames,
    metadata: {
      ...metadata,
      targetDirection: normalizedTargetDirection,
    },
    getFrameSteering: ({ direction }: ActionPathOptions) =>
      getSteeringFromBearing(getBearingToDirection(direction, normalizedTargetDirection)),
  });
}

/**
 * Creates the shared inactive proposal shape for vehicle-capability proposals.
 */
export function createInactiveActionProposal(
  id: string,
  extra: Record<string, unknown> = {},
): VehicleActionProposal {
  return {
    id,
    active: false,
    confidence: 0,
    actionPath: [],
    firstAction: null,
    ...extra,
  };
}
