import {
  CHASER_CHASE_MOTIVE_STRATEGY_IDS,
  CHASER_KNOWLEDGE_MOTIVE_STRATEGY_IDS,
  CHASER_MOTIVE_IDS,
} from "../../../../../config/strategy-ids.mjs";
import type { MotiveSignal } from "../../../core/interfaces.ts";

type StrategyEnabledResolver = (strategyId: string) => boolean;

/**
 * Tests whether at least one strategy in a motive group can currently run.
 */
function hasEnabledStrategy(
  isStrategyEnabled: StrategyEnabledResolver,
  strategyIds: readonly string[],
): boolean {
  return strategyIds.some((strategyId) => isStrategyEnabled(strategyId));
}

/**
 * Current mutable policy for reducing motive candidates to one motive signal.
 *
 * Visible evader plus an enabled chase strategy selects `chase`; otherwise the
 * chaser falls back to `knowledgeAcquisition`. This is hard selection, but it
 * lives with mixing policies because it reduces competing motive conditions.
 */
export function buildVisibilityPriorityMotiveSignal({
  evaderLocation,
  isStrategyEnabled = () => true,
}: {
  evaderLocation?: Record<string, unknown> | null;
  isStrategyEnabled?: StrategyEnabledResolver;
} = {}): MotiveSignal {
  const evaderInLineOfSight = Boolean(evaderLocation?.visible);
  const chaseStrategyEnabled = hasEnabledStrategy(
    isStrategyEnabled,
    CHASER_CHASE_MOTIVE_STRATEGY_IDS,
  );
  const knowledgeStrategyEnabled = hasEnabledStrategy(
    isStrategyEnabled,
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
    source: "visibility-priority",
    reason,
    confidence: 1,
    evaderInLineOfSight,
  };
}
