import type {
  PatternConfidenceParts,
  PatternEvidence,
  PatternMetadata,
  PatternPredictionSample,
  PatternPredictionUnit,
  PatternPredictionValues,
} from "./interfaces.ts";

const DEFAULT_BETA_PRIOR_ALPHA = 0.5;
const DEFAULT_BETA_PRIOR_BETA = 0.5;
const DEFAULT_ONE_SIDED_Z_SCORE = 1.2815515655446004;

/**
 * Posterior summary for a binary pattern observation model.
 *
 * `confirmedCount` records observations supporting the pattern, while
 * `opportunityCount` records chances where the pattern could have appeared.
 */
export type BetaBernoulliPosterior = {
  model: "beta-bernoulli";
  priorAlpha: number;
  priorBeta: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  confirmedCount: number;
  contradictedCount: number;
  opportunityCount: number;
  probability: number;
  posteriorMean: number;
  posteriorVariance: number;
  posteriorStandardDeviation: number;
  credibleLowerBound: number;
  credibleUpperBound: number;
  zScore: number;
};

/**
 * Inputs for estimating how often a pattern appears when it has the chance to.
 */
export type PatternPosteriorOptions = {
  confirmedCount?: number | null;
  opportunityCount?: number | null;
  priorAlpha?: number | null;
  priorBeta?: number | null;
  zScore?: number | null;
};

/**
 * Inputs for converting pattern observation history into an actionable
 * confidence value.
 */
export type PatternConfidenceOptions = PatternPosteriorOptions & {
  staleFrames?: number | null;
  recencyHalfLifeFrames?: number | null;
  frameOffset?: number | null;
  horizonHalfLifeFrames?: number | null;
};

/**
 * Creation options for one future-frame prediction sample.
 *
 * `values` is intentionally domain-neutral: spatial patterns can pass
 * `position` and `direction`, while non-spatial patterns can pass any other
 * value names without changing the core container.
 */
export type FramePredictionOptions<
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
> = {
  sourcePatternId?: string;
  frameOffset?: number | null;
  values?: Partial<TValues> | PatternPredictionValues;
  confidenceParts?: PatternConfidenceParts | null;
  confidence?: number | null;
  metadata?: TMetadata;
  prediction?: TPredictionPayload | null;
} & PatternPredictionValues;

/**
 * Creation options for a pattern prediction unit.
 */
export type PatternPredictionUnitOptions<
  TUnit = object,
  TEvidence = PatternEvidence,
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
> = {
  id?: string;
  unit?: TUnit | null;
  evidence?: TEvidence;
  predictions?: PatternPredictionSample<TPredictionPayload, TValues, TMetadata>[];
  primaryPrediction?: TPredictionPayload | null;
  status?: string;
};

function clampConfidence(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.min(1, Math.max(0, numericValue))
    : 0;
}

/**
 * Normalizes a prediction horizon offset to a positive integer frame count.
 */
export function normalizeFrameOffset(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : 1;
}

function getPositiveDecay(frameCount: unknown, halfLifeFrames: unknown): number {
  const frames = Math.max(0, Number(frameCount) || 0);
  const halfLife = Number(halfLifeFrames);
  if (!Number.isFinite(halfLife) || halfLife <= 0) {
    return 1;
  }
  return clampConfidence(Math.pow(0.5, frames / halfLife));
}

/**
 * Builds a beta-binomial posterior for repeated pattern evidence.
 *
 * This gives the pattern layer a conservative probability estimate that
 * includes uncertainty from low sample counts. Callers typically use the lower
 * credible bound when turning the posterior into confidence.
 */
export function createBetaBernoulliPosterior({
  confirmedCount = 0,
  opportunityCount = 0,
  priorAlpha = DEFAULT_BETA_PRIOR_ALPHA,
  priorBeta = DEFAULT_BETA_PRIOR_BETA,
  zScore = DEFAULT_ONE_SIDED_Z_SCORE,
}: PatternPosteriorOptions = {}): BetaBernoulliPosterior {
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

/**
 * Converts event frequency, recency, and prediction horizon into confidence.
 *
 * The returned confidence is the lower credible probability bound multiplied by
 * optional recency and horizon decay terms. This keeps weakly observed or stale
 * patterns from dominating downstream strategy consensus.
 */
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
}: PatternConfidenceOptions = {}): PatternConfidenceParts {
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

function clonePredictionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(clonePredictionValue);
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) };
  }
  return value ?? null;
}

function clonePredictionValues<TValues extends PatternPredictionValues>(
  values?: Partial<TValues> | PatternPredictionValues,
): TValues {
  return Object.fromEntries(
    Object.entries(values ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, clonePredictionValue(value)]),
  ) as TValues;
}

/**
 * Creates one normalized prediction sample for a future frame.
 *
 * The sample keeps generic pattern metadata and spreads `values` onto the
 * top-level object for backward-compatible domain callers.
 */
export function createFramePrediction<
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
>({
  sourcePatternId,
  frameOffset,
  values = {},
  confidenceParts = null,
  confidence = null,
  metadata = {} as TMetadata,
  prediction = null,
  ...inlineValues
}: FramePredictionOptions<TPredictionPayload, TValues, TMetadata> = {}): PatternPredictionSample<
  TPredictionPayload,
  TValues,
  TMetadata
> {
  const normalizedFrameOffset = normalizeFrameOffset(frameOffset);
  const normalizedConfidence = clampConfidence(
    Number.isFinite(confidence)
      ? confidence
      : confidenceParts?.confidence,
  );
  const predictionValues = clonePredictionValues<TValues>({
    ...inlineValues,
    ...values,
  });

  return {
    sourcePatternId,
    frameOffset: normalizedFrameOffset,
    framesAhead: normalizedFrameOffset,
    values: predictionValues,
    confidence: normalizedConfidence,
    confidenceParts: confidenceParts ?? {
      confidence: normalizedConfidence,
    },
    metadata,
    prediction,
    ...predictionValues,
  };
}

/**
 * Packages a pattern's frame predictions into the common prediction-unit shape.
 *
 * Prediction units are what strategies consume: they expose sorted future
 * samples, first-sample confidence, horizon length, evidence, and status.
 */
export function createPatternPredictionUnit<
  TUnit = object,
  TEvidence = PatternEvidence,
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
>({
  id,
  unit = null,
  evidence = {} as TEvidence,
  predictions = [],
  primaryPrediction = null,
  status = "active",
}: PatternPredictionUnitOptions<
  TUnit,
  TEvidence,
  TPredictionPayload,
  TValues,
  TMetadata
> = {}): PatternPredictionUnit<TUnit, TEvidence, TPredictionPayload, TValues, TMetadata> {
  const sortedPredictions = [...predictions]
    .filter((prediction) => prediction?.frameOffset)
    .sort((first, second) => first.frameOffset - second.frameOffset);
  const firstPrediction = sortedPredictions[0] ?? null;
  const confidence = Number.isFinite(firstPrediction?.confidence)
    ? firstPrediction.confidence
    : 0;

  return {
    id: id ?? "pattern-prediction-unit",
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

/**
 * Returns the first prediction at or beyond the requested frame offset.
 *
 * If the requested offset is beyond the sampled horizon, the last available
 * prediction is returned.
 */
export function getPatternPredictionForFrame<
  TUnit = object,
  TEvidence = PatternEvidence,
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
>(
  patternUnit: PatternPredictionUnit<TUnit, TEvidence, TPredictionPayload, TValues, TMetadata> | null | undefined,
  frameOffset = 1,
): PatternPredictionSample<TPredictionPayload, TValues, TMetadata> | null {
  const predictions = patternUnit?.predictions;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return null;
  }
  const normalizedFrameOffset = normalizeFrameOffset(frameOffset);
  return predictions.find((prediction) => prediction.frameOffset >= normalizedFrameOffset)
    ?? predictions.at(-1)
    ?? null;
}
