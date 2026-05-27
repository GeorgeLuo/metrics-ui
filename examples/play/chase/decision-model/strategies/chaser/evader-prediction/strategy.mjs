import {
  buildEvaderPredictionPlan,
  createEvaderPredictionPlanState,
} from "./plan.mjs";
import {
  createStatefulStrategy,
  getStrategyOutput,
  getStrategyState,
  updateStrategy,
} from "../../core/stateful-strategy.mjs";

export const EVADER_PREDICTION_STRATEGY_ID = "evaderPrediction";

export function createDisabledEvaderPredictionPlan(invalidReason) {
  return {
    actionable: false,
    invalidReason,
    prediction: {
      strategy: invalidReason,
      direction: { x: 0, z: 0 },
      consensus: 0,
      oscillators: [],
    },
    path: [],
    sampleCount: 0,
    sampleSpacingFrames: 0,
    horizonFrames: 0,
    validationErrorDistance: 0,
  };
}

export function createEvaderPredictionStrategy() {
  return createStatefulStrategy({
    id: EVADER_PREDICTION_STRATEGY_ID,
    createState: createEvaderPredictionPlanState,
    createOutput: () => createDisabledEvaderPredictionPlan("prediction-not-yet-built"),
    deriveOutput: (planState, context = {}) => buildEvaderPredictionPlan({
      estimate: context.estimate,
      patternUnits: context.patternUnits,
      evaderVisible: context.evaderVisible,
      planState,
      columns: context.columns,
      rows: context.rows,
      obstacles: context.obstacles,
      horizonFrames: context.horizonFrames,
      sampleSpacingFrames: context.sampleSpacingFrames,
    }),
    getConfidence: (plan) => Number(plan?.prediction?.consensus) || 0,
    isActionable: (plan) => plan?.actionable !== false,
  });
}

export function updateEvaderPredictionStrategy(strategy, context) {
  return updateStrategy(strategy, context);
}

export function getEvaderPredictionPlan(strategy) {
  return getStrategyOutput(strategy);
}

export function getEvaderPredictionStrategyState(strategy) {
  return getStrategyState(strategy);
}
