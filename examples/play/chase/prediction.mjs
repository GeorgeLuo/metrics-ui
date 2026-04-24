import {
  TARGET_PREDICTION_CONSENSUS_THRESHOLD,
  TARGET_PREDICTION_KURAMOTO_COUPLING,
  TARGET_PREDICTION_KURAMOTO_ITERATIONS,
} from "./constants.mjs";
import {
  blendDirectionTowardWallAvoidance,
  buildTargetPredictionOscillators,
  getDefaultTargetPrediction,
  getWallAvoidanceSignal,
} from "./prediction-strategies.mjs";
import { runKuramotoConsensus } from "./kuramoto.mjs";

export { getDefaultTargetPrediction } from "./prediction-strategies.mjs";

export function predictTargetMotionWithKuramoto(estimate, options = {}) {
  const defaultPrediction = getDefaultTargetPrediction(estimate);
  const oscillators = buildTargetPredictionOscillators(estimate, options);
  const wallAvoidanceSignal = getWallAvoidanceSignal(oscillators);
  if (oscillators.length < 2) {
    return {
      ...defaultPrediction,
      strategy: "default-insufficient-consensus-inputs",
      oscillators,
    };
  }

  const consensus = runKuramotoConsensus(oscillators, {
    coupling: options.coupling ?? TARGET_PREDICTION_KURAMOTO_COUPLING,
    iterations: options.iterations ?? TARGET_PREDICTION_KURAMOTO_ITERATIONS,
    threshold: options.threshold ?? TARGET_PREDICTION_CONSENSUS_THRESHOLD,
  });
  if (
    consensus.order < (options.threshold ?? TARGET_PREDICTION_CONSENSUS_THRESHOLD)
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
