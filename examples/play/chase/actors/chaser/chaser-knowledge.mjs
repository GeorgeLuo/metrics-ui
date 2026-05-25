import {
  createObservedEvaderMotionMemory,
  createActorLocationMemory,
  getActorPerception,
  updateObservedEvaderMotionMemory,
  updateActorLocationMemory,
} from "./chaser.mjs";
import {
  createMapShapeMemory,
  getMapShapePerception,
  updateMapShapeMemory,
} from "../../decision-model/memory/chaser/map-memory.mjs";
import {
  createChaserSuccessMetricsMemory,
  updateChaserSuccessMetricsMemory,
} from "../../decision-model/memory/chaser/success-memory.mjs";
import {
  getPatternConfidence,
  getPatternPredictionUnit,
} from "../../decision-model/patterns/stateful-pattern.mjs";
import {
  getStrategyConfidence,
  getStrategyOutput,
  isStrategyActionable,
} from "../../decision-model/strategies/stateful-strategy.mjs";
import {
  buildEvaderMotionModel,
  createContinuancePattern,
  getContinuancePatternOutput,
  updateContinuancePattern,
} from "../../decision-model/patterns/evader-motion/continuance.mjs";
import {
  createWallAvoidancePattern,
  getWallAvoidancePatternOutput,
  updateWallAvoidancePattern,
} from "../../decision-model/patterns/evader-motion/wall-avoidance.mjs";
import {
  createDisabledEvaderPredictionPlan,
  createEvaderPredictionStrategy,
  updateEvaderPredictionStrategy,
} from "../../decision-model/strategies/evader-prediction/strategy.mjs";
import { CHASER_PATTERN_IDS } from "../../config/strategy-ids.mjs";

export const CHASER_KNOWLEDGE_ENGINE_IDS = Object.freeze({
  PERCEPTION: "perception",
  EVADER_TRACKING: "evaderTracking",
  WALL_AVOIDANCE_INFERENCE: "wallAvoidanceInference",
  PREDICTION_PLANNING: "predictionPlanning",
});

function createChaserPatternEngines(overrides = {}) {
  return {
    [CHASER_PATTERN_IDS.CONTINUANCE]: asEnabled(
      overrides[CHASER_PATTERN_IDS.CONTINUANCE],
      true,
    ),
    [CHASER_PATTERN_IDS.WALL_AVOIDANCE]: asEnabled(
      overrides[CHASER_PATTERN_IDS.WALL_AVOIDANCE],
      true,
    ),
  };
}

function isPatternEnabled(knowledgeBase, patternId) {
  return knowledgeBase?.patternEngines?.[patternId] !== false;
}

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
  patterns,
} = {}) {
  return {
    evaderExists: true,
    engines: createChaserKnowledgeEngines(engines),
    patternEngines: createChaserPatternEngines(patterns),
    memory: {
      directObservation: {
        evaderLocation: createActorLocationMemory(),
      },
      abstracted: {
        observedEvaderMotion: createObservedEvaderMotionMemory(evaderDirection),
        mapShape: createMapShapeMemory(),
        successMetrics: createChaserSuccessMetricsMemory(),
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

function getRememberedObstacles(knowledgeBase) {
  return knowledgeBase?.memory?.abstracted?.mapShape?.obstacles ?? { walls: [] };
}

export function observeChaserEnvironment(
  knowledgeBase,
  {
    chaserPosition,
    evaderPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
    columns,
    rows,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  if (!knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PERCEPTION]) {
    const disabledEvaderPerception = { visible: false, disabled: true };
    return {
      ...disabledEvaderPerception,
      evader: disabledEvaderPerception,
      map: { visibleWalls: [], disabled: true, observationCount: 0 },
    };
  }

  const evaderPerception = getActorPerception(
    chaserPosition,
    evaderPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
  );
  return {
    ...evaderPerception,
    evader: evaderPerception,
    map: getMapShapePerception(
      chaserPosition,
      chaserLookDirection,
      fieldOfViewAngleRadians,
      obstacles,
      { columns, rows },
    ),
  };
}

export function updateChaserMemoryStage(
  knowledgeBase,
  {
    perception,
    chaserPosition,
    chaserLookDirection,
    frameIndex = null,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  const evaderPerception = perception?.evader ?? perception ?? { visible: false };
  updateActorLocationMemory(
    knowledgeBase.memory.directObservation.evaderLocation,
    evaderPerception,
    chaserPosition,
    chaserLookDirection,
  );
  updateMapShapeMemory(
    knowledgeBase.memory.abstracted.mapShape,
    perception?.map,
    frameIndex,
  );

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING]) {
    updateObservedEvaderMotionMemory(
      knowledgeBase.memory.abstracted.observedEvaderMotion,
      knowledgeBase.memory.directObservation.evaderLocation,
    );
  }

  return knowledgeBase.memory;
}

export function updateChaserSuccessMetricsStage(
  knowledgeBase,
  {
    chaserPosition,
    evaderPosition,
    evaderExists = true,
    frameIndex = null,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  if (!knowledgeBase.memory.abstracted.successMetrics) {
    knowledgeBase.memory.abstracted.successMetrics = createChaserSuccessMetricsMemory();
  }

  return updateChaserSuccessMetricsMemory(
    knowledgeBase.memory.abstracted.successMetrics,
    {
      chaserPosition,
      evaderPosition: evaderExists === false ? null : evaderPosition,
      evaderExists,
      frameIndex,
    },
  );
}

export function updateChaserPatternStage(
  knowledgeBase,
  {
    evaderExists = true,
    columns,
    rows,
    projectionSettings = {},
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }
  knowledgeBase.evaderExists = evaderExists !== false;

  if (!evaderExists) {
    return {
      evaderMotionModel: null,
      wallAvoidancePattern: null,
      patternUnits: {},
    };
  }

  const rememberedObstacles = getRememberedObstacles(knowledgeBase);
  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING]) {
    updateContinuancePattern(
      knowledgeBase.patterns.continuance,
      {
        observedEvaderMotion: knowledgeBase.memory.abstracted.observedEvaderMotion,
        evaderLocationMemory: knowledgeBase.memory.directObservation.evaderLocation,
        worldContext: {
          columns,
          rows,
          obstacles: rememberedObstacles,
        },
        horizonFrames: projectionSettings?.horizonFrames,
        sampleSpacingFrames: projectionSettings?.sampleSpacingFrames,
      },
    );
  }

  const evaderMotionModel = getEvaderMotionModel(knowledgeBase);

  if (
    knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]
    && isPatternEnabled(knowledgeBase, CHASER_PATTERN_IDS.WALL_AVOIDANCE)
  ) {
    updateWallAvoidancePattern(knowledgeBase.patterns.wallAvoidance, {
      estimate: evaderMotionModel,
      evaderVisible: knowledgeBase.memory.directObservation.evaderLocation.visible,
      columns,
      rows,
      obstacles: rememberedObstacles,
      speedUnitsPerFrame: evaderMotionModel?.speedEstimateUnitsPerFrame,
      horizonFrames: projectionSettings?.horizonFrames,
      sampleSpacingFrames: projectionSettings?.sampleSpacingFrames,
    });
  }

  const wallAvoidancePattern = (
    knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.WALL_AVOIDANCE_INFERENCE]
    && isPatternEnabled(knowledgeBase, CHASER_PATTERN_IDS.WALL_AVOIDANCE)
  )
    ? getWallAvoidancePatternOutput(knowledgeBase.patterns.wallAvoidance)
    : null;

  return {
    evaderMotionModel,
    wallAvoidancePattern,
    patternUnits: getChaserPatternUnits(knowledgeBase),
  };
}

export function updateChaserStrategyStage(
  knowledgeBase,
  {
    evaderExists = true,
    columns,
    rows,
    projectionSettings = {},
    evaderMotionModel = null,
    patternUnits = null,
  } = {},
) {
  if (!knowledgeBase) {
    return null;
  }
  knowledgeBase.evaderExists = evaderExists !== false;

  if (!evaderExists) {
    knowledgeBase.strategies.evaderPrediction.output = createDisabledEvaderPredictionPlan(
      "target-absent",
    );
    knowledgeBase.assumedBehavior = {
      evaderMotion: buildAssumedEvaderBehavior(knowledgeBase),
    };
    return knowledgeBase.strategies;
  }

  const resolvedEvaderMotionModel = evaderMotionModel ?? getEvaderMotionModel(knowledgeBase);

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PREDICTION_PLANNING]) {
    const rememberedObstacles = getRememberedObstacles(knowledgeBase);
    updateEvaderPredictionStrategy(knowledgeBase.strategies.evaderPrediction, {
      estimate: resolvedEvaderMotionModel,
      patternUnits: patternUnits ?? {
        ...getChaserPatternUnits(knowledgeBase),
      },
      evaderVisible: knowledgeBase.memory.directObservation.evaderLocation.visible,
      columns,
      rows,
      obstacles: rememberedObstacles,
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
  if (knowledgeBase?.evaderExists === false) {
    return {};
  }

  return {
    ...(isPatternEnabled(knowledgeBase, CHASER_PATTERN_IDS.CONTINUANCE)
      ? {
        continuance: getPatternPredictionUnit(
          knowledgeBase?.patterns?.continuance,
        ),
      }
      : {}),
    ...(isPatternEnabled(knowledgeBase, CHASER_PATTERN_IDS.WALL_AVOIDANCE)
      ? {
        wallAvoidance: getPatternPredictionUnit(
          knowledgeBase?.patterns?.wallAvoidance,
        ),
      }
      : {}),
  };
}

function getChaserPatternStatus(knowledgeBase, patternId, pattern) {
  const predictionUnit = getPatternPredictionUnit(pattern);
  return {
    id: pattern?.id ?? patternId,
    enabled: isPatternEnabled(knowledgeBase, patternId),
    confidence: getPatternConfidence(pattern),
    predictionCount: predictionUnit?.predictionCount ?? 0,
  };
}

export function getChaserKnowledgeSnapshot(knowledgeBase) {
  const evaderPredictionStrategy = knowledgeBase?.strategies?.evaderPrediction ?? null;
  const evaderPrediction = getStrategyOutput(evaderPredictionStrategy);
  const evaderExists = knowledgeBase?.evaderExists !== false;
  const evaderMotionModel = evaderExists ? getEvaderMotionModel(knowledgeBase) : null;

  return {
    engines: { ...knowledgeBase?.engines },
    memory: knowledgeBase?.memory ?? null,
    patterns: {
      evaderMotionModel,
      wallAvoidance: evaderExists ? getWallAvoidancePatternOutput(
        knowledgeBase?.patterns?.wallAvoidance,
      ) : null,
      continuance: evaderExists ? getContinuancePatternOutput(
        knowledgeBase?.patterns?.continuance,
      ) : null,
    },
    patternUnits: getChaserPatternUnits(knowledgeBase),
    strategies: {
      evaderPrediction,
    },
    patternStatus: {
      wallAvoidance: getChaserPatternStatus(
        knowledgeBase,
        CHASER_PATTERN_IDS.WALL_AVOIDANCE,
        knowledgeBase?.patterns?.wallAvoidance,
      ),
      continuance: getChaserPatternStatus(
        knowledgeBase,
        CHASER_PATTERN_IDS.CONTINUANCE,
        knowledgeBase?.patterns?.continuance,
      ),
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
    frameIndex: context.frameIndex,
  });
  const patternStage = updateChaserPatternStage(knowledgeBase, context);
  updateChaserStrategyStage(knowledgeBase, {
    ...context,
    evaderMotionModel: patternStage?.evaderMotionModel,
    patternUnits: patternStage?.patternUnits,
  });

  return knowledgeBase;
}
