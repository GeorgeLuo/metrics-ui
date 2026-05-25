/**
 * @import {
 *   ActorLocationMemory,
 *   ObservedMotionMemory,
 *   ObstacleSet,
 *   VectorXZ,
 *   WorldContext,
 * } from "../observer-world/interfaces.mjs"
 */

/**
 * @typedef {Object} PatternUpdateContext
 * @property {number} [frameIndex] Current simulation frame index.
 * @property {number} [columns] Field width in world columns.
 * @property {number} [rows] Field depth in world rows.
 * @property {ObstacleSet} [obstacles] Obstacles known to the actor.
 * @property {WorldContext} [worldContext] Nested world context used by projection patterns.
 * @property {ObservedMotionMemory} [observedEvaderMotion] Observed target motion memory.
 * @property {ActorLocationMemory} [evaderLocationMemory] Target location memory.
 * @property {boolean} [evaderVisible] Whether the target is visible this frame.
 * @property {number} [speedUnitsPerFrame] Speed to use when projecting motion.
 * @property {number} [horizonFrames] Number of future frames to model.
 * @property {number} [sampleSpacingFrames] Frame spacing between prediction samples.
 */

/**
 * @typedef {Object} PatternMetadata
 * @property {string} [role] Semantic role of the prediction sample.
 * @property {string} [strategy] Pattern or strategy id that produced the sample.
 * @property {string} [projectionStrategy] Nested projection strategy id.
 * @property {boolean | null} [projectionActionable] Whether nested projection was actionable.
 * @property {number} [speedEstimateUnitsPerFrame] Speed estimate used by the sample.
 * @property {number} [framesSinceObservation] Staleness of the source observation.
 * @property {string | null} [nearestWall] Nearest wall id for wall-aware predictions.
 * @property {number | null} [nearestDistance] Distance to the nearest wall.
 */

/**
 * @typedef {Object} PatternEvidence
 */

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @typedef {Object} StatefulPatternConfig
 * @property {string} id Stable pattern id used in snapshots, debug views, and strategy inputs.
 * @property {TUnit} [unit] Human-readable or structured explanation of the pattern's modeled relationship.
 * @property {() => TState} [createState] Creates private mutable pattern state.
 * @property {(state: TState, context: PatternUpdateContext) => TState | null} [updateState] Advances state from the latest context.
 * @property {(state: TState) => TOutput} [getOutput] Projects private state into the public pattern output.
 * @property {(state: TState) => TEvidence | null} [getEvidence] Returns evidence used by this pattern.
 * @property {(state: TState) => PatternPredictionSample[]} [getPredictions] Returns future samples produced by this pattern.
 * @property {(state: TState) => TPredictionUnit | null} [getPredictionUnit] Returns the full prediction payload.
 * @property {(state: TState) => number} [getConfidence] Returns the current confidence on a 0..1 scale.
 */

/**
 * @template TState
 * @template TOutput
 * @template TEvidence
 * @template TPredictionUnit
 * @template TUnit
 * @typedef {Object} StatefulPattern
 * @property {string} id Stable pattern id.
 * @property {TUnit} unit Pattern unit description.
 * @property {TState | null} state Private mutable state.
 * @property {(context: PatternUpdateContext) => TState | null} update Advances and returns private state.
 * @property {() => TOutput | null} getOutput Returns the public pattern output.
 * @property {() => TEvidence | null} getEvidence Returns evidence used by this pattern.
 * @property {() => PatternPredictionSample[]} getPredictions Returns future samples produced by this pattern.
 * @property {() => TPredictionUnit | null} getPredictionUnit Returns the full prediction payload.
 * @property {() => number} getConfidence Returns the current confidence on a 0..1 scale.
 */

/**
 * @template [TPredictionPayload=object]
 * @typedef {Object} PatternPredictionSample
 * @property {string} [sourcePatternId] Pattern id that produced the sample.
 * @property {number} frameOffset Future frame offset from the frame where the prediction was made.
 * @property {number} framesAhead Alias for frameOffset.
 * @property {VectorXZ | null} predictedPosition Predicted target position.
 * @property {VectorXZ | null} predictedDirection Predicted target direction.
 * @property {VectorXZ | null} position Alias for predictedPosition.
 * @property {VectorXZ | null} direction Alias for predictedDirection.
 * @property {number} confidence Sample confidence on a 0..1 scale.
 * @property {PatternConfidenceParts} confidenceParts Expanded confidence calculation.
 * @property {PatternMetadata} metadata Pattern-specific sample metadata.
 * @property {TPredictionPayload | null} prediction Pattern-specific prediction payload.
 */

/**
 * @template [TUnit=object]
 * @template [TEvidence=PatternEvidence]
 * @template [TPredictionPayload=object]
 * @typedef {Object} PatternPredictionUnit
 * @property {string} id Pattern id.
 * @property {TUnit} unit Pattern unit description.
 * @property {TEvidence} evidence Evidence snapshot used to build predictions.
 * @property {PatternPredictionSample<TPredictionPayload>[]} predictions Sorted future samples.
 * @property {TPredictionPayload | null} primaryPrediction Pattern-specific primary prediction payload.
 * @property {number} confidence Confidence of the earliest prediction sample.
 * @property {number} predictionCount Number of prediction samples.
 * @property {number | null} firstFrameOffset Earliest predicted frame offset.
 * @property {number} horizonFrames Last predicted frame offset.
 * @property {string} status Current prediction status, such as active, inactive, or unobserved.
 */

/**
 * @typedef {Object} PatternConfidenceParts
 * @property {string} [model] Confidence model id.
 * @property {number} [probability] Estimated probability on a 0..1 scale.
 * @property {number} [uncertainty] Posterior uncertainty.
 * @property {number} [credibleLowerBound] Conservative lower bound on probability.
 * @property {number} [credibleUpperBound] Upper bound on probability.
 * @property {number} [recencyConfidence] Recency decay multiplier.
 * @property {number} [horizonConfidence] Prediction-horizon decay multiplier.
 * @property {number} confidence Final confidence on a 0..1 scale.
 * @property {number} [confirmedCount] Count of confirming observations.
 * @property {number} [contradictedCount] Count of contradicting observations.
 * @property {number} [opportunityCount] Count of observations that could confirm or contradict.
 */

/**
 * @typedef {Object} PatternStatus
 * @property {string} id Pattern id.
 * @property {boolean} enabled Whether the actor currently considers this pattern.
 * @property {number} confidence Current confidence on a 0..1 scale.
 * @property {number} predictionCount Number of prediction samples in the current unit.
 */

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
