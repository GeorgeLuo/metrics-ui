import { CHASER_PATTERN_IDS } from "../../../../config/decision-ids.mjs";
import {
  getPatternPredictionUnit,
} from "../../../../decision-model/patterns/core/stateful-pattern.ts";
import {
  buildEvaderMotionModel,
  updateContinuancePattern,
} from "../../../../decision-model/patterns/chaser/evader-motion/continuance/pattern.ts";
import {
  getWallAvoidancePatternOutput,
  updateWallAvoidancePattern,
} from "../../../../decision-model/patterns/chaser/evader-motion/wall-avoidance/pattern.ts";
import {
  CHASER_KNOWLEDGE_ENGINE_IDS,
  isPatternEnabled,
} from "../engines.ts";
import { getRememberedObstacles } from "../memory-selectors.ts";

type ChaserPatternStageContext = {
  evaderExists?: boolean;
  columns?: number;
  rows?: number;
  projectionSettings?: Record<string, any>;
};

/**
 * Builds the latest evader-motion model from observed-motion memory.
 */
export function getEvaderMotionModel(knowledgeBase: Record<string, any> | null | undefined) {
  return buildEvaderMotionModel({
    observedEvaderMotion: knowledgeBase?.memory?.abstracted?.observedEvaderMotion,
    continuancePattern: knowledgeBase?.patterns?.continuance,
  });
}

/**
 * Returns active chaser pattern units for downstream projection planning.
 */
export function getChaserPatternUnits(knowledgeBase: Record<string, any> | null | undefined) {
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

/**
 * Updates the chaser's evader-motion pattern modules for one IDAE cycle.
 */
export function updateChaserPatternStage(
  knowledgeBase: Record<string, any> | null | undefined,
  {
    evaderExists = true,
    columns,
    rows,
    projectionSettings = {},
  }: ChaserPatternStageContext = {},
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
