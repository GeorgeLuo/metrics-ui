export function createStatefulPattern({
  id,
  unit,
  createState,
  updateState,
  getOutput,
  getEvidence,
  getPredictions,
  getPredictionUnit,
  getConfidence,
} = {}) {
  const pattern = {
    id,
    unit: unit ?? id,
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
    getEvidence() {
      if (typeof getEvidence === "function") {
        return getEvidence(pattern.state);
      }
      return pattern.state?.evidence ?? null;
    },
    getPredictions() {
      if (typeof getPredictions === "function") {
        return getPredictions(pattern.state);
      }
      return Array.isArray(pattern.state?.predictions)
        ? pattern.state.predictions
        : [];
    },
    getPredictionUnit() {
      if (typeof getPredictionUnit === "function") {
        return getPredictionUnit(pattern.state);
      }
      return pattern.state?.predictionUnit ?? null;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(pattern.state)) || 0;
      }
      return Number(pattern.getPredictionUnit()?.confidence) || 0;
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

export function getPatternEvidence(pattern) {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getEvidence === "function") {
    return pattern.getEvidence();
  }
  return null;
}

export function getPatternPredictions(pattern) {
  if (!pattern) {
    return [];
  }
  if (typeof pattern.getPredictions === "function") {
    return pattern.getPredictions();
  }
  return [];
}

export function getPatternPredictionUnit(pattern) {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getPredictionUnit === "function") {
    return pattern.getPredictionUnit();
  }
  return null;
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
