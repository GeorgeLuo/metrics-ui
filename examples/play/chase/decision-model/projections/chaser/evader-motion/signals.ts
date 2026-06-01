import {
  EVADER_PREDICTION_WALL_AVOIDANCE_MAX_BLEND,
  EVADER_PREDICTION_WALL_AVOIDANCE_WEIGHT,
  WALL_AVOIDANCE_DETECTION_MIN_APPROACHES,
} from "../../../../config/constants.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../../core/math.ts";
import {
  clampConfidence,
  createPredictionSignal,
  getSampleConfidence,
} from "../../core/confidence.ts";
import { createPatternConfidence } from "../../../patterns/core/prediction-units.ts";
import { getWorldWallPressure } from "../../../../world/world.mjs";
import type { ProjectionPredictionSignal } from "../../core/interfaces.ts";
import type {
  EvaderMotionEstimate,
  EvaderMotionPrediction,
  EvaderMotionPredictionContext,
  WallAvoidanceEvidence,
} from "./interfaces.ts";

const CURRENT_DIRECTION_WEIGHT = 1.2;
const LAST_OBSERVED_DIRECTION_WEIGHT = 0.8;
const PREVIOUS_OBSERVED_DIRECTION_WEIGHT = 0.45;
const RECENT_TURN_BIAS_WEIGHT = 0.55;
const CURRENT_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS = 3;
const LAST_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS = 2;
const TURN_BIAS_FULL_CONFIDENCE_OBSERVATIONS = 4;
const MEANINGFUL_TURN_RATE_RADIANS = Math.PI / 5;

/**
 * Builds the baseline projection: continue moving in the latest estimated
 * direction.
 */
export function getDefaultEvaderMotionPrediction(
  estimate: EvaderMotionEstimate | null | undefined,
): EvaderMotionPrediction {
  return {
    strategy: "continue-current-direction",
    direction: normalizeVector(estimate?.direction?.x ?? 0, estimate?.direction?.z ?? 0),
    consensus: 1,
  };
}

/**
 * Converts wall-avoidance evidence into projection confidence.
 */
function getWallAvoidanceConfidence(
  wallAvoidanceEvidence: WallAvoidanceEvidence | null | undefined,
): number {
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

/**
 * Creates a direction signal when current world pressure and learned evidence
 * both support wall avoidance.
 */
export function getWallAvoidancePredictionSignal(
  estimate: EvaderMotionEstimate | null | undefined,
  {
    columns,
    rows,
    obstacles,
    wallAvoidanceEvidence,
  }: EvaderMotionPredictionContext = {},
): ProjectionPredictionSignal | null {
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

/**
 * Builds the oscillator set that the evader-motion projection can mix.
 *
 * Each oscillator is one directional hypothesis about where the evader will
 * move next: current direction, prior observations, turn bias, and wall
 * avoidance when evidence exists.
 */
export function buildEvaderMotionProjectionOscillators(
  estimate: EvaderMotionEstimate | null | undefined,
  context: EvaderMotionPredictionContext = {},
): ProjectionPredictionSignal[] {
  const defaultPrediction = getDefaultEvaderMotionPrediction(estimate);
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
  const oscillators: ProjectionPredictionSignal[] = currentDirectionSignal ? [currentDirectionSignal] : [];

  if (estimate?.lastObservedDirection) {
    const signal = createPredictionSignal({
      id: "last-observed-direction",
      direction: estimate.lastObservedDirection,
      baseWeight: LAST_OBSERVED_DIRECTION_WEIGHT,
      confidence: getSampleConfidence(
        estimate?.observationCount ?? 0,
        LAST_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS,
      ),
    });
    if (signal) {
      oscillators.push(signal);
    }
  }

  if (estimate?.previousObservedDirection) {
    const signal = createPredictionSignal({
      id: "previous-observed-direction",
      direction: estimate.previousObservedDirection,
      baseWeight: PREVIOUS_OBSERVED_DIRECTION_WEIGHT,
      confidence: getSampleConfidence(
        estimate?.motionObservationCount ?? 0,
        CURRENT_DIRECTION_FULL_CONFIDENCE_OBSERVATIONS,
      ),
    });
    if (signal) {
      oscillators.push(signal);
    }
  }

  const turnBias = Number(estimate?.observedTurnRadiansPerFrame);
  if (Number.isFinite(turnBias) && Math.abs(turnBias) > 0.001) {
    const signal = createPredictionSignal({
      id: "recent-turn-bias",
      direction: angleToVector(normalizeAngleDelta(currentPhase + turnBias)),
      baseWeight: RECENT_TURN_BIAS_WEIGHT,
      confidence: getSampleConfidence(
        estimate?.motionObservationCount ?? 0,
        TURN_BIAS_FULL_CONFIDENCE_OBSERVATIONS,
      ) * clampConfidence(Math.abs(turnBias) / MEANINGFUL_TURN_RATE_RADIANS),
    });
    if (signal) {
      oscillators.push(signal);
    }
  }

  const wallAvoidanceSignal = getWallAvoidancePredictionSignal(estimate, context);
  if (wallAvoidanceSignal) {
    oscillators.push(wallAvoidanceSignal);
  }

  return oscillators;
}

/**
 * Finds the wall-avoidance oscillator in a mixed prediction result.
 */
export function getWallAvoidanceSignal(
  oscillators: ProjectionPredictionSignal[] | null | undefined,
): ProjectionPredictionSignal | null {
  return oscillators?.find((oscillator) => oscillator.id === "wall-avoidance") ?? null;
}

/**
 * Softly bends a base direction toward the wall-avoidance signal.
 */
export function blendDirectionTowardWallAvoidance(
  baseDirection: EvaderMotionPrediction["direction"] | null | undefined,
  wallAvoidanceSignal: ProjectionPredictionSignal | null | undefined,
): EvaderMotionPrediction["direction"] {
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
