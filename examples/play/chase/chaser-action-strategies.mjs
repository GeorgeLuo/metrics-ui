import {
  CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
  CHASER_AUTOPILOT_SEARCH_LEAD_RADIANS,
  CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS,
  CHASER_STRATEGY_CONSENSUS_COUPLING,
  CHASER_STRATEGY_CONSENSUS_ITERATIONS,
} from "./constants.mjs";
import { runKuramotoConsensus } from "./kuramoto.mjs";
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

function getDirectionToPosition(chaserPosition, evaderPosition) {
  return normalizeVector(
    evaderPosition.x - chaserPosition.x,
    evaderPosition.z - chaserPosition.z,
  );
}

function getBearingToDirection(chaserLookDirection, direction) {
  return normalizeAngleDelta(vectorToAngle(direction) - vectorToAngle(chaserLookDirection));
}

function getDirectionFromPerception(chaserLookDirection, evaderPerception) {
  return angleToVector(
    vectorToAngle(chaserLookDirection) + evaderPerception.bearingRadians,
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
    confidence: 0,
    ...extra,
  };
}

export const CHASER_MOTIVE_IDS = Object.freeze({
  CHASE: "chase",
  SEARCH: "search",
});

export function buildChaserMotiveSignal({
  evaderLocation,
} = {}) {
  const evaderInLineOfSight = Boolean(evaderLocation?.visible);
  return {
    id: evaderInLineOfSight ? CHASER_MOTIVE_IDS.CHASE : CHASER_MOTIVE_IDS.SEARCH,
    source: "line-of-sight-rule",
    reason: evaderInLineOfSight ? "evader-visible" : "evader-not-visible",
    confidence: 1,
    evaderInLineOfSight,
  };
}

export function selectPursuitPoint({
  chaserPosition,
  snapshot,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
} = {}) {
  if (!chaserPosition) {
    return null;
  }

  const evaderPredictionPlan = snapshot?.strategies?.evaderPrediction ?? null;
  const continuance = snapshot?.patterns?.continuance ?? null;

  if (evaderPredictionPlan?.actionable === false) {
    return null;
  }

  const path = Array.isArray(evaderPredictionPlan?.path) ? evaderPredictionPlan.path : [];
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

  if (continuance?.position) {
    return {
      position: continuance.position,
      source: "current-estimate",
      sample: null,
    };
  }

  return null;
}

export function buildEvaderPredictionPursuitProposal({
  enabled,
  chaserPosition,
  snapshot,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
} = {}) {
  if (!enabled) {
    return createInactiveActionProposal("evaderPredictionPursuit");
  }

  const pursuitPoint = selectPursuitPoint({
    chaserPosition,
    snapshot,
    chaserSpeedUnitsPerFrame,
    speedUnitsPerFrame,
  });

  if (!pursuitPoint?.position) {
    return createInactiveActionProposal("evaderPredictionPursuit", { pursuitPoint: null });
  }

  return {
    id: "evaderPredictionPursuit",
    active: true,
    confidence: Number(snapshot?.strategies?.evaderPrediction?.prediction?.consensus) || 1,
    pursuitPoint,
    pursuitSource: pursuitPoint.source,
    goalDirection: getDirectionToPosition(chaserPosition, pursuitPoint.position),
  };
}

export function buildVisibleBearingFallbackProposal({
  enabled,
  chaserLookDirection,
  evaderLocation,
} = {}) {
  if (!enabled || !evaderLocation?.visible || !chaserLookDirection) {
    return createInactiveActionProposal("lineOfSightPursuit");
  }

  return {
    id: "lineOfSightPursuit",
    active: true,
    confidence: 1,
    pursuitSource: "visible-bearing",
    goalDirection: getDirectionFromPerception(chaserLookDirection, evaderLocation),
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
    confidence: 1,
    pursuitSource: "search",
    goalDirection: getSearchDirection(chaserLookDirection, searchSteering),
  };
}

function createPeerConsensusSignal(proposal) {
  const direction = normalizeVector(
    proposal?.goalDirection?.x ?? 0,
    proposal?.goalDirection?.z ?? 0,
  );
  if (!proposal?.active || (direction.x === 0 && direction.z === 0)) {
    return null;
  }

  return {
    id: proposal.id,
    direction,
    confidence: Number.isFinite(proposal.confidence) ? proposal.confidence : 1,
    weight: 1,
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

function getPrimaryPeerProposal(proposals) {
  if (proposals.evaderPredictionPursuit?.active) {
    return proposals.evaderPredictionPursuit;
  }
  if (proposals.lineOfSightPursuit?.active) {
    return proposals.lineOfSightPursuit;
  }
  return proposals.search?.active ? proposals.search : null;
}

export function planProgrammaticChaserAction({
  snapshot,
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
  const evaderLocation = snapshot?.memory?.directObservation?.evaderLocation ?? { visible: false };
  const motiveSignal = buildChaserMotiveSignal({ evaderLocation });
  const shouldChase = motiveSignal.id === CHASER_MOTIVE_IDS.CHASE;
  const shouldSearch = motiveSignal.id === CHASER_MOTIVE_IDS.SEARCH;

  const proposals = {
    evaderPredictionPursuit: buildEvaderPredictionPursuitProposal({
      enabled: shouldChase && actionEngines.evaderPredictionPursuit !== false,
      chaserPosition,
      snapshot,
      chaserSpeedUnitsPerFrame,
      speedUnitsPerFrame,
    }),
    lineOfSightPursuit: buildVisibleBearingFallbackProposal({
      enabled: shouldChase && actionEngines.lineOfSightPursuit !== false,
      chaserLookDirection,
      evaderLocation,
    }),
    search: createInactiveActionProposal("search"),
  };

  proposals.search = buildSearchProposal({
    enabled: shouldSearch && actionEngines.search !== false,
    chaserLookDirection,
    searchSteering,
  });

  const peerSignals = [
    createPeerConsensusSignal(proposals.evaderPredictionPursuit),
    createPeerConsensusSignal(proposals.lineOfSightPursuit),
    createPeerConsensusSignal(proposals.search),
  ].filter(Boolean);
  const peerConsensus = runKuramotoConsensus(peerSignals, {
    coupling: CHASER_STRATEGY_CONSENSUS_COUPLING,
    iterations: CHASER_STRATEGY_CONSENSUS_ITERATIONS,
  });

  const primaryProposal = getPrimaryPeerProposal(proposals);
  const goalDirection = peerConsensus.direction.x === 0 && peerConsensus.direction.z === 0
    ? primaryProposal?.goalDirection ?? null
    : peerConsensus.direction;
  const pursuitPoint = proposals.evaderPredictionPursuit.active
    ? proposals.evaderPredictionPursuit.pursuitPoint ?? null
    : null;
  const activePeerIds = peerSignals.map((signal) => signal.id);
  const chosenPeerLabel = activePeerIds.length > 0
    ? activePeerIds.join("+")
    : "none";
  const localNavigation = buildLocalNavigationProposal({
    enabled: true,
    chaserPosition,
    goalDirection,
    columns,
    rows,
    obstacles,
    previousWallFollowSign,
  });
  proposals.peerConsensus = {
    id: "strategyConsensus",
    active: activePeerIds.length > 0,
    activePeerIds,
    consensus: peerConsensus,
    direction: goalDirection,
  };
  proposals.motiveSignal = motiveSignal;
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
        ? `${chosenPeerLabel}+wallSafety`
        : chosenPeerLabel,
      searchSteeringHint: proposals.search.active && steering !== 0 ? steering : null,
      wallFollowSign: movement.wallFollowSign,
      proposals,
    };
  }

  if (!evaderLocation?.visible) {
    if (!proposals.search.active) {
      return {
        forward: false,
        reverse: false,
        steering: 0,
        desiredDirection: null,
        chosenStrategy: "none",
        searchSteeringHint: null,
        wallFollowSign: movement.wallFollowSign,
        proposals,
      };
    }
    return {
      forward: true,
      reverse: false,
      steering: searchSteering,
      desiredDirection: null,
      chosenStrategy: "search",
      searchSteeringHint: null,
      wallFollowSign: movement.wallFollowSign,
      proposals,
    };
  }

  const steering = getSteeringFromBearing(evaderLocation.bearingRadians);
  if (!proposals.lineOfSightPursuit.active) {
    return {
      forward: false,
      reverse: false,
      steering: 0,
      desiredDirection: null,
      chosenStrategy: "none",
      searchSteeringHint: null,
      wallFollowSign: movement.wallFollowSign,
      proposals,
    };
  }
  return {
    forward: true,
    reverse: false,
    steering,
    desiredDirection: null,
    chosenStrategy: "lineOfSightPursuit",
    searchSteeringHint: null,
    wallFollowSign: movement.wallFollowSign,
    proposals,
  };
}
