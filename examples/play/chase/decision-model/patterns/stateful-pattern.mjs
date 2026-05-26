/**
 * @import {
 *   PatternEvidence,
 *   PatternPredictionSample,
 *   PatternPredictionUnit,
 *   PatternUpdateContext,
 *   StatefulPattern,
 *   StatefulPatternConfig,
 * } from "./interfaces.ts"
 */

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPatternConfig<TState, TOutput, TEvidence, TPredictionUnit, TUnit>} config
 * @returns {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit>}
 */
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
  /** @type {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit>} */
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

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @param {PatternUpdateContext} context
 * @returns {TState | null}
 */
export function updatePattern(pattern, context) {
  if (!pattern || typeof pattern.update !== "function") {
    return null;
  }
  return pattern.update(context);
}

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @returns {TState | null}
 */
export function getPatternState(pattern) {
  return pattern?.state ?? null;
}

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @returns {TOutput | TState | null}
 */
export function getPatternOutput(pattern) {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getOutput === "function") {
    return pattern.getOutput();
  }
  return getPatternState(pattern);
}

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @returns {TEvidence | PatternEvidence | null}
 */
export function getPatternEvidence(pattern) {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getEvidence === "function") {
    return pattern.getEvidence();
  }
  return null;
}

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @returns {PatternPredictionSample[]}
 */
export function getPatternPredictions(pattern) {
  if (!pattern) {
    return [];
  }
  if (typeof pattern.getPredictions === "function") {
    return pattern.getPredictions();
  }
  return [];
}

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @returns {TPredictionUnit | PatternPredictionUnit | null}
 */
export function getPatternPredictionUnit(pattern) {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getPredictionUnit === "function") {
    return pattern.getPredictionUnit();
  }
  return null;
}

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @param {StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit> | null | undefined} pattern
 * @returns {number}
 */
export function getPatternConfidence(pattern) {
  if (!pattern) {
    return 0;
  }
  if (typeof pattern.getConfidence === "function") {
    return Number(pattern.getConfidence()) || 0;
  }
  return 0;
}
