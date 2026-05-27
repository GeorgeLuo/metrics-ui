import {
  createDecisionEngine,
  stepDecisionEngine,
  type DecisionCycle,
  type DecisionEngine,
} from "./decision-engine.ts";

/**
 * Opaque value boundary for actor-specific payloads.
 *
 * The actor wrapper understands the framework slots an actor exposes, such as
 * memory, patterns, strategies, controller state, and engines. It does not
 * interpret the concrete payloads stored inside those slots; the chaser, evader,
 * or another actor implementation owns those shapes.
 */
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

/**
 * Decision cycle specialization used by actor models.
 *
 * Actor memory, pattern, and strategy stages all return module-output maps keyed
 * by module id. Observation, action, and self/controller payloads stay opaque to
 * this generic wrapper.
 */
export type ActorDecisionCycle = DecisionCycle<
  ActorFrameContext,
  ActorObservation,
  ActorModuleOutputs,
  ActorModuleOutputs,
  ActorModuleOutputs,
  ActorAction,
  ActorSnapshot
>;

/**
 * Generic decision engine specialized to the actor framework state and cycle.
 */
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

/**
 * Shared memory layout every actor state exposes.
 *
 * Direct observation is for raw current-frame perception. Abstracted memory is
 * for derived state that persists across frames, such as learned map knowledge
 * or success metrics.
 */
export type ActorMemory = {
  directObservation: ActorRuntimeRecord;
  abstracted: ActorRuntimeRecord;
  [key: string]: ActorOpaqueValue;
};

/**
 * Minimum state shape required by the actor decision wrapper.
 *
 * Concrete actors can add fields, but these framework keys must exist so the
 * generic pipeline can normalize state, run modules, and build debug snapshots.
 */
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

/**
 * Runtime context passed to each actor module.
 *
 * `outputs` contains results already produced by earlier modules in the same
 * stage, allowing modules to depend on previous same-stage calculations when an
 * actor deliberately orders them that way.
 */
export type ActorModuleContext<TState extends ActorFrameworkState = ActorFrameworkState> = {
  actorId: string;
  state: TState;
  frameContext: ActorFrameContext;
  cycle: ActorDecisionCycle;
  outputs: ActorModuleOutputs;
};

/**
 * Module contract for memory, pattern, and strategy stages.
 *
 * A module returns one stage result and is stored in the stage output map under
 * its `id`.
 */
export type ActorModule<TState extends ActorFrameworkState = ActorFrameworkState> = {
  id: string;
  update: (context: ActorModuleContext<TState>) => ActorStageResult;
};

/**
 * Assembly contract for an actor decision model.
 *
 * Actor-specific adapters provide perception, self-state derivation, stage
 * modules, action selection, and debug snapshot projection. This wrapper wires
 * those callbacks into the generic IDAE execution order.
 */
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

/**
 * Returns a record when a framework slot is object-like, otherwise an empty map.
 *
 * This keeps optional actor state overrides from breaking the expected framework
 * shape when callers omit a section or pass a malformed value.
 */
function ensureRecord(value: ActorOpaqueValue): ActorRuntimeRecord {
  return value && typeof value === "object" ? value as ActorRuntimeRecord : {};
}

/**
 * Normalizes memory into the two required memory namespaces.
 */
function normalizeActorMemory(value: ActorOpaqueValue): ActorMemory {
  const memory = ensureRecord(value);
  return {
    ...memory,
    directObservation: ensureRecord(memory.directObservation),
    abstracted: ensureRecord(memory.abstracted),
  };
}

/**
 * Fills missing framework slots before an actor starts running.
 *
 * This lets concrete actors return partial state from `createState` while still
 * giving the generic pipeline stable places to read and write framework data.
 */
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

/**
 * Fails early when an actor state no longer matches the framework contract.
 */
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

/**
 * Runs one ordered list of actor modules for a single IDAE stage.
 *
 * Results are collected by module id and returned as the stage output. The same
 * output map is passed into later modules in the list so intentional intra-stage
 * dependencies remain possible.
 */
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

/**
 * Builds the public snapshot for debug views and tests.
 *
 * Actor-provided snapshot fields can override framework defaults, while omitted
 * sections fall back to the current actor state.
 */
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

/**
 * Creates an actor decision model by adapting actor callbacks to IDAE stages.
 *
 * The generic engine sees only stage functions. This adapter adds actor-specific
 * behavior: state normalization, self-state derivation during memory update,
 * ordered module execution for memory/pattern/strategy stages, and framework
 * snapshot defaults.
 */
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

/**
 * Advances an actor decision model by one frame context.
 */
export function stepActorDecisionModel<TState extends ActorFrameworkState>(
  actorDecisionModel: ActorDecisionEngine<TState>,
  frameContext: ActorFrameContext = {},
): ActorDecisionCycle | null {
  return stepDecisionEngine(actorDecisionModel, frameContext);
}

/**
 * IDAE naming aliases for actor call sites.
 */
export const createActorIdae = createActorDecisionModel;
export const stepActorIdae = stepActorDecisionModel;
