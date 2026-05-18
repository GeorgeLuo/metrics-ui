import { clampConfidence } from "./strategy-confidence.mjs";

const DEFAULT_BETA_PRIOR_ALPHA = 0.5;
const DEFAULT_BETA_PRIOR_BETA = 0.5;
const DEFAULT_ONE_SIDED_Z_SCORE = 1.2815515655446004;

export function normalizeFrameOffset(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : 1;
}

function getPositiveDecay(frameCount, halfLifeFrames) {
  const frames = Math.max(0, Number(frameCount) || 0);
  const halfLife = Number(halfLifeFrames);
  if (!Number.isFinite(halfLife) || halfLife <= 0) {
    return 1;
  }
  return clampConfidence(Math.pow(0.5, frames / halfLife));
}

export function createBetaBernoulliPosterior({
  confirmedCount = 0,
  opportunityCount = 0,
  priorAlpha = DEFAULT_BETA_PRIOR_ALPHA,
  priorBeta = DEFAULT_BETA_PRIOR_BETA,
  zScore = DEFAULT_ONE_SIDED_Z_SCORE,
} = {}) {
  const confirmed = Math.max(0, Number(confirmedCount) || 0);
  const opportunities = Math.max(0, Number(opportunityCount) || 0);
  const contradicted = Math.max(0, opportunities - confirmed);
  const alphaPrior = Math.max(0.0001, Number(priorAlpha) || DEFAULT_BETA_PRIOR_ALPHA);
  const betaPrior = Math.max(0.0001, Number(priorBeta) || DEFAULT_BETA_PRIOR_BETA);
  const posteriorAlpha = alphaPrior + confirmed;
  const posteriorBeta = betaPrior + contradicted;
  const posteriorTotal = posteriorAlpha + posteriorBeta;
  const probability = posteriorAlpha / posteriorTotal;
  const variance = (posteriorAlpha * posteriorBeta)
    / (posteriorTotal * posteriorTotal * (posteriorTotal + 1));
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  const normalizedZScore = Math.max(0, Number(zScore) || DEFAULT_ONE_SIDED_Z_SCORE);
  const credibleLowerBound = clampConfidence(probability - normalizedZScore * standardDeviation);
  const credibleUpperBound = clampConfidence(probability + normalizedZScore * standardDeviation);

  return {
    model: "beta-bernoulli",
    priorAlpha: alphaPrior,
    priorBeta: betaPrior,
    posteriorAlpha,
    posteriorBeta,
    confirmedCount: confirmed,
    contradictedCount: contradicted,
    opportunityCount: opportunities,
    probability: clampConfidence(probability),
    posteriorMean: clampConfidence(probability),
    posteriorVariance: variance,
    posteriorStandardDeviation: standardDeviation,
    credibleLowerBound,
    credibleUpperBound,
    zScore: normalizedZScore,
  };
}

export function createPatternConfidence({
  confirmedCount = 0,
  opportunityCount = 0,
  priorAlpha = DEFAULT_BETA_PRIOR_ALPHA,
  priorBeta = DEFAULT_BETA_PRIOR_BETA,
  zScore = DEFAULT_ONE_SIDED_Z_SCORE,
  staleFrames = 0,
  recencyHalfLifeFrames = null,
  frameOffset = 1,
  horizonHalfLifeFrames = null,
} = {}) {
  const eventPosterior = createBetaBernoulliPosterior({
    confirmedCount,
    opportunityCount,
    priorAlpha,
    priorBeta,
    zScore,
  });
  const recencyConfidence = getPositiveDecay(staleFrames, recencyHalfLifeFrames);
  const horizonConfidence = getPositiveDecay(
    Math.max(0, normalizeFrameOffset(frameOffset) - 1),
    horizonHalfLifeFrames,
  );
  const confidence = clampConfidence(
    eventPosterior.credibleLowerBound * recencyConfidence * horizonConfidence,
  );

  return {
    model: eventPosterior.model,
    probability: eventPosterior.probability,
    uncertainty: eventPosterior.posteriorStandardDeviation,
    credibleLowerBound: eventPosterior.credibleLowerBound,
    credibleUpperBound: eventPosterior.credibleUpperBound,
    recencyConfidence,
    horizonConfidence,
    confidence,
    eventPosterior,
    confirmedCount: eventPosterior.confirmedCount,
    contradictedCount: eventPosterior.contradictedCount,
    opportunityCount: eventPosterior.opportunityCount,
  };
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

export function createFramePrediction({
  sourcePatternId,
  frameOffset,
  position = null,
  direction = null,
  confidenceParts = null,
  confidence = null,
  metadata = {},
  prediction = null,
} = {}) {
  const normalizedFrameOffset = normalizeFrameOffset(frameOffset);
  const normalizedConfidence = clampConfidence(
    Number.isFinite(confidence)
      ? confidence
      : confidenceParts?.confidence,
  );
  const predictedPosition = clonePosition(position);
  const predictedDirection = cloneDirection(direction);

  return {
    sourcePatternId,
    frameOffset: normalizedFrameOffset,
    framesAhead: normalizedFrameOffset,
    predictedPosition,
    predictedDirection,
    position: predictedPosition,
    direction: predictedDirection,
    confidence: normalizedConfidence,
    confidenceParts: confidenceParts ?? {
      confidence: normalizedConfidence,
    },
    metadata,
    prediction,
  };
}

export function createPatternPredictionUnit({
  id,
  unit,
  evidence = {},
  predictions = [],
  primaryPrediction = null,
  status = "active",
} = {}) {
  const sortedPredictions = [...predictions]
    .filter((prediction) => prediction?.frameOffset)
    .sort((first, second) => first.frameOffset - second.frameOffset);
  const firstPrediction = sortedPredictions[0] ?? null;
  const confidence = Number.isFinite(firstPrediction?.confidence)
    ? firstPrediction.confidence
    : 0;

  return {
    id,
    unit,
    status,
    evidence,
    predictions: sortedPredictions,
    primaryPrediction,
    predictionCount: sortedPredictions.length,
    confidence,
    firstFrameOffset: firstPrediction?.frameOffset ?? null,
    horizonFrames: sortedPredictions.at(-1)?.frameOffset ?? 0,
  };
}

export function getPatternPredictionForFrame(patternUnit, frameOffset = 1) {
  const predictions = patternUnit?.predictions;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return null;
  }
  const normalizedFrameOffset = normalizeFrameOffset(frameOffset);
  return predictions.find((prediction) => prediction.frameOffset >= normalizedFrameOffset)
    ?? predictions.at(-1)
    ?? null;
}
