import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
} from "./constants.mjs";
import {
  createFramePrediction,
  createPatternConfidence,
  createPatternPredictionUnit,
} from "./pattern-predictions.mjs";
import {
  createWallAvoidanceEvidenceState,
  updateWallAvoidanceEvidence,
} from "./wall-avoidance-detection.mjs";
import { createStatefulPattern, getPatternOutput, updatePattern } from "./patterns.mjs";
import { predictEvaderMotionFromWallAvoidance } from "./prediction.mjs";
import { buildEvaderProjectionPath } from "./projection-path.mjs";

export const WALL_AVOIDANCE_PATTERN_ID = "wallAvoidance";
const WALL_AVOIDANCE_PATTERN_UNIT = "wall-avoidance-motion-deflection";

function getPositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

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
        prediction: sample.prediction,
        metadata: {
          strategy: sample.prediction?.strategy ?? null,
          nearestWall: sample.prediction?.wallAvoidance?.nearestWall ?? null,
          nearestDistance: sample.prediction?.wallAvoidance?.nearestDistance ?? null,
        },
      });
    }),
  };
}

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

function createWallAvoidancePatternState() {
  const state = createWallAvoidanceEvidenceState();
  refreshWallAvoidancePredictionUnit(state);
  return state;
}

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
