import {
  createDecisionEngine,
  stepDecisionEngine,
  type DecisionCycle,
  type DecisionEngine,
} from "./decision-engine.ts";

// The generic actor framework stores actor-specific payloads, but does not inspect them.
export type ActorOpaqueValue = unknown;
export type ActorRuntimeRecord = Record<string, ActorOpaqueValue>;
export type ActorFrameContext = ActorRuntimeRecord;
export type ActorPolicy = ActorRuntimeRecord;
export type ActorStageMap = ActorRuntimeRecord;
export type ActorModuleOutputs = ActorRuntimeRecord;
export type ActorSnapshot = ActorRuntimeRecord;
export type ActorObservation = ActorOpaqueValue;
export type ActorSelfState = ActorOpaqueValue;
export type ActorControllerState = ActorOpaqueValue;
export type ActorAction = ActorOpaqueValue;
export type ActorStageResult = ActorOpaqueValue;

export type ActorDecisionCycle = DecisionCycle<
  ActorFrameContext,
  ActorObservation,
  ActorModuleOutputs,
  ActorModuleOutputs,
  ActorModuleOutputs,
  ActorAction,
  ActorSnapshot
>;

export type ActorDecisionEngine<TState extends ActorFrameworkState = ActorFrameworkState> = DecisionEngine<
  TState,
  ActorFrameContext,
  ActorObservation,
  ActorModuleOutputs,
  ActorModuleOutputs,
  ActorModuleOutputs,
  ActorAction,
  ActorSnapshot
>;

export type ActorMemory = {
  directObservation: ActorRuntimeRecord;
  abstracted: ActorRuntimeRecord;
  [key: string]: ActorOpaqueValue;
};

export type ActorFrameworkState = {
  policy: ActorPolicy;
  selfState: ActorSelfState | null;
  memory: ActorMemory;
  patterns: ActorStageMap;
  strategies: ActorStageMap;
  controllerState: ActorControllerState | null;
  engines: ActorStageMap;
  [key: string]: ActorOpaqueValue;
};

export type ActorModuleContext<TState extends ActorFrameworkState = ActorFrameworkState> = {
  actorId: string;
  state: TState;
  frameContext: ActorFrameContext;
  cycle: ActorDecisionCycle;
  outputs: ActorModuleOutputs;
};

export type ActorModule<TState extends ActorFrameworkState = ActorFrameworkState> = {
  id: string;
  update: (context: ActorModuleContext<TState>) => ActorStageResult;
};

export type ActorDecisionModelConfig<TState extends ActorFrameworkState = ActorFrameworkState> = {
  id?: string;
  createState?: () => Partial<TState> | TState;
  observe?: (state: TState, frameContext: ActorFrameContext, cycle: ActorDecisionCycle) => ActorObservation;
  deriveSelfState?: (state: TState, frameContext: ActorFrameContext, cycle: ActorDecisionCycle) => ActorSelfState;
  memoryModules?: ActorModule<TState>[];
  patternModules?: ActorModule<TState>[];
  strategyModules?: ActorModule<TState>[];
  chooseAction?: (state: TState, frameContext: ActorFrameContext, cycle: ActorDecisionCycle) => ActorAction;
  getSnapshot?: (state: TState, frameContext: ActorFrameContext, cycle: ActorDecisionCycle) => ActorSnapshot;
};

function ensureRecord(value: ActorOpaqueValue): ActorRuntimeRecord {
  return value && typeof value === "object" ? value as ActorRuntimeRecord : {};
}

function normalizeActorMemory(value: ActorOpaqueValue): ActorMemory {
  const memory = ensureRecord(value);
  return {
    ...memory,
    directObservation: ensureRecord(memory.directObservation),
    abstracted: ensureRecord(memory.abstracted),
  };
}

function normalizeActorState<TState extends ActorFrameworkState>(state: Partial<TState> = {}): TState {
  const normalized = {
    ...state,
  } as ActorFrameworkState;
  normalized.policy = ensureRecord(normalized.policy);
  normalized.selfState = normalized.selfState ?? null;
  normalized.memory = normalizeActorMemory(normalized.memory);
  normalized.patterns = ensureRecord(normalized.patterns);
  normalized.strategies = ensureRecord(normalized.strategies);
  normalized.controllerState = normalized.controllerState ?? null;
  normalized.engines = ensureRecord(normalized.engines);
  return normalized as TState;
}

function assertActorStateShape(state: ActorFrameworkState, actorId: string): void {
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

function runActorModules<TState extends ActorFrameworkState>(
  modules: ActorModule<TState>[] = [],
  context: Omit<ActorModuleContext<TState>, "outputs">,
): ActorModuleOutputs {
  const outputs: ActorModuleOutputs = {};
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

export function buildActorSnapshot<TState extends ActorFrameworkState>(
  state: TState,
  snapshot: ActorSnapshot = {},
): ActorSnapshot {
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

export function createActorDecisionModel<TState extends ActorFrameworkState = ActorFrameworkState>({
  id,
  createState,
  observe,
  deriveSelfState,
  memoryModules = [],
  patternModules = [],
  strategyModules = [],
  chooseAction,
  getSnapshot,
}: ActorDecisionModelConfig<TState> = {}): ActorDecisionEngine<TState> {
  return createDecisionEngine<
    TState,
    ActorFrameContext,
    ActorObservation,
    ActorModuleOutputs,
    ActorModuleOutputs,
    ActorModuleOutputs,
    ActorAction,
    ActorSnapshot
  >({
    id: id ?? "actor-decision-model",
    createState: () => {
      const state = normalizeActorState<TState>(
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

export function stepActorDecisionModel<TState extends ActorFrameworkState>(
  actorDecisionModel: ActorDecisionEngine<TState>,
  frameContext: ActorFrameContext = {},
): ActorDecisionCycle | null {
  return stepDecisionEngine(actorDecisionModel, frameContext);
}

export const createActorIdae = createActorDecisionModel;
export const stepActorIdae = stepActorDecisionModel;
