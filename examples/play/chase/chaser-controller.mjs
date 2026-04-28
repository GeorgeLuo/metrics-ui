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
    actionEngines: createChaserActionEngines(),
  };
}

export const CHASER_ACTION_ENGINE_IDS = Object.freeze({
  PROJECTION_PURSUIT: "projectionPursuit",
  VISIBLE_BEARING_FALLBACK: "visibleBearingFallback",
  SEARCH: "search",
  LOCAL_NAVIGATION: "localNavigation",
});

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

export function createChaserActionEngines(overrides = {}) {
  return {
    [CHASER_ACTION_ENGINE_IDS.PROJECTION_PURSUIT]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.PROJECTION_PURSUIT],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.VISIBLE_BEARING_FALLBACK]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.VISIBLE_BEARING_FALLBACK],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.SEARCH]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.SEARCH],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.LOCAL_NAVIGATION]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.LOCAL_NAVIGATION],
      true,
    ),
  };
}

export function setChaserActionEngineEnabled(autopilotState, engineId, enabled) {
  if (!autopilotState?.actionEngines || !(engineId in autopilotState.actionEngines)) {
    return;
  }
  autopilotState.actionEngines[engineId] = Boolean(enabled);
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
  knowledgeBase,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
} = {}) {
  if (!chaserPosition) {
    return null;
  }

  const predictionPlan = knowledgeBase?.predictionPlan;
  const targetMotionHypothesis = knowledgeBase?.targetMotionHypothesis
    ?? knowledgeBase?.patterns?.targetMotionHypothesis
    ?? knowledgeBase?.targetEstimate;

  if (predictionPlan?.actionable === false) {
    return null;
  }

  const path = Array.isArray(predictionPlan?.path) ? predictionPlan.path : [];
  const safeSpeed = Math.max(
    0.001,
    Number(chaserSpeedUnitsPerFrame ?? speedUnitsPerFrame) || 0,
  );
  let fallbackSample = null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index]?.position) {
      fallbackSample = path[index];
      break;
    }
  }

  for (const sample of path) {
    if (!sample?.position || !Number.isFinite(sample.framesAhead)) {
      continue;
    }

    const distance = Math.hypot(
      sample.position.x - chaserPosition.x,
      sample.position.z - chaserPosition.z,
    );
    if (sample.framesAhead >= distance / safeSpeed) {
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

  if (targetMotionHypothesis?.position) {
    return {
      position: targetMotionHypothesis.position,
      source: "current-estimate",
      sample: null,
    };
  }

  return null;
}

export function getProgrammaticChaserInput({
  knowledgeBase,
  chaserPosition,
  chaserLookDirection,
  autopilotState,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  columns,
  rows,
  obstacles,
} = {}) {
  const actionEngines = autopilotState?.actionEngines ?? createChaserActionEngines();
  const targetLocation = knowledgeBase?.targetLocation
    ?? knowledgeBase?.memory?.targetLocation
    ?? knowledgeBase?.perception
    ?? { visible: false };
  const pursuitPoint = actionEngines[CHASER_ACTION_ENGINE_IDS.PROJECTION_PURSUIT]
    ? selectPursuitPoint({
      chaserPosition,
      knowledgeBase,
      chaserSpeedUnitsPerFrame,
      speedUnitsPerFrame,
    })
    : null;
  let goalDirection = null;
  let pursuitSource = "search";

  if (pursuitPoint?.position) {
    goalDirection = getDirectionToPosition(chaserPosition, pursuitPoint.position);
    pursuitSource = pursuitPoint.source;
  } else if (
    actionEngines[CHASER_ACTION_ENGINE_IDS.VISIBLE_BEARING_FALLBACK]
    && targetLocation?.visible
    && chaserLookDirection
  ) {
    goalDirection = getDirectionFromPerception(chaserLookDirection, targetLocation);
    pursuitSource = "visible-bearing";
  } else if (actionEngines[CHASER_ACTION_ENGINE_IDS.SEARCH] && chaserLookDirection) {
    goalDirection = getSearchDirection(chaserLookDirection, autopilotState);
  }

  const movement = actionEngines[CHASER_ACTION_ENGINE_IDS.LOCAL_NAVIGATION]
    ? planLocalMovementDirection({
      position: chaserPosition,
      goalDirection,
      columns,
      rows,
      obstacles,
      previousWallFollowSign: autopilotState?.wallFollowSign,
    })
    : {
      direction: goalDirection ?? { x: 0, z: 0 },
      wallPressure: null,
      wallFollowSign: autopilotState?.wallFollowSign ?? 1,
      signals: [],
      consensus: null,
    };
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

  if (!targetLocation?.visible) {
    if (autopilotState) {
      autopilotState.lastPursuitSource = "search";
    }
    return {
      forward: true,
      steering: autopilotState?.searchSteering ?? CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
    };
  }

  const steering = getSteeringFromBearing(targetLocation.bearingRadians);
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
