import {
  MOVEMENT_CONSENSUS_COUPLING,
  MOVEMENT_CONSENSUS_ITERATIONS,
} from "../../config/constants.mjs";
import {
  createActorLocationMemory,
  getActorPerception,
  updateActorLocationMemory,
} from "../chaser/chaser.mjs";
import {
  buildActorSnapshot,
  createActorDecisionModel,
  stepActorDecisionModel,
} from "../../decision-model/actor-decision-model.mjs";
import { runKuramotoConsensus } from "../../decision-model/kuramoto.mjs";
import { constrainDirectionToBounds } from "./evader.mjs";
import {
  createEvaderBaselineMovementStrategy,
  updateEvaderBaselineMovementStrategy,
} from "./strategies/baseline-movement.mjs";
import {
  createEvaderDriftStrategy,
  updateEvaderDriftStrategy,
} from "./strategies/drift.mjs";
import {
  createEvaderVisibleChaserEvadeStrategy,
  getEvaderVisibleChaserEvadeStrategyState,
  recordEvaderVisibleChaserExecution,
  updateEvaderVisibleChaserEvadeStrategy,
} from "./strategies/visible-chaser-evade.mjs";
import {
  createEvaderWallAvoidStrategy,
  updateEvaderWallAvoidStrategy,
} from "./strategies/wall-avoid.mjs";
import { EVADER_STRATEGY_IDS } from "../../config/strategy-ids.mjs";
import { planEvaderVehicleAction } from "./evader-controller.mjs";

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function createEvaderStrategyEngines(overrides = {}) {
  return {
    [EVADER_STRATEGY_IDS.DEFAULT_ROAM]: asEnabled(
      overrides[EVADER_STRATEGY_IDS.DEFAULT_ROAM],
      true,
    ),
    [EVADER_STRATEGY_IDS.EVADE_ON_SIGHT]: asEnabled(
      overrides[EVADER_STRATEGY_IDS.EVADE_ON_SIGHT],
      true,
    ),
  };
}

export function setEvaderStrategyEngineEnabled(evaderState, strategyId, enabled) {
  if (!evaderState?.engines || !(strategyId in evaderState.engines)) {
    return;
  }
  evaderState.engines[strategyId] = Boolean(enabled);
}

function createEvaderIdaeState({ scenario } = {}) {
  return {
    policy: { ...(scenario?.policies?.evader ?? {}) },
    selfState: null,
    memory: {
      directObservation: {
        chaserLocation: createActorLocationMemory(),
      },
      abstracted: {},
    },
    patterns: {},
    controllerState: {},
    engines: createEvaderStrategyEngines(scenario?.actors?.evader?.strategies),
    strategies: {
      driftMotion: createEvaderDriftStrategy(),
      wallAvoidance: createEvaderWallAvoidStrategy(),
      defaultRoam: null,
      defaultRoamStrategy: createEvaderBaselineMovementStrategy(),
      evadeOnSight: null,
      evadeOnSightStrategy: createEvaderVisibleChaserEvadeStrategy(),
    },
  };
}

function observeEvaderEnvironment(state, frameContext = {}) {
  const chaserPerception = getActorPerception(
    frameContext.evaderPosition,
    frameContext.chaserPosition,
    frameContext.evaderDirection,
    frameContext.fieldOfViewAngleRadians,
    frameContext.obstacles,
  );

  return {
    position: frameContext.evaderPosition,
    direction: frameContext.evaderDirection,
    chaserPosition: frameContext.chaserPosition,
    chaserPerception,
    columns: frameContext.columns,
    rows: frameContext.rows,
    frameIndex: frameContext.frameIndex,
    obstacles: frameContext.obstacles,
    turnRateRadiansPerFrame: frameContext.turnRateRadiansPerFrame,
    policy: state.policy,
  };
}

function deriveEvaderSelfState(_state, _frameContext, cycle) {
  const observation = cycle.observation;
  return observation
    ? {
      position: observation.position
        ? {
          x: Number(observation.position.x) || 0,
          z: Number(observation.position.z) || 0,
        }
        : null,
      direction: observation.direction
        ? {
          x: Number(observation.direction.x) || 0,
          z: Number(observation.direction.z) || 0,
        }
        : null,
      frameIndex: Number(observation.frameIndex) || 0,
    }
    : null;
}

const EVADER_MEMORY_MODULES = [
  {
    id: "chaserLocation",
    update: ({ state, cycle }) => {
      updateActorLocationMemory(
        state.memory.directObservation.chaserLocation,
        cycle.observation?.chaserPerception ?? { visible: false },
        cycle.observation?.position,
        cycle.observation?.direction,
      );
      return state.memory.directObservation.chaserLocation;
    },
  },
];

const EVADER_STRATEGY_MODULES = [
  {
    id: "driftMotion",
    update: ({ state, cycle }) => updateEvaderDriftStrategy(
      state.strategies.driftMotion,
      {
        ...cycle.observation,
        policy: state.policy,
        chaserLocation: state.memory.directObservation.chaserLocation,
        chaserLocationVisible: state.memory.directObservation.chaserLocation.visible,
      },
    ),
  },
  {
    id: "wallAvoidance",
    update: ({ state, cycle }) => updateEvaderWallAvoidStrategy(
      state.strategies.wallAvoidance,
      {
        ...cycle.observation,
        policy: state.policy,
        chaserLocation: state.memory.directObservation.chaserLocation,
        chaserLocationVisible: state.memory.directObservation.chaserLocation.visible,
      },
    ),
  },
  {
    id: "defaultRoam",
    update: ({ state, cycle, outputs }) => {
      const strategyContext = {
        ...cycle.observation,
        policy: state.policy,
        chaserLocation: state.memory.directObservation.chaserLocation,
        chaserLocationVisible: state.memory.directObservation.chaserLocation.visible,
      };
      const baselineDecision = state.engines[EVADER_STRATEGY_IDS.DEFAULT_ROAM]
        ? updateEvaderBaselineMovementStrategy(
          state.strategies.defaultRoamStrategy,
          {
            ...strategyContext,
            driftStrategyOutput: outputs.driftMotion,
            wallAvoidStrategyOutput: outputs.wallAvoidance,
          },
        )
        : null;

      state.strategies.defaultRoam = baselineDecision
        ? {
          id: EVADER_STRATEGY_IDS.DEFAULT_ROAM,
          actionable: true,
          confidence: state.memory.directObservation.chaserLocation.visible ? 0.5 : 1,
          output: baselineDecision,
        }
        : null;
      return state.strategies.defaultRoam;
    },
  },
  {
    id: "evadeOnSight",
    update: ({ state, cycle }) => {
      const strategyContext = {
        ...cycle.observation,
        policy: state.policy,
        chaserLocation: state.memory.directObservation.chaserLocation,
        chaserLocationVisible: state.memory.directObservation.chaserLocation.visible,
      };
      const evadeDecision = state.engines[EVADER_STRATEGY_IDS.EVADE_ON_SIGHT]
        ? updateEvaderVisibleChaserEvadeStrategy(
          state.strategies.evadeOnSightStrategy,
          {
            ...strategyContext,
            baselineMovementOutput: state.strategies.defaultRoam?.output ?? null,
          },
        )
        : null;

      state.strategies.evadeOnSight = evadeDecision
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
      return state.strategies.evadeOnSight;
    },
  },
];

function buildEvaderConsensusSignals(state) {
  return [
    state.strategies.defaultRoam?.actionable
      ? {
      id: state.strategies.defaultRoam.id,
      direction: state.strategies.defaultRoam.output?.direction,
      confidence: state.strategies.defaultRoam.confidence,
        weight: 1,
      }
      : null,
    state.strategies.evadeOnSight?.actionable
      ? {
        id: state.strategies.evadeOnSight.id,
        direction: state.strategies.evadeOnSight.output?.direction,
        confidence: state.strategies.evadeOnSight.confidence,
        weight: 1,
      }
      : null,
  ].filter(Boolean);
}

function chooseEvaderAction(state, _frameContext, cycle) {
  const evadeStrategy = state.strategies.evadeOnSight;
  const baselineStrategy = state.strategies.defaultRoam;
  const strategy = evadeStrategy?.actionable ? evadeStrategy : baselineStrategy;
  const consensusSignals = buildEvaderConsensusSignals(state);
  const consensus = runKuramotoConsensus(consensusSignals, {
    coupling: MOVEMENT_CONSENSUS_COUPLING,
    iterations: MOVEMENT_CONSENSUS_ITERATIONS,
  });
  const consensusDirection = consensus.direction.x === 0 && consensus.direction.z === 0
    ? (strategy?.output?.direction ?? { x: 0, z: 0 })
    : consensus.direction;
  const boundedDirection = constrainDirectionToBounds(
    cycle?.observation?.position,
    consensusDirection,
    cycle?.observation?.columns,
    cycle?.observation?.rows,
  );
  const vehicleAction = planEvaderVehicleAction({
    position: cycle?.observation?.position,
    currentDirection: cycle?.observation?.direction,
    desiredDirection: boundedDirection,
    turnRateRadiansPerFrame: cycle?.observation?.turnRateRadiansPerFrame,
    columns: cycle?.observation?.columns,
    rows: cycle?.observation?.rows,
  });
  const evadeExecuted = Boolean(evadeStrategy?.actionable);
  recordEvaderVisibleChaserExecution(
    state.strategies.evadeOnSightStrategy,
    {
      frameIndex: cycle?.observation?.frameIndex ?? null,
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
      ...(baselineStrategy?.output?.debug ?? strategy?.output?.debug ?? null),
      policyId: evadeExecuted ? "evader-consensus-evade" : "evader-consensus-baseline",
      chaserVisible: Boolean(state.memory.directObservation.chaserLocation?.visible),
      evadeActive: evadeExecuted,
      activeStrategyIds: consensusSignals.map((signal) => signal.id),
      consensusOrder: Number(consensus.order) || 0,
    },
  };
}

function getEvaderIdaeSnapshot(state) {
  const evadeVisibleChaserStrategyState = getEvaderVisibleChaserEvadeStrategyState(
    state.strategies.evadeOnSightStrategy,
  );
  return buildActorSnapshot(state, {
    selfState: state.selfState,
    memory: state.memory,
    patterns: {},
    strategies: {
      driftMotion: state.strategies.driftMotion?.output ?? null,
      wallAvoidance: state.strategies.wallAvoidance?.output ?? null,
      defaultRoam: state.strategies.defaultRoam?.output ?? null,
      evadeOnSight: state.strategies.evadeOnSight?.output ?? null,
    },
    controllerState: state.controllerState,
    strategyStatus: {
      driftMotion: {
        id: state.strategies.driftMotion?.id ?? "driftMotion",
      },
      wallAvoidance: {
        id: state.strategies.wallAvoidance?.id ?? "wallAvoidance",
      },
      defaultRoam: state.strategies.defaultRoam
        ? {
          id: state.strategies.defaultRoam.id,
          actionable: Boolean(state.strategies.defaultRoam.actionable),
          confidence: Number(state.strategies.defaultRoam.confidence) || 0,
        }
        : null,
      evadeOnSight: state.strategies.evadeOnSight
        ? {
          id: state.strategies.evadeOnSight.id,
          actionable: Boolean(state.strategies.evadeOnSight.actionable),
          confidence: Number(state.strategies.evadeOnSight.confidence) || 0,
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
  });
}

export function createEvaderIdae({ scenario } = {}) {
  return createActorDecisionModel({
    id: "evader-idae",
    createState: () => createEvaderIdaeState({ scenario }),
    observe: observeEvaderEnvironment,
    deriveSelfState: deriveEvaderSelfState,
    memoryModules: EVADER_MEMORY_MODULES,
    patternModules: [],
    strategyModules: EVADER_STRATEGY_MODULES,
    chooseAction: chooseEvaderAction,
    getSnapshot: getEvaderIdaeSnapshot,
  });
}

export function stepEvaderIdae(evaderIdae, frameContext = {}) {
  return stepActorDecisionModel(evaderIdae, frameContext);
}
