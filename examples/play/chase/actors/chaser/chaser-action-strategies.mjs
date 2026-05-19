import {
  CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
  CHASER_AUTOPILOT_SPIN_LEAD_RADIANS,
  CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS,
  CHASER_STRATEGY_CONSENSUS_COUPLING,
  CHASER_STRATEGY_CONSENSUS_ITERATIONS,
  DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
} from "../../config/constants.mjs";
import { buildKnowledgeAcquisitionProposals } from "./knowledge/chaser-knowledge-acquisition.mjs";
import { runKuramotoConsensus } from "../../decision-model/kuramoto.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../decision-model/math.mjs";
import {
  CHASER_CHASE_MOTIVE_STRATEGY_IDS,
  CHASER_KNOWLEDGE_MOTIVE_STRATEGY_IDS,
  CHASER_LEGACY_STRATEGY_IDS,
  CHASER_MOTIVE_IDS,
  CHASER_STRATEGY_IDS,
} from "../../config/strategy-ids.mjs";

const DEFAULT_ACTION_PATH_HORIZON_FRAMES = 36;
const MAX_ACTION_PATH_HORIZON_FRAMES = 120;

function clampNumber(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }
  return Math.max(min, Math.min(max, numericValue));
}

function clampUnit(value) {
  return clampNumber(value, -1, 1);
}

function getPositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function normalizeActionPathHorizon(value) {
  return Math.min(
    MAX_ACTION_PATH_HORIZON_FRAMES,
    getPositiveInteger(value, DEFAULT_ACTION_PATH_HORIZON_FRAMES),
  );
}

function clonePosition(position, fallback = { x: 0, z: 0 }) {
  const x = Number(position?.x);
  const z = Number(position?.z);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

function cloneDirection(direction, fallback = { x: 1, z: 0 }) {
  const x = Number(direction?.x);
  const z = Number(direction?.z);
  const normalized = normalizeVector(
    Number.isFinite(x) ? x : fallback.x,
    Number.isFinite(z) ? z : fallback.z,
  );
  return normalized.x === 0 && normalized.z === 0 ? { ...fallback } : normalized;
}

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

function getSpinDirection(chaserLookDirection, spinSteering) {
  return angleToVector(
    vectorToAngle(chaserLookDirection)
      + spinSteering * CHASER_AUTOPILOT_SPIN_LEAD_RADIANS,
  );
}

function stepActionPathFrame({
  position,
  direction,
  throttle,
  steering,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
} = {}) {
  const currentPosition = clonePosition(position);
  const currentDirection = cloneDirection(direction);
  const resolvedThrottle = clampUnit(throttle);
  const resolvedSteering = clampUnit(steering);
  const speed = Math.max(0, Number(speedUnitsPerFrame) || 0);
  const turnRate = Math.max(
    0,
    Number(turnRateRadiansPerFrame) || DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
  );
  const isMoving = Math.abs(resolvedThrottle) > 0.001;
  const nextDirection = isMoving && resolvedSteering !== 0
    ? angleToVector(
      vectorToAngle(currentDirection)
        + resolvedSteering * turnRate * (resolvedThrottle < 0 ? -1 : 1),
    )
    : currentDirection;
  const nextPosition = {
    x: currentPosition.x + nextDirection.x * speed * resolvedThrottle,
    z: currentPosition.z + nextDirection.z * speed * resolvedThrottle,
  };

  return {
    throttle: resolvedThrottle,
    steering: resolvedSteering,
    position: nextPosition,
    direction: nextDirection,
  };
}

function createActionFrame({
  frameOffset,
  throttle,
  steering,
  position,
  direction,
  metadata = {},
}) {
  const resolvedThrottle = clampUnit(throttle);
  const resolvedSteering = clampUnit(steering);
  return {
    frameOffset,
    framesAhead: frameOffset,
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

function buildFeasibleActionPath({
  chaserPosition,
  chaserLookDirection,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  horizonFrames,
  getFrameSteering,
  getFrameThrottle = () => 1,
  metadata = {},
} = {}) {
  let position = clonePosition(chaserPosition);
  let direction = cloneDirection(chaserLookDirection);
  const path = [];
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
      metadata,
    }));
  }

  return path;
}

function buildActionPathToPosition({
  chaserPosition,
  chaserLookDirection,
  targetPosition,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  horizonFrames,
  metadata,
} = {}) {
  if (!targetPosition) {
    return [];
  }
  return buildFeasibleActionPath({
    chaserPosition,
    chaserLookDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    horizonFrames,
    metadata: {
      ...metadata,
      targetPosition: clonePosition(targetPosition),
    },
    getFrameSteering: ({ position, direction }) => {
      const targetDirection = getDirectionToPosition(position, targetPosition);
      return getSteeringFromBearing(getBearingToDirection(direction, targetDirection));
    },
  });
}

function buildActionPathToDirection({
  chaserPosition,
  chaserLookDirection,
  targetDirection,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  horizonFrames,
  metadata,
} = {}) {
  const normalizedTargetDirection = normalizeVector(targetDirection?.x ?? 0, targetDirection?.z ?? 0);
  if (normalizedTargetDirection.x === 0 && normalizedTargetDirection.z === 0) {
    return [];
  }
  return buildFeasibleActionPath({
    chaserPosition,
    chaserLookDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    horizonFrames,
    metadata: {
      ...metadata,
      targetDirection: normalizedTargetDirection,
    },
    getFrameSteering: ({ direction }) =>
      getSteeringFromBearing(getBearingToDirection(direction, normalizedTargetDirection)),
  });
}

function buildSpinActionPath({
  chaserPosition,
  chaserLookDirection,
  spinSteering,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  horizonFrames,
} = {}) {
  const steering = clampUnit(spinSteering);
  return buildFeasibleActionPath({
    chaserPosition,
    chaserLookDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    horizonFrames,
    metadata: {
      targetDirection: getSpinDirection(chaserLookDirection, steering),
    },
    getFrameSteering: () => steering,
  });
}

function createInactiveActionProposal(id, extra = {}) {
  return {
    id,
    active: false,
    confidence: 0,
    actionPath: [],
    firstAction: null,
    ...extra,
  };
}

function getActionEngineEnabled(actionEngines, strategyId) {
  if (strategyId === CHASER_STRATEGY_IDS.SPIN
    && actionEngines?.[strategyId] === undefined
    && actionEngines?.[CHASER_LEGACY_STRATEGY_IDS.SEARCH] !== undefined) {
    return actionEngines[CHASER_LEGACY_STRATEGY_IDS.SEARCH] !== false;
  }
  return actionEngines?.[strategyId] !== false;
}

function hasEnabledStrategy(actionEngines, strategyIds) {
  return strategyIds.some((strategyId) => getActionEngineEnabled(actionEngines, strategyId));
}

export function buildChaserMotiveSignal({
  evaderLocation,
  actionEngines = {},
} = {}) {
  const evaderInLineOfSight = Boolean(evaderLocation?.visible);
  const chaseStrategyEnabled = hasEnabledStrategy(
    actionEngines,
    CHASER_CHASE_MOTIVE_STRATEGY_IDS,
  );
  const knowledgeStrategyEnabled = hasEnabledStrategy(
    actionEngines,
    CHASER_KNOWLEDGE_MOTIVE_STRATEGY_IDS,
  );
  const shouldChase = evaderInLineOfSight && chaseStrategyEnabled;
  const reason = evaderInLineOfSight
    ? chaseStrategyEnabled
      ? "evader-visible"
      : knowledgeStrategyEnabled
        ? "evader-visible-chase-disabled"
        : "evader-visible-no-enabled-strategy"
    : "evader-not-visible";

  return {
    id: shouldChase
      ? CHASER_MOTIVE_IDS.CHASE
      : CHASER_MOTIVE_IDS.KNOWLEDGE_ACQUISITION,
    source: "line-of-sight-rule",
    reason,
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
  chaserLookDirection,
  snapshot,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
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

  const goalDirection = getDirectionToPosition(chaserPosition, pursuitPoint.position);
  const actionPath = buildActionPathToPosition({
    chaserPosition,
    chaserLookDirection,
    targetPosition: pursuitPoint.position,
    speedUnitsPerFrame: chaserSpeedUnitsPerFrame ?? speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    horizonFrames: pursuitPoint.sample?.framesAhead,
    metadata: {
      proposalId: "evaderPredictionPursuit",
      pursuitSource: pursuitPoint.source,
    },
  });

  return {
    id: "evaderPredictionPursuit",
    active: true,
    confidence: Number(snapshot?.strategies?.evaderPrediction?.prediction?.consensus) || 1,
    pursuitPoint,
    pursuitSource: pursuitPoint.source,
    goalDirection,
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}

export function buildVisibleBearingFallbackProposal({
  enabled,
  chaserPosition,
  chaserLookDirection,
  evaderLocation,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
} = {}) {
  if (!enabled || !evaderLocation?.visible || !chaserLookDirection) {
    return createInactiveActionProposal("lineOfSightPursuit");
  }

  const goalDirection = getDirectionFromPerception(chaserLookDirection, evaderLocation);
  const actionPath = buildActionPathToDirection({
    chaserPosition,
    chaserLookDirection,
    targetDirection: goalDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    metadata: {
      proposalId: "lineOfSightPursuit",
      pursuitSource: "visible-bearing",
    },
  });

  return {
    id: "lineOfSightPursuit",
    active: true,
    confidence: 1,
    pursuitSource: "visible-bearing",
    goalDirection,
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}

export function buildSpinProposal({
  enabled,
  chaserPosition,
  chaserLookDirection,
  spinSteering = CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
} = {}) {
  if (!enabled || !chaserLookDirection) {
    return createInactiveActionProposal(CHASER_STRATEGY_IDS.SPIN);
  }

  const actionPath = buildSpinActionPath({
    chaserPosition,
    chaserLookDirection,
    spinSteering,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
  });

  return {
    id: CHASER_STRATEGY_IDS.SPIN,
    active: true,
    confidence: 0.35,
    pursuitSource: CHASER_STRATEGY_IDS.SPIN,
    goalDirection: getSpinDirection(chaserLookDirection, spinSteering),
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}

function createPeerConsensusSignal(proposal) {
  const direction = normalizeVector(
    proposal?.firstAction?.predictedDirection?.x ?? proposal?.goalDirection?.x ?? 0,
    proposal?.firstAction?.predictedDirection?.z ?? proposal?.goalDirection?.z ?? 0,
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
  direction,
  actionPath = [],
  previousWallFollowSign,
} = {}) {
  return {
    id: "localNavigation",
    active: Boolean(enabled),
    disabledReason: "chaser-wall-safety-disabled",
    movement: {
      direction: direction ?? { x: 0, z: 0 },
      wallPressure: null,
      wallFollowSign: previousWallFollowSign ?? 1,
      signals: [],
      consensus: null,
      actionPath,
    },
  };
}

function getActivePathProposals(proposals) {
  return [
    proposals.evaderPredictionPursuit,
    proposals.lineOfSightPursuit,
    proposals.mapDiscovery,
    proposals.mapRecencyRefresh,
    proposals.spin,
  ].filter((proposal) => proposal?.active && Array.isArray(proposal.actionPath)
    && proposal.actionPath.length > 0);
}

function getProposalFrame(proposal, index) {
  if (!proposal?.actionPath?.length) {
    return null;
  }
  return proposal.actionPath[Math.min(index, proposal.actionPath.length - 1)] ?? null;
}

function mixProposalActionAtFrame(proposals, index) {
  const weightedFrames = proposals.flatMap((proposal) => {
    const frame = getProposalFrame(proposal, index);
    const confidence = Number.isFinite(proposal?.confidence)
      ? Math.max(0, Math.min(1, proposal.confidence))
      : 1;
    return frame && confidence > 0
      ? [{
        frame,
        proposal,
        weight: confidence,
      }]
      : [];
  });
  const totalWeight = weightedFrames.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  const throttle = weightedFrames.reduce(
    (sum, entry) => sum + (Number(entry.frame.throttle) || 0) * entry.weight,
    0,
  ) / totalWeight;
  const steering = weightedFrames.reduce(
    (sum, entry) => sum + (Number(entry.frame.steer) || 0) * entry.weight,
    0,
  ) / totalWeight;

  return {
    throttle: clampUnit(throttle),
    steering: clampUnit(steering),
    sourceProposalIds: weightedFrames.map((entry) => entry.proposal.id),
  };
}

function buildActionPathConsensus({
  proposals,
  chaserPosition,
  chaserLookDirection,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
} = {}) {
  const activeProposals = getActivePathProposals(proposals);
  if (activeProposals.length === 0) {
    return {
      id: "actionPathConsensus",
      active: false,
      path: [],
      firstAction: null,
      sourceProposalIds: [],
    };
  }

  const horizonFrames = Math.max(
    1,
    ...activeProposals.map((proposal) => proposal.actionPath.length),
  );
  let position = clonePosition(chaserPosition);
  let direction = cloneDirection(chaserLookDirection);
  const path = [];

  for (let index = 0; index < horizonFrames; index += 1) {
    const mixedAction = mixProposalActionAtFrame(activeProposals, index);
    if (!mixedAction) {
      break;
    }
    const nextFrame = stepActionPathFrame({
      position,
      direction,
      throttle: mixedAction.throttle,
      steering: mixedAction.steering,
      speedUnitsPerFrame,
      turnRateRadiansPerFrame,
    });
    position = nextFrame.position;
    direction = nextFrame.direction;
    path.push(createActionFrame({
      frameOffset: index + 1,
      throttle: nextFrame.throttle,
      steering: nextFrame.steering,
      position,
      direction,
      metadata: {
        sourceProposalIds: mixedAction.sourceProposalIds,
      },
    }));
  }

  return {
    id: "actionPathConsensus",
    active: path.length > 0,
    path,
    firstAction: path[0] ?? null,
    sourceProposalIds: activeProposals.map((proposal) => proposal.id),
  };
}

function getPrimaryPeerProposal(proposals) {
  return getActivePathProposals(proposals)
    .sort((first, second) =>
      (Number(second.confidence) || 0) - (Number(first.confidence) || 0))
    [0] ?? null;
}

export function planProgrammaticChaserAction({
  snapshot,
  chaserPosition,
  chaserLookDirection,
  actionEngines = {},
  spinSteering = CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
  previousWallFollowSign = 1,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  frameIndex,
  columns,
  rows,
} = {}) {
  const evaderLocation = snapshot?.memory?.directObservation?.evaderLocation ?? { visible: false };
  const motiveSignal = buildChaserMotiveSignal({ evaderLocation, actionEngines });
  const shouldChase = motiveSignal.id === CHASER_MOTIVE_IDS.CHASE;
  const shouldAcquireKnowledge = motiveSignal.id === CHASER_MOTIVE_IDS.KNOWLEDGE_ACQUISITION;
  const actionSpeedUnitsPerFrame = chaserSpeedUnitsPerFrame ?? speedUnitsPerFrame;
  const knowledgeProposals = buildKnowledgeAcquisitionProposals({
    enabled: shouldAcquireKnowledge,
    actionEngines,
    snapshot,
    chaserPosition,
    chaserLookDirection,
    frameIndex,
    speedUnitsPerFrame: actionSpeedUnitsPerFrame,
    turnRateRadiansPerFrame,
    columns,
    rows,
  });

  const proposals = {
    evaderPredictionPursuit: buildEvaderPredictionPursuitProposal({
      enabled: shouldChase && actionEngines.evaderPredictionPursuit !== false,
      chaserPosition,
      chaserLookDirection,
      snapshot,
      chaserSpeedUnitsPerFrame: actionSpeedUnitsPerFrame,
      turnRateRadiansPerFrame,
    }),
    lineOfSightPursuit: buildVisibleBearingFallbackProposal({
      enabled: shouldChase && actionEngines.lineOfSightPursuit !== false,
      chaserPosition,
      chaserLookDirection,
      evaderLocation,
      speedUnitsPerFrame: actionSpeedUnitsPerFrame,
      turnRateRadiansPerFrame,
    }),
    mapDiscovery: knowledgeProposals.mapDiscovery,
    mapRecencyRefresh: knowledgeProposals.mapRecencyRefresh,
    spin: createInactiveActionProposal(CHASER_STRATEGY_IDS.SPIN),
  };

  proposals.spin = buildSpinProposal({
    enabled: shouldAcquireKnowledge
      && getActionEngineEnabled(actionEngines, CHASER_STRATEGY_IDS.SPIN),
    chaserPosition,
    chaserLookDirection,
    spinSteering,
    speedUnitsPerFrame: actionSpeedUnitsPerFrame,
    turnRateRadiansPerFrame,
  });

  const peerSignals = [
    createPeerConsensusSignal(proposals.evaderPredictionPursuit),
    createPeerConsensusSignal(proposals.lineOfSightPursuit),
    createPeerConsensusSignal(proposals.mapDiscovery),
    createPeerConsensusSignal(proposals.mapRecencyRefresh),
    createPeerConsensusSignal(proposals.spin),
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
  const actionPathConsensus = buildActionPathConsensus({
    proposals,
    chaserPosition,
    chaserLookDirection,
    speedUnitsPerFrame: actionSpeedUnitsPerFrame,
    turnRateRadiansPerFrame,
  });
  const firstAction = actionPathConsensus.firstAction;
  const actionPathDirection = firstAction?.predictedDirection ?? goalDirection;
  const localNavigation = buildLocalNavigationProposal({
    enabled: false,
    direction: actionPathDirection,
    actionPath: actionPathConsensus.path,
    previousWallFollowSign,
  });
  proposals.peerConsensus = {
    id: "strategyConsensus",
    active: activePeerIds.length > 0,
    activePeerIds,
    consensus: peerConsensus,
    direction: goalDirection,
  };
  proposals.actionPathConsensus = actionPathConsensus;
  proposals.motiveSignal = motiveSignal;
  proposals.knowledgeAcquisition = knowledgeProposals.signal;
  proposals.localNavigation = localNavigation;

  const movement = localNavigation.movement;
  const desiredDirection = movement.direction.x === 0 && movement.direction.z === 0
    ? goalDirection
    : movement.direction;

  if (firstAction) {
    return {
      forward: firstAction.forward,
      reverse: firstAction.reverse,
      steering: firstAction.steer,
      pursuitPoint,
      movement,
      desiredDirection,
      actionPath: actionPathConsensus.path,
      chosenStrategy: chosenPeerLabel,
      spinSteeringHint: proposals.spin.active && firstAction.steer !== 0
        ? firstAction.steer
        : null,
      wallFollowSign: movement.wallFollowSign,
      proposals,
    };
  }

  if (!evaderLocation?.visible) {
    if (!proposals.spin.active) {
      return {
        forward: false,
        reverse: false,
        steering: 0,
        desiredDirection: null,
        chosenStrategy: "none",
        spinSteeringHint: null,
        wallFollowSign: movement.wallFollowSign,
        proposals,
      };
    }
    return {
      forward: true,
      reverse: false,
      steering: spinSteering,
      desiredDirection: null,
      chosenStrategy: CHASER_STRATEGY_IDS.SPIN,
      spinSteeringHint: null,
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
      spinSteeringHint: null,
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
    spinSteeringHint: null,
    wallFollowSign: movement.wallFollowSign,
    proposals,
  };
}
