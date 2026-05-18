import {
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
  EVADER_PREDICTION_MAX_UNOBSERVED_FRAMES,
} from "../../config/constants.mjs";
import {
  createFramePrediction,
  createPatternConfidence,
  createPatternPredictionUnit,
} from "../../decision-model/pattern-predictions.mjs";
import { createStatefulPattern, getPatternOutput, updatePattern } from "../../decision-model/patterns.mjs";
import { resolveObstacleCollisions } from "../../world/world.mjs";

export const CONTINUANCE_PATTERN_ID = "continuance";
export const CONTINUANCE_PATTERN_UNIT = Object.freeze({
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

export function createContinuancePatternState(
  evaderDirection = { x: 0, z: 0 },
) {
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

function getPositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function createContinuancePredictionConfidence({
  staleFrames = 0,
  frameOffset = 1,
} = {}) {
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
      priorConfidence.probability
        * priorConfidence.recencyConfidence
        * priorConfidence.horizonConfidence,
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

function cloneMotionEvidence(state) {
  return {
    position: state?.position ? { ...state.position } : null,
    direction: state?.direction ? { ...state.direction } : null,
    framesSinceObservation: Number(state?.framesSinceObservation) || 0,
    observationCount: Number(state?.observationCount) || 0,
    motionObservationCount: Number(state?.motionObservationCount) || 0,
    speedEstimateUnitsPerFrame: Number.isFinite(state?.speedEstimateUnitsPerFrame)
      ? state.speedEstimateUnitsPerFrame
      : DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
  };
}

function projectLinearMotionPredictions(state, {
  worldContext = {},
  horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
} = {}) {
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
  const predictions = [];
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
        worldContext.columns,
        worldContext.rows,
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
      position,
      direction: state.direction,
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

function refreshContinuancePredictionUnit(state, context = {}) {
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

export function updateContinuancePatternState(
  continuance,
  {
    observedEvaderMotion,
    evaderLocationMemory,
    worldContext = {},
    horizonFrames = DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
    sampleSpacingFrames = DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  } = {},
) {
  if (!continuance) {
    return null;
  }

  if (evaderLocationMemory?.visible && evaderLocationMemory.position) {
    continuance.position = { ...evaderLocationMemory.position };
    continuance.framesSinceObservation = 0;
    continuance.observationCount = Number(observedEvaderMotion?.observationCount) || 0;
    continuance.motionObservationCount = Number(observedEvaderMotion?.motionObservationCount) || 0;
    continuance.speedEstimateUnitsPerFrame = Number.isFinite(
      observedEvaderMotion?.speedEstimateUnitsPerFrame,
    )
      ? observedEvaderMotion.speedEstimateUnitsPerFrame
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
    const speedEstimate = Number.isFinite(observedEvaderMotion?.speedEstimateUnitsPerFrame)
      ? observedEvaderMotion.speedEstimateUnitsPerFrame
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
        worldContext.columns,
        worldContext.rows,
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

export function createContinuancePattern(evaderDirection = { x: 0, z: 0 }) {
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

export function updateContinuancePattern(pattern, context) {
  return updatePattern(pattern, context);
}

export function getContinuancePatternOutput(pattern) {
  return getPatternOutput(pattern);
}

export function buildEvaderMotionModel({
  observedEvaderMotion,
  continuancePattern,
  continuance,
} = {}) {
  const resolvedContinuance = getContinuancePatternOutput(
    continuancePattern ?? continuance,
  );
  return {
    position: resolvedContinuance?.position ?? null,
    direction: resolvedContinuance?.direction ?? { x: 0, z: 0 },
    framesSinceObservation: Number(resolvedContinuance?.framesSinceObservation) || 0,
    speedEstimateUnitsPerFrame: Number.isFinite(observedEvaderMotion?.speedEstimateUnitsPerFrame)
      ? observedEvaderMotion.speedEstimateUnitsPerFrame
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
