import {
  createObservedEvaderMotionMemory,
  createActorLocationMemory,
  getActorPerception,
  updateObservedEvaderMotionMemory,
  updateActorLocationMemory,
} from "./chaser.mjs";
import {
  getPatternConfidence,
  getPatternPredictionUnit,
} from "./patterns.mjs";
import {
  getStrategyConfidence,
  getStrategyOutput,
  isStrategyActionable,
} from "./strategies.mjs";
import {
  buildEvaderMotionModel,
  createContinuancePattern,
  getContinuancePatternOutput,
  updateContinuancePattern,
} from "./continuance-pattern.mjs";
import {
  createWallAvoidancePattern,
  getWallAvoidancePatternOutput,
  updateWallAvoidancePattern,
} from "./wall-avoidance-pattern.mjs";
import {
  createDisabledEvaderPredictionPlan,
  createEvaderPredictionStrategy,
  updateEvaderPredictionStrategy,
} from "./evader-prediction-strategy.mjs";

export const CHASER_KNOWLEDGE_ENGINE_IDS = Object.freeze({
  PERCEPTION: "perception",
  EVADER_TRACKING: "evaderTracking",
  WALL_AVOIDANCE_INFERENCE: "wallAvoidanceInference",
  PREDICTION_PLANNING: "predictionPlanning",
});

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function buildAssumedEvaderBehavior(knowledgeBase) {
  const evaderPredictionPlan = getStrategyOutput(knowledgeBase?.strategies?.evaderPrediction);
  const prediction = evaderPredictionPlan?.prediction;
  const wallAvoidancePattern = getWallAvoidancePatternOutput(
    knowledgeBase?.patterns?.wallAvoidance,
  );
  const evaderLocation = knowledgeBase?.memory?.directObservation?.evaderLocation;
  const observedEvaderMotion = knowledgeBase?.memory?.abstracted?.observedEvaderMotion;
  return {
    strategy: prediction?.strategy ?? "unknown",
    actionable: evaderPredictionPlan?.actionable !== false,
    invalidReason: evaderPredictionPlan?.invalidReason ?? null,
    consensus: Number(prediction?.consensus) || 0,
    wallAvoidanceScore: Number(wallAvoidancePattern?.wallAvoidanceScore) || 0,
    observationCount: Number(evaderLocation?.observationCount) || 0,
    motionObservationCount: Number(observedEvaderMotion?.motionObservationCount) || 0,
    visibleNow: Boolean(evaderLocation?.visible),
  };
}

export function createChaserKnowledgeEngines(overrides = {}) {
  return {
    [CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION]: asEnabled(
      overrides[CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION],
      true,
    ),
    [CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING]: asEnabled(
      overrides[CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING],
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
  evaderDirection = { x: 0, z: 0 },
  engines,
} = {}) {
  return {
    engines: createChaserKnowledgeEngines(engines),
    memory: {
      directObservation: {
        evaderLocation: createActorLocationMemory(),
      },
      abstracted: {
        observedEvaderMotion: createObservedEvaderMotionMemory(evaderDirection),
      },
    },
    patterns: {
      wallAvoidance: createWallAvoidancePattern(),
      continuance: createContinuancePattern(evaderDirection),
    },
    strategies: {
      evaderPrediction: createEvaderPredictionStrategy(),
    },
    assumedBehavior: {
      evaderMotion: {
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

function getEvaderMotionModel(knowledgeBase) {
  return buildEvaderMotionModel({
    observedEvaderMotion: knowledgeBase?.memory?.abstracted?.observedEvaderMotion,
    continuancePattern: knowledgeBase?.patterns?.continuance,
  });
}

export function observeChaserEnvironment(
  knowledgeBase,
  {
    chaserPosition,
    evaderPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  return knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION]
    ? getActorPerception(
      chaserPosition,
      evaderPosition,
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

  updateActorLocationMemory(
    knowledgeBase.memory.directObservation.evaderLocation,
    perception,
    chaserPosition,
    chaserLookDirection,
  );

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING]) {
    updateObservedEvaderMotionMemory(
      knowledgeBase.memory.abstracted.observedEvaderMotion,
      knowledgeBase.memory.directObservation.evaderLocation,
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
    projectionSettings = {},
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING]) {
    updateContinuancePattern(
      knowledgeBase.patterns.continuance,
      {
        observedEvaderMotion: knowledgeBase.memory.abstracted.observedEvaderMotion,
        evaderLocationMemory: knowledgeBase.memory.directObservation.evaderLocation,
        worldContext: {
          columns,
          rows,
          obstacles,
        },
        horizonFrames: projectionSettings?.horizonFrames,
        sampleSpacingFrames: projectionSettings?.sampleSpacingFrames,
      },
    );
  }

  const evaderMotionModel = getEvaderMotionModel(knowledgeBase);

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]) {
    updateWallAvoidancePattern(knowledgeBase.patterns.wallAvoidance, {
      estimate: evaderMotionModel,
      evaderVisible: knowledgeBase.memory.directObservation.evaderLocation.visible,
      columns,
      rows,
      obstacles,
      speedUnitsPerFrame: evaderMotionModel?.speedEstimateUnitsPerFrame,
      horizonFrames: projectionSettings?.horizonFrames,
      sampleSpacingFrames: projectionSettings?.sampleSpacingFrames,
    });
  }

  const wallAvoidancePattern = knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]
    ? getWallAvoidancePatternOutput(knowledgeBase.patterns.wallAvoidance)
    : null;

  return {
    evaderMotionModel,
    wallAvoidancePattern,
    patternUnits: {
      continuance: getPatternPredictionUnit(
        knowledgeBase.patterns.continuance,
      ),
      wallAvoidance: getPatternPredictionUnit(knowledgeBase.patterns.wallAvoidance),
    },
  };
}

export function updateChaserStrategyStage(
  knowledgeBase,
  {
    columns,
    rows,
    obstacles,
    projectionSettings = {},
    evaderMotionModel = null,
    patternUnits = null,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  const resolvedEvaderMotionModel = evaderMotionModel ?? getEvaderMotionModel(knowledgeBase);

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PREDICTION_PLANNING]) {
    updateEvaderPredictionStrategy(knowledgeBase.strategies.evaderPrediction, {
      estimate: resolvedEvaderMotionModel,
      patternUnits: patternUnits ?? {
        continuance: getPatternPredictionUnit(
          knowledgeBase.patterns.continuance,
        ),
        wallAvoidance: getPatternPredictionUnit(knowledgeBase.patterns.wallAvoidance),
      },
      evaderVisible: knowledgeBase.memory.directObservation.evaderLocation.visible,
      columns,
      rows,
      obstacles,
      horizonFrames: projectionSettings?.horizonFrames,
      sampleSpacingFrames: projectionSettings?.sampleSpacingFrames,
    });
  } else {
    knowledgeBase.strategies.evaderPrediction.output = createDisabledEvaderPredictionPlan(
      "prediction-engine-disabled",
    );
  }

  knowledgeBase.assumedBehavior = {
    evaderMotion: buildAssumedEvaderBehavior(knowledgeBase),
  };

  return knowledgeBase.strategies;
}

function getChaserPatternUnits(knowledgeBase) {
  return {
    continuance: getPatternPredictionUnit(
      knowledgeBase?.patterns?.continuance,
    ),
    wallAvoidance: getPatternPredictionUnit(
      knowledgeBase?.patterns?.wallAvoidance,
    ),
  };
}

export function getChaserKnowledgeSnapshot(knowledgeBase) {
  const evaderPredictionStrategy = knowledgeBase?.strategies?.evaderPrediction ?? null;
  const evaderPrediction = getStrategyOutput(evaderPredictionStrategy);
  const evaderMotionModel = getEvaderMotionModel(knowledgeBase);

  return {
    engines: { ...knowledgeBase?.engines },
    memory: knowledgeBase?.memory ?? null,
    patterns: {
      evaderMotionModel,
      wallAvoidance: getWallAvoidancePatternOutput(
        knowledgeBase?.patterns?.wallAvoidance,
      ),
      continuance: getContinuancePatternOutput(
        knowledgeBase?.patterns?.continuance,
      ),
    },
    patternUnits: getChaserPatternUnits(knowledgeBase),
    strategies: {
      evaderPrediction,
    },
    patternStatus: {
      wallAvoidance: {
        id: knowledgeBase?.patterns?.wallAvoidance?.id ?? "wallAvoidance",
        confidence: getPatternConfidence(knowledgeBase?.patterns?.wallAvoidance),
        predictionCount: getPatternPredictionUnit(
          knowledgeBase?.patterns?.wallAvoidance,
        )?.predictionCount ?? 0,
      },
      continuance: {
        id: knowledgeBase?.patterns?.continuance?.id ?? "continuance",
        confidence: getPatternConfidence(knowledgeBase?.patterns?.continuance),
        predictionCount: getPatternPredictionUnit(
          knowledgeBase?.patterns?.continuance,
        )?.predictionCount ?? 0,
      },
    },
    strategyStatus: {
      evaderPrediction: {
        id: evaderPredictionStrategy?.id ?? "evaderPrediction",
        confidence: getStrategyConfidence(evaderPredictionStrategy),
        actionable: isStrategyActionable(evaderPredictionStrategy),
      },
    },
    assumedBehavior: knowledgeBase?.assumedBehavior ?? null,
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
    evaderMotionModel: patternStage?.evaderMotionModel,
    patternUnits: patternStage?.patternUnits,
  });

  return knowledgeBase;
}
