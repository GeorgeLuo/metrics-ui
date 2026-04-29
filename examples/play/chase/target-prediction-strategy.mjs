import {
  buildTargetPredictionPlan,
  createTargetPredictionPlanState,
} from "./target-prediction-plan.mjs";
import {
  createStatefulStrategy,
  getStrategyOutput,
  getStrategyState,
  updateStrategy,
} from "./strategies.mjs";

export const TARGET_PREDICTION_STRATEGY_ID = "targetPrediction";

export function createDisabledTargetPredictionPlan(invalidReason) {
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

export function createTargetPredictionStrategy() {
  return createStatefulStrategy({
    id: TARGET_PREDICTION_STRATEGY_ID,
    createState: createTargetPredictionPlanState,
    createOutput: () => createDisabledTargetPredictionPlan("prediction-not-yet-built"),
    deriveOutput: (planState, context = {}) => buildTargetPredictionPlan({
      estimate: context.estimate,
      columns: context.columns,
      rows: context.rows,
      obstacles: context.obstacles,
      wallAvoidanceEvidence: context.wallAvoidanceEvidence,
      speedUnitsPerFrame: context.speedUnitsPerFrame,
      targetVisible: context.targetVisible,
      planState,
      horizonFrames: context.horizonFrames,
      sampleSpacingFrames: context.sampleSpacingFrames,
    }),
    getConfidence: (plan) => Number(plan?.prediction?.consensus) || 0,
    isActionable: (plan) => plan?.actionable !== false,
  });
}

export function updateTargetPredictionStrategy(strategy, context) {
  return updateStrategy(strategy, context);
}

export function getTargetPredictionPlan(strategy) {
  return getStrategyOutput(strategy);
}

export function getTargetPredictionStrategyState(strategy) {
  return getStrategyState(strategy);
}
