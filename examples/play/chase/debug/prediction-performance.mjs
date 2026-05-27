import { normalizeAngleDelta, vectorToAngle } from "../decision-model/core/math.ts";
import {
  addThresholdSuccessValidation,
  createThresholdSuccessStats,
  normalizeSuccessRateThresholds,
  summarizeThresholdSuccessStat,
} from "./prediction-success-thresholds.mjs";

const DEFAULT_MAX_PENDING_PREDICTIONS = 8192;
const DEFAULT_RECENT_WINDOW_SIZE = 128;
const DEFAULT_RECENT_VALIDATION_COUNT = 32;
const DEFAULT_POSITION_ERROR_THRESHOLD = 0.5;
const OVERALL_STAT_KEY = "__overall__";

function asPositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function clamp01(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue))
    : fallback;
}

function clonePosition(position) {
  return position
    ? {
      x: Number(position.x) || 0,
      z: Number(position.z) || 0,
    }
    : null;
}

function cloneDirection(direction) {
  return direction
    ? {
      x: Number(direction.x) || 0,
      z: Number(direction.z) || 0,
    }
    : null;
}

function hasDirection(direction) {
  return direction && (direction.x !== 0 || direction.z !== 0);
}

function getPositionDistance(first, second) {
  return first && second
    ? Math.hypot(first.x - second.x, first.z - second.z)
    : null;
}

function getDirectionErrorRadians(predictedDirection, actualDirection) {
  if (!hasDirection(predictedDirection) || !hasDirection(actualDirection)) {
    return null;
  }
  return Math.abs(normalizeAngleDelta(
    vectorToAngle(predictedDirection) - vectorToAngle(actualDirection),
  ));
}

function getPredictionFrameOffset(sample) {
  const frameOffset = Number(sample?.frameOffset ?? sample?.framesAhead);
  return Number.isFinite(frameOffset) && frameOffset > 0
    ? Math.max(1, Math.floor(frameOffset))
    : null;
}

function createGroupKey({
  targetId,
  producerId,
  sourceId,
  frameOffset,
}) {
  return [
    String(targetId ?? "unknown-target"),
    String(producerId ?? "unknown-producer"),
    String(sourceId ?? "unknown-source"),
    String(frameOffset ?? "unknown-horizon"),
  ].join("|");
}

function createStatGroup({
  targetId = null,
  producerId = null,
  sourceId = null,
  frameOffset = null,
} = {}) {
  return {
    targetId,
    producerId,
    sourceId,
    frameOffset,
    count: 0,
    successCount: 0,
    directionCount: 0,
    meanPositionError: 0,
    meanDirectionErrorRadians: 0,
    meanConfidence: 0,
    recentPositionErrors: [],
    recentDirectionErrorsRadians: [],
    latest: null,
  };
}

function createCalibrationBucket(id, minConfidence, maxConfidence) {
  return {
    id,
    minConfidence,
    maxConfidence,
    count: 0,
    successCount: 0,
    meanPositionError: 0,
    meanConfidence: 0,
  };
}

function getCalibrationBucketId(confidence) {
  const clamped = clamp01(confidence);
  if (clamped < 0.25) {
    return "0.00-0.25";
  }
  if (clamped < 0.5) {
    return "0.25-0.50";
  }
  if (clamped < 0.75) {
    return "0.50-0.75";
  }
  return "0.75-1.00";
}

function createCalibrationBucketForId(id) {
  if (id === "0.00-0.25") {
    return createCalibrationBucket(id, 0, 0.25);
  }
  if (id === "0.25-0.50") {
    return createCalibrationBucket(id, 0.25, 0.5);
  }
  if (id === "0.50-0.75") {
    return createCalibrationBucket(id, 0.5, 0.75);
  }
  return createCalibrationBucket("0.75-1.00", 0.75, 1);
}

function updateRunningMean(currentMean, count, value) {
  return currentMean + (value - currentMean) / count;
}

function pushRecent(values, value, maxCount) {
  if (!Number.isFinite(value)) {
    return;
  }
  values.push(value);
  if (values.length > maxCount) {
    values.splice(0, values.length - maxCount);
  }
}

function getPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function addStatValidation(stat, validation, options) {
  stat.count += 1;
  stat.meanPositionError = updateRunningMean(
    stat.meanPositionError,
    stat.count,
    validation.positionError,
  );
  stat.meanConfidence = updateRunningMean(
    stat.meanConfidence,
    stat.count,
    validation.confidence,
  );
  if (validation.success) {
    stat.successCount += 1;
  }
  if (Number.isFinite(validation.directionErrorRadians)) {
    stat.directionCount += 1;
    stat.meanDirectionErrorRadians = updateRunningMean(
      stat.meanDirectionErrorRadians,
      stat.directionCount,
      validation.directionErrorRadians,
    );
    pushRecent(
      stat.recentDirectionErrorsRadians,
      validation.directionErrorRadians,
      options.recentWindowSize,
    );
  }
  pushRecent(stat.recentPositionErrors, validation.positionError, options.recentWindowSize);
  stat.latest = {
    madeFrame: validation.madeFrame,
    dueFrame: validation.dueFrame,
    validatedFrame: validation.validatedFrame,
    positionError: validation.positionError,
    directionErrorRadians: validation.directionErrorRadians,
    confidence: validation.confidence,
    success: validation.success,
  };
}

function addCalibrationValidation(state, validation) {
  const bucketId = getCalibrationBucketId(validation.confidence);
  const bucket = state.calibrationBuckets[bucketId]
    ?? createCalibrationBucketForId(bucketId);
  bucket.count += 1;
  bucket.meanPositionError = updateRunningMean(
    bucket.meanPositionError,
    bucket.count,
    validation.positionError,
  );
  bucket.meanConfidence = updateRunningMean(
    bucket.meanConfidence,
    bucket.count,
    validation.confidence,
  );
  if (validation.success) {
    bucket.successCount += 1;
  }
  state.calibrationBuckets[bucketId] = bucket;
}

function normalizePredictionSample({
  frameIndex,
  targetId,
  producerId,
  sourceId,
  sample,
}) {
  const frameOffset = getPredictionFrameOffset(sample);
  const position = clonePosition(sample?.position ?? sample?.predictedPosition);
  if (!frameOffset || !position) {
    return null;
  }

  return {
    targetId,
    producerId,
    sourceId,
    madeFrame: frameIndex,
    dueFrame: frameIndex + frameOffset,
    frameOffset,
    position,
    direction: cloneDirection(sample?.direction ?? sample?.predictedDirection),
    confidence: clamp01(sample?.confidence),
  };
}

function getSourcePredictions(sample) {
  return Array.isArray(sample?.sourcePredictions)
    ? sample.sourcePredictions
    : [];
}

export function createPredictionPerformanceTracker(options = {}) {
  return {
    schemaVersion: 1,
    pending: [],
    statsByKey: {},
    calibrationBuckets: {},
    thresholdSuccessStats: createThresholdSuccessStats(options.successRateThresholds),
    recentValidations: [],
    validatedCount: 0,
    droppedPendingCount: 0,
    options: {
      maxPendingPredictions: asPositiveInteger(
        options.maxPendingPredictions,
        DEFAULT_MAX_PENDING_PREDICTIONS,
      ),
      recentWindowSize: asPositiveInteger(
        options.recentWindowSize,
        DEFAULT_RECENT_WINDOW_SIZE,
      ),
      recentValidationCount: asPositiveInteger(
        options.recentValidationCount,
        DEFAULT_RECENT_VALIDATION_COUNT,
      ),
      positionErrorThreshold: Number.isFinite(options.positionErrorThreshold)
        ? Math.max(0, Number(options.positionErrorThreshold))
        : DEFAULT_POSITION_ERROR_THRESHOLD,
      successRateThresholds: normalizeSuccessRateThresholds(options.successRateThresholds),
    },
  };
}

export function recordPredictionPerformanceSet(state, {
  frameIndex,
  targetId = "target",
  producerId = "prediction",
  path = [],
} = {}) {
  if (!state || !Number.isFinite(frameIndex) || !Array.isArray(path) || path.length === 0) {
    return;
  }

  const normalizedFrameIndex = Math.floor(frameIndex);
  const queuedSamples = [];
  for (const sample of path) {
    const consensusSample = normalizePredictionSample({
      frameIndex: normalizedFrameIndex,
      targetId,
      producerId,
      sourceId: "consensus",
      sample,
    });
    if (consensusSample) {
      queuedSamples.push(consensusSample);
    }

    for (const sourcePrediction of getSourcePredictions(sample)) {
      const sourceSample = normalizePredictionSample({
        frameIndex: normalizedFrameIndex,
        targetId,
        producerId,
        sourceId: sourcePrediction?.sourcePatternId
          ?? sourcePrediction?.sourceId
          ?? sourcePrediction?.id
          ?? "unknown-source",
        sample: {
          ...sourcePrediction,
          frameOffset: sample.frameOffset ?? sample.framesAhead,
          framesAhead: sample.framesAhead ?? sample.frameOffset,
        },
      });
      if (sourceSample) {
        queuedSamples.push(sourceSample);
      }
    }
  }

  if (queuedSamples.length === 0) {
    return;
  }

  state.pending.push(...queuedSamples);
  const maxPending = state.options.maxPendingPredictions;
  if (state.pending.length > maxPending) {
    const dropCount = state.pending.length - maxPending;
    state.pending.splice(0, dropCount);
    state.droppedPendingCount += dropCount;
  }
}

export function validatePredictionPerformance(state, {
  frameIndex,
  targetId = "target",
  actualPosition = null,
  actualDirection = null,
} = {}) {
  const position = clonePosition(actualPosition);
  if (!state || !Number.isFinite(frameIndex) || !position) {
    return;
  }

  const normalizedFrameIndex = Math.floor(frameIndex);
  const direction = cloneDirection(actualDirection);
  const remaining = [];

  for (const prediction of state.pending) {
    if (prediction.targetId !== targetId || prediction.dueFrame > normalizedFrameIndex) {
      remaining.push(prediction);
      continue;
    }

    const positionError = getPositionDistance(prediction.position, position);
    if (!Number.isFinite(positionError)) {
      continue;
    }

    const validation = {
      targetId: prediction.targetId,
      producerId: prediction.producerId,
      sourceId: prediction.sourceId,
      frameOffset: prediction.frameOffset,
      madeFrame: prediction.madeFrame,
      dueFrame: prediction.dueFrame,
      validatedFrame: normalizedFrameIndex,
      positionError,
      directionErrorRadians: getDirectionErrorRadians(prediction.direction, direction),
      confidence: prediction.confidence,
      success: positionError <= state.options.positionErrorThreshold,
    };
    const groupKey = createGroupKey(validation);
    const group = state.statsByKey[groupKey] ?? createStatGroup(validation);
    const overall = state.statsByKey[OVERALL_STAT_KEY] ?? createStatGroup({
      targetId: "all",
      producerId: "all",
      sourceId: "all",
      frameOffset: "all",
    });

    addStatValidation(group, validation, state.options);
    addStatValidation(overall, validation, state.options);
    addCalibrationValidation(state, validation);
    addThresholdSuccessValidation(state, validation);
    state.statsByKey[groupKey] = group;
    state.statsByKey[OVERALL_STAT_KEY] = overall;
    state.validatedCount += 1;
    state.recentValidations.push(validation);
    if (state.recentValidations.length > state.options.recentValidationCount) {
      state.recentValidations.splice(
        0,
        state.recentValidations.length - state.options.recentValidationCount,
      );
    }
  }

  state.pending = remaining;
}

function summarizeStat(stat) {
  if (!stat) {
    return null;
  }

  return {
    targetId: stat.targetId,
    producerId: stat.producerId,
    sourceId: stat.sourceId,
    frameOffset: stat.frameOffset,
    count: stat.count,
    meanPositionError: stat.meanPositionError,
    p50RecentPositionError: getPercentile(stat.recentPositionErrors, 50),
    p90RecentPositionError: getPercentile(stat.recentPositionErrors, 90),
    meanDirectionErrorRadians: stat.directionCount > 0
      ? stat.meanDirectionErrorRadians
      : null,
    meanConfidence: stat.meanConfidence,
    successRate: stat.count > 0 ? stat.successCount / stat.count : 0,
    latest: stat.latest,
  };
}

function summarizeCalibrationBucket(bucket) {
  return {
    id: bucket.id,
    minConfidence: bucket.minConfidence,
    maxConfidence: bucket.maxConfidence,
    count: bucket.count,
    meanConfidence: bucket.meanConfidence,
    meanPositionError: bucket.meanPositionError,
    successRate: bucket.count > 0 ? bucket.successCount / bucket.count : 0,
  };
}

export function getPredictionPerformanceSnapshot(state) {
  if (!state) {
    return null;
  }

  const bySourceHorizon = Object.entries(state.statsByKey)
    .filter(([key]) => key !== OVERALL_STAT_KEY)
    .map(([, stat]) => summarizeStat(stat))
    .filter(Boolean)
    .sort((first, second) =>
      String(first.targetId).localeCompare(String(second.targetId))
      || String(first.producerId).localeCompare(String(second.producerId))
      || String(first.sourceId).localeCompare(String(second.sourceId))
      || Number(first.frameOffset) - Number(second.frameOffset));

  return {
    schemaVersion: state.schemaVersion,
    pendingCount: state.pending.length,
    validatedCount: state.validatedCount,
    droppedPendingCount: state.droppedPendingCount,
    positionErrorThreshold: state.options.positionErrorThreshold,
    recentWindowSize: state.options.recentWindowSize,
    summary: summarizeStat(state.statsByKey[OVERALL_STAT_KEY]),
    bySourceHorizon,
    calibration: Object.values(state.calibrationBuckets)
      .map(summarizeCalibrationBucket)
      .sort((first, second) => first.minConfidence - second.minConfidence),
    thresholdSuccessRates: Object.values(
      state.thresholdSuccessStats
        ?? createThresholdSuccessStats(state.options?.successRateThresholds),
    )
      .map(summarizeThresholdSuccessStat)
      .sort((first, second) => first.threshold - second.threshold),
    thresholdSuccessRatesByFrameOffset: Object.values(
      state.thresholdSuccessStatsByFrameOffset ?? {},
    )
      .map(summarizeThresholdSuccessStat)
      .sort((first, second) =>
        first.threshold - second.threshold
        || first.frameOffset - second.frameOffset),
    recentValidations: state.recentValidations.map((validation) => ({
      ...validation,
      directionErrorRadians: Number.isFinite(validation.directionErrorRadians)
        ? validation.directionErrorRadians
        : null,
    })),
  };
}
