export function createStatefulStrategy({
  id,
  createState,
  createOutput,
  deriveOutput,
  getConfidence,
  isActionable,
} = {}) {
  const strategy = {
    id,
    state: typeof createState === "function" ? createState() : null,
    output: typeof createOutput === "function" ? createOutput() : null,
    update(context) {
      if (typeof deriveOutput === "function") {
        strategy.output = deriveOutput(strategy.state, context);
      }
      return strategy.output;
    },
    getOutput() {
      return strategy.output;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(strategy.output, strategy.state)) || 0;
      }
      return 0;
    },
    isActionable() {
      if (typeof isActionable === "function") {
        return Boolean(isActionable(strategy.output, strategy.state));
      }
      return true;
    },
  };

  return strategy;
}

export function updateStrategy(strategy, context) {
  if (!strategy || typeof strategy.update !== "function") {
    return null;
  }
  return strategy.update(context);
}

export function getStrategyState(strategy) {
  return strategy?.state ?? null;
}

export function getStrategyOutput(strategy) {
  if (!strategy) {
    return null;
  }
  if (typeof strategy.getOutput === "function") {
    return strategy.getOutput();
  }
  return strategy?.output ?? null;
}

export function getStrategyConfidence(strategy) {
  if (!strategy) {
    return 0;
  }
  if (typeof strategy.getConfidence === "function") {
    return Number(strategy.getConfidence()) || 0;
  }
  return 0;
}

export function isStrategyActionable(strategy) {
  if (!strategy) {
    return false;
  }
  if (typeof strategy.isActionable === "function") {
    return Boolean(strategy.isActionable());
  }
  return true;
}
