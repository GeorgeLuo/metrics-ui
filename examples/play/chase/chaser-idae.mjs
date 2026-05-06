import { createChaserAutopilotState, getProgrammaticChaserInput, setChaserActionEngineEnabled } from "./chaser-controller.mjs";
import {
  createChaserKnowledgeBase,
  getChaserKnowledgeSnapshot,
  observeChaserEnvironment,
  setChaserKnowledgeEngineEnabled,
  updateChaserMemoryStage,
  updateChaserPatternStage,
  updateChaserStrategyStage,
} from "./chaser-knowledge.mjs";
import { buildActorSnapshot, createActorIdae, stepActorIdae } from "./actor-idae.mjs";

function applyScenarioEngineToggles(scenario, actorState) {
  Object.entries(scenario?.engines?.knowledge ?? {}).forEach(([engineId, enabled]) => {
    setChaserKnowledgeEngineEnabled(actorState, engineId, enabled);
  });
  Object.entries(scenario?.actors?.chaser?.strategies ?? {}).forEach(([engineId, enabled]) => {
    setChaserActionEngineEnabled(actorState.controllerState, engineId, enabled);
  });
}

function normalizeHumanAction(humanInput) {
  return {
    source: "human",
    forward: Boolean(humanInput?.forward),
    reverse: Boolean(humanInput?.reverse),
    steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
  };
}

function createChaserIdaeState({ scenario } = {}) {
  const actorState = {
    ...createChaserKnowledgeBase({
      evaderDirection: scenario?.actors?.evader?.direction,
      engines: scenario?.engines?.knowledge,
      patterns: scenario?.actors?.chaser?.patterns,
    }),
    policy: {},
    selfState: null,
    controllerState: createChaserAutopilotState(),
  };
  applyScenarioEngineToggles(scenario, actorState);
  return actorState;
}

function observeChaserIdae(state, frameContext) {
  return observeChaserEnvironment(state, frameContext);
}

function deriveChaserSelfState(_state, frameContext = {}) {
  return {
    position: frameContext.chaserPosition
      ? {
        x: Number(frameContext.chaserPosition.x) || 0,
        z: Number(frameContext.chaserPosition.z) || 0,
      }
      : null,
    direction: frameContext.chaserLookDirection
      ? {
        x: Number(frameContext.chaserLookDirection.x) || 0,
        z: Number(frameContext.chaserLookDirection.z) || 0,
      }
      : null,
    frameIndex: Number.isFinite(frameContext.frameIndex) ? frameContext.frameIndex : null,
  };
}

const CHASER_MEMORY_MODULES = [
  {
    id: "observationMemory",
    update: ({ state, frameContext, cycle }) => updateChaserMemoryStage(state, {
      perception: cycle.observation,
      chaserPosition: frameContext.chaserPosition,
      chaserLookDirection: frameContext.chaserLookDirection,
    }),
  },
];

const CHASER_PATTERN_MODULES = [
  {
    id: "patternInference",
    update: ({ state, frameContext }) => updateChaserPatternStage(state, {
      columns: frameContext.columns,
      rows: frameContext.rows,
      obstacles: frameContext.obstacles,
      projectionSettings: frameContext.projectionSettings,
    }),
  },
];

const CHASER_STRATEGY_MODULES = [
  {
    id: "evaderPrediction",
    update: ({ state, frameContext, cycle }) => updateChaserStrategyStage(state, {
      columns: frameContext.columns,
      rows: frameContext.rows,
      obstacles: frameContext.obstacles,
      projectionSettings: frameContext.projectionSettings,
      evaderMotionModel: cycle.patterns?.patternInference?.evaderMotionModel,
      patternUnits: cycle.patterns?.patternInference?.patternUnits,
    }),
  },
];

function chooseChaserIdaeAction(state, frameContext) {
  if (!frameContext.programmaticChaserEnabled) {
    return normalizeHumanAction(frameContext.humanInput);
  }

  const snapshot = getChaserKnowledgeSnapshot(state);
  return {
    source: "idae",
    ...getProgrammaticChaserInput({
      snapshot,
      chaserPosition: frameContext.chaserPosition,
      chaserLookDirection: frameContext.chaserLookDirection,
      autopilotState: state.controllerState,
      chaserSpeedUnitsPerFrame: frameContext.chaserSpeedUnitsPerFrame,
      columns: frameContext.columns,
      rows: frameContext.rows,
      obstacles: frameContext.obstacles,
    }),
  };
}

function getChaserIdaeSnapshot(state) {
  const snapshot = getChaserKnowledgeSnapshot(state);
  return buildActorSnapshot(state, {
    memory: snapshot.memory,
    patterns: snapshot.patterns,
    strategies: snapshot.strategies,
    patternUnits: snapshot.patternUnits,
    patternStatus: snapshot.patternStatus,
    strategyStatus: snapshot.strategyStatus,
    assumedBehavior: snapshot.assumedBehavior,
    controllerState: {
      searchSteering: Number(state.controllerState?.searchSteering) || 0,
      lastPursuitSource: state.controllerState?.lastPursuitSource ?? "search",
      wallFollowSign: Number(state.controllerState?.wallFollowSign) || 0,
      actionEngines: { ...(state.controllerState?.actionEngines ?? {}) },
    },
  });
}

export function createChaserIdae({ scenario } = {}) {
  return createActorIdae({
    id: "chaser-idae",
    createState: () => createChaserIdaeState({ scenario }),
    observe: observeChaserIdae,
    deriveSelfState: deriveChaserSelfState,
    memoryModules: CHASER_MEMORY_MODULES,
    patternModules: CHASER_PATTERN_MODULES,
    strategyModules: CHASER_STRATEGY_MODULES,
    chooseAction: chooseChaserIdaeAction,
    getSnapshot: getChaserIdaeSnapshot,
  });
}

export function stepChaserIdae(chaserIdae, frameContext = {}) {
  return stepActorIdae(chaserIdae, frameContext);
}
