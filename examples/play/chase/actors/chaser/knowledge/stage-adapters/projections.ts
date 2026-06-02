import {
  createDisabledEvaderMotionProjection,
  createEvaderMotionProjection,
  getEvaderMotionProjection as getEvaderMotionProjectionOutput,
  updateEvaderMotionProjection,
} from "../../../../decision-model/projections/chaser/evader-motion/projection.ts";
import {
  getWallAvoidancePatternOutput,
} from "../../../../decision-model/patterns/chaser/evader-motion/wall-avoidance/pattern.ts";
import { CHASER_KNOWLEDGE_ENGINE_IDS } from "../runtime-settings/index.ts";
import { getRememberedObstacles } from "../memory-selectors.ts";
import {
  getChaserPatternUnits,
  getEvaderMotionModel,
} from "./patterns.ts";

type ChaserProjectionStageContext = {
  evaderExists?: boolean;
  columns?: number;
  rows?: number;
  projectionSettings?: Record<string, any>;
  evaderMotionModel?: any;
  patternUnits?: Record<string, any> | null;
};

/**
 * Returns the stateful evader-motion projection module from chaser state.
 */
export function getEvaderMotionProjectionModule(
  knowledgeBase: Record<string, any> | null | undefined,
) {
  return knowledgeBase?.projections?.evaderMotion ?? null;
}

function ensureEvaderMotionProjectionModule(
  knowledgeBase: Record<string, any> | null | undefined,
) {
  if (!knowledgeBase) {
    return null;
  }
  if (!knowledgeBase.projections || typeof knowledgeBase.projections !== "object") {
    knowledgeBase.projections = {};
  }
  if (!knowledgeBase.projections.evaderMotion) {
    knowledgeBase.projections.evaderMotion = createEvaderMotionProjection();
  }
  return knowledgeBase.projections.evaderMotion;
}

function buildAssumedEvaderBehavior(knowledgeBase: Record<string, any> | null | undefined) {
  const evaderMotionProjection = getEvaderMotionProjectionOutput(
    getEvaderMotionProjectionModule(knowledgeBase),
  );
  const prediction = evaderMotionProjection?.prediction;
  const wallAvoidancePattern = getWallAvoidancePatternOutput(
    knowledgeBase?.patterns?.wallAvoidance,
  );
  const evaderLocation = knowledgeBase?.memory?.directObservation?.evaderLocation;
  const observedEvaderMotion = knowledgeBase?.memory?.abstracted?.observedEvaderMotion;
  return {
    strategy: prediction?.strategy ?? "unknown",
    actionable: evaderMotionProjection?.actionable !== false,
    invalidReason: evaderMotionProjection?.invalidReason ?? null,
    consensus: Number(prediction?.consensus) || 0,
    wallAvoidanceScore: Number(wallAvoidancePattern?.wallAvoidanceScore) || 0,
    observationCount: Number(evaderLocation?.observationCount) || 0,
    motionObservationCount: Number(observedEvaderMotion?.motionObservationCount) || 0,
    visibleNow: Boolean(evaderLocation?.visible),
  };
}

/**
 * Updates chaser projection modules for one IDAE cycle.
 */
export function updateChaserProjectionStage(
  knowledgeBase: Record<string, any> | null | undefined,
  {
    evaderExists = true,
    columns,
    rows,
    projectionSettings = {},
    evaderMotionModel = null,
    patternUnits = null,
  }: ChaserProjectionStageContext = {},
) {
  if (!knowledgeBase) {
    return null;
  }
  knowledgeBase.evaderExists = evaderExists !== false;
  const evaderMotionProjection = ensureEvaderMotionProjectionModule(knowledgeBase);

  if (!evaderExists) {
    evaderMotionProjection.output = createDisabledEvaderMotionProjection(
      "target-absent",
    );
    knowledgeBase.assumedBehavior = {
      evaderMotion: buildAssumedEvaderBehavior(knowledgeBase),
    };
    return knowledgeBase.projections;
  }

  const resolvedEvaderMotionModel = evaderMotionModel ?? getEvaderMotionModel(knowledgeBase);

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.PREDICTION_PLANNING]) {
    const rememberedObstacles = getRememberedObstacles(knowledgeBase);
    updateEvaderMotionProjection(evaderMotionProjection, {
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
    evaderMotionProjection.output = createDisabledEvaderMotionProjection(
      "prediction-engine-disabled",
    );
  }

  knowledgeBase.assumedBehavior = {
    evaderMotion: buildAssumedEvaderBehavior(knowledgeBase),
  };

  return knowledgeBase.projections;
}
