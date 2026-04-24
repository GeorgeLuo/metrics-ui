import {
  CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
  CHASER_AUTOPILOT_SEARCH_LEAD_RADIANS,
  CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS,
} from "./constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "./math.mjs";
import { planLocalMovementDirection } from "./movement-strategies.mjs";

export function createChaserAutopilotState() {
  return {
    searchSteering: CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
    lastPursuitSource: "search",
    wallFollowSign: 1,
  };
}

function getSteeringFromBearing(bearingRadians) {
  return bearingRadians > CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS
    ? 1
    : bearingRadians < -CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS
      ? -1
      : 0;
}

function getDirectionToPosition(chaserPosition, targetPosition) {
  return normalizeVector(
    targetPosition.x - chaserPosition.x,
    targetPosition.z - chaserPosition.z,
  );
}

function getBearingToDirection(chaserLookDirection, direction) {
  return normalizeAngleDelta(vectorToAngle(direction) - vectorToAngle(chaserLookDirection));
}

function getDirectionFromPerception(chaserLookDirection, targetPerception) {
  return angleToVector(
    vectorToAngle(chaserLookDirection) + targetPerception.bearingRadians,
  );
}

function getSearchDirection(chaserLookDirection, autopilotState) {
  return angleToVector(
    vectorToAngle(chaserLookDirection)
      + (autopilotState?.searchSteering ?? CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING)
        * CHASER_AUTOPILOT_SEARCH_LEAD_RADIANS,
  );
}

export function selectPursuitPoint({
  chaserPosition,
  targetEstimate,
  predictionPlan,
  chaserSpeedUnitsPerSecond,
  speedUnitsPerSecond,
} = {}) {
  if (!chaserPosition) {
    return null;
  }

  if (predictionPlan?.actionable === false) {
    return null;
  }

  const path = Array.isArray(predictionPlan?.path) ? predictionPlan.path : [];
  const safeSpeed = Math.max(
    0.001,
    Number(chaserSpeedUnitsPerSecond ?? speedUnitsPerSecond) || 0,
  );
  let fallbackSample = null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index]?.position) {
      fallbackSample = path[index];
      break;
    }
  }

  for (const sample of path) {
    if (!sample?.position || !Number.isFinite(sample.secondsAhead)) {
      continue;
    }

    const distance = Math.hypot(
      sample.position.x - chaserPosition.x,
      sample.position.z - chaserPosition.z,
    );
    if (sample.secondsAhead >= distance / safeSpeed) {
      return {
        position: sample.position,
        source: "reachable-projection",
        sample,
      };
    }
  }

  if (fallbackSample?.position) {
    return {
      position: fallbackSample.position,
      source: "projection-lookahead",
      sample: fallbackSample,
    };
  }

  if (targetEstimate?.position) {
    return {
      position: targetEstimate.position,
      source: "current-estimate",
      sample: null,
    };
  }

  return null;
}

export function getProgrammaticChaserInput({
  targetPerception,
  chaserPosition,
  chaserLookDirection,
  targetEstimate,
  predictionPlan,
  autopilotState,
  chaserSpeedUnitsPerSecond,
  speedUnitsPerSecond,
  columns,
  rows,
  obstacles,
} = {}) {
  const pursuitPoint = selectPursuitPoint({
    chaserPosition,
    targetEstimate,
    predictionPlan,
    chaserSpeedUnitsPerSecond,
    speedUnitsPerSecond,
  });
  let goalDirection = null;
  let pursuitSource = "search";

  if (pursuitPoint?.position) {
    goalDirection = getDirectionToPosition(chaserPosition, pursuitPoint.position);
    pursuitSource = pursuitPoint.source;
  } else if (targetPerception?.visible && chaserLookDirection) {
    goalDirection = getDirectionFromPerception(chaserLookDirection, targetPerception);
    pursuitSource = "visible-bearing";
  } else if (chaserLookDirection) {
    goalDirection = getSearchDirection(chaserLookDirection, autopilotState);
  }

  const movement = planLocalMovementDirection({
    position: chaserPosition,
    goalDirection,
    columns,
    rows,
    obstacles,
    previousWallFollowSign: autopilotState?.wallFollowSign,
  });
  const desiredDirection = movement.direction.x === 0 && movement.direction.z === 0
    ? goalDirection
    : movement.direction;

  if (desiredDirection && chaserLookDirection) {
    const bearingRadians = getBearingToDirection(chaserLookDirection, desiredDirection);
    const steering = getSteeringFromBearing(bearingRadians);
    if (autopilotState) {
      autopilotState.lastPursuitSource = movement.wallPressure?.active
        ? `${pursuitSource}+local-wall`
        : pursuitSource;
      autopilotState.wallFollowSign = movement.wallFollowSign;
      if (steering !== 0) {
        autopilotState.searchSteering = steering;
      }
    }
    return {
      forward: true,
      steering,
      pursuitPoint,
      movement,
    };
  }

  if (!targetPerception?.visible) {
    if (autopilotState) {
      autopilotState.lastPursuitSource = "search";
    }
    return {
      forward: true,
      steering: autopilotState?.searchSteering ?? CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
    };
  }

  const steering = getSteeringFromBearing(targetPerception.bearingRadians);
  if (autopilotState) {
    autopilotState.lastPursuitSource = "visible-bearing";
    if (steering !== 0) {
      autopilotState.searchSteering = steering;
    }
  }

  return {
    forward: true,
    steering,
  };
}
