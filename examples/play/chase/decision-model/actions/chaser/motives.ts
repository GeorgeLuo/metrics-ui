import { buildVisibilityPriorityMotiveSignal } from "./mixing/motive/visibility-priority.ts";
import type { MotiveSignal } from "../core/interfaces.ts";

type ActionEngines = Record<string, boolean | undefined>;

/**
 * Resolves whether a chaser action proposal is enabled for the current action frame.
 */
export function getActionEngineEnabled(
  actionEngines: ActionEngines = {},
  actionProposalId: string,
): boolean {
  return actionEngines?.[actionProposalId] !== false;
}

/**
 * Chooses the chaser's action-stage motive from local visibility and toggles.
 *
 * The mutable motive-selection rule lives under `mixing/motive`; this wrapper
 * adapts the current action-engine settings to that policy's action proposal resolver.
 */
export function buildChaserMotiveSignal({
  evaderLocation,
  actionEngines = {},
}: Record<string, any> = {}): MotiveSignal {
  return buildVisibilityPriorityMotiveSignal({
    evaderLocation,
    isActionProposalEnabled: (actionProposalId) => getActionEngineEnabled(actionEngines, actionProposalId),
  });
}
