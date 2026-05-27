import type {
  PatternEvidence,
  PatternPredictionSample,
  PatternPredictionUnit,
  PatternUpdateContext,
  StatefulPattern,
  StatefulPatternConfig,
} from "./interfaces.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/**
 * Creates a stateful pattern wrapper from domain-specific callbacks.
 *
 * The wrapper owns the generic lifecycle: state initialization, updates,
 * evidence access, prediction access, and confidence lookup. Pattern-specific
 * code owns the actual state shape and update semantics.
 */
export function createStatefulPattern<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>({
  id,
  unit,
  createState,
  updateState,
  getOutput,
  getEvidence,
  getPredictions,
  getPredictionUnit,
  getConfidence,
}: StatefulPatternConfig<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> = {}): StatefulPattern<
  TState,
  TOutput,
  TEvidence,
  TPredictionUnit,
  TUnit,
  TContext
> {
  const pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> = {
    id: id ?? "stateful-pattern",
    unit: unit ?? null,
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
      return pattern.state as TOutput | null;
    },
    getEvidence() {
      if (typeof getEvidence === "function") {
        return getEvidence(pattern.state);
      }
      return (asRecord(pattern.state)?.evidence as TEvidence | undefined) ?? null;
    },
    getPredictions() {
      if (typeof getPredictions === "function") {
        return getPredictions(pattern.state);
      }
      const predictions = asRecord(pattern.state)?.predictions;
      return Array.isArray(predictions)
        ? predictions as PatternPredictionSample[]
        : [];
    },
    getPredictionUnit() {
      if (typeof getPredictionUnit === "function") {
        return getPredictionUnit(pattern.state);
      }
      return (asRecord(pattern.state)?.predictionUnit as TPredictionUnit | undefined) ?? null;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(pattern.state)) || 0;
      }
      const predictionUnit = pattern.getPredictionUnit() as { confidence?: unknown } | null;
      return Number(predictionUnit?.confidence) || 0;
    },
  };

  return pattern;
}

/**
 * Updates a pattern if it exists and exposes an update function.
 */
export function updatePattern<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
  context: PatternUpdateContext<TContext>,
): TState | null {
  if (!pattern || typeof pattern.update !== "function") {
    return null;
  }
  return pattern.update(context);
}

/**
 * Returns the current pattern state without invoking domain callbacks.
 */
export function getPatternState<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
): TState | null {
  return pattern?.state ?? null;
}

/**
 * Returns the pattern's public output, falling back to raw state.
 */
export function getPatternOutput<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
): TOutput | TState | null {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getOutput === "function") {
    return pattern.getOutput();
  }
  return getPatternState(pattern);
}

/**
 * Returns the evidence payload exposed by a pattern.
 */
export function getPatternEvidence<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
): TEvidence | PatternEvidence | null {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getEvidence === "function") {
    return pattern.getEvidence();
  }
  return null;
}

/**
 * Returns normalized future prediction samples for a pattern.
 */
export function getPatternPredictions<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
): PatternPredictionSample[] {
  if (!pattern) {
    return [];
  }
  if (typeof pattern.getPredictions === "function") {
    return pattern.getPredictions();
  }
  return [];
}

/**
 * Returns the pattern prediction unit consumed by strategies.
 */
export function getPatternPredictionUnit<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
): TPredictionUnit | PatternPredictionUnit | null {
  if (!pattern) {
    return null;
  }
  if (typeof pattern.getPredictionUnit === "function") {
    return pattern.getPredictionUnit();
  }
  return null;
}

/**
 * Returns the current pattern confidence on a 0..1 scale.
 */
export function getPatternConfidence<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
>(
  pattern: StatefulPattern<TState, TOutput, TEvidence, TPredictionUnit, TUnit, TContext> | null | undefined,
): number {
  if (!pattern) {
    return 0;
  }
  if (typeof pattern.getConfidence === "function") {
    return Number(pattern.getConfidence()) || 0;
  }
  return 0;
}
