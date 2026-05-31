export function createStatefulActionStrategy({
  id,
  createState,
  createOutput,
  deriveOutput,
  getConfidence,
  isActionable,
} = {}) {
  const actionStrategy = {
    id,
    state: typeof createState === "function" ? createState() : null,
    output: typeof createOutput === "function" ? createOutput() : null,
    update(context) {
      if (typeof deriveOutput === "function") {
        actionStrategy.output = deriveOutput(actionStrategy.state, context);
      }
      return actionStrategy.output;
    },
    getOutput() {
      return actionStrategy.output;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(actionStrategy.output, actionStrategy.state)) || 0;
      }
      return 0;
    },
    isActionable() {
      if (typeof isActionable === "function") {
        return Boolean(isActionable(actionStrategy.output, actionStrategy.state));
      }
      return true;
    },
  };

  return actionStrategy;
}

export function updateActionStrategy(actionStrategy, context) {
  if (!actionStrategy || typeof actionStrategy.update !== "function") {
    return null;
  }
  return actionStrategy.update(context);
}

export function getActionStrategyState(actionStrategy) {
  return actionStrategy?.state ?? null;
}

export function getActionStrategyOutput(actionStrategy) {
  if (!actionStrategy) {
    return null;
  }
  if (typeof actionStrategy.getOutput === "function") {
    return actionStrategy.getOutput();
  }
  return actionStrategy?.output ?? null;
}

export function getActionStrategyConfidence(actionStrategy) {
  if (!actionStrategy) {
    return 0;
  }
  if (typeof actionStrategy.getConfidence === "function") {
    return Number(actionStrategy.getConfidence()) || 0;
  }
  return 0;
}

export function isActionStrategyActionable(actionStrategy) {
  if (!actionStrategy) {
    return false;
  }
  if (typeof actionStrategy.isActionable === "function") {
    return Boolean(actionStrategy.isActionable());
  }
  return true;
}
