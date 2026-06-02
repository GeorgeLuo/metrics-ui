import { createChaserAutopilotState, getProgrammaticChaserInput, setChaserActionEngineEnabled } from "./chaser-controller.mjs";
import {
  createChaserKnowledgeBase,
  getChaserKnowledgeSnapshot,
  observeChaserEnvironment,
  setChaserKnowledgeEngineEnabled,
  updateChaserMemoryStage,
  updateChaserPatternStage,
  updateChaserProjectionStage,
  updateChaserSuccessMetricsStage,
} from "./knowledge/index.ts";
import {
  buildActorSnapshot,
  createActorIdae,
  stepActorIdae,
} from "../../decision-model/core/actor-decision-model.ts";

function applyScenarioEngineToggles(scenario, actorState) {
  Object.entries(scenario?.engines?.knowledge ?? {}).forEach(([engineId, enabled]) => {
    setChaserKnowledgeEngineEnabled(actorState, engineId, enabled);
  });
  Object.entries(scenario?.actors?.chaser?.actionProposals ?? {}).forEach(([engineId, enabled]) => {
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
  const evaderExists = scenario?.actors?.evader?.exists !== false;
  const actorState = {
    ...createChaserKnowledgeBase({
      evaderDirection: evaderExists ? scenario?.actors?.evader?.direction : null,
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

function getRememberedObstaclesFromSnapshot(snapshot) {
  return snapshot?.memory?.abstracted?.mapShape?.obstacles ?? { walls: [] };
}

const CHASER_MEMORY_MODULES = [
  {
    id: "observationMemory",
    update: ({ state, frameContext, cycle }) => updateChaserMemoryStage(state, {
      perception: cycle.observation,
      chaserPosition: frameContext.chaserPosition,
      chaserLookDirection: frameContext.chaserLookDirection,
      frameIndex: frameContext.frameIndex,
    }),
  },
];

const CHASER_PATTERN_MODULES = [
  {
    id: "patternInference",
    update: ({ state, frameContext }) => updateChaserPatternStage(state, {
      evaderExists: frameContext.evaderExists !== false,
      columns: frameContext.columns,
      rows: frameContext.rows,
      projectionSettings: frameContext.projectionSettings,
    }),
  },
];

const CHASER_PROJECTION_MODULES = [
  {
    id: "evaderMotion",
    update: ({ state, frameContext, cycle }) => updateChaserProjectionStage(state, {
      evaderExists: frameContext.evaderExists !== false,
      columns: frameContext.columns,
      rows: frameContext.rows,
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
      turnRateRadiansPerFrame: frameContext.turnRateRadiansPerFrame,
      frameIndex: frameContext.frameIndex,
      columns: frameContext.columns,
      rows: frameContext.rows,
      obstacles: getRememberedObstaclesFromSnapshot(snapshot),
    }),
  };
}

function getChaserIdaeSnapshot(state) {
  const snapshot = getChaserKnowledgeSnapshot(state);
  return buildActorSnapshot(state, {
    memory: snapshot.memory,
    patterns: snapshot.patterns,
    projections: snapshot.projections,
    patternUnits: snapshot.patternUnits,
    patternStatus: snapshot.patternStatus,
    projectionStatus: snapshot.projectionStatus,
    assumedBehavior: snapshot.assumedBehavior,
    controllerState: {
      spinSteering: Number(state.controllerState?.spinSteering) || 0,
      lastPursuitSource: state.controllerState?.lastPursuitSource ?? "spin",
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
    projectionModules: CHASER_PROJECTION_MODULES,
    chooseAction: chooseChaserIdaeAction,
    getSnapshot: getChaserIdaeSnapshot,
  });
}

export function stepChaserIdae(chaserIdae, frameContext = {}) {
  return stepActorIdae(chaserIdae, frameContext);
}

export function recordChaserSuccessMetrics(chaserIdae, outcomeContext = {}) {
  return updateChaserSuccessMetricsStage(chaserIdae?.state, outcomeContext);
}
