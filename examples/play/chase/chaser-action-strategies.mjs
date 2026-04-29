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

function getSearchDirection(chaserLookDirection, searchSteering) {
  return angleToVector(
    vectorToAngle(chaserLookDirection)
      + searchSteering * CHASER_AUTOPILOT_SEARCH_LEAD_RADIANS,
  );
}

function createInactiveActionProposal(id, extra = {}) {
  return {
    id,
    active: false,
    ...extra,
  };
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

export function buildProjectionPursuitProposal({
  enabled,
  chaserPosition,
  knowledgeBase,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
} = {}) {
  if (!enabled) {
    return createInactiveActionProposal("projectionPursuit");
  }

  const pursuitPoint = selectPursuitPoint({
    chaserPosition,
    knowledgeBase,
    chaserSpeedUnitsPerFrame,
    speedUnitsPerFrame,
  });

  if (!pursuitPoint?.position) {
    return createInactiveActionProposal("projectionPursuit", { pursuitPoint: null });
  }

  return {
    id: "projectionPursuit",
    active: true,
    pursuitPoint,
    pursuitSource: pursuitPoint.source,
    goalDirection: getDirectionToPosition(chaserPosition, pursuitPoint.position),
  };
}

export function buildVisibleBearingFallbackProposal({
  enabled,
  chaserLookDirection,
  targetLocation,
} = {}) {
  if (!enabled || !targetLocation?.visible || !chaserLookDirection) {
    return createInactiveActionProposal("visibleBearingFallback");
  }

  return {
    id: "visibleBearingFallback",
    active: true,
    pursuitSource: "visible-bearing",
    goalDirection: getDirectionFromPerception(chaserLookDirection, targetLocation),
  };
}

export function buildSearchProposal({
  enabled,
  chaserLookDirection,
  searchSteering = CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
} = {}) {
  if (!enabled || !chaserLookDirection) {
    return createInactiveActionProposal("search");
  }

  return {
    id: "search",
    active: true,
    pursuitSource: "search",
    goalDirection: getSearchDirection(chaserLookDirection, searchSteering),
  };
}

export function buildLocalNavigationProposal({
  enabled,
  chaserPosition,
  goalDirection,
  columns,
  rows,
  obstacles,
  previousWallFollowSign,
} = {}) {
  if (!enabled) {
    return {
      id: "localNavigation",
      active: false,
      movement: {
        direction: goalDirection ?? { x: 0, z: 0 },
        wallPressure: null,
        wallFollowSign: previousWallFollowSign ?? 1,
        signals: [],
        consensus: null,
      },
    };
  }

  return {
    id: "localNavigation",
    active: true,
    movement: planLocalMovementDirection({
      position: chaserPosition,
      goalDirection,
      columns,
      rows,
      obstacles,
      previousWallFollowSign,
    }),
  };
}

function chooseBaseGoalProposal(proposals) {
  if (proposals.projectionPursuit?.active) {
    return proposals.projectionPursuit;
  }
  if (proposals.visibleBearingFallback?.active) {
    return proposals.visibleBearingFallback;
  }
  if (proposals.search?.active) {
    return proposals.search;
  }
  return null;
}

export function planProgrammaticChaserAction({
  knowledgeBase,
  chaserPosition,
  chaserLookDirection,
  actionEngines = {},
  searchSteering = CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
  previousWallFollowSign = 1,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  columns,
  rows,
  obstacles,
} = {}) {
  const targetLocation = knowledgeBase?.targetLocation
    ?? knowledgeBase?.memory?.targetLocation
    ?? knowledgeBase?.perception
    ?? { visible: false };

  const proposals = {
    projectionPursuit: buildProjectionPursuitProposal({
      enabled: actionEngines.projectionPursuit !== false,
      chaserPosition,
      knowledgeBase,
      chaserSpeedUnitsPerFrame,
      speedUnitsPerFrame,
    }),
    visibleBearingFallback: buildVisibleBearingFallbackProposal({
      enabled: actionEngines.visibleBearingFallback !== false,
      chaserLookDirection,
      targetLocation,
    }),
    search: buildSearchProposal({
      enabled: actionEngines.search !== false,
      chaserLookDirection,
      searchSteering,
    }),
  };

  const chosenGoalProposal = chooseBaseGoalProposal(proposals);
  const goalDirection = chosenGoalProposal?.goalDirection ?? null;
  const pursuitPoint = chosenGoalProposal?.pursuitPoint ?? null;
  const pursuitSource = chosenGoalProposal?.pursuitSource ?? "search";
  const localNavigation = buildLocalNavigationProposal({
    enabled: actionEngines.localNavigation !== false,
    chaserPosition,
    goalDirection,
    columns,
    rows,
    obstacles,
    previousWallFollowSign,
  });
  proposals.localNavigation = localNavigation;

  const movement = localNavigation.movement;
  const desiredDirection = movement.direction.x === 0 && movement.direction.z === 0
    ? goalDirection
    : movement.direction;

  if (desiredDirection && chaserLookDirection) {
    const bearingRadians = getBearingToDirection(chaserLookDirection, desiredDirection);
    const steering = getSteeringFromBearing(bearingRadians);
    return {
      forward: true,
      steering,
      pursuitPoint,
      movement,
      desiredDirection,
      chosenStrategy: movement.wallPressure?.active
        ? `${pursuitSource}+local-wall`
        : pursuitSource,
      searchSteeringHint: steering !== 0 ? steering : null,
      wallFollowSign: movement.wallFollowSign,
      proposals,
    };
  }

  if (!targetLocation?.visible) {
    return {
      forward: true,
      steering: searchSteering,
      desiredDirection: null,
      chosenStrategy: "search",
      searchSteeringHint: null,
      wallFollowSign: movement.wallFollowSign,
      proposals,
    };
  }

  const steering = getSteeringFromBearing(targetLocation.bearingRadians);
  return {
    forward: true,
    steering,
    desiredDirection: null,
    chosenStrategy: "visible-bearing",
    searchSteeringHint: steering !== 0 ? steering : null,
    wallFollowSign: movement.wallFollowSign,
    proposals,
  };
}
