import { CHASER_PATTERN_IDS } from "../../../../config/decision-ids.mjs";

type ChaserKnowledgeBase = Record<string, any>;
type EngineOverrides = Record<string, boolean | undefined>;

function asEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
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
