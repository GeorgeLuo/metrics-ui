import {
  DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  TARGET_PREDICTION_MAX_UNOBSERVED_FRAMES,
  TARGET_PROJECTION_INVALIDATION_DISTANCE,
  TARGET_PROJECTION_VALIDATION_LOOKAHEAD_FRAMES,
} from "./constants.mjs";
import { predictTargetMotionWithKuramoto } from "./prediction.mjs";
import { buildTargetProjectionPath } from "./projection-path.mjs";

const MAX_PENDING_VALIDATIONS = 24;

function getPositiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

export function getTargetProjectionSampleCount({
  horizonFrames = DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  sampleEveryFrames = 1,
} = {}) {
  const normalizedHorizonFrames = getPositiveNumber(
    horizonFrames,
    DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  );
  const normalizedSampleEveryFrames = Math.max(
    1,
    Math.floor(getPositiveNumber(sampleEveryFrames, 1)),
  );
  return Math.max(1, Math.ceil(normalizedHorizonFrames / normalizedSampleEveryFrames));
}

export function createTargetPredictionPlanState() {
  return {
    frameIndex: 0,
    lastValidationErrorDistance: 0,
    pendingValidations: [],
  };
}

function getSampleNearestFrames(path, framesAhead) {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }

  return path.reduce((best, sample) => {
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

function getPositionDistance(first, second) {
  return first && second
    ? Math.hypot(first.x - second.x, first.z - second.z)
    : Number.POSITIVE_INFINITY;
}

function updatePredictionPlanState({
  state,
  targetVisible,
  estimate,
}) {
  if (!state) {
    return;
  }

  state.frameIndex += 1;

  if (!targetVisible || !estimate?.position) {
    return;
  }

  let shouldClearValidations = false;
  const remainingValidations = [];
  for (const validation of state.pendingValidations) {
    if (validation.dueFrame > state.frameIndex) {
      remainingValidations.push(validation);
      continue;
    }

    const errorDistance = getPositionDistance(estimate.position, validation.position);
    state.lastValidationErrorDistance = Number.isFinite(errorDistance) ? errorDistance : 0;
    if (errorDistance > TARGET_PROJECTION_INVALIDATION_DISTANCE) {
      shouldClearValidations = true;
      break;
    }
  }
  state.pendingValidations = shouldClearValidations
    ? []
    : remainingValidations.slice(-MAX_PENDING_VALIDATIONS);
}

function queuePredictionValidation(state, path) {
  if (!state) {
    return;
  }

  const validationSample = getSampleNearestFrames(
    path,
    TARGET_PROJECTION_VALIDATION_LOOKAHEAD_FRAMES,
  );
  if (!validationSample?.position) {
    return;
  }

  state.pendingValidations.push({
    dueFrame: state.frameIndex + validationSample.framesAhead,
    position: { ...validationSample.position },
  });
  state.pendingValidations = state.pendingValidations.slice(-MAX_PENDING_VALIDATIONS);
}

export function buildTargetPredictionPlan({
  estimate,
  columns,
  rows,
  obstacles,
  wallAvoidanceEvidence,
  speedUnitsPerFrame,
  targetVisible = false,
  planState = null,
  horizonFrames = DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
} = {}) {
  updatePredictionPlanState({
    state: planState,
    targetVisible,
    estimate,
  });

  const prediction = predictTargetMotionWithKuramoto(estimate, {
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence,
  });
  const hasObservedTarget = targetVisible || Number(estimate?.observationCount) > 0;
  const isEstimateStale = !targetVisible && (
    !hasObservedTarget
    || Number(estimate?.framesSinceObservation) > TARGET_PREDICTION_MAX_UNOBSERVED_FRAMES
  );
  const invalidReason = isEstimateStale
    ? "stale-target-estimate"
    : null;
  const actionable = !invalidReason;
  const path = actionable ? buildTargetProjectionPath({
    estimate,
    initialPrediction: prediction,
    horizonFrames: Math.max(1, Math.floor(getPositiveNumber(
      horizonFrames,
      DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
    ))),
    speedUnitsPerFrame,
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence,
  }) : [];

  if (actionable && targetVisible) {
    queuePredictionValidation(planState, path);
  }

  return {
    actionable,
    invalidReason,
    prediction,
    path,
    horizonFrames,
    validationErrorDistance: planState?.lastValidationErrorDistance ?? 0,
  };
}
