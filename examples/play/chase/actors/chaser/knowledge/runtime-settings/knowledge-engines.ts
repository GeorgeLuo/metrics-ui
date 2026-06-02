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
