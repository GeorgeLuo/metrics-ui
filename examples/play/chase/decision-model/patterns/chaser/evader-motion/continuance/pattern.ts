import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
  EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES,
} from "../../../../../config/constants.mjs";
import {
  createFramePrediction,
  createPatternConfidence,
  createPatternPredictionUnit,
} from "../../../core/prediction-units.ts";
import { createStatefulPattern, getPatternOutput, updatePattern } from "../../../core/stateful-pattern.ts";
import { resolveObstacleCollisions } from "../../../../../world/world.mjs";
import type {
  ActorLocationMemory,
  ObservedMotionMemory,
  VectorXZ,
  WorldContext,
} from "../../../../observer-world/interfaces.ts";
import type {
  PatternConfidenceParts,
  PatternPredictionSample,
  PatternPredictionUnit,
  PatternUpdateContext,
  StatefulPattern,
} from "../../../core/interfaces.ts";

/**
 * Component-level statement for the continuance pattern unit.
 */
export type ContinuancePatternUnitComponent = {
  quantity: "velocity";
  axis: "x" | "z";
  relation: "continues";
};

/**
 * Pattern unit declaring that observed x/z velocity components continue.
 */
export type ContinuancePatternUnit = {
  id: "linear-motion-continuation";
  type: "component-velocity-continuance";
  role: "default-prediction";
  assumption: string;
  coordinatePlane: "x/z";
  components: {
    x: ContinuancePatternUnitComponent;
    z: ContinuancePatternUnitComponent;
  };
};

/**
 * Evidence exposed by the continuance pattern.
 */
export type ContinuanceMotionEvidence = {
  position: VectorXZ | null;
  direction: VectorXZ | null;
  framesSinceObservation: number;
  observationCount: number;
  motionObservationCount: number;
  speedEstimateUnitsPerFrame: number;
};

/**
 * Persistent state for the observed-motion continuance pattern.
 */
export type ContinuancePatternState = {
  position: VectorXZ | null;
  direction: VectorXZ;
  framesSinceObservation: number;
  observationCount: number;
  motionObservationCount: number;
  speedEstimateUnitsPerFrame: number;
  predictionUnit: PatternPredictionUnit<ContinuancePatternUnit, ContinuanceMotionEvidence, object>;
  predictions: PatternPredictionSample<object>[];
};

/**
 * Update context consumed by the continuance pattern.
 */
export type ContinuancePatternContext = PatternUpdateContext<{
  observedEvaderMotion?: ObservedMotionMemory;
  evaderLocationMemory?: ActorLocationMemory;
  worldContext?: WorldContext;
}>;

/**
 * Motion model consumed by chaser evader-prediction strategies.
 */
export type EvaderMotionModel = {
  position: VectorXZ | null;
  direction: VectorXZ;
  framesSinceObservation: number;
  speedEstimateUnitsPerFrame: number;
  speedObservationCount: number;
  lastObservedDirection: VectorXZ | null;
  previousObservedDirection: VectorXZ | null;
  observedTurnRadiansPerFrame: number;
  lastObservedPosition: VectorXZ | null;
  observationCount: number;
  motionObservationCount: number;
};

export type ContinuanceStatefulPattern = StatefulPattern<
  ContinuancePatternState,
  ContinuancePatternState,
  ContinuanceMotionEvidence,
  PatternPredictionUnit<ContinuancePatternUnit, ContinuanceMotionEvidence, object>,
  ContinuancePatternUnit,
  ContinuancePatternContext
>;

export type BuildEvaderMotionModelOptions = {
  observedEvaderMotion?: ObservedMotionMemory;
  continuancePattern?: ContinuanceStatefulPattern | null;
  continuance?: ContinuanceStatefulPattern | null;
};

export const CONTINUANCE_PATTERN_ID = "continuance";
export const CONTINUANCE_PATTERN_UNIT: Readonly<ContinuancePatternUnit> = Object.freeze({
  id: "linear-motion-continuation",
  type: "component-velocity-continuance",
  role: "default-prediction",
  assumption: "observed velocity components continue until replaced by newer observation",
  coordinatePlane: "x/z",
  components: Object.freeze({
    x: Object.freeze({
      quantity: "velocity",
      axis: "x",
      relation: "continues",
    }),
    z: Object.freeze({
      quantity: "velocity",
      axis: "z",
      relation: "continues",
    }),
  }),
});

export const CONTINUANCE_PATTERN_STATE_FIELDS = Object.freeze([
  "position",
  "direction",
  "framesSinceObservation",
  "observationCount",
  "motionObservationCount",
  "speedEstimateUnitsPerFrame",
  "predictionUnit",
  "predictions",
]);

export const CONTINUANCE_MOTION_EVIDENCE_FIELDS = Object.freeze([
  "position",
  "direction",
  "framesSinceObservation",
  "observationCount",
  "motionObservationCount",
  "speedEstimateUnitsPerFrame",
]);

export const EVADER_MOTION_MODEL_FIELDS = Object.freeze([
  "position",
  "direction",
  "framesSinceObservation",
  "speedEstimateUnitsPerFrame",
  "speedObservationCount",
  "lastObservedDirection",
  "previousObservedDirection",
  "observedTurnRadiansPerFrame",
  "lastObservedPosition",
  "observationCount",
  "motionObservationCount",
]);

/**
 * Creates the initial continuance state from the last known evader direction.
 */
export function createContinuancePatternState(
  evaderDirection: VectorXZ | null = { x: 0, z: 0 },
): ContinuancePatternState {
  const safeEvaderDirection = evaderDirection
    ? { ...evaderDirection }
    : { x: 0, z: 0 };
  return {
    position: null,
    direction: safeEvaderDirection,
    framesSinceObservation: 0,
    observationCount: 0,
    motionObservationCount: 0,
    speedEstimateUnitsPerFrame: DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
    predictionUnit: createPatternPredictionUnit({
      id: CONTINUANCE_PATTERN_ID,
      unit: CONTINUANCE_PATTERN_UNIT,
      status: "unobserved",
    }),
    predictions: [],
  };
}

function getPositiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function createContinuancePredictionConfidence({
  staleFrames = 0,
  frameOffset = 1,
}: {
  staleFrames?: number;
  frameOffset?: number;
} = {}): PatternConfidenceParts {
  const priorConfidence = createPatternConfidence({
    confirmedCount: 0,
    opportunityCount: 0,
    staleFrames,
    recencyHalfLifeFrames: EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES,
    frameOffset,
    horizonHalfLifeFrames: EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES,
  });
  const confidence = Math.max(
    0,
    Math.min(
      1,
      (priorConfidence.probability ?? 0)
        * (priorConfidence.recencyConfidence ?? 1)
        * (priorConfidence.horizonConfidence ?? 1),
    ),
  );

  return {
    model: "default-prior-decay",
    probability: priorConfidence.probability,
    uncertainty: priorConfidence.uncertainty,
    credibleLowerBound: priorConfidence.credibleLowerBound,
    credibleUpperBound: priorConfidence.credibleUpperBound,
    recencyConfidence: priorConfidence.recencyConfidence,
    horizonConfidence: priorConfidence.horizonConfidence,
    confidence,
    priorDistribution: priorConfidence.eventPosterior,
    confirmedCount: 0,
    contradictedCount: 0,
    opportunityCount: 0,
  };
}

function cloneMotionEvidence(state: ContinuancePatternState | null | undefined): ContinuanceMotionEvidence {
  const speedEstimate = state?.speedEstimateUnitsPerFrame;
  return {
    position: state?.position ? { ...state.position } : null,
    direction: state?.direction ? { ...state.direction } : null,
    framesSinceObservation: Number(state?.framesSinceObservation) || 0,
    observationCount: Number(state?.observationCount) || 0,
    motionObservationCount: Number(state?.motionObservationCount) || 0,
    speedEstimateUnitsPerFrame: Number.isFinite(speedEstimate)
      ? speedEstimate as number
      : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
  };
}

/**
 * Projects the current continuance estimate into future prediction samples.
 */
function projectLinearMotionPredictions(
  state: ContinuancePatternState,
  {
    worldContext = {},
    horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
    sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  }: ContinuancePatternContext = {},
): PatternPredictionSample<object>[] {
  if (!state?.position || !state?.direction) {
    return [];
  }

  const normalizedHorizonFrames = getPositiveInteger(
    horizonFrames,
    DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  );
  const normalizedSampleSpacingFrames = getPositiveInteger(
    sampleSpacingFrames,
    DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  );
  const speedEstimate = Number.isFinite(state.speedEstimateUnitsPerFrame)
    ? state.speedEstimateUnitsPerFrame
    : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME;
  const canResolveWorldCollision = worldContext.obstacles
    && Number.isFinite(worldContext.columns)
    && Number.isFinite(worldContext.rows);
  const predictions: PatternPredictionSample<object>[] = [];
  let position = { ...state.position };

  for (let frameOffset = 1; frameOffset <= normalizedHorizonFrames; frameOffset += 1) {
    const intendedPosition = {
      x: position.x + state.direction.x * speedEstimate,
      z: position.z + state.direction.z * speedEstimate,
    };
    position = canResolveWorldCollision
      ? resolveObstacleCollisions(
        intendedPosition,
        position,
        worldContext.columns as number,
        worldContext.rows as number,
        worldContext.obstacles,
      )
      : intendedPosition;

    if (frameOffset % normalizedSampleSpacingFrames !== 0 && frameOffset !== normalizedHorizonFrames) {
      continue;
    }

    const confidenceParts = createContinuancePredictionConfidence({
      staleFrames: state.framesSinceObservation,
      frameOffset,
    });

    predictions.push(createFramePrediction({
      sourcePatternId: CONTINUANCE_PATTERN_ID,
      frameOffset,
      values: {
        position,
        direction: state.direction,
        predictedPosition: position,
        predictedDirection: state.direction,
      },
      confidenceParts,
      metadata: {
        role: CONTINUANCE_PATTERN_UNIT.role,
        speedEstimateUnitsPerFrame: speedEstimate,
        framesSinceObservation: state.framesSinceObservation,
      },
    }));
  }

  return predictions;
}

function refreshContinuancePredictionUnit(
  state: ContinuancePatternState,
  context: ContinuancePatternContext = {},
): void {
  const predictions = projectLinearMotionPredictions(state, context);
  state.predictions = predictions;
  state.predictionUnit = createPatternPredictionUnit({
    id: CONTINUANCE_PATTERN_ID,
    unit: CONTINUANCE_PATTERN_UNIT,
    evidence: cloneMotionEvidence(state),
    predictions,
    status: state.position ? "active" : "unobserved",
  });
}

/**
 * Updates the continuance state from direct observation or passive projection.
 */
export function updateContinuancePatternState(
  continuance: ContinuancePatternState | null,
  {
    observedEvaderMotion,
    evaderLocationMemory,
    worldContext = {},
    horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
    sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  }: ContinuancePatternContext = {},
): ContinuancePatternState | null {
  if (!continuance) {
    return null;
  }

  if (evaderLocationMemory?.visible && evaderLocationMemory.position) {
    continuance.position = { ...evaderLocationMemory.position };
    continuance.framesSinceObservation = 0;
    continuance.observationCount = Number(observedEvaderMotion?.observationCount) || 0;
    continuance.motionObservationCount = Number(observedEvaderMotion?.motionObservationCount) || 0;
    const observedSpeed = observedEvaderMotion?.speedEstimateUnitsPerFrame;
    continuance.speedEstimateUnitsPerFrame = Number.isFinite(observedSpeed)
      ? observedSpeed as number
      : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME;
    if (observedEvaderMotion?.lastObservedDirection) {
      continuance.direction = { ...observedEvaderMotion.lastObservedDirection };
    }
    refreshContinuancePredictionUnit(continuance, {
      worldContext,
      horizonFrames,
      sampleSpacingFrames,
    });
    return continuance;
  }

  if (continuance.position && continuance.direction) {
    continuance.framesSinceObservation += 1;
    const observedSpeed = observedEvaderMotion?.speedEstimateUnitsPerFrame;
    const speedEstimate = Number.isFinite(observedSpeed)
      ? observedSpeed as number
      : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME;
    const nextPosition = {
      x: continuance.position.x
        + continuance.direction.x * speedEstimate,
      z: continuance.position.z
        + continuance.direction.z * speedEstimate,
    };
    const canResolveWorldCollision = worldContext.obstacles
      && Number.isFinite(worldContext.columns)
      && Number.isFinite(worldContext.rows);
    continuance.position = canResolveWorldCollision
      ? resolveObstacleCollisions(
        nextPosition,
        continuance.position,
        worldContext.columns as number,
        worldContext.rows as number,
        worldContext.obstacles,
      )
      : nextPosition;
  }

  refreshContinuancePredictionUnit(continuance, {
    worldContext,
    horizonFrames,
    sampleSpacingFrames,
  });
  return continuance;
}

/**
 * Creates the stateful continuance pattern wrapper.
 */
export function createContinuancePattern(
  evaderDirection: VectorXZ | null = { x: 0, z: 0 },
): ContinuanceStatefulPattern {
  return createStatefulPattern({
    id: CONTINUANCE_PATTERN_ID,
    unit: CONTINUANCE_PATTERN_UNIT,
    createState: () => createContinuancePatternState(evaderDirection),
    updateState: (state, context) => updateContinuancePatternState(state, context),
    getOutput: (state) => state,
    getEvidence: cloneMotionEvidence,
    getPredictions: (state) => state?.predictions ?? [],
    getPredictionUnit: (state) => state?.predictionUnit ?? null,
  });
}

/**
 * Advances a continuance pattern wrapper by one context update.
 */
export function updateContinuancePattern(
  pattern: ContinuanceStatefulPattern | null | undefined,
  context: ContinuancePatternContext,
): ContinuancePatternState | null {
  return updatePattern(pattern, context);
}

/**
 * Returns the current public continuance output.
 */
export function getContinuancePatternOutput(
  pattern: ContinuanceStatefulPattern | null | undefined,
): ContinuancePatternState | null {
  return getPatternOutput(pattern) as ContinuancePatternState | null;
}

/**
 * Builds the evader motion model exposed to prediction strategies.
 */
export function buildEvaderMotionModel({
  observedEvaderMotion,
  continuancePattern,
  continuance,
}: BuildEvaderMotionModelOptions = {}): EvaderMotionModel {
  const resolvedContinuance = getContinuancePatternOutput(
    continuancePattern ?? continuance,
  );
  const observedSpeed = observedEvaderMotion?.speedEstimateUnitsPerFrame;
  return {
    position: resolvedContinuance?.position ?? null,
    direction: resolvedContinuance?.direction ?? { x: 0, z: 0 },
    framesSinceObservation: Number(resolvedContinuance?.framesSinceObservation) || 0,
    speedEstimateUnitsPerFrame: Number.isFinite(observedSpeed)
      ? observedSpeed as number
      : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
    speedObservationCount: Number(observedEvaderMotion?.speedObservationCount) || 0,
    lastObservedDirection: observedEvaderMotion?.lastObservedDirection ?? { x: 0, z: 0 },
    previousObservedDirection: observedEvaderMotion?.previousObservedDirection ?? null,
    observedTurnRadiansPerFrame: Number(observedEvaderMotion?.observedTurnRadiansPerFrame) || 0,
    lastObservedPosition: observedEvaderMotion?.lastObservedPosition ?? null,
    observationCount: Number(observedEvaderMotion?.observationCount) || 0,
    motionObservationCount: Number(observedEvaderMotion?.motionObservationCount) || 0,
  };
}
