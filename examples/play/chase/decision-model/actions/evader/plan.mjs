import {
  MOVEMENT_CONSENSUS_COUPLING,
  MOVEMENT_CONSENSUS_ITERATIONS,
} from "../../../config/constants.mjs";
import { EVADER_ACTION_PROPOSAL_IDS } from "../../../config/decision-ids.mjs";
import { constrainDirectionToBounds } from "../../../actors/evader/evader.mjs";
import { planEvaderVehicleAction } from "../../../actors/evader/evader-controller.mjs";
import { runKuramotoConsensus } from "../../core/kuramoto.ts";
import {
  createEvaderBaselineMovementProposal,
  updateEvaderBaselineMovementProposal,
} from "./baseline-movement.mjs";
import {
  createEvaderDriftProposal,
  updateEvaderDriftProposal,
} from "./drift.mjs";
import {
  createEvaderVisibleChaserEvadeProposal,
  getEvaderVisibleChaserEvadeProposalState,
  recordEvaderVisibleChaserExecution,
  updateEvaderVisibleChaserEvadeProposal,
} from "./visible-chaser-evade.mjs";
import {
  createEvaderWallAvoidProposal,
  updateEvaderWallAvoidProposal,
} from "./wall-avoid.mjs";

export function createEvaderActionState() {
  return {
    driftMotion: createEvaderDriftProposal(),
    wallAvoidance: createEvaderWallAvoidProposal(),
    defaultRoam: null,
    defaultRoamProposal: createEvaderBaselineMovementProposal(),
    evadeOnSight: null,
    evadeOnSightProposal: createEvaderVisibleChaserEvadeProposal(),
  };
}

function buildEvaderActionContext({
  observation,
  policy,
  chaserLocation,
} = {}) {
  return {
    ...observation,
    policy,
    chaserLocation,
    chaserLocationVisible: Boolean(chaserLocation?.visible),
  };
}

function updateEvaderActionProposals({
  actionState,
  engines,
  policy,
  observation,
  chaserLocation,
} = {}) {
  const actionContext = buildEvaderActionContext({
    observation,
    policy,
    chaserLocation,
  });
  const driftMotion = updateEvaderDriftProposal(
    actionState.driftMotion,
    actionContext,
  );
  const wallAvoidance = updateEvaderWallAvoidProposal(
    actionState.wallAvoidance,
    actionContext,
  );
  const baselineDecision = engines?.[EVADER_ACTION_PROPOSAL_IDS.DEFAULT_ROAM]
    ? updateEvaderBaselineMovementProposal(
      actionState.defaultRoamProposal,
      {
        ...actionContext,
        driftProposalOutput: driftMotion,
        wallAvoidProposalOutput: wallAvoidance,
      },
    )
    : null;

  actionState.defaultRoam = baselineDecision
    ? {
      id: EVADER_ACTION_PROPOSAL_IDS.DEFAULT_ROAM,
      actionable: true,
      confidence: chaserLocation?.visible ? 0.5 : 1,
      output: baselineDecision,
    }
    : null;

  const evadeDecision = engines?.[EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT]
    ? updateEvaderVisibleChaserEvadeProposal(
      actionState.evadeOnSightProposal,
      {
        ...actionContext,
        baselineMovementOutput: actionState.defaultRoam?.output ?? null,
      },
    )
    : null;

  actionState.evadeOnSight = evadeDecision
    ? {
      id: EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT,
      actionable: true,
      confidence: 1,
      output: evadeDecision,
    }
    : {
      id: EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT,
      actionable: false,
      confidence: 0,
      output: null,
    };

  return {
    driftMotion,
    wallAvoidance,
    defaultRoam: actionState.defaultRoam,
    evadeOnSight: actionState.evadeOnSight,
  };
}

function buildEvaderConsensusSignals(actionState) {
  return [
    actionState.defaultRoam?.actionable
      ? {
        id: actionState.defaultRoam.id,
        direction: actionState.defaultRoam.output?.direction,
        confidence: actionState.defaultRoam.confidence,
        weight: 1,
      }
      : null,
    actionState.evadeOnSight?.actionable
      ? {
        id: actionState.evadeOnSight.id,
        direction: actionState.evadeOnSight.output?.direction,
        confidence: actionState.evadeOnSight.confidence,
        weight: 1,
      }
      : null,
  ].filter(Boolean);
}

export function planEvaderIdaeAction({
  actionState,
  engines,
  policy,
  memory,
  observation,
} = {}) {
  const chaserLocation = memory?.directObservation?.chaserLocation ?? null;
  updateEvaderActionProposals({
    actionState,
    engines,
    policy,
    observation,
    chaserLocation,
  });

  const evadeActionProposal = actionState.evadeOnSight;
  const baselineActionProposal = actionState.defaultRoam;
  const selectedActionProposal = evadeActionProposal?.actionable
    ? evadeActionProposal
    : baselineActionProposal;
  const consensusSignals = buildEvaderConsensusSignals(actionState);
  const consensus = runKuramotoConsensus(consensusSignals, {
    coupling: MOVEMENT_CONSENSUS_COUPLING,
    iterations: MOVEMENT_CONSENSUS_ITERATIONS,
  });
  const consensusDirection = consensus.direction.x === 0 && consensus.direction.z === 0
    ? (selectedActionProposal?.output?.direction ?? { x: 0, z: 0 })
    : consensus.direction;
  const boundedDirection = constrainDirectionToBounds(
    observation?.position,
    consensusDirection,
    observation?.columns,
    observation?.rows,
  );
  const vehicleAction = planEvaderVehicleAction({
    position: observation?.position,
    currentDirection: observation?.direction,
    desiredDirection: boundedDirection,
    maxSteeringAngleRadians: observation?.maxSteeringAngleRadians,
    columns: observation?.columns,
    rows: observation?.rows,
  });
  const evadeExecuted = Boolean(evadeActionProposal?.actionable);
  recordEvaderVisibleChaserExecution(
    actionState.evadeOnSightProposal,
    {
      frameIndex: observation?.frameIndex ?? null,
      executed: evadeExecuted,
    },
  );

  return {
    source: "idae",
    actionProposalId: "evader-consensus",
    forward: vehicleAction.forward,
    steering: vehicleAction.steering,
    frontViewCapture: vehicleAction.frontViewCapture ?? null,
    desiredDirection: vehicleAction.desiredDirection,
    nextDirection: vehicleAction.nextDirection,
    direction: vehicleAction.nextDirection,
    debug: {
      ...(baselineActionProposal?.output?.debug ?? selectedActionProposal?.output?.debug ?? null),
      policyId: evadeExecuted ? "evader-consensus-evade" : "evader-consensus-baseline",
      chaserVisible: Boolean(chaserLocation?.visible),
      evadeActive: evadeExecuted,
      activeActionProposalIds: consensusSignals.map((signal) => signal.id),
      consensusOrder: Number(consensus.order) || 0,
    },
  };
}

export function getEvaderActionSnapshot(actionState) {
  const evadeVisibleChaserProposalState = getEvaderVisibleChaserEvadeProposalState(
    actionState?.evadeOnSightProposal,
  );
  return {
    actionProposals: {
      driftMotion: actionState?.driftMotion?.output ?? null,
      wallAvoidance: actionState?.wallAvoidance?.output ?? null,
      defaultRoam: actionState?.defaultRoam?.output ?? null,
      evadeOnSight: actionState?.evadeOnSight?.output ?? null,
    },
    actionStatus: {
      driftMotion: {
        id: actionState?.driftMotion?.id ?? "driftMotion",
      },
      wallAvoidance: {
        id: actionState?.wallAvoidance?.id ?? "wallAvoidance",
      },
      defaultRoam: actionState?.defaultRoam
        ? {
          id: actionState.defaultRoam.id,
          actionable: Boolean(actionState.defaultRoam.actionable),
          confidence: Number(actionState.defaultRoam.confidence) || 0,
        }
        : null,
      evadeOnSight: actionState?.evadeOnSight
        ? {
          id: actionState.evadeOnSight.id,
          actionable: Boolean(actionState.evadeOnSight.actionable),
          confidence: Number(actionState.evadeOnSight.confidence) || 0,
          state: evadeVisibleChaserProposalState
            ? {
              visibleFrameCount: Number(evadeVisibleChaserProposalState.visibleFrameCount) || 0,
              actionableFrameCount: Number(evadeVisibleChaserProposalState.actionableFrameCount) || 0,
              executedFrameCount: Number(evadeVisibleChaserProposalState.executedFrameCount) || 0,
              visibilityEpisodeCount: Number(evadeVisibleChaserProposalState.visibilityEpisodeCount) || 0,
              actionableEpisodeCount: Number(evadeVisibleChaserProposalState.actionableEpisodeCount) || 0,
              executionEpisodeCount: Number(evadeVisibleChaserProposalState.executionEpisodeCount) || 0,
              lastSeenDistance: Number.isFinite(evadeVisibleChaserProposalState.lastSeenDistance)
                ? evadeVisibleChaserProposalState.lastSeenDistance
                : null,
              lastSeenBearingRadians: Number.isFinite(
                evadeVisibleChaserProposalState.lastSeenBearingRadians,
              )
                ? evadeVisibleChaserProposalState.lastSeenBearingRadians
                : null,
            }
            : null,
        }
        : null,
    },
  };
}
