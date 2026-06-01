import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES,
} from "../../../../config/constants.mjs";
import {
  buildRectifiedPrediction,
  buildRectifiedPredictionPath,
} from "./rectification.ts";
import {
  buildPersistedPredictionPlan,
  clearPersistedPlan,
  persistActionablePlan,
  queuePredictionValidation,
  updatePredictionPlanState,
} from "./validation-state.ts";
import type { ProjectionPlan } from "../../core/interfaces.ts";
import type {
  EvaderMotionProjectionPlanOptions,
  EvaderMotionProjectionState,
} from "./interfaces.ts";

/**
 * Normalizes caller-provided frame counts used by projection sampling.
 */
function getPositiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

/**
 * Returns how many path samples should be produced for the current horizon.
 */
export function getEvaderProjectionSampleCount({
  horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
}: {
  horizonFrames?: number;
  sampleSpacingFrames?: number;
} = {}): number {
  const normalizedHorizonFrames = getPositiveInteger(
    horizonFrames,
    DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  );
  const normalizedSampleSpacingFrames = getPositiveInteger(
    sampleSpacingFrames,
    DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  );
  return Math.max(1, Math.ceil(normalizedHorizonFrames / normalizedSampleSpacingFrames));
}

/**
 * Creates mutable validation and persistence state for evader-motion projection.
 */
export function createEvaderMotionProjectionState(): EvaderMotionProjectionState {
  return {
    elapsedFrames: 0,
    lastValidationErrorDistance: 0,
    pendingValidations: [],
    lastActionablePlan: null,
    lastActionableFrame: null,
  };
}

/**
 * Builds the chaser's future-state projection for the evader.
 *
 * This planner centralizes projection rectification, stale-estimate handling,
 * validation against later observations, and short persistence after sight is
 * lost. Pattern units supply possible future samples; this function turns those
 * into one action-consumable projection plan.
 */
export function buildEvaderMotionProjectionPlan({
  estimate,
  patternUnits,
  evaderVisible = false,
  projectionState = null,
  columns,
  rows,
  obstacles,
  horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
}: EvaderMotionProjectionPlanOptions = {}): ProjectionPlan {
  updatePredictionPlanState({
    state: projectionState,
    evaderVisible,
    estimate,
  });

  const normalizedHorizonFrames = getPositiveInteger(
    horizonFrames,
    DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  );
  const normalizedSampleSpacingFrames = getPositiveInteger(
    sampleSpacingFrames,
    DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  );
  const resolvedSampleCount = getEvaderProjectionSampleCount({
    horizonFrames: normalizedHorizonFrames,
    sampleSpacingFrames: normalizedSampleSpacingFrames,
  });
  const path = buildRectifiedPredictionPath(patternUnits, {
    estimate,
    worldContext: {
      columns,
      rows,
      obstacles,
    },
  });
  const prediction = buildRectifiedPrediction(path);
  const hasObservedTarget = evaderVisible || Number(estimate?.observationCount) > 0;
  const isEstimateStale = !evaderVisible && (
    !hasObservedTarget
    || Number(estimate?.framesSinceObservation) > EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES
  );
  const hasPatternPredictions = path.length > 0;
  const invalidReason = isEstimateStale
    ? "stale-evader-estimate"
    : !hasPatternPredictions
      ? "pattern-predictions-unavailable"
      : null;
  const actionable = !invalidReason;

  if (isEstimateStale) {
    clearPersistedPlan(projectionState);
  }

  if (!actionable && !evaderVisible && !isEstimateStale) {
    const persistedPlan = buildPersistedPredictionPlan(projectionState);
    if (persistedPlan) {
      return persistedPlan;
    }
  }

  const actionablePath = actionable ? path : [];

  if (actionable && evaderVisible) {
    queuePredictionValidation(projectionState, actionablePath);
  }

  if (actionable) {
    persistActionablePlan(projectionState, {
      prediction,
      path: actionablePath,
      sampleCount: resolvedSampleCount,
      sampleSpacingFrames: normalizedSampleSpacingFrames,
      horizonFrames: normalizedHorizonFrames,
    });
  }

  return {
    actionable,
    invalidReason,
    prediction,
    path: actionablePath,
    sampleCount: resolvedSampleCount,
    sampleSpacingFrames: normalizedSampleSpacingFrames,
    horizonFrames: normalizedHorizonFrames,
    validationErrorDistance: projectionState?.lastValidationErrorDistance ?? 0,
  };
}
