import {
  CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
} from "../../../config/constants.mjs";
import {
  CHASER_MOTIVE_IDS,
  CHASER_STRATEGY_IDS,
} from "../../../config/strategy-ids.mjs";
import { getSteeringFromBearing } from "../vehicle/action-paths.ts";
import {
  buildActionPathConsensus,
  buildDirectionConsensus,
  buildLocalNavigationProposal,
} from "./consensus.ts";
import { buildKnowledgeAcquisitionProposals } from "./knowledge-acquisition.ts";
import {
  buildChaserMotiveSignal,
  getActionEngineEnabled,
} from "./motives.ts";
import {
  buildEvaderPredictionPursuitProposal,
  buildVisibleBearingFallbackProposal,
} from "./proposals/chase.ts";
import { buildSpinProposal } from "./proposals/spin.ts";
import type { ChaserActionPlan } from "./interfaces.ts";

type PlanOptions = Record<string, any>;

/**
 * Builds the executable chaser action plan for one simulation frame.
 *
 * This is the high-level action-stage entry point: it chooses a motive, builds
 * strategy proposals, applies the current mixing policies, and returns the
 * concrete vehicle controls plus the debug proposal payload.
 */
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
}: PlanOptions = {}): ChaserActionPlan {
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

  const proposals: Record<string, any> = {
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

  const directionConsensus = buildDirectionConsensus({ proposals });
  const goalDirection = directionConsensus.goalDirection;
  const pursuitPoint = proposals.evaderPredictionPursuit.active
    ? proposals.evaderPredictionPursuit.pursuitPoint ?? null
    : null;
  const chosenPeerLabel = directionConsensus.chosenPeerLabel;
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
  proposals.peerConsensus = directionConsensus.proposal;
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
      selectedProposalLabel: chosenPeerLabel,
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
        actionPath: [],
        chosenStrategy: "none",
        selectedProposalLabel: "none",
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
      actionPath: [],
      chosenStrategy: CHASER_STRATEGY_IDS.SPIN,
      selectedProposalLabel: CHASER_STRATEGY_IDS.SPIN,
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
      actionPath: [],
      chosenStrategy: "none",
      selectedProposalLabel: "none",
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
    actionPath: [],
    chosenStrategy: "lineOfSightPursuit",
    selectedProposalLabel: "lineOfSightPursuit",
    spinSteeringHint: null,
    wallFollowSign: movement.wallFollowSign,
    proposals,
  };
}
