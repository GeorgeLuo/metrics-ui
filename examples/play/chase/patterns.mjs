export function createStatefulPattern({
  id,
  createState,
  updateState,
  getOutput,
  getConfidence,
} = {}) {
  const pattern = {
    id,
    state: typeof createState === "function" ? createState() : null,
    update(context) {
      if (typeof updateState === "function") {
        pattern.state = updateState(pattern.state, context) ?? pattern.state;
      }
      return pattern.state;
    },
    getOutput() {
      if (typeof getOutput === "function") {
        return getOutput(pattern.state);
      }
      return pattern.state;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(pattern.state)) || 0;
      }
      return 0;
    },
  };

  return pattern;
}

export function updatePattern(pattern, context) {
  if (!pattern || typeof pattern.update !== "function") {
    return null;
  }
  return pattern.update(context);
}

export function getPatternState(pattern) {
  return pattern?.state ?? null;
}

export function getPatternOutput(pattern) {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getOutput === "function") {
    return pattern.getOutput();
  }
  return getPatternState(pattern);
}

export function getPatternConfidence(pattern) {
  if (!pattern) {
    return 0;
  }
  if (typeof pattern.getConfidence === "function") {
    return Number(pattern.getConfidence()) || 0;
  }
  return 0;
}
