import {
  EVADER_PREDICTION_CONSENSUS_THRESHOLD,
  EVADER_PREDICTION_KURAMOTO_COUPLING,
  EVADER_PREDICTION_KURAMOTO_ITERATIONS,
} from "../../../../config/constants.mjs";
import {
  blendDirectionTowardWallAvoidance,
  buildEvaderMotionProjectionOscillators,
  getDefaultEvaderMotionPrediction,
  getWallAvoidanceSignal,
} from "./signals.ts";
import { runKuramotoConsensus } from "../../../core/kuramoto.ts";
import type {
  EvaderMotionEstimate,
  EvaderMotionPrediction,
  EvaderMotionPredictionContext,
} from "./interfaces.ts";

export { getDefaultEvaderMotionPrediction } from "./signals.ts";

/**
 * Predicts evader motion using only the wall-avoidance pattern.
 *
 * Pattern tests use this as a single-source predictor so wall-avoidance
 * evidence can be evaluated without current-direction or turn-bias consensus.
 */
export function predictEvaderMotionFromWallAvoidance(
  estimate: EvaderMotionEstimate,
  options: EvaderMotionPredictionContext = {},
): EvaderMotionPrediction {
  const defaultPrediction = getDefaultEvaderMotionPrediction(estimate);
  const wallAvoidanceSignal = getWallAvoidanceSignal(
    buildEvaderMotionProjectionOscillators(estimate, options),
  );
  if (!wallAvoidanceSignal) {
    return {
      ...defaultPrediction,
      strategy: "wall-avoidance-pattern-inactive",
      consensus: 0,
      oscillators: [],
      actionable: false,
    };
  }

  return {
    strategy: "wall-avoidance-intercept",
    direction: blendDirectionTowardWallAvoidance(
      defaultPrediction.direction,
      wallAvoidanceSignal,
    ),
    consensus: wallAvoidanceSignal.confidence,
    oscillators: [wallAvoidanceSignal],
    wallAvoidance: wallAvoidanceSignal,
    actionable: true,
  };
}

/**
 * Mixes motion-prediction signals into one evader direction.
 *
 * The projection stage uses Kuramoto consensus as a directional mixer. If the
 * oscillators fail to agree, wall avoidance can still bias the default
 * continuation direction when that learned pattern is active.
 */
export function predictEvaderMotionWithKuramoto(
  estimate: EvaderMotionEstimate,
  options: EvaderMotionPredictionContext = {},
): EvaderMotionPrediction {
  const defaultPrediction = getDefaultEvaderMotionPrediction(estimate);
  const oscillators = buildEvaderMotionProjectionOscillators(estimate, options);
  const wallAvoidanceSignal = getWallAvoidanceSignal(oscillators);
  if (oscillators.length < 2) {
    return {
      ...defaultPrediction,
      strategy: "default-insufficient-consensus-inputs",
      oscillators,
    };
  }

  const consensus = runKuramotoConsensus(oscillators, {
    coupling: options.coupling ?? EVADER_PREDICTION_KURAMOTO_COUPLING,
    iterations: options.iterations ?? EVADER_PREDICTION_KURAMOTO_ITERATIONS,
    threshold: options.threshold ?? EVADER_PREDICTION_CONSENSUS_THRESHOLD,
  });
  if (
    consensus.order < (options.threshold ?? EVADER_PREDICTION_CONSENSUS_THRESHOLD)
    || (consensus.direction.x === 0 && consensus.direction.z === 0)
  ) {
    if (wallAvoidanceSignal) {
      return {
        strategy: "default-wall-avoidance-bias",
        direction: blendDirectionTowardWallAvoidance(
          defaultPrediction.direction,
          wallAvoidanceSignal,
        ),
        consensus: consensus.order,
        oscillators: consensus.oscillators,
        wallAvoidance: wallAvoidanceSignal,
      };
    }

    return {
      ...defaultPrediction,
      strategy: "default-low-consensus",
      consensus: consensus.order,
      oscillators: consensus.oscillators,
    };
  }

  return {
    strategy: "kuramoto-consensus",
    direction: consensus.direction,
    consensus: consensus.order,
    oscillators: consensus.oscillators,
  };
}
