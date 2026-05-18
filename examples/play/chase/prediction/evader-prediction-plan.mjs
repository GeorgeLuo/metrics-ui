import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  EVADER_PREDICTION_KURAMOTO_COUPLING,
  EVADER_PREDICTION_KURAMOTO_ITERATIONS,
  EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES,
  EVADER_PREDICTION_PERSISTENCE_FRAMES,
  EVADER_PROJECTION_INVALIDATION_DISTANCE,
  EVADER_PROJECTION_VALIDATION_LOOKAHEAD_FRAMES,
} from "../config/constants.mjs";
import { runKuramotoConsensus } from "../decision-model/kuramoto.mjs";
import { normalizeVector } from "../decision-model/math.mjs";
import { resolveObstacleCollisions } from "../world/world.mjs";

const MAX_PENDING_VALIDATIONS = 24;
const RECTIFICATION_STRATEGY_ID = "rectified-evader-projection";

function getPositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

export function getEvaderProjectionSampleCount({
  horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
} = {}) {
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

export function createEvaderPredictionPlanState() {
  return {
    elapsedFrames: 0,
    lastValidationErrorDistance: 0,
    pendingValidations: [],
    lastActionablePlan: null,
    lastActionableFrame: null,
  };
}

function cloneVector(vector) {
  return vector
    ? {
      x: Number(vector.x) || 0,
      z: Number(vector.z) || 0,
    }
    : null;
}

function clonePosition(position) {
  return position
    ? {
      x: Number(position.x) || 0,
      z: Number(position.z) || 0,
    }
    : null;
}

function getPredictionFrameOffset(sample) {
  const frameOffset = Number(sample?.frameOffset ?? sample?.framesAhead);
  return Number.isFinite(frameOffset) && frameOffset > 0
    ? Math.max(1, Math.floor(frameOffset))
    : null;
}

function clonePatternPredictionSample(patternId, patternUnit, sample, index) {
  const frameOffset = getPredictionFrameOffset(sample);
  const position = clonePosition(sample?.position ?? sample?.predictedPosition);
  if (!frameOffset || !position) {
    return null;
  }

  return {
    index,
    framesAhead: frameOffset,
    frameOffset,
    position,
    direction: cloneVector(sample?.direction ?? sample?.predictedDirection),
    prediction: sample?.prediction ?? null,
    confidence: Number.isFinite(sample?.confidence) ? Math.max(0, Math.min(1, sample.confidence)) : 0,
    confidenceParts: sample?.confidenceParts ?? null,
    metadata: sample?.metadata ?? {},
    sourcePatternId: sample?.sourcePatternId ?? patternUnit?.id ?? patternId,
  };
}

function getPatternPredictionSamples(patternUnits) {
  return Object.entries(patternUnits ?? {}).flatMap(([patternId, patternUnit]) => {
    const predictions = Array.isArray(patternUnit?.predictions)
      ? patternUnit.predictions
      : [];
    return predictions
      .map((sample, index) => clonePatternPredictionSample(
        patternId,
        patternUnit,
        sample,
        index,
      ))
      .filter(Boolean);
  });
}

function getSourcePatternIds(samples) {
  return [...new Set(
    samples
      .map((sample) => sample.sourcePatternId)
      .filter(Boolean),
  )].sort();
}

function getRectifiedStrategyId(sourcePatternIds) {
  if (sourcePatternIds.length === 1 && sourcePatternIds[0] === "continuance") {
    return "continuance-default";
  }
  if (sourcePatternIds.length === 1 && sourcePatternIds[0] === "wallAvoidance") {
    return "wall-avoidance-intercept";
  }
  return RECTIFICATION_STRATEGY_ID;
}

function combinePredictionConfidence(samples) {
  return Math.max(
    0,
    Math.min(
      1,
      1 - samples.reduce((missProbability, sample) => {
        const confidence = Number.isFinite(sample?.confidence)
          ? Math.max(0, Math.min(1, sample.confidence))
          : 0;
        return missProbability * (1 - confidence);
      }, 1),
    ),
  );
}

function getHighestConfidencePosition(samples) {
  const selectedSample = [...samples].sort((first, second) => {
    const confidenceDelta = second.confidence - first.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return String(first.sourcePatternId).localeCompare(String(second.sourcePatternId));
  })[0];
  return clonePosition(selectedSample?.position);
}

function getDistance(first, second) {
  return first && second
    ? Math.hypot(first.x - second.x, first.z - second.z)
    : 0;
}

function getWeightedDistance(samples, referencePosition) {
  if (!referencePosition) {
    return 0;
  }
  const totalWeight = samples.reduce((sum, sample) => sum + sample.confidence, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return samples.reduce(
    (sum, sample) => sum + getDistance(referencePosition, sample.position) * sample.confidence,
    0,
  ) / totalWeight;
}

function getDisplacementDirection(sample, referencePosition) {
  if (referencePosition && sample?.position) {
    const direction = normalizeVector(
      sample.position.x - referencePosition.x,
      sample.position.z - referencePosition.z,
    );
    if (direction.x !== 0 || direction.z !== 0) {
      return direction;
    }
  }
  return sample?.direction ? cloneVector(sample.direction) : null;
}

function runPredictionDirectionConsensus(samples, getDirection) {
  const consensusInputs = samples
    .map((sample) => ({
      id: sample.sourcePatternId,
      direction: getDirection(sample),
      confidence: sample.confidence,
      weight: sample.confidence,
    }))
    .filter((sample) => sample.direction && sample.confidence > 0);
  const consensus = runKuramotoConsensus(consensusInputs, {
    coupling: EVADER_PREDICTION_KURAMOTO_COUPLING,
    iterations: EVADER_PREDICTION_KURAMOTO_ITERATIONS,
  });
  return consensus.direction.x === 0 && consensus.direction.z === 0
    ? { x: 0, z: 0 }
    : consensus.direction;
}

function canResolveWorldContext(worldContext) {
  return worldContext?.obstacles
    && Number.isFinite(worldContext.columns)
    && Number.isFinite(worldContext.rows);
}

function buildConsensusPosition(samples, referencePosition, worldContext) {
  const fallbackPosition = getHighestConfidencePosition(samples);
  if (!referencePosition) {
    return fallbackPosition;
  }

  const displacementDirection = runPredictionDirectionConsensus(
    samples,
    (sample) => getDisplacementDirection(sample, referencePosition),
  );
  const distance = getWeightedDistance(samples, referencePosition);
  const projectedPosition = displacementDirection.x === 0 && displacementDirection.z === 0
    ? fallbackPosition
    : {
      x: referencePosition.x + displacementDirection.x * distance,
      z: referencePosition.z + displacementDirection.z * distance,
    };

  return canResolveWorldContext(worldContext)
    ? resolveObstacleCollisions(
      projectedPosition,
      referencePosition,
      worldContext.columns,
      worldContext.rows,
      worldContext.obstacles,
    )
    : projectedPosition;
}

function rectifyPredictionFrame(frameOffset, samples, {
  referencePosition = null,
  worldContext = {},
} = {}) {
  const usableSamples = samples
    .filter((sample) => sample?.position && sample.confidence > 0);
  if (usableSamples.length === 0) {
    return null;
  }

  const sourcePatternIds = getSourcePatternIds(usableSamples);
  const confidence = combinePredictionConfidence(usableSamples);
  const direction = runPredictionDirectionConsensus(
    usableSamples,
    (sample) => sample.direction,
  );
  const wallAvoidancePrediction = usableSamples.find(
    (sample) => sample.sourcePatternId === "wallAvoidance" && sample.prediction?.wallAvoidance,
  )?.prediction ?? null;

  return {
    framesAhead: frameOffset,
    frameOffset,
    position: buildConsensusPosition(usableSamples, referencePosition, worldContext),
    direction,
    confidence,
    confidenceParts: {
      model: "pattern-prediction-rectification",
      confidence,
      sourceCount: sourcePatternIds.length,
      sourcePatternIds,
    },
    prediction: {
      strategy: getRectifiedStrategyId(sourcePatternIds),
      direction,
      consensus: confidence,
      oscillators: usableSamples.map((sample) => ({
        id: sample.sourcePatternId,
        direction: cloneVector(sample.direction),
        confidence: sample.confidence,
        weight: sample.confidence,
      })),
      sourcePatternIds,
      wallAvoidance: wallAvoidancePrediction?.wallAvoidance ?? null,
      actionable: true,
    },
    sourcePatternIds,
    sourcePredictions: usableSamples.map((sample) => ({
      sourcePatternId: sample.sourcePatternId,
      position: clonePosition(sample.position),
      direction: cloneVector(sample.direction),
      confidence: sample.confidence,
      confidenceParts: sample.confidenceParts,
      metadata: sample.metadata,
      prediction: sample.prediction,
    })),
  };
}

function buildRectifiedPredictionPath(patternUnits, {
  estimate,
  worldContext = {},
} = {}) {
  const samples = getPatternPredictionSamples(patternUnits);
  const frameOffsets = [...new Set(samples.map((sample) => sample.frameOffset))]
    .sort((first, second) => first - second);

  return frameOffsets
    .map((frameOffset, index) => {
      const rectified = rectifyPredictionFrame(
        frameOffset,
        samples.filter((sample) => sample.frameOffset === frameOffset),
        {
          referencePosition: estimate?.position ?? null,
          worldContext,
        },
      );
      return rectified ? { index, ...rectified } : null;
    })
    .filter(Boolean);
}

function buildRectifiedPrediction(path) {
  const firstSample = path?.[0] ?? null;
  if (!firstSample) {
    return {
      strategy: "pattern-predictions-unavailable",
      direction: { x: 0, z: 0 },
      consensus: 0,
      oscillators: [],
      sourcePatternIds: [],
      actionable: false,
    };
  }

  return {
    ...firstSample.prediction,
    direction: cloneVector(firstSample.direction),
    consensus: Number(firstSample.confidence) || 0,
    sourcePatternIds: firstSample.sourcePatternIds,
    rectification: {
      model: firstSample.confidenceParts?.model ?? "pattern-prediction-rectification",
      sourcePatternIds: firstSample.sourcePatternIds,
      sourceCount: firstSample.sourcePatternIds.length,
    },
  };
}

function clearPersistedPlan(state) {
  if (!state) {
    return;
  }
  state.lastActionablePlan = null;
  state.lastActionableFrame = null;
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
  evaderVisible,
  estimate,
}) {
  if (!state) {
    return;
  }

  state.elapsedFrames += 1;

  if (!evaderVisible || !estimate?.position) {
    return;
  }

  let shouldClearValidations = false;
  const remainingValidations = [];
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

function queuePredictionValidation(state, path) {
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

function persistActionablePlan(state, {
  prediction,
  path,
  sampleCount,
  sampleSpacingFrames,
  horizonFrames,
} = {}) {
  if (!state || !prediction || !Array.isArray(path) || path.length === 0) {
    return;
  }

  state.lastActionableFrame = state.elapsedFrames;
  state.lastActionablePlan = {
    prediction: {
      ...prediction,
      direction: cloneVector(prediction.direction),
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
      .map((sample) => ({
        dueFrame: state.elapsedFrames + sample.framesAhead,
        position: clonePosition(sample.position),
        direction: cloneVector(sample.direction),
        confidence: Number.isFinite(sample.confidence) ? sample.confidence : 0,
        sourcePatternIds: Array.isArray(sample.sourcePatternIds)
          ? [...sample.sourcePatternIds]
          : [],
      })),
    sampleCount: Number(sampleCount) || 0,
    sampleSpacingFrames: Number(sampleSpacingFrames) || 0,
    horizonFrames: Number(horizonFrames) || 0,
  };
}

function buildPersistedPredictionPlan(state) {
  if (!state?.lastActionablePlan || !Number.isFinite(state.lastActionableFrame)) {
    return null;
  }

  if (state.elapsedFrames - state.lastActionableFrame > EVADER_PREDICTION_PERSISTENCE_FRAMES) {
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
    horizonFrames: Number(remainingPath.at(-1)?.dueFrame - state.elapsedFrames) || 0,
    validationErrorDistance: state.lastValidationErrorDistance ?? 0,
    persisted: true,
  };
}

export function buildEvaderPredictionPlan({
  estimate,
  patternUnits,
  evaderVisible = false,
  planState = null,
  columns,
  rows,
  obstacles,
  horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
} = {}) {
  updatePredictionPlanState({
    state: planState,
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
    clearPersistedPlan(planState);
  }

  if (!actionable && !evaderVisible && !isEstimateStale) {
    const persistedPlan = buildPersistedPredictionPlan(planState);
    if (persistedPlan) {
      return persistedPlan;
    }
  }

  const actionablePath = actionable ? path : [];

  if (actionable && evaderVisible) {
    queuePredictionValidation(planState, actionablePath);
  }

  if (actionable) {
    persistActionablePlan(planState, {
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
    validationErrorDistance: planState?.lastValidationErrorDistance ?? 0,
  };
}
