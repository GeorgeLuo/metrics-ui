import { CHASER_PATTERN_IDS } from "../../../config/decision-ids.mjs";
import {
  getPatternConfidence,
  getPatternPredictionUnit,
} from "../../../decision-model/patterns/core/stateful-pattern.ts";
import {
  getContinuancePatternOutput,
} from "../../../decision-model/patterns/chaser/evader-motion/continuance/pattern.ts";
import {
  getWallAvoidancePatternOutput,
} from "../../../decision-model/patterns/chaser/evader-motion/wall-avoidance/pattern.ts";
import {
  getEvaderMotionProjection as getEvaderMotionProjectionOutput,
  getEvaderMotionProjectionStatus,
} from "../../../decision-model/projections/chaser/evader-motion/projection.ts";
import { isPatternEnabled } from "./runtime-settings/index.ts";
import {
  getChaserPatternUnits,
  getEvaderMotionModel,
} from "./stage-adapters/patterns.ts";
import { getEvaderMotionProjectionModule } from "./stage-adapters/projections.ts";

function getChaserPatternStatus(
  knowledgeBase: Record<string, any> | null | undefined,
  patternId: string,
  pattern: any,
) {
  const predictionUnit = getPatternPredictionUnit(pattern);
  return {
    id: pattern?.id ?? patternId,
    enabled: isPatternEnabled(knowledgeBase, patternId),
    confidence: getPatternConfidence(pattern),
    predictionCount: predictionUnit?.predictionCount ?? 0,
  };
}

/**
 * Builds the chaser decision-model snapshot consumed by debug UI and tests.
 */
export function getChaserKnowledgeSnapshot(
  knowledgeBase: Record<string, any> | null | undefined,
) {
  const evaderMotionProjection = getEvaderMotionProjectionModule(knowledgeBase);
  const evaderMotion = getEvaderMotionProjectionOutput(evaderMotionProjection);
  const evaderExists = knowledgeBase?.evaderExists !== false;
  const evaderMotionModel = evaderExists ? getEvaderMotionModel(knowledgeBase) : null;
  const evaderMotionStatus = getEvaderMotionProjectionStatus(evaderMotionProjection);

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
    projections: {
      evaderMotion,
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
    projectionStatus: {
      evaderMotion: evaderMotionStatus,
    },
    assumedBehavior: knowledgeBase?.assumedBehavior ?? null,
  };
}
