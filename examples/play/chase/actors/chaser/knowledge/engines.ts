import { CHASER_PATTERN_IDS } from "../../../config/decision-ids.mjs";

type ChaserKnowledgeBase = Record<string, any>;
type EngineOverrides = Record<string, boolean | undefined>;

export const CHASER_KNOWLEDGE_ENGINE_IDS = Object.freeze({
  EVADER_TRACKING: "evaderTracking",
  WALL_AVOIDANCE_INFERENCE: "wallAvoidanceInference",
  PREDICTION_PLANNING: "predictionPlanning",
});

function asEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Creates the chaser's stage-level engine toggles.
 */
export function createChaserKnowledgeEngines(overrides: EngineOverrides = {}): Record<string, boolean> {
  return {
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

/**
 * Enables or disables one chaser decision-model engine.
 */
export function setChaserKnowledgeEngineEnabled(
  knowledgeBase: ChaserKnowledgeBase | null | undefined,
  engineId: string,
  enabled: unknown,
): void {
  if (!knowledgeBase?.engines || !(engineId in knowledgeBase.engines)) {
    return;
  }
  knowledgeBase.engines[engineId] = Boolean(enabled);
}

/**
 * Creates pattern-specific toggles for the chaser's evader-motion patterns.
 */
export function createChaserPatternEngines(overrides: EngineOverrides = {}): Record<string, boolean> {
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

/**
 * Resolves whether a chaser pattern is enabled for the current decision state.
 */
export function isPatternEnabled(
  knowledgeBase: ChaserKnowledgeBase | null | undefined,
  patternId: string,
): boolean {
  return knowledgeBase?.patternEngines?.[patternId] !== false;
}
