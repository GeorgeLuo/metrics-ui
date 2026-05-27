// The base decision engine orders IDAE stages but does not interpret stage payloads.
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

export type DecisionStage<
  TState,
  TFrameContext,
  TCycle,
  TResult,
> = (state: TState, frameContext: TFrameContext, cycle: TCycle) => TResult;

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

export function getDecisionSnapshot<TSnapshot>(
  engine: { lastCycle?: { snapshot?: TSnapshot | null } | null } | null | undefined,
): TSnapshot | null {
  return engine?.lastCycle?.snapshot ?? null;
}

export const createIdaeEngine = createDecisionEngine;
export const stepIdaeEngine = stepDecisionEngine;
export const getIdaeSnapshot = getDecisionSnapshot;
