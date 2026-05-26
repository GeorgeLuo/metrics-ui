import type {
  ActorLocationMemory,
  ObservedMotionMemory,
  ObstacleSet,
  VectorXZ,
  WorldContext,
} from "../observer-world/interfaces.ts";

export type PatternUpdateContext = {
  frameIndex?: number;
  columns?: number;
  rows?: number;
  obstacles?: ObstacleSet;
  worldContext?: WorldContext;
  observedEvaderMotion?: ObservedMotionMemory;
  evaderLocationMemory?: ActorLocationMemory;
  evaderVisible?: boolean;
  speedUnitsPerFrame?: number;
  horizonFrames?: number;
  sampleSpacingFrames?: number;
};

export type PatternMetadata = {
  role?: string;
  strategy?: string;
  projectionStrategy?: string;
  projectionActionable?: boolean | null;
  speedEstimateUnitsPerFrame?: number;
  framesSinceObservation?: number;
  nearestWall?: string | null;
  nearestDistance?: number | null;
};

export type PatternEvidence = Record<string, unknown>;

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
};

export type PatternPredictionSample<TPredictionPayload = object> = {
  sourcePatternId?: string;
  frameOffset: number;
  framesAhead: number;
  predictedPosition: VectorXZ | null;
  predictedDirection: VectorXZ | null;
  position: VectorXZ | null;
  direction: VectorXZ | null;
  confidence: number;
  confidenceParts: PatternConfidenceParts;
  metadata: PatternMetadata;
  prediction: TPredictionPayload | null;
};

export type PatternPredictionUnit<
  TUnit = object,
  TEvidence = PatternEvidence,
  TPredictionPayload = object,
> = {
  id: string;
  unit: TUnit;
  evidence: TEvidence;
  predictions: PatternPredictionSample<TPredictionPayload>[];
  primaryPrediction: TPredictionPayload | null;
  confidence: number;
  predictionCount: number;
  firstFrameOffset: number | null;
  horizonFrames: number;
  status: string;
};

export type StatefulPatternConfig<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
> = {
  id: string;
  unit?: TUnit;
  createState?: () => TState;
  updateState?: (state: TState, context: PatternUpdateContext) => TState | null;
  getOutput?: (state: TState) => TOutput;
  getEvidence?: (state: TState) => TEvidence | null;
  getPredictions?: (state: TState) => PatternPredictionSample[];
  getPredictionUnit?: (state: TState) => TPredictionUnit | null;
  getConfidence?: (state: TState) => number;
};

export type StatefulPattern<
  TState = object,
  TOutput = object,
  TEvidence = PatternEvidence,
  TPredictionUnit = PatternPredictionUnit,
  TUnit = object,
> = {
  id: string;
  unit: TUnit | null;
  state: TState | null;
  update: (context: PatternUpdateContext) => TState | null;
  getOutput: () => TOutput | null;
  getEvidence: () => TEvidence | null;
  getPredictions: () => PatternPredictionSample[];
  getPredictionUnit: () => TPredictionUnit | null;
  getConfidence: () => number;
};

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
  "columns",
  "rows",
  "obstacles",
  "worldContext",
  "observedEvaderMotion",
  "evaderLocationMemory",
  "evaderVisible",
  "speedUnitsPerFrame",
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
  "predictedPosition",
  "predictedDirection",
  "position",
  "direction",
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
