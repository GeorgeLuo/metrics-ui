import {
  CHASER_CHASE_MOTIVE_STRATEGY_IDS,
  CHASER_KNOWLEDGE_MOTIVE_STRATEGY_IDS,
  CHASER_LEGACY_STRATEGY_IDS,
  CHASER_MOTIVE_IDS,
  CHASER_STRATEGY_IDS,
} from "../../../config/strategy-ids.mjs";
import type { MotiveSignal } from "../core/interfaces.ts";

type ActionEngines = Record<string, boolean | undefined>;

/**
 * Resolves whether a chaser strategy is enabled for the current action frame.
 *
 * This keeps legacy `search` toggles mapped to the renamed `spin` strategy so
 * old scenario settings continue to drive the same behavior.
 */
export function getActionEngineEnabled(
  actionEngines: ActionEngines = {},
  strategyId: string,
): boolean {
  if (strategyId === CHASER_STRATEGY_IDS.SPIN
    && actionEngines?.[strategyId] === undefined
    && actionEngines?.[CHASER_LEGACY_STRATEGY_IDS.SEARCH] !== undefined) {
    return actionEngines[CHASER_LEGACY_STRATEGY_IDS.SEARCH] !== false;
  }
  return actionEngines?.[strategyId] !== false;
}

/**
 * Tests whether at least one strategy in a motive group can currently run.
 */
function hasEnabledStrategy(actionEngines: ActionEngines, strategyIds: readonly string[]): boolean {
  return strategyIds.some((strategyId) => getActionEngineEnabled(actionEngines, strategyId));
}

/**
 * Chooses the chaser's action-stage motive from local visibility and toggles.
 *
 * The current policy is intentionally simple: visible evader plus an enabled
 * chase strategy selects `chase`; otherwise the chaser acquires map knowledge.
 */
export function buildChaserMotiveSignal({
  evaderLocation,
  actionEngines = {},
}: Record<string, any> = {}): MotiveSignal {
  const evaderInLineOfSight = Boolean(evaderLocation?.visible);
  const chaseStrategyEnabled = hasEnabledStrategy(
    actionEngines,
    CHASER_CHASE_MOTIVE_STRATEGY_IDS,
  );
  const knowledgeStrategyEnabled = hasEnabledStrategy(
    actionEngines,
    CHASER_KNOWLEDGE_MOTIVE_STRATEGY_IDS,
  );
  const shouldChase = evaderInLineOfSight && chaseStrategyEnabled;
  const reason = evaderInLineOfSight
    ? chaseStrategyEnabled
      ? "evader-visible"
      : knowledgeStrategyEnabled
        ? "evader-visible-chase-disabled"
        : "evader-visible-no-enabled-strategy"
    : "evader-not-visible";

  return {
    id: shouldChase
      ? CHASER_MOTIVE_IDS.CHASE
      : CHASER_MOTIVE_IDS.KNOWLEDGE_ACQUISITION,
    source: "line-of-sight-rule",
    reason,
    confidence: 1,
    evaderInLineOfSight,
  };
}
