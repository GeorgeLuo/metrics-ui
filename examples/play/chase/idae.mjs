export function createIdaeEngine({
  id,
  createState,
  observe,
  updateMemory,
  updatePatterns,
  updateStrategies,
  chooseAction,
  getSnapshot,
} = {}) {
  return {
    id: id ?? "idae",
    state: typeof createState === "function" ? createState() : {},
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

export function stepIdaeEngine(engine, frameContext = {}) {
  if (!engine?.stages) {
    return null;
  }

  const cycle = {
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

export function getIdaeSnapshot(engine) {
  return engine?.lastCycle?.snapshot ?? null;
}
