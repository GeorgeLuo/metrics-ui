/**
 * Opaque value boundary for the generic decision engine.
 *
 * The base engine is responsible for ordering IDAE stages, preserving state, and
 * storing each stage's output in a cycle. It intentionally does not inspect the
 * meaning of observations, memory updates, pattern outputs, strategies, actions,
 * or snapshots. Actor-specific adapters should specialize these defaults.
 */
export type DecisionOpaqueValue = unknown;
export type DecisionRuntimeRecord = Record<string, DecisionOpaqueValue>;
export type DecisionDefaultState = DecisionRuntimeRecord;
export type DecisionDefaultFrameContext = DecisionRuntimeRecord;
export type DecisionDefaultObservation = DecisionOpaqueValue;
export type DecisionDefaultMemory = DecisionOpaqueValue;
export type DecisionDefaultPatterns = DecisionOpaqueValue;
export type DecisionDefaultStrategies = DecisionOpaqueValue;
export type DecisionDefaultAction = DecisionOpaqueValue;
export type DecisionDefaultSnapshot = DecisionOpaqueValue;

/**
 * A single pass through the decision pipeline.
 *
 * Every stage receives the same mutable cycle object. Earlier stage outputs are
 * available to later stages, while stages that are not configured remain `null`.
 */
export type DecisionCycle<
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
> = {
  frameContext: TFrameContext;
  observation: TObservation | null;
  memory: TMemory | null;
  patterns: TPatterns | null;
  strategies: TStrategies | null;
  action: TAction | null;
  snapshot: TSnapshot | null;
};

/**
 * Function signature shared by all decision stages.
 *
 * `TResult` changes per stage: observe returns an observation, updateMemory
 * returns memory output, chooseAction returns an action, and so on.
 */
export type DecisionStage<
  TState,
  TFrameContext,
  TCycle,
  TResult,
> = (state: TState, frameContext: TFrameContext, cycle: TCycle) => TResult;

/**
 * Fully-typed cycle passed into each stage.
 *
 * This alias keeps the stage map readable while preserving the relationship
 * between every stage output type and the cycle object that stages receive.
 */
export type DecisionStageCycle<
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
> = DecisionCycle<
  TFrameContext,
  TObservation,
  TMemory,
  TPatterns,
  TStrategies,
  TAction,
  TSnapshot
>;

/**
 * Convenience alias for a stage within a particular engine specialization.
 *
 * The first eight type parameters describe the full engine, and `TResult`
 * selects the output for the individual stage being declared.
 */
export type DecisionStageFor<
  TState = DecisionDefaultState,
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
  TResult = DecisionOpaqueValue,
> = DecisionStage<
  TState,
  TFrameContext,
  DecisionStageCycle<TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot>,
  TResult
>;

/**
 * Optional IDAE stage handlers.
 *
 * The engine executes these in declaration order:
 * observe -> updateMemory -> updatePatterns -> updateStrategies ->
 * chooseAction -> getSnapshot.
 */
export type DecisionStages<
  TState = DecisionDefaultState,
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
> = {
  observe?: DecisionStageFor<
    TState, TFrameContext, TObservation, TMemory, TPatterns,
    TStrategies, TAction, TSnapshot, TObservation
  >;
  updateMemory?: DecisionStageFor<
    TState, TFrameContext, TObservation, TMemory, TPatterns,
    TStrategies, TAction, TSnapshot, TMemory
  >;
  updatePatterns?: DecisionStageFor<
    TState, TFrameContext, TObservation, TMemory, TPatterns,
    TStrategies, TAction, TSnapshot, TPatterns
  >;
  updateStrategies?: DecisionStageFor<
    TState, TFrameContext, TObservation, TMemory, TPatterns,
    TStrategies, TAction, TSnapshot, TStrategies
  >;
  chooseAction?: DecisionStageFor<
    TState, TFrameContext, TObservation, TMemory, TPatterns,
    TStrategies, TAction, TSnapshot, TAction
  >;
  getSnapshot?: DecisionStageFor<
    TState, TFrameContext, TObservation, TMemory, TPatterns,
    TStrategies, TAction, TSnapshot, TSnapshot
  >;
};

/**
 * Creation-time configuration for a decision engine.
 *
 * `createState` initializes the mutable state owned by the engine. Stage
 * handlers are optional so consumers can assemble narrow pipelines for tests,
 * probes, or actors that only need part of the IDAE flow.
 */
export type DecisionEngineConfig<
  TState = DecisionDefaultState,
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
> = DecisionStages<TState, TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> & {
  id?: string;
  createState?: () => TState;
};

/**
 * Runtime container for a decision pipeline.
 *
 * `state` persists across frames. `lastCycle` stores the most recent pass so
 * renderers, debug overlays, and tests can inspect the latest decision result
 * without rerunning the model.
 */
export type DecisionEngine<
  TState = DecisionDefaultState,
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
> = {
  id: string;
  state: TState;
  stages: DecisionStages<TState, TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot>;
  lastCycle: DecisionCycle<TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> | null;
};

/**
 * Creates a decision engine from optional IDAE stages.
 *
 * The returned engine is inert until `stepDecisionEngine` is called. If no
 * `createState` function is provided, the engine starts with an empty object
 * cast to the requested state type.
 */
export function createDecisionEngine<
  TState = DecisionDefaultState,
  TFrameContext = DecisionDefaultFrameContext,
  TObservation = DecisionDefaultObservation,
  TMemory = DecisionDefaultMemory,
  TPatterns = DecisionDefaultPatterns,
  TStrategies = DecisionDefaultStrategies,
  TAction = DecisionDefaultAction,
  TSnapshot = DecisionDefaultSnapshot,
>({
  id,
  createState,
  observe,
  updateMemory,
  updatePatterns,
  updateStrategies,
  chooseAction,
  getSnapshot,
}: DecisionEngineConfig<TState, TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> = {}): DecisionEngine<TState, TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> {
  return {
    id: id ?? "decision-engine",
    state: typeof createState === "function" ? createState() : ({} as TState),
    stages: {
      observe,
      updateMemory,
      updatePatterns,
      updateStrategies,
      chooseAction,
      getSnapshot,
    },
    lastCycle: null,
  };
}

/**
 * Executes one decision cycle.
 *
 * Each configured stage is invoked at most once, in IDAE order. The cycle object
 * is populated as stages run, assigned to `engine.lastCycle`, and returned to
 * the caller. A missing engine or stage map returns `null` instead of throwing,
 * which keeps optional actor models easy to guard at call sites.
 */
export function stepDecisionEngine<
  TState,
  TFrameContext,
  TObservation,
  TMemory,
  TPatterns,
  TStrategies,
  TAction,
  TSnapshot,
>(
  engine: DecisionEngine<TState, TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> | null | undefined,
  frameContext = {} as TFrameContext,
): DecisionCycle<TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> | null {
  if (!engine?.stages) {
    return null;
  }

  const cycle: DecisionCycle<TFrameContext, TObservation, TMemory, TPatterns, TStrategies, TAction, TSnapshot> = {
    frameContext,
    observation: null,
    memory: null,
    patterns: null,
    strategies: null,
    action: null,
    snapshot: null,
  };

  if (typeof engine.stages.observe === "function") {
    cycle.observation = engine.stages.observe(engine.state, frameContext, cycle);
  }
  if (typeof engine.stages.updateMemory === "function") {
    cycle.memory = engine.stages.updateMemory(engine.state, frameContext, cycle);
  }
  if (typeof engine.stages.updatePatterns === "function") {
    cycle.patterns = engine.stages.updatePatterns(engine.state, frameContext, cycle);
  }
  if (typeof engine.stages.updateStrategies === "function") {
    cycle.strategies = engine.stages.updateStrategies(engine.state, frameContext, cycle);
  }
  if (typeof engine.stages.chooseAction === "function") {
    cycle.action = engine.stages.chooseAction(engine.state, frameContext, cycle);
  }
  if (typeof engine.stages.getSnapshot === "function") {
    cycle.snapshot = engine.stages.getSnapshot(engine.state, frameContext, cycle);
  }

  engine.lastCycle = cycle;
  return cycle;
}

/**
 * Reads the last snapshot produced by an engine.
 *
 * This helper is intentionally tolerant of partial objects so callers can use
 * it with mocked engines or partially constructed debug structures.
 */
export function getDecisionSnapshot<TSnapshot>(
  engine: { lastCycle?: { snapshot?: TSnapshot | null } | null } | null | undefined,
): TSnapshot | null {
  return engine?.lastCycle?.snapshot ?? null;
}

/**
 * IDAE naming aliases for call sites that should speak in decision-model terms
 * rather than generic engine terms.
 */
export const createIdaeEngine = createDecisionEngine;
export const stepIdaeEngine = stepDecisionEngine;
export const getIdaeSnapshot = getDecisionSnapshot;
