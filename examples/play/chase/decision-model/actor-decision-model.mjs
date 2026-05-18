import { createDecisionEngine, stepDecisionEngine } from "./decision-engine.mjs";

function ensureRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeActorMemory(value) {
  const memory = ensureRecord(value);
  return {
    ...memory,
    directObservation: ensureRecord(memory.directObservation),
    abstracted: ensureRecord(memory.abstracted),
  };
}

function normalizeActorState(state = {}) {
  const normalized = {
    ...state,
  };
  normalized.policy = ensureRecord(normalized.policy);
  normalized.selfState = normalized.selfState ?? null;
  normalized.memory = normalizeActorMemory(normalized.memory);
  normalized.patterns = ensureRecord(normalized.patterns);
  normalized.strategies = ensureRecord(normalized.strategies);
  normalized.controllerState = normalized.controllerState ?? null;
  normalized.engines = ensureRecord(normalized.engines);
  return normalized;
}

function assertActorStateShape(state, actorId) {
  const requiredKeys = [
    "policy",
    "selfState",
    "memory",
    "patterns",
    "strategies",
    "controllerState",
    "engines",
  ];
  for (const key of requiredKeys) {
    if (!(key in state)) {
      throw new Error(`${actorId}: missing actor framework state key "${key}"`);
    }
  }
}

function runActorModules(modules = [], context = {}) {
  const outputs = {};
  for (const module of modules) {
    if (!module?.id || typeof module.update !== "function") {
      throw new Error(`actor module is missing a valid id/update pair`);
    }
    outputs[module.id] = module.update({
      ...context,
      outputs,
    });
  }
  return outputs;
}

export function buildActorSnapshot(state, snapshot = {}) {
  return {
    selfState: snapshot.selfState ?? state.selfState ?? null,
    memory: snapshot.memory ?? state.memory ?? {},
    patterns: snapshot.patterns ?? state.patterns ?? {},
    strategies: snapshot.strategies ?? state.strategies ?? {},
    controllerState: snapshot.controllerState ?? state.controllerState ?? null,
    engines: snapshot.engines ?? state.engines ?? {},
    ...snapshot,
  };
}

export function createActorDecisionModel({
  id,
  createState,
  observe,
  deriveSelfState,
  memoryModules = [],
  patternModules = [],
  strategyModules = [],
  chooseAction,
  getSnapshot,
} = {}) {
  return createDecisionEngine({
    id: id ?? "actor-decision-model",
    createState: () => {
      const state = normalizeActorState(
        typeof createState === "function" ? createState() : {},
      );
      assertActorStateShape(state, id ?? "actor-decision-model");
      return state;
    },
    observe: (state, frameContext, cycle) => {
      assertActorStateShape(state, id ?? "actor-decision-model");
      return typeof observe === "function"
        ? observe(state, frameContext, cycle)
        : null;
    },
    updateMemory: (state, frameContext, cycle) => {
      assertActorStateShape(state, id ?? "actor-decision-model");
      if (typeof deriveSelfState === "function") {
        state.selfState = deriveSelfState(state, frameContext, cycle);
      }
      return runActorModules(memoryModules, {
        actorId: id ?? "actor-decision-model",
        state,
        frameContext,
        cycle,
      });
    },
    updatePatterns: (state, frameContext, cycle) => {
      assertActorStateShape(state, id ?? "actor-decision-model");
      return runActorModules(patternModules, {
        actorId: id ?? "actor-decision-model",
        state,
        frameContext,
        cycle,
      });
    },
    updateStrategies: (state, frameContext, cycle) => {
      assertActorStateShape(state, id ?? "actor-decision-model");
      return runActorModules(strategyModules, {
        actorId: id ?? "actor-decision-model",
        state,
        frameContext,
        cycle,
      });
    },
    chooseAction: (state, frameContext, cycle) => {
      assertActorStateShape(state, id ?? "actor-decision-model");
      return typeof chooseAction === "function"
        ? chooseAction(state, frameContext, cycle)
        : null;
    },
    getSnapshot: (state, frameContext, cycle) => {
      assertActorStateShape(state, id ?? "actor-decision-model");
      return buildActorSnapshot(
        state,
        typeof getSnapshot === "function"
          ? getSnapshot(state, frameContext, cycle)
          : {},
      );
    },
  });
}

export function stepActorDecisionModel(actorDecisionModel, frameContext = {}) {
  return stepDecisionEngine(actorDecisionModel, frameContext);
}

export const createActorIdae = createActorDecisionModel;
export const stepActorIdae = stepActorDecisionModel;
