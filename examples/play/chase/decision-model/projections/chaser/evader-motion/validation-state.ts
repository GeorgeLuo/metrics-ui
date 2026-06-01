import {
  EVADER_PREDICTION_PERSISTENCE_FRAMES,
  EVADER_PROJECTION_INVALIDATION_DISTANCE,
  EVADER_PROJECTION_VALIDATION_LOOKAHEAD_FRAMES,
} from "../../../../config/constants.mjs";
import { clonePosition, cloneVector } from "./sample-utils.ts";
import type { ProjectionPlan, ProjectionPrediction, ProjectionSample } from "../../core/interfaces.ts";
import type { VectorXZ } from "../../../core/math.ts";
import type {
  EvaderMotionEstimate,
  EvaderMotionProjectionState,
  PersistedEvaderProjectionSample,
} from "./interfaces.ts";

const MAX_PENDING_VALIDATIONS = 24;

/**
 * Drops any cached actionable plan from projection state.
 */
export function clearPersistedPlan(state: EvaderMotionProjectionState | null | undefined): void {
  if (!state) {
    return;
  }
  state.lastActionablePlan = null;
  state.lastActionableFrame = null;
}

/**
 * Finds the path sample nearest to the requested validation lookahead.
 */
function getSampleNearestFrames(
  path: ProjectionSample[] | null | undefined,
  framesAhead: number,
): ProjectionSample | null {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }

  return path.reduce<ProjectionSample | null>((best, sample) => {
    if (!sample?.position || !Number.isFinite(sample.framesAhead)) {
      return best;
    }
    if (!best) {
      return sample;
    }
    return Math.abs(sample.framesAhead - framesAhead)
      < Math.abs(best.framesAhead - framesAhead)
      ? sample
      : best;
  }, null);
}

/**
 * Calculates distance used to validate an old prediction against fresh sighting.
 */
function getPositionDistance(
  first: VectorXZ | null | undefined,
  second: VectorXZ | null | undefined,
): number {
  return first && second
    ? Math.hypot(first.x - second.x, first.z - second.z)
    : Number.POSITIVE_INFINITY;
}

/**
 * Advances validation bookkeeping and invalidates stale persisted plans.
 */
export function updatePredictionPlanState({
  state,
  evaderVisible,
  estimate,
}: {
  state: EvaderMotionProjectionState | null | undefined;
  evaderVisible: boolean;
  estimate?: EvaderMotionEstimate | null;
}): void {
  if (!state) {
    return;
  }

  state.elapsedFrames += 1;

  if (!evaderVisible || !estimate?.position) {
    return;
  }

  let shouldClearValidations = false;
  const remainingValidations: EvaderMotionProjectionState["pendingValidations"] = [];
  for (const validation of state.pendingValidations) {
    if (validation.dueFrame > state.elapsedFrames) {
      remainingValidations.push(validation);
      continue;
    }

    const errorDistance = getPositionDistance(estimate.position, validation.position);
    state.lastValidationErrorDistance = Number.isFinite(errorDistance) ? errorDistance : 0;
    if (errorDistance > EVADER_PROJECTION_INVALIDATION_DISTANCE) {
      shouldClearValidations = true;
      break;
    }
  }
  if (shouldClearValidations) {
    state.pendingValidations = [];
    clearPersistedPlan(state);
    return;
  }
  state.pendingValidations = remainingValidations.slice(-MAX_PENDING_VALIDATIONS);
}

/**
 * Queues one future sample to compare against the next matching observation.
 */
export function queuePredictionValidation(
  state: EvaderMotionProjectionState | null | undefined,
  path: ProjectionSample[],
): void {
  if (!state) {
    return;
  }

  const validationSample = getSampleNearestFrames(
    path,
    EVADER_PROJECTION_VALIDATION_LOOKAHEAD_FRAMES,
  );
  if (!validationSample?.position) {
    return;
  }

  state.pendingValidations.push({
    dueFrame: state.elapsedFrames + validationSample.framesAhead,
    position: { ...validationSample.position },
  });
  state.pendingValidations = state.pendingValidations.slice(-MAX_PENDING_VALIDATIONS);
}

/**
 * Persists an actionable path so the chaser can keep a short-lived projection
 * after line of sight is lost.
 */
export function persistActionablePlan(
  state: EvaderMotionProjectionState | null | undefined,
  {
    prediction,
    path,
    sampleCount,
    sampleSpacingFrames,
    horizonFrames,
  }: {
    prediction?: ProjectionPrediction | null;
    path?: ProjectionSample[];
    sampleCount?: number;
    sampleSpacingFrames?: number;
    horizonFrames?: number;
  } = {},
): void {
  if (!state || !prediction || !Array.isArray(path) || path.length === 0) {
    return;
  }

  state.lastActionableFrame = state.elapsedFrames;
  state.lastActionablePlan = {
    prediction: {
      ...prediction,
      direction: cloneVector(prediction.direction) ?? { x: 0, z: 0 },
      rectification: prediction.rectification ? { ...prediction.rectification } : null,
      sourcePatternIds: Array.isArray(prediction.sourcePatternIds)
        ? [...prediction.sourcePatternIds]
        : [],
      wallAvoidance: prediction.wallAvoidance ? { ...prediction.wallAvoidance } : null,
      oscillators: Array.isArray(prediction.oscillators)
        ? prediction.oscillators.map((oscillator) => ({ ...oscillator }))
        : [],
    },
    path: path
      .filter((sample) => sample?.position && Number.isFinite(sample.framesAhead))
      .map((sample): PersistedEvaderProjectionSample => ({
        dueFrame: state.elapsedFrames + sample.framesAhead,
        position: clonePosition(sample.position),
        direction: cloneVector(sample.direction),
        confidence: Number.isFinite(Number(sample.confidence)) ? Number(sample.confidence) : 0,
        sourcePatternIds: Array.isArray(sample.sourcePatternIds)
          ? [...sample.sourcePatternIds]
          : [],
      })),
    sampleCount: Number(sampleCount) || 0,
    sampleSpacingFrames: Number(sampleSpacingFrames) || 0,
    horizonFrames: Number(horizonFrames) || 0,
  };
}

/**
 * Rebuilds a still-valid persisted plan relative to the current frame.
 */
export function buildPersistedPredictionPlan(
  state: EvaderMotionProjectionState | null | undefined,
): ProjectionPlan | null {
  if (!state?.lastActionablePlan || !Number.isFinite(state.lastActionableFrame)) {
    return null;
  }

  const lastActionableFrame = state.lastActionableFrame;
  if (lastActionableFrame === null) {
    return null;
  }

  if (state.elapsedFrames - lastActionableFrame > EVADER_PREDICTION_PERSISTENCE_FRAMES) {
    clearPersistedPlan(state);
    return null;
  }

  const remainingPath = state.lastActionablePlan.path
    .filter((sample) => sample?.position && Number.isFinite(sample.dueFrame))
    .filter((sample) => sample.dueFrame > state.elapsedFrames);

  if (remainingPath.length === 0) {
    clearPersistedPlan(state);
    return null;
  }

  return {
    actionable: true,
    invalidReason: null,
    prediction: {
      ...state.lastActionablePlan.prediction,
      strategy: `${state.lastActionablePlan.prediction.strategy}-persisted`,
      persisted: true,
    },
    path: remainingPath.map((sample) => ({
      framesAhead: sample.dueFrame - state.elapsedFrames,
      position: clonePosition(sample.position),
      direction: cloneVector(sample.direction),
      confidence: Number.isFinite(sample.confidence) ? sample.confidence : 0,
      sourcePatternIds: Array.isArray(sample.sourcePatternIds)
        ? [...sample.sourcePatternIds]
        : [],
    })),
    sampleCount: remainingPath.length,
    sampleSpacingFrames: state.lastActionablePlan.sampleSpacingFrames,
    horizonFrames: Math.max(0, Number(remainingPath.at(-1)?.dueFrame) - state.elapsedFrames) || 0,
    validationErrorDistance: state.lastValidationErrorDistance ?? 0,
    persisted: true,
  };
}
