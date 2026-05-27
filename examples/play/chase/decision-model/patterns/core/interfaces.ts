/**
 * Generic context passed to a pattern update.
 *
 * The core reserves only frame and sampling fields. Domain-specific pattern
 * implementations extend this with their own perception, memory, or world
 * values through `TContext`.
 */
export type PatternUpdateContext<
  TContext extends object = Record<string, unknown>,
> = {
  frameIndex?: number;
  horizonFrames?: number;
  sampleSpacingFrames?: number;
} & TContext;

/**
 * Free-form metadata attached to prediction samples.
 */
export type PatternMetadata = Record<string, unknown>;

/**
 * Free-form evidence payload exposed by a pattern.
 */
export type PatternEvidence = Record<string, unknown>;

/**
 * Domain-neutral values predicted for a future frame.
 */
export type PatternPredictionValues = Record<string, unknown>;

/**
 * Normalized confidence fields emitted by the pattern confidence helpers.
 */
export type PatternConfidenceParts = {
  model?: string;
  probability?: number;
  uncertainty?: number;
  credibleLowerBound?: number;
  credibleUpperBound?: number;
  recencyConfidence?: number;
  horizonConfidence?: number;
  confidence: number;
  confirmedCount?: number;
  contradictedCount?: number;
  opportunityCount?: number;
  eventPosterior?: unknown;
  priorDistribution?: unknown;
};

/**
 * One prediction for a future frame.
 *
 * `values` contains domain-specific predicted values and is also spread onto
 * the sample for existing spatial call sites that read fields like `position`
 * or `direction` directly.
 */
export type PatternPredictionSample<
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
> = {
  sourcePatternId?: string;
  frameOffset: number;
  framesAhead: number;
  values: TValues;
  confidence: number;
  confidenceParts: PatternConfidenceParts;
  metadata: TMetadata;
  prediction: TPredictionPayload | null;
} & TValues;

/**
 * Common container that patterns expose to downstream strategies.
 */
export type PatternPredictionUnit<
  TUnit = object,
  TEvidence = PatternEvidence,
  TPredictionPayload = object,
  TValues extends PatternPredictionValues = PatternPredictionValues,
  TMetadata extends PatternMetadata = PatternMetadata,
> = {
  id: string;
  unit: TUnit | null;
  evidence: TEvidence;
  predictions: PatternPredictionSample<TPredictionPayload, TValues, TMetadata>[];
  primaryPrediction: TPredictionPayload | null;
  confidence: number;
  predictionCount: number;
  firstFrameOffset: number | null;
  horizonFrames: number;
  status: string;
};

/**
 * Callback configuration for building a stateful pattern wrapper.
 */
export type StatefulPatternConfig<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
> = {
  id?: string;
  unit?: TUnit | null;
  createState?: () => TState;
  updateState?: (state: TState | null, context: PatternUpdateContext<TContext>) => TState | null;
  getOutput?: (state: TState | null) => TOutput;
  getEvidence?: (state: TState | null) => TEvidence | null;
  getPredictions?: (state: TState | null) => PatternPredictionSample[];
  getPredictionUnit?: (state: TState | null) => TPredictionUnit | null;
  getConfidence?: (state: TState | null) => number;
};

/**
 * Runtime wrapper for a pattern with persistent state.
 */
export type StatefulPattern<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
  TContext extends object = Record<string, unknown>,
> = {
  id: string;
  unit: TUnit | null;
  state: TState | null;
  update: (context: PatternUpdateContext<TContext>) => TState | null;
  getOutput: () => TOutput | null;
  getEvidence: () => TEvidence | null;
  getPredictions: () => PatternPredictionSample[];
  getPredictionUnit: () => TPredictionUnit | null;
  getConfidence: () => number;
};

/**
 * Small status projection used by debug views and selectors.
 */
export type PatternStatus = {
  id: string;
  enabled: boolean;
  confidence: number;
  predictionCount: number;
};

export const STATEFUL_PATTERN_CONFIG_FIELDS = Object.freeze([
  "id",
  "unit",
  "createState",
  "updateState",
  "getOutput",
  "getEvidence",
  "getPredictions",
  "getPredictionUnit",
  "getConfidence",
]);

export const PATTERN_UPDATE_CONTEXT_FIELDS = Object.freeze([
  "frameIndex",
  "horizonFrames",
  "sampleSpacingFrames",
]);

export const STATEFUL_PATTERN_FIELDS = Object.freeze([
  "id",
  "unit",
  "state",
  "update",
  "getOutput",
  "getEvidence",
  "getPredictions",
  "getPredictionUnit",
  "getConfidence",
]);

export const PATTERN_PREDICTION_SAMPLE_FIELDS = Object.freeze([
  "sourcePatternId",
  "frameOffset",
  "framesAhead",
  "values",
  "confidence",
  "confidenceParts",
  "metadata",
  "prediction",
]);

export const PATTERN_PREDICTION_UNIT_FIELDS = Object.freeze([
  "id",
  "unit",
  "evidence",
  "predictions",
  "primaryPrediction",
  "confidence",
  "predictionCount",
  "firstFrameOffset",
  "horizonFrames",
  "status",
]);
