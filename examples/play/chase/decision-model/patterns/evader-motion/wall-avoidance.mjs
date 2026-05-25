import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
} from "../../../config/constants.mjs";
import {
  createFramePrediction,
  createPatternConfidence,
  createPatternPredictionUnit,
} from "../prediction-units.mjs";
import {
  createWallAvoidanceEvidenceState,
  updateWallAvoidanceEvidence,
} from "./wall-avoidance-evidence.mjs";
import { createStatefulPattern, getPatternOutput, updatePattern } from "../stateful-pattern.mjs";
import { predictEvaderMotionFromWallAvoidance } from "../../strategies/evader-prediction/motion-prediction.mjs";
import { buildEvaderProjectionPath } from "../../strategies/evader-prediction/projection-path.mjs";

/**
 * @import {
 *   ObstacleSet,
 *   VectorXZ,
 * } from "../../observer-world/interfaces.mjs"
 * @import {
 *   PatternPredictionSample,
 *   PatternPredictionUnit,
 *   PatternUpdateContext,
 *   StatefulPattern,
 * } from "../interfaces.mjs"
 * @import {
 *   WallAvoidanceEvidenceState,
 * } from "./wall-avoidance-evidence.mjs"
 */

/**
 * @typedef {Object} PredictionOscillator
 * @property {string} id Signal id.
 * @property {VectorXZ | null} direction Signal direction.
 * @property {number} confidence Signal confidence on a 0..1 scale.
 * @property {number} [weight] Optional consensus weight.
 */

/**
 * @typedef {Object} WallAvoidanceSignal
 * @property {string} id Signal id.
 * @property {VectorXZ} direction Suggested avoidance direction.
 * @property {number} confidence Signal confidence on a 0..1 scale.
 * @property {number} weight Consensus weight.
 * @property {Object} metadata Wall signal metadata.
 * @property {string | null} [metadata.nearestWall] Nearest wall id.
 * @property {number | null} [metadata.nearestDistance] Distance to nearest wall.
 */

/**
 * @typedef {Object} EvaderMotionPrediction
 * @property {string} strategy Prediction strategy id.
 * @property {VectorXZ} direction Predicted direction.
 * @property {number} consensus Prediction confidence or consensus score.
 * @property {PredictionOscillator[]} oscillators Signals used by the prediction.
 * @property {WallAvoidanceSignal | null} [wallAvoidance] Wall-avoidance signal when active.
 * @property {boolean} [actionable] Whether the prediction can be used by a strategy.
 */

/**
 * @typedef {EvaderMotionPrediction & {
 *   projectionPrediction: EvaderMotionPrediction | null
 * }} WallAvoidancePatternPrediction
 */

/**
 * @typedef {WallAvoidanceEvidenceState & {
 *   predictions?: PatternPredictionSample<WallAvoidancePatternPrediction>[],
 *   primaryPrediction?: EvaderMotionPrediction | null,
 *   predictionUnit?: PatternPredictionUnit<string, WallAvoidanceEvidenceState, WallAvoidancePatternPrediction>
 * }} WallAvoidancePatternState
 */

/**
 * @typedef {PatternUpdateContext & {
 *   estimate?: import("./continuance.mjs").EvaderMotionModel | null,
 *   obstacles?: ObstacleSet,
 *   speedUnitsPerFrame?: number
 * }} WallAvoidancePatternContext
 */

/**
 * @typedef {Object} WallAvoidancePatternPredictionSet
 * @property {EvaderMotionPrediction | null} primaryPrediction Primary wall-avoidance prediction.
 * @property {PatternPredictionSample<WallAvoidancePatternPrediction>[]} predictions Future-frame samples.
 */

export const WALL_AVOIDANCE_PATTERN_ID = "wallAvoidance";
const WALL_AVOIDANCE_PATTERN_UNIT = "wall-avoidance-motion-deflection";
const WALL_AVOIDANCE_PATTERN_STRATEGY = "wall-avoidance-intercept";

export const WALL_AVOIDANCE_PATTERN_STATE_FIELDS = Object.freeze([
  "observedSampleCount",
  "approachEpisodeCount",
  "avoidedApproachCount",
  "hitApproachCount",
  "pendingApproach",
  "cooldownWall",
  "wallAvoidanceScore",
  "latest",
  "predictions",
  "primaryPrediction",
  "predictionUnit",
]);

export const EVADER_MOTION_PREDICTION_FIELDS = Object.freeze([
  "strategy",
  "direction",
  "consensus",
  "oscillators",
  "wallAvoidance",
  "actionable",
]);

function getPositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

/**
 * @param {WallAvoidancePatternState | null | undefined} state
 * @returns {WallAvoidanceEvidenceState}
 */
function cloneWallAvoidanceEvidence(state) {
  return {
    observedSampleCount: Number(state?.observedSampleCount) || 0,
    approachEpisodeCount: Number(state?.approachEpisodeCount) || 0,
    avoidedApproachCount: Number(state?.avoidedApproachCount) || 0,
    hitApproachCount: Number(state?.hitApproachCount) || 0,
    wallAvoidanceScore: Number(state?.wallAvoidanceScore) || 0,
    pendingApproach: state?.pendingApproach ? { ...state.pendingApproach } : null,
    cooldownWall: state?.cooldownWall ?? null,
    latest: state?.latest ? { ...state.latest } : null,
  };
}

/**
 * @param {{direction: VectorXZ, prediction?: EvaderMotionPrediction | null}} sample
 * @param {import("../interfaces.mjs").PatternConfidenceParts} confidenceParts
 * @param {EvaderMotionPrediction | null} initialPrediction
 * @returns {WallAvoidancePatternPrediction}
 */
function createWallAvoidancePatternPrediction(sample, confidenceParts, initialPrediction) {
  const projectionPrediction = sample.prediction ?? null;
  const wallAvoidance = projectionPrediction?.wallAvoidance
    ?? initialPrediction?.wallAvoidance
    ?? null;

  return {
    strategy: WALL_AVOIDANCE_PATTERN_STRATEGY,
    direction: sample.direction,
    consensus: confidenceParts.confidence,
    oscillators: Array.isArray(projectionPrediction?.oscillators)
      ? projectionPrediction.oscillators
      : [],
    wallAvoidance,
    actionable: true,
    projectionPrediction,
  };
}

/**
 * @param {WallAvoidancePatternState} state
 * @param {WallAvoidancePatternContext} context
 * @returns {WallAvoidancePatternPredictionSet}
 */
function buildWallAvoidancePatternPredictionSet(state, {
  estimate,
  columns,
  rows,
  obstacles,
  speedUnitsPerFrame,
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
  const resolvedSpeedUnitsPerFrame = Number.isFinite(speedUnitsPerFrame)
    ? speedUnitsPerFrame
    : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME;
  const initialPrediction = predictEvaderMotionFromWallAvoidance(estimate, {
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence: state,
  });
  if (!initialPrediction?.actionable) {
    return {
      primaryPrediction: initialPrediction,
      predictions: [],
    };
  }

  const path = buildEvaderProjectionPath({
    estimate,
    initialPrediction,
    predictMotion: predictEvaderMotionFromWallAvoidance,
    horizonFrames: normalizedHorizonFrames,
    sampleSpacingFrames: normalizedSampleSpacingFrames,
    speedUnitsPerFrame: resolvedSpeedUnitsPerFrame,
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence: state,
  });

  return {
    primaryPrediction: initialPrediction,
    predictions: path.map((sample) => {
      const confidenceParts = createPatternConfidence({
        confirmedCount: state?.avoidedApproachCount,
        opportunityCount: state?.approachEpisodeCount,
        frameOffset: sample.framesAhead,
      });
      return createFramePrediction({
        sourcePatternId: WALL_AVOIDANCE_PATTERN_ID,
        frameOffset: sample.framesAhead,
        position: sample.position,
        direction: sample.direction,
        confidenceParts,
        prediction: createWallAvoidancePatternPrediction(
          sample,
          confidenceParts,
          initialPrediction,
        ),
        metadata: {
          strategy: WALL_AVOIDANCE_PATTERN_STRATEGY,
          projectionStrategy: sample.prediction?.strategy ?? null,
          projectionActionable: sample.prediction?.actionable ?? null,
          nearestWall: sample.prediction?.wallAvoidance?.nearestWall
            ?? initialPrediction?.wallAvoidance?.nearestWall
            ?? null,
          nearestDistance: sample.prediction?.wallAvoidance?.nearestDistance
            ?? initialPrediction?.wallAvoidance?.nearestDistance
            ?? null,
        },
      });
    }),
  };
}

/**
 * @param {WallAvoidancePatternState} state
 * @param {WallAvoidancePatternContext} context
 * @returns {void}
 */
function refreshWallAvoidancePredictionUnit(state, context = {}) {
  const predictionSet = buildWallAvoidancePatternPredictionSet(state, context);
  const predictions = predictionSet.predictions;
  state.predictions = predictions;
  state.primaryPrediction = predictionSet.primaryPrediction;
  state.predictionUnit = createPatternPredictionUnit({
    id: WALL_AVOIDANCE_PATTERN_ID,
    unit: WALL_AVOIDANCE_PATTERN_UNIT,
    evidence: cloneWallAvoidanceEvidence(state),
    predictions,
    primaryPrediction: predictionSet.primaryPrediction,
    status: predictions.length > 0 ? "active" : "inactive",
  });
}

/**
 * @returns {WallAvoidancePatternState}
 */
function createWallAvoidancePatternState() {
  const state = createWallAvoidanceEvidenceState();
  refreshWallAvoidancePredictionUnit(state);
  return state;
}

/**
 * @returns {StatefulPattern<
 *   WallAvoidancePatternState,
 *   WallAvoidancePatternState,
 *   WallAvoidanceEvidenceState,
 *   PatternPredictionUnit<string, WallAvoidanceEvidenceState, WallAvoidancePatternPrediction>,
 *   string
 * >}
 */
export function createWallAvoidancePattern() {
  return createStatefulPattern({
    id: WALL_AVOIDANCE_PATTERN_ID,
    unit: WALL_AVOIDANCE_PATTERN_UNIT,
    createState: createWallAvoidancePatternState,
    updateState: (state, context) => {
      const nextState = updateWallAvoidanceEvidence(state, context);
      refreshWallAvoidancePredictionUnit(nextState, context);
      return nextState;
    },
    getOutput: (state) => state,
    getEvidence: cloneWallAvoidanceEvidence,
    getPredictions: (state) => state?.predictions ?? [],
    getPredictionUnit: (state) => state?.predictionUnit ?? null,
  });
}

export function updateWallAvoidancePattern(pattern, context) {
  return updatePattern(pattern, context);
}

export function getWallAvoidancePatternOutput(pattern) {
  return getPatternOutput(pattern);
}
