import {
  EVADER_PREDICTION_CONSENSUS_THRESHOLD,
  EVADER_PREDICTION_KURAMOTO_COUPLING,
  EVADER_PREDICTION_KURAMOTO_ITERATIONS,
} from "../config/constants.mjs";
import {
  blendDirectionTowardWallAvoidance,
  buildEvaderPredictionOscillators,
  getDefaultEvaderPrediction,
  getWallAvoidanceSignal,
} from "./prediction-strategies.mjs";
import { runKuramotoConsensus } from "../decision-model/kuramoto.mjs";

export { getDefaultEvaderPrediction } from "./prediction-strategies.mjs";

export function predictEvaderMotionFromWallAvoidance(estimate, options = {}) {
  const defaultPrediction = getDefaultEvaderPrediction(estimate);
  const wallAvoidanceSignal = getWallAvoidanceSignal(
    buildEvaderPredictionOscillators(estimate, options),
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

export function predictEvaderMotionWithKuramoto(estimate, options = {}) {
  const defaultPrediction = getDefaultEvaderPrediction(estimate);
  const oscillators = buildEvaderPredictionOscillators(estimate, options);
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
