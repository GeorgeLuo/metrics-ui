import {
  CHASER_LEGACY_STRATEGY_IDS,
  CHASER_STRATEGY_IDS,
} from "../../../config/strategy-ids.mjs";
import { buildVisibilityPriorityMotiveSignal } from "./mixing/motive/visibility-priority.ts";
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
 * Chooses the chaser's action-stage motive from local visibility and toggles.
 *
 * The mutable motive-selection rule lives under `mixing/motive`; this wrapper
 * adapts the current action-engine settings to that policy's strategy resolver.
 */
export function buildChaserMotiveSignal({
  evaderLocation,
  actionEngines = {},
}: Record<string, any> = {}): MotiveSignal {
  return buildVisibilityPriorityMotiveSignal({
    evaderLocation,
    isStrategyEnabled: (strategyId) => getActionEngineEnabled(actionEngines, strategyId),
  });
}
