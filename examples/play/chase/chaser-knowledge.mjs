import {
  createObservedTargetMotionMemory,
  createTargetLocationMemory,
  getChaserTargetPerception,
  updateObservedTargetMotionMemory,
  updateTargetLocationMemory,
} from "./chaser.mjs";
import {
  getPatternConfidence,
} from "./patterns.mjs";
import {
  getStrategyConfidence,
  getStrategyState,
  getStrategyOutput,
  isStrategyActionable,
} from "./strategies.mjs";
import {
  buildTargetMotionModel,
  createTargetMotionPattern,
  getTargetMotionHypothesis,
  updateTargetMotionPattern,
} from "./target-motion-pattern.mjs";
import {
  createWallAvoidancePattern,
  getWallAvoidancePatternOutput,
  updateWallAvoidancePattern,
} from "./wall-avoidance-pattern.mjs";
import {
  createDisabledTargetPredictionPlan,
  createTargetPredictionStrategy,
  updateTargetPredictionStrategy,
} from "./target-prediction-strategy.mjs";

export const CHASER_KNOWLEDGE_ENGINE_IDS = Object.freeze({
  PERCEPTION: "perception",
  TARGET_TRACKING: "targetTracking",
  WALL_AVOIDANCE_INFERENCE: "wallAvoidanceInference",
  PREDICTION_PLANNING: "predictionPlanning",
});

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function buildAssumedTargetBehavior(knowledgeBase) {
  const predictionPlan = getStrategyOutput(knowledgeBase?.strategies?.targetPrediction);
  const prediction = predictionPlan?.prediction;
  const wallAvoidancePattern = getWallAvoidancePatternOutput(
    knowledgeBase?.patterns?.wallAvoidance,
  );
  const targetLocation = knowledgeBase?.memory?.targetLocation;
  const observedTargetMotion = knowledgeBase?.memory?.observedTargetMotion;
  return {
    strategy: prediction?.strategy ?? "unknown",
    actionable: predictionPlan?.actionable !== false,
    invalidReason: predictionPlan?.invalidReason ?? null,
    consensus: Number(prediction?.consensus) || 0,
    wallAvoidanceScore: Number(wallAvoidancePattern?.wallAvoidanceScore) || 0,
    observationCount: Number(targetLocation?.observationCount) || 0,
    motionObservationCount: Number(observedTargetMotion?.motionObservationCount) || 0,
    visibleNow: Boolean(targetLocation?.visible),
  };
}

export function createChaserKnowledgeEngines(overrides = {}) {
  return {
    [CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION]: asEnabled(
      overrides[CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION],
      true,
    ),
    [CHASER_KNOWLEDGE_ENGINE_IDS.TARGET_TRACKING]: asEnabled(
      overrides[CHASER_KNOWLEDGE_ENGINE_IDS.TARGET_TRACKING],
      true,
    ),
    [CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]: asEnabled(
      overrides[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE],
      true,
    ),
    [CHASER_KNOWLEDGE_ENGINE_IDS.PREDICTION_PLANNING]: asEnabled(
      overrides[CHASER_KNOWLEDGE_ENGINE_IDS.PREDICTION_PLANNING],
      true,
    ),
  };
}

export function setChaserKnowledgeEngineEnabled(knowledgeBase, engineId, enabled) {
  if (!knowledgeBase?.engines || !(engineId in knowledgeBase.engines)) {
    return;
  }
  knowledgeBase.engines[engineId] = Boolean(enabled);
}

export function createChaserKnowledgeBase({
  targetDirection = { x: 0, z: 0 },
  engines,
} = {}) {
  return {
    engines: createChaserKnowledgeEngines(engines),
    memory: {
      targetLocation: createTargetLocationMemory(),
      observedTargetMotion: createObservedTargetMotionMemory(targetDirection),
    },
    patterns: {
      wallAvoidance: createWallAvoidancePattern(),
      targetMotionHypothesis: createTargetMotionPattern(targetDirection),
    },
    strategies: {
      targetPrediction: createTargetPredictionStrategy(),
    },
    assumedBehavior: {
      targetMotion: {
        strategy: "uninitialized",
        actionable: false,
        invalidReason: "prediction-not-yet-built",
        consensus: 0,
        wallAvoidanceScore: 0,
        observationCount: 0,
        motionObservationCount: 0,
        visibleNow: false,
      },
    },
  };
}

function getTargetMotionModel(knowledgeBase) {
  return buildTargetMotionModel({
    observedTargetMotion: knowledgeBase?.memory?.observedTargetMotion,
    targetMotionPattern: knowledgeBase?.patterns?.targetMotionHypothesis,
  });
}

export function observeChaserEnvironment(
  knowledgeBase,
  {
    chaserPosition,
    targetPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  return knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION]
    ? getChaserTargetPerception(
      chaserPosition,
      targetPosition,
      chaserLookDirection,
      fieldOfViewAngleRadians,
      obstacles,
    )
    : { visible: false, disabled: true };
}

export function updateChaserMemoryStage(
  knowledgeBase,
  {
    perception,
    chaserPosition,
    chaserLookDirection,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  updateTargetLocationMemory(
    knowledgeBase.memory.targetLocation,
    perception,
    chaserPosition,
    chaserLookDirection,
  );

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.TARGET_TRACKING]) {
    updateObservedTargetMotionMemory(
      knowledgeBase.memory.observedTargetMotion,
      knowledgeBase.memory.targetLocation,
    );
  }

  return knowledgeBase.memory;
}

export function updateChaserPatternStage(
  knowledgeBase,
  {
    columns,
    rows,
    obstacles,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.TARGET_TRACKING]) {
    updateTargetMotionPattern(
      knowledgeBase.patterns.targetMotionHypothesis,
      {
        observedTargetMotion: knowledgeBase.memory.observedTargetMotion,
        targetLocationMemory: knowledgeBase.memory.targetLocation,
        worldContext: {
          columns,
          rows,
          obstacles,
        },
      },
    );
  }

  const targetMotionModel = getTargetMotionModel(knowledgeBase);

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]) {
    updateWallAvoidancePattern(knowledgeBase.patterns.wallAvoidance, {
      estimate: targetMotionModel,
      targetVisible: knowledgeBase.memory.targetLocation.visible,
      columns,
      rows,
      obstacles,
    });
  }

  const wallAvoidancePattern = knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]
    ? getWallAvoidancePatternOutput(knowledgeBase.patterns.wallAvoidance)
    : null;

  return {
    targetMotionModel,
    wallAvoidancePattern,
  };
}

export function updateChaserStrategyStage(
  knowledgeBase,
  {
    columns,
    rows,
    obstacles,
    projectionSettings = {},
    targetMotionModel = null,
    wallAvoidancePattern = null,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  const resolvedTargetMotionModel = targetMotionModel ?? getTargetMotionModel(knowledgeBase);
  const resolvedWallAvoidancePattern = wallAvoidancePattern ?? (
    knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]
      ? getWallAvoidancePatternOutput(knowledgeBase.patterns.wallAvoidance)
      : null
  );

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PREDICTION_PLANNING]) {
    updateTargetPredictionStrategy(knowledgeBase.strategies.targetPrediction, {
      estimate: resolvedTargetMotionModel,
      columns,
      rows,
      obstacles,
      wallAvoidanceEvidence: resolvedWallAvoidancePattern,
      speedUnitsPerFrame: resolvedTargetMotionModel?.speedEstimateUnitsPerFrame,
      targetVisible: knowledgeBase.memory.targetLocation.visible,
      horizonFrames: projectionSettings?.horizonFrames,
      sampleSpacingFrames: projectionSettings?.sampleSpacingFrames,
    });
  } else {
    knowledgeBase.strategies.targetPrediction.output = createDisabledTargetPredictionPlan(
      "prediction-engine-disabled",
    );
  }

  knowledgeBase.assumedBehavior = {
    targetMotion: buildAssumedTargetBehavior(knowledgeBase),
  };

  return knowledgeBase.strategies;
}

export function getChaserKnowledgeSnapshot(knowledgeBase) {
  const targetLocation = knowledgeBase?.memory?.targetLocation ?? null;
  const observedTargetMotion = knowledgeBase?.memory?.observedTargetMotion ?? null;
  const targetMotionHypothesis = getTargetMotionHypothesis(
    knowledgeBase?.patterns?.targetMotionHypothesis,
  );
  const wallAvoidancePattern = getWallAvoidancePatternOutput(
    knowledgeBase?.patterns?.wallAvoidance,
  );
  const targetPredictionStrategy = knowledgeBase?.strategies?.targetPrediction ?? null;
  const targetPrediction = getStrategyOutput(targetPredictionStrategy);
  const targetMotionModel = getTargetMotionModel(knowledgeBase);

  return {
    engines: { ...knowledgeBase?.engines },
    memory: knowledgeBase?.memory ?? null,
    patterns: {
      wallAvoidance: wallAvoidancePattern,
      targetMotionHypothesis,
    },
    strategies: {
      targetPrediction,
    },
    patternStatus: {
      wallAvoidance: {
        id: knowledgeBase?.patterns?.wallAvoidance?.id ?? "wallAvoidance",
        confidence: getPatternConfidence(knowledgeBase?.patterns?.wallAvoidance),
      },
      targetMotionHypothesis: {
        id: knowledgeBase?.patterns?.targetMotionHypothesis?.id ?? "targetMotionHypothesis",
        confidence: getPatternConfidence(knowledgeBase?.patterns?.targetMotionHypothesis),
      },
    },
    strategyStatus: {
      targetPrediction: {
        id: targetPredictionStrategy?.id ?? "targetPrediction",
        confidence: getStrategyConfidence(targetPredictionStrategy),
        actionable: isStrategyActionable(targetPredictionStrategy),
      },
    },
    targetLocation,
    observedTargetMotion,
    targetMotionHypothesis,
    targetMotionModel,
    wallAvoidancePattern,
    predictionPlan: targetPrediction ?? null,
    predictionPlanState: getStrategyState(targetPredictionStrategy),
    assumedBehavior: knowledgeBase?.assumedBehavior ?? null,
    perception: targetLocation ?? { visible: false },
    targetEstimate: targetMotionModel,
    wallAvoidanceEvidence: wallAvoidancePattern,
  };
}

export function updateChaserKnowledgeBase(
  knowledgeBase,
  context = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  const perception = observeChaserEnvironment(knowledgeBase, context);
  updateChaserMemoryStage(knowledgeBase, {
    perception,
    chaserPosition: context.chaserPosition,
    chaserLookDirection: context.chaserLookDirection,
  });
  const patternStage = updateChaserPatternStage(knowledgeBase, context);
  updateChaserStrategyStage(knowledgeBase, {
    ...context,
    targetMotionModel: patternStage?.targetMotionModel,
    wallAvoidancePattern: patternStage?.wallAvoidancePattern,
  });

  return knowledgeBase;
}
