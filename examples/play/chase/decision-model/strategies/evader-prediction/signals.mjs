import {
  EVADER_PREDICTION_WALL_AVOIDANCE_MAX_BLEND,
  EVADER_PREDICTION_WALL_AVOIDANCE_WEIGHT,
  WALL_AVOIDANCE_DETECTION_MIN_APPROACHES,
} from "../../../config/constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../core/math.ts";
import {
  clampConfidence,
  createPredictionSignal,
  getSampleConfidence,
} from "../confidence.mjs";
import { createPatternConfidence } from "../../patterns/prediction-units.mjs";
import { getWorldWallPressure } from "../../../world/world.mjs";

const CURRENT_DIRECTION_WEIGHT = 1.2;
const LAST_OBSERVED_DIRECTION_WEIGHT = 0.8;
const PREVIOUS_OBSERVED_DIRECTION_WEIGHT = 0.45;
const RECENT_TURN_BIAS_WEIGHT = 0.55;
const CURRENT_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS = 3;
const LAST_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS = 2;
const TURN_BIAS_FULL_CONFIDENCE_OBSERVATIONS = 4;
const MEANINGFUL_TURN_RATE_RADIANS = Math.PI / 5;

export function getDefaultEvaderPrediction(estimate) {
  return {
    strategy: "continue-current-direction",
    direction: normalizeVector(estimate?.direction?.x ?? 0, estimate?.direction?.z ?? 0),
    consensus: 1,
  };
}

function getWallAvoidanceConfidence(wallAvoidanceEvidence) {
  const possibleEvents = Number(wallAvoidanceEvidence?.approachEpisodeCount);
  if (
    !Number.isFinite(possibleEvents)
    || possibleEvents < WALL_AVOIDANCE_DETECTION_MIN_APPROACHES
  ) {
    return 0;
  }

  return createPatternConfidence({
    confirmedCount: wallAvoidanceEvidence?.avoidedApproachCount,
    opportunityCount: possibleEvents,
  }).confidence;
}

export function getWallAvoidancePredictionSignal(
  estimate,
  {
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence,
  } = {},
) {
  if (!estimate?.position || !Number.isFinite(columns) || !Number.isFinite(rows)) {
    return null;
  }

  const wallPressure = getWorldWallPressure(estimate.position, columns, rows, obstacles);
  const confidence = getWallAvoidanceConfidence(wallAvoidanceEvidence);
  if (!wallPressure.active || confidence <= 0) {
    return null;
  }

  return createPredictionSignal({
    id: "wall-avoidance",
    direction: wallPressure.direction,
    confidence,
    baseWeight: EVADER_PREDICTION_WALL_AVOIDANCE_WEIGHT,
    metadata: {
      nearestWall: wallPressure.nearestWall,
      nearestDistance: wallPressure.nearestDistance,
      possibleEvents: wallAvoidanceEvidence?.approachEpisodeCount ?? 0,
      confirmingEvents: wallAvoidanceEvidence?.avoidedApproachCount ?? 0,
    },
  });
}

export function buildEvaderPredictionOscillators(estimate, context = {}) {
  const defaultPrediction = getDefaultEvaderPrediction(estimate);
  const currentDirection = defaultPrediction.direction;
  if (currentDirection.x === 0 && currentDirection.z === 0) {
    return [];
  }

  const currentPhase = vectorToAngle(currentDirection);
  const currentDirectionSignal = createPredictionSignal({
    id: "current-direction",
    direction: currentDirection,
    baseWeight: CURRENT_DIRECTION_WEIGHT,
    confidence: 0.45 + 0.55 * getSampleConfidence(
      estimate?.motionObservationCount ?? 0,
      CURRENT_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS,
    ),
  });
  const oscillators = currentDirectionSignal ? [currentDirectionSignal] : [];

  if (estimate?.lastObservedDirection) {
    oscillators.push(createPredictionSignal({
      id: "last-observed-direction",
      direction: estimate.lastObservedDirection,
      baseWeight: LAST_OBSERVED_DIRECTION_WEIGHT,
      confidence: getSampleConfidence(
        estimate?.observationCount ?? 0,
        LAST_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS,
      ),
    }));
  }

  if (estimate?.previousObservedDirection) {
    oscillators.push(createPredictionSignal({
      id: "previous-observed-direction",
      direction: estimate.previousObservedDirection,
      baseWeight: PREVIOUS_OBSERVED_DIRECTION_WEIGHT,
      confidence: getSampleConfidence(
        estimate?.motionObservationCount ?? 0,
        CURRENT_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS,
      ),
    }));
  }

  const turnBias = Number(estimate?.observedTurnRadiansPerFrame);
  if (Number.isFinite(turnBias) && Math.abs(turnBias) > 0.001) {
    oscillators.push(createPredictionSignal({
      id: "recent-turn-bias",
      direction: angleToVector(normalizeAngleDelta(currentPhase + turnBias)),
      baseWeight: RECENT_TURN_BIAS_WEIGHT,
      confidence: getSampleConfidence(
        estimate?.motionObservationCount ?? 0,
        TURN_BIAS_FULL_CONFIDENCE_OBSERVATIONS,
      ) * clampConfidence(Math.abs(turnBias) / MEANINGFUL_TURN_RATE_RADIANS),
    }));
  }

  const wallAvoidanceSignal = getWallAvoidancePredictionSignal(estimate, context);
  if (wallAvoidanceSignal) {
    oscillators.push(wallAvoidanceSignal);
  }

  return oscillators.filter(Boolean);
}

export function getWallAvoidanceSignal(oscillators) {
  return oscillators.find((oscillator) => oscillator.id === "wall-avoidance") ?? null;
}

export function blendDirectionTowardWallAvoidance(baseDirection, wallAvoidanceSignal) {
  if (!wallAvoidanceSignal?.direction) {
    return normalizeVector(baseDirection?.x ?? 0, baseDirection?.z ?? 0);
  }

  const base = normalizeVector(baseDirection?.x ?? 0, baseDirection?.z ?? 0);
  const wallAvoidanceDirection = normalizeVector(
    wallAvoidanceSignal.direction.x,
    wallAvoidanceSignal.direction.z,
  );
  if (
    (base.x === 0 && base.z === 0)
    || (wallAvoidanceDirection.x === 0 && wallAvoidanceDirection.z === 0)
  ) {
    return base;
  }

  const blend = clampConfidence(wallAvoidanceSignal.confidence)
    * EVADER_PREDICTION_WALL_AVOIDANCE_MAX_BLEND;
  const blendedAngle = vectorToAngle(base)
    + normalizeAngleDelta(
      vectorToAngle(wallAvoidanceDirection) - vectorToAngle(base),
    ) * blend;
  return angleToVector(blendedAngle);
}
