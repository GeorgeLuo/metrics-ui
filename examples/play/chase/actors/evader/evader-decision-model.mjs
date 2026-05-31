import {
  createActorLocationMemory,
  getActorPerception,
  updateActorLocationMemory,
} from "../../decision-model/memory/actors/perceived-actor-location.ts";
import {
  buildActorSnapshot,
  createActorIdae,
  stepActorIdae,
} from "../../decision-model/core/actor-decision-model.ts";
import {
  createEvaderActionState,
  getEvaderActionSnapshot,
  planEvaderIdaeAction,
} from "../../decision-model/actions/evader/plan.mjs";
import { EVADER_STRATEGY_IDS } from "../../config/strategy-ids.mjs";

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
    projections: {},
    controllerState: {},
    engines: createEvaderStrategyEngines(scenario?.actors?.evader?.strategies),
    actionState: createEvaderActionState(),
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

function chooseEvaderAction(state, _frameContext, cycle) {
  return planEvaderIdaeAction({
    actionState: state.actionState,
    engines: state.engines,
    policy: state.policy,
    memory: state.memory,
    observation: cycle?.observation,
  });
}

function getEvaderIdaeSnapshot(state) {
  const actionSnapshot = getEvaderActionSnapshot(state.actionState);
  return buildActorSnapshot(state, {
    selfState: state.selfState,
    memory: state.memory,
    patterns: {},
    projections: {},
    controllerState: state.controllerState,
    actionStrategies: actionSnapshot.actionStrategies,
    actionStatus: actionSnapshot.actionStatus,
  });
}

export function createEvaderIdae({ scenario } = {}) {
  return createActorIdae({
    id: "evader-idae",
    createState: () => createEvaderIdaeState({ scenario }),
    observe: observeEvaderEnvironment,
    deriveSelfState: deriveEvaderSelfState,
    memoryModules: EVADER_MEMORY_MODULES,
    patternModules: [],
    chooseAction: chooseEvaderAction,
    getSnapshot: getEvaderIdaeSnapshot,
  });
}

export function stepEvaderIdae(evaderIdae, frameContext = {}) {
  return stepActorIdae(evaderIdae, frameContext);
}
