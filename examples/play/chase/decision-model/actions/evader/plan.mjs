import {
  MOVEMENT_CONSENSUS_COUPLING,
  MOVEMENT_CONSENSUS_ITERATIONS,
} from "../../../config/constants.mjs";
import { EVADER_STRATEGY_IDS } from "../../../config/strategy-ids.mjs";
import { constrainDirectionToBounds } from "../../../actors/evader/evader.mjs";
import { planEvaderVehicleAction } from "../../../actors/evader/evader-controller.mjs";
import { runKuramotoConsensus } from "../../core/kuramoto.ts";
import {
  createEvaderBaselineMovementStrategy,
  updateEvaderBaselineMovementStrategy,
} from "./baseline-movement.mjs";
import {
  createEvaderDriftStrategy,
  updateEvaderDriftStrategy,
} from "./drift.mjs";
import {
  createEvaderVisibleChaserEvadeStrategy,
  getEvaderVisibleChaserEvadeStrategyState,
  recordEvaderVisibleChaserExecution,
  updateEvaderVisibleChaserEvadeStrategy,
} from "./visible-chaser-evade.mjs";
import {
  createEvaderWallAvoidStrategy,
  updateEvaderWallAvoidStrategy,
} from "./wall-avoid.mjs";

export function createEvaderActionState() {
  return {
    driftMotion: createEvaderDriftStrategy(),
    wallAvoidance: createEvaderWallAvoidStrategy(),
    defaultRoam: null,
    defaultRoamStrategy: createEvaderBaselineMovementStrategy(),
    evadeOnSight: null,
    evadeOnSightStrategy: createEvaderVisibleChaserEvadeStrategy(),
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

function updateEvaderActionStrategies({
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
  const driftMotion = updateEvaderDriftStrategy(
    actionState.driftMotion,
    actionContext,
  );
  const wallAvoidance = updateEvaderWallAvoidStrategy(
    actionState.wallAvoidance,
    actionContext,
  );
  const baselineDecision = engines?.[EVADER_STRATEGY_IDS.DEFAULT_ROAM]
    ? updateEvaderBaselineMovementStrategy(
      actionState.defaultRoamStrategy,
      {
        ...actionContext,
        driftStrategyOutput: driftMotion,
        wallAvoidStrategyOutput: wallAvoidance,
      },
    )
    : null;

  actionState.defaultRoam = baselineDecision
    ? {
      id: EVADER_STRATEGY_IDS.DEFAULT_ROAM,
      actionable: true,
      confidence: chaserLocation?.visible ? 0.5 : 1,
      output: baselineDecision,
    }
    : null;

  const evadeDecision = engines?.[EVADER_STRATEGY_IDS.EVADE_ON_SIGHT]
    ? updateEvaderVisibleChaserEvadeStrategy(
      actionState.evadeOnSightStrategy,
      {
        ...actionContext,
        baselineMovementOutput: actionState.defaultRoam?.output ?? null,
      },
    )
    : null;

  actionState.evadeOnSight = evadeDecision
    ? {
      id: EVADER_STRATEGY_IDS.EVADE_ON_SIGHT,
      actionable: true,
      confidence: 1,
      output: evadeDecision,
    }
    : {
      id: EVADER_STRATEGY_IDS.EVADE_ON_SIGHT,
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
  updateEvaderActionStrategies({
    actionState,
    engines,
    policy,
    observation,
    chaserLocation,
  });

  const evadeActionStrategy = actionState.evadeOnSight;
  const baselineActionStrategy = actionState.defaultRoam;
  const selectedActionStrategy = evadeActionStrategy?.actionable
    ? evadeActionStrategy
    : baselineActionStrategy;
  const consensusSignals = buildEvaderConsensusSignals(actionState);
  const consensus = runKuramotoConsensus(consensusSignals, {
    coupling: MOVEMENT_CONSENSUS_COUPLING,
    iterations: MOVEMENT_CONSENSUS_ITERATIONS,
  });
  const consensusDirection = consensus.direction.x === 0 && consensus.direction.z === 0
    ? (selectedActionStrategy?.output?.direction ?? { x: 0, z: 0 })
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
    turnRateRadiansPerFrame: observation?.turnRateRadiansPerFrame,
    columns: observation?.columns,
    rows: observation?.rows,
  });
  const evadeExecuted = Boolean(evadeActionStrategy?.actionable);
  recordEvaderVisibleChaserExecution(
    actionState.evadeOnSightStrategy,
    {
      frameIndex: observation?.frameIndex ?? null,
      executed: evadeExecuted,
    },
  );

  return {
    source: "idae",
    strategyId: "evader-consensus",
    forward: vehicleAction.forward,
    steering: vehicleAction.steering,
    desiredDirection: vehicleAction.desiredDirection,
    nextDirection: vehicleAction.nextDirection,
    direction: vehicleAction.nextDirection,
    debug: {
      ...(baselineActionStrategy?.output?.debug ?? selectedActionStrategy?.output?.debug ?? null),
      policyId: evadeExecuted ? "evader-consensus-evade" : "evader-consensus-baseline",
      chaserVisible: Boolean(chaserLocation?.visible),
      evadeActive: evadeExecuted,
      activeStrategyIds: consensusSignals.map((signal) => signal.id),
      consensusOrder: Number(consensus.order) || 0,
    },
  };
}

export function getEvaderActionSnapshot(actionState) {
  const evadeVisibleChaserStrategyState = getEvaderVisibleChaserEvadeStrategyState(
    actionState?.evadeOnSightStrategy,
  );
  return {
    actionStrategies: {
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
          state: evadeVisibleChaserStrategyState
            ? {
              visibleFrameCount: Number(evadeVisibleChaserStrategyState.visibleFrameCount) || 0,
              actionableFrameCount: Number(evadeVisibleChaserStrategyState.actionableFrameCount) || 0,
              executedFrameCount: Number(evadeVisibleChaserStrategyState.executedFrameCount) || 0,
              visibilityEpisodeCount: Number(evadeVisibleChaserStrategyState.visibilityEpisodeCount) || 0,
              actionableEpisodeCount: Number(evadeVisibleChaserStrategyState.actionableEpisodeCount) || 0,
              executionEpisodeCount: Number(evadeVisibleChaserStrategyState.executionEpisodeCount) || 0,
              lastSeenDistance: Number.isFinite(evadeVisibleChaserStrategyState.lastSeenDistance)
                ? evadeVisibleChaserStrategyState.lastSeenDistance
                : null,
              lastSeenBearingRadians: Number.isFinite(
                evadeVisibleChaserStrategyState.lastSeenBearingRadians,
              )
                ? evadeVisibleChaserStrategyState.lastSeenBearingRadians
                : null,
            }
            : null,
        }
        : null,
    },
  };
}
