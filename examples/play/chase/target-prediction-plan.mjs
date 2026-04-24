import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  DEFAULT_TARGET_PROJECTION_SAMPLES_PER_SECOND,
  TARGET_PREDICTION_MAX_UNOBSERVED_SECONDS,
  TARGET_PROJECTION_INVALIDATION_DISTANCE,
  TARGET_PROJECTION_VALIDATION_LOOKAHEAD_SECONDS,
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
  samplesPerSecond = DEFAULT_TARGET_PROJECTION_SAMPLES_PER_SECOND,
} = {}) {
  const normalizedHorizonFrames = getPositiveNumber(
    horizonFrames,
    DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  );
  const normalizedSamplesPerSecond = getPositiveNumber(
    samplesPerSecond,
    DEFAULT_TARGET_PROJECTION_SAMPLES_PER_SECOND,
  );
  const horizonSeconds = normalizedHorizonFrames / ASSUMED_GAME_FRAMES_PER_SECOND;
  return Math.max(1, Math.floor(horizonSeconds * normalizedSamplesPerSecond));
}

export function createTargetPredictionPlanState() {
  return {
    timeSeconds: 0,
    lastValidationErrorDistance: 0,
    pendingValidations: [],
  };
}

function getSampleNearestSeconds(path, secondsAhead) {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }

  return path.reduce((best, sample) => {
    if (!sample?.position || !Number.isFinite(sample.secondsAhead)) {
      return best;
    }
    if (!best) {
      return sample;
    }
    return Math.abs(sample.secondsAhead - secondsAhead)
      < Math.abs(best.secondsAhead - secondsAhead)
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
  deltaSeconds,
  targetVisible,
  estimate,
}) {
  if (!state) {
    return;
  }

  const elapsedSeconds = Number(deltaSeconds);
  state.timeSeconds += Number.isFinite(elapsedSeconds) && elapsedSeconds > 0
    ? elapsedSeconds
    : 0;

  if (!targetVisible || !estimate?.position) {
    return;
  }

  let shouldClearValidations = false;
  const remainingValidations = [];
  for (const validation of state.pendingValidations) {
    if (validation.dueTimeSeconds > state.timeSeconds) {
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

  const validationSample = getSampleNearestSeconds(
    path,
    TARGET_PROJECTION_VALIDATION_LOOKAHEAD_SECONDS,
  );
  if (!validationSample?.position) {
    return;
  }

  state.pendingValidations.push({
    dueTimeSeconds: state.timeSeconds + validationSample.secondsAhead,
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
  speedUnitsPerSecond,
  deltaSeconds = 0,
  targetVisible = false,
  planState = null,
  horizonFrames = DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  samplesPerSecond = DEFAULT_TARGET_PROJECTION_SAMPLES_PER_SECOND,
  sampleCount,
} = {}) {
  updatePredictionPlanState({
    state: planState,
    deltaSeconds,
    targetVisible,
    estimate,
  });

  const prediction = predictTargetMotionWithKuramoto(estimate, {
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence,
  });
  const normalizedSamplesPerSecond = getPositiveNumber(
    samplesPerSecond,
    DEFAULT_TARGET_PROJECTION_SAMPLES_PER_SECOND,
  );
  const resolvedSampleCount = Number.isFinite(Number(sampleCount))
    ? Math.max(0, Math.floor(Number(sampleCount)))
    : getTargetProjectionSampleCount({ horizonFrames, samplesPerSecond: normalizedSamplesPerSecond });
  const sampleIntervalSeconds = 1 / normalizedSamplesPerSecond;
  const hasObservedTarget = targetVisible || Number(estimate?.observationCount) > 0;
  const isEstimateStale = !targetVisible && (
    !hasObservedTarget
    || Number(estimate?.secondsSinceObservation) > TARGET_PREDICTION_MAX_UNOBSERVED_SECONDS
  );
  const invalidReason = isEstimateStale
    ? "stale-target-estimate"
    : null;
  const actionable = !invalidReason;
  const path = actionable ? buildTargetProjectionPath({
    estimate,
    initialPrediction: prediction,
    sampleCount: resolvedSampleCount,
    sampleIntervalSeconds,
    speedUnitsPerSecond,
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
    sampleCount: resolvedSampleCount,
    sampleIntervalSeconds,
    horizonFrames,
    samplesPerSecond: normalizedSamplesPerSecond,
    validationErrorDistance: planState?.lastValidationErrorDistance ?? 0,
  };
}
