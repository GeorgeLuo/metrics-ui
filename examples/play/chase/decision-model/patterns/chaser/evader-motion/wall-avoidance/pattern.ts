import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
} from "../../../../../config/constants.mjs";
import {
  createFramePrediction,
  createPatternConfidence,
  createPatternPredictionUnit,
} from "../../../core/prediction-units.ts";
import {
  createWallAvoidanceEvidenceState,
  updateWallAvoidanceEvidence,
} from "./evidence.ts";
import { createStatefulPattern, getPatternOutput, updatePattern } from "../../../core/stateful-pattern.ts";
import { predictEvaderMotionFromWallAvoidance } from "../../../../projections/chaser/evader-motion/motion-prediction.mjs";
import { buildEvaderProjectionPath } from "../../../../projections/chaser/evader-motion/projection-path.mjs";
import type {
  ObstacleSet,
  VectorXZ,
} from "../../../../observer-world/interfaces.ts";
import type {
  PatternConfidenceParts,
  PatternPredictionSample,
  PatternPredictionUnit,
  PatternUpdateContext,
  StatefulPattern,
} from "../../../core/interfaces.ts";
import type { EvaderMotionModel } from "../continuance/pattern.ts";
import type { WallAvoidanceEvidenceState } from "./evidence.ts";

/**
 * Consensus input used by evader-motion prediction.
 */
export type PredictionOscillator = {
  id: string;
  direction: VectorXZ | null;
  confidence: number;
  weight?: number;
};

/**
 * Wall-avoidance direction signal inferred from observed wall approaches.
 */
export type WallAvoidanceSignal = {
  id: string;
  direction: VectorXZ;
  confidence: number;
  weight: number;
  metadata: {
    nearestWall?: string | null;
    nearestDistance?: number | null;
  };
  nearestWall?: string | null;
  nearestDistance?: number | null;
};

/**
 * Direction prediction produced for an evader motion model.
 */
export type EvaderMotionPrediction = {
  strategy: string;
  direction: VectorXZ;
  consensus: number;
  oscillators: PredictionOscillator[];
  wallAvoidance?: WallAvoidanceSignal | null;
  actionable?: boolean;
};

/**
 * Wall-avoidance prediction payload stored in pattern samples.
 */
export type WallAvoidancePatternPrediction = EvaderMotionPrediction & {
  projectionPrediction: EvaderMotionPrediction | null;
};

/**
 * Stateful pattern state for wall-avoidance inference and projections.
 */
export type WallAvoidancePatternState = WallAvoidanceEvidenceState & {
  predictions?: PatternPredictionSample<WallAvoidancePatternPrediction>[];
  primaryPrediction?: EvaderMotionPrediction | null;
  predictionUnit?: PatternPredictionUnit<
    string,
    WallAvoidanceEvidenceState,
    WallAvoidancePatternPrediction | EvaderMotionPrediction
  >;
};

/**
 * Update context consumed by the wall-avoidance pattern.
 */
export type WallAvoidancePatternContext = PatternUpdateContext<{
  estimate?: EvaderMotionModel | null;
  evaderVisible?: boolean;
  columns?: number;
  rows?: number;
  obstacles?: ObstacleSet;
  speedUnitsPerFrame?: number;
}>;

export type WallAvoidancePatternPredictionSet = {
  primaryPrediction: EvaderMotionPrediction | null;
  predictions: PatternPredictionSample<WallAvoidancePatternPrediction>[];
};

type ProjectionSample = {
  framesAhead: number;
  position: VectorXZ;
  direction: VectorXZ;
  prediction?: EvaderMotionPrediction | null;
};

export type WallAvoidanceStatefulPattern = StatefulPattern<
  WallAvoidancePatternState,
  WallAvoidancePatternState,
  WallAvoidanceEvidenceState,
  PatternPredictionUnit<string, WallAvoidanceEvidenceState, WallAvoidancePatternPrediction | EvaderMotionPrediction>,
  string,
  WallAvoidancePatternContext
>;

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

function getPositiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function cloneWallAvoidanceEvidence(
  state: WallAvoidancePatternState | null | undefined,
): WallAvoidanceEvidenceState {
  const latest = state?.latest
    ? { ...state.latest }
    : {
      observed: false,
      nearestWall: "none",
      nearestDistance: null,
      nearingWall: false,
      hitWall: false,
      episodeStatus: "idle" as const,
    };
  return {
    observedSampleCount: Number(state?.observedSampleCount) || 0,
    approachEpisodeCount: Number(state?.approachEpisodeCount) || 0,
    avoidedApproachCount: Number(state?.avoidedApproachCount) || 0,
    hitApproachCount: Number(state?.hitApproachCount) || 0,
    wallAvoidanceScore: Number(state?.wallAvoidanceScore) || 0,
    pendingApproach: state?.pendingApproach ? { ...state.pendingApproach } : null,
    cooldownWall: state?.cooldownWall ?? null,
    latest,
  };
}

function createWallAvoidancePatternPrediction(
  sample: ProjectionSample,
  confidenceParts: PatternConfidenceParts,
  initialPrediction: EvaderMotionPrediction | null,
): WallAvoidancePatternPrediction {
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
 * Builds wall-avoidance predictions from accumulated wall-approach evidence.
 */
function buildWallAvoidancePatternPredictionSet(
  state: WallAvoidancePatternState,
  {
    estimate,
    columns,
    rows,
    obstacles,
    speedUnitsPerFrame,
    horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
    sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  }: WallAvoidancePatternContext = {},
): WallAvoidancePatternPredictionSet {
  const normalizedHorizonFrames = getPositiveInteger(
    horizonFrames,
    DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  );
  const normalizedSampleSpacingFrames = getPositiveInteger(
    sampleSpacingFrames,
    DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  );
  const resolvedSpeedUnitsPerFrame = Number.isFinite(speedUnitsPerFrame)
    ? speedUnitsPerFrame as number
    : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME;
  const initialPrediction = predictEvaderMotionFromWallAvoidance(estimate, {
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence: state,
  }) as EvaderMotionPrediction | null;
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
  }) as ProjectionSample[];

  return {
    primaryPrediction: initialPrediction,
    predictions: path.map((sample) => {
      const confidenceParts = createPatternConfidence({
        confirmedCount: state?.avoidedApproachCount,
        opportunityCount: state?.approachEpisodeCount,
        frameOffset: sample.framesAhead,
      });
      return createFramePrediction<WallAvoidancePatternPrediction>({
        sourcePatternId: WALL_AVOIDANCE_PATTERN_ID,
        frameOffset: sample.framesAhead,
        values: {
          position: sample.position,
          direction: sample.direction,
          predictedPosition: sample.position,
          predictedDirection: sample.direction,
        },
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

function refreshWallAvoidancePredictionUnit(
  state: WallAvoidancePatternState,
  context: WallAvoidancePatternContext = {},
): void {
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

function createWallAvoidancePatternState(): WallAvoidancePatternState {
  const state = createWallAvoidanceEvidenceState() as WallAvoidancePatternState;
  refreshWallAvoidancePredictionUnit(state);
  return state;
}

/**
 * Creates the stateful wall-avoidance pattern wrapper.
 */
export function createWallAvoidancePattern(): WallAvoidanceStatefulPattern {
  return createStatefulPattern({
    id: WALL_AVOIDANCE_PATTERN_ID,
    unit: WALL_AVOIDANCE_PATTERN_UNIT,
    createState: createWallAvoidancePatternState,
    updateState: (state, context) => {
      const activeState = state ?? createWallAvoidancePatternState();
      const nextState = updateWallAvoidanceEvidence(
        activeState,
        {
          ...context,
          estimate: context.estimate ?? undefined,
        },
      ) as WallAvoidancePatternState;
      refreshWallAvoidancePredictionUnit(nextState, context);
      return nextState;
    },
    getOutput: (state) => state,
    getEvidence: cloneWallAvoidanceEvidence,
    getPredictions: (state) => state?.predictions ?? [],
    getPredictionUnit: (state) => state?.predictionUnit ?? null,
  });
}

/**
 * Advances a wall-avoidance pattern wrapper by one context update.
 */
export function updateWallAvoidancePattern(
  pattern: WallAvoidanceStatefulPattern | null | undefined,
  context: WallAvoidancePatternContext,
): WallAvoidancePatternState | null {
  return updatePattern(pattern, context);
}

/**
 * Returns the current public wall-avoidance output.
 */
export function getWallAvoidancePatternOutput(
  pattern: WallAvoidanceStatefulPattern | null | undefined,
): WallAvoidancePatternState | null {
  return getPatternOutput(pattern) as WallAvoidancePatternState | null;
}
