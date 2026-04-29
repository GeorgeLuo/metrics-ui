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
import { createIdaeEngine, stepIdaeEngine } from "./idae.mjs";

function applyScenarioEngineToggles(scenario, knowledgeBase, autopilotState) {
  Object.entries(scenario?.engines?.knowledge ?? {}).forEach(([engineId, enabled]) => {
    setChaserKnowledgeEngineEnabled(knowledgeBase, engineId, enabled);
  });
  Object.entries(scenario?.engines?.action ?? {}).forEach(([engineId, enabled]) => {
    setChaserActionEngineEnabled(autopilotState, engineId, enabled);
  });
}

function normalizeHumanAction(humanInput) {
  return {
    source: "human",
    forward: Boolean(humanInput?.forward),
    steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
  };
}

function createChaserIdaeState({ scenario } = {}) {
  const knowledgeBase = createChaserKnowledgeBase();
  const autopilotState = createChaserAutopilotState();
  applyScenarioEngineToggles(scenario, knowledgeBase, autopilotState);
  return {
    knowledgeBase,
    autopilotState,
  };
}

function observeChaserIdae(state, frameContext) {
  return observeChaserEnvironment(state.knowledgeBase, frameContext);
}

function updateChaserIdaeMemory(state, frameContext, cycle) {
  return updateChaserMemoryStage(state.knowledgeBase, {
    perception: cycle.observation,
    chaserPosition: frameContext.chaserPosition,
    chaserLookDirection: frameContext.chaserLookDirection,
  });
}

function updateChaserIdaePatterns(state, frameContext) {
  return updateChaserPatternStage(state.knowledgeBase, {
    columns: frameContext.columns,
    rows: frameContext.rows,
    obstacles: frameContext.obstacles,
  });
}

function updateChaserIdaeStrategies(state, frameContext, cycle) {
  return updateChaserStrategyStage(state.knowledgeBase, {
    columns: frameContext.columns,
    rows: frameContext.rows,
    obstacles: frameContext.obstacles,
    projectionSettings: frameContext.projectionSettings,
    targetMotionModel: cycle.patterns?.targetMotionModel,
    wallAvoidancePattern: cycle.patterns?.wallAvoidancePattern,
  });
}

function chooseChaserIdaeAction(state, frameContext) {
  if (!frameContext.programmaticChaserEnabled) {
    return normalizeHumanAction(frameContext.humanInput);
  }

  return {
    source: "idae",
    ...getProgrammaticChaserInput({
      knowledgeBase: getChaserKnowledgeSnapshot(state.knowledgeBase),
      chaserPosition: frameContext.chaserPosition,
      chaserLookDirection: frameContext.chaserLookDirection,
      autopilotState: state.autopilotState,
      chaserSpeedUnitsPerFrame: frameContext.chaserSpeedUnitsPerFrame,
      columns: frameContext.columns,
      rows: frameContext.rows,
      obstacles: frameContext.obstacles,
    }),
  };
}

function getChaserIdaeSnapshot(state) {
  return {
    knowledge: getChaserKnowledgeSnapshot(state.knowledgeBase),
    autopilot: {
      searchSteering: Number(state.autopilotState?.searchSteering) || 0,
      lastPursuitSource: state.autopilotState?.lastPursuitSource ?? "search",
      wallFollowSign: Number(state.autopilotState?.wallFollowSign) || 0,
      actionEngines: { ...(state.autopilotState?.actionEngines ?? {}) },
    },
  };
}

export function createChaserIdae({ scenario } = {}) {
  return createIdaeEngine({
    id: "chaser-idae",
    createState: () => createChaserIdaeState({ scenario }),
    observe: observeChaserIdae,
    updateMemory: updateChaserIdaeMemory,
    updatePatterns: updateChaserIdaePatterns,
    updateStrategies: updateChaserIdaeStrategies,
    chooseAction: chooseChaserIdaeAction,
    getSnapshot: getChaserIdaeSnapshot,
  });
}

export function stepChaserIdae(chaserIdae, frameContext = {}) {
  return stepIdaeEngine(chaserIdae, frameContext);
}
