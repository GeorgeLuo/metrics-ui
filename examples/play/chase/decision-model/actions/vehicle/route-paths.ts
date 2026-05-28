import {
  cloneDirection,
  clonePosition,
  createActionFrame,
  getBearingToDirection,
  getDirectionToPosition,
  getSteeringFromBearing,
  stepActionPathFrame,
} from "./action-paths.ts";
import type { VectorXZ } from "../../observer-world/interfaces.ts";
import type { VehicleActionFrame } from "./interfaces.ts";

const DEFAULT_ACTION_PATH_HORIZON_FRAMES = 36;
const DEFAULT_WAYPOINT_REACH_DISTANCE = 0.75;

/**
 * Flexible route-following option bag.
 *
 * The route shape is actor-owned, but this helper expects an optional
 * `waypoints` array of x/z positions when a route is present.
 */
type RoutePathOptions = Record<string, any>;

/**
 * Advances past already-reached waypoints without skipping the final target.
 */
function getNextWaypointIndex(
  waypoints: VectorXZ[],
  position: VectorXZ,
  currentIndex: number,
  waypointReachDistance: number,
): number {
  let nextIndex = Math.max(0, currentIndex);
  while (
    nextIndex < waypoints.length - 1
    && Math.hypot(
      waypoints[nextIndex].x - position.x,
      waypoints[nextIndex].z - position.z,
    ) <= waypointReachDistance
  ) {
    nextIndex += 1;
  }
  return nextIndex;
}

/**
 * Builds a feasible vehicle path that follows route waypoints in order.
 *
 * This is capability-level route following only. Actor-specific code decides
 * why a route was selected and passes any debug metadata through unchanged.
 */
export function buildActionPathAlongRoute({
  vehiclePosition,
  vehicleDirection,
  route,
  fallbackTargetPosition,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  horizonFrames = DEFAULT_ACTION_PATH_HORIZON_FRAMES,
  waypointReachDistance = DEFAULT_WAYPOINT_REACH_DISTANCE,
  metadata = {},
}: RoutePathOptions = {}): VehicleActionFrame[] {
  const waypoints = Array.isArray(route?.waypoints) && route.waypoints.length > 0
    ? route.waypoints
    : fallbackTargetPosition ? [fallbackTargetPosition] : [];
  if (!vehiclePosition || !vehicleDirection || waypoints.length === 0) {
    return [];
  }

  let position = clonePosition(vehiclePosition);
  let direction = cloneDirection(vehicleDirection);
  let waypointIndex = getNextWaypointIndex(
    waypoints,
    position,
    0,
    Number(waypointReachDistance) || DEFAULT_WAYPOINT_REACH_DISTANCE,
  );
  const path: VehicleActionFrame[] = [];
  const frameCount = Math.max(
    1,
    Math.floor(Number(horizonFrames) || DEFAULT_ACTION_PATH_HORIZON_FRAMES),
  );

  for (let frameOffset = 1; frameOffset <= frameCount; frameOffset += 1) {
    waypointIndex = getNextWaypointIndex(
      waypoints,
      position,
      waypointIndex,
      Number(waypointReachDistance) || DEFAULT_WAYPOINT_REACH_DISTANCE,
    );
    const targetPosition = waypoints[waypointIndex] ?? waypoints.at(-1);
    if (!targetPosition) {
      break;
    }
    const targetDirection = getDirectionToPosition(position, targetPosition);
    if (targetDirection.x === 0 && targetDirection.z === 0) {
      break;
    }
    const nextFrame = stepActionPathFrame({
      position,
      direction,
      throttle: 1,
      steering: getSteeringFromBearing(getBearingToDirection(direction, targetDirection)),
      speedUnitsPerFrame,
      turnRateRadiansPerFrame,
    });
    position = nextFrame.position;
    direction = nextFrame.direction;
    path.push(createActionFrame({
      frameOffset,
      throttle: nextFrame.throttle,
      steering: nextFrame.steering,
      position,
      direction,
      metadata: {
        ...metadata,
        waypointIndex,
        routeTargetPosition: { ...targetPosition },
      },
    }));
  }

  return path;
}
