import {
  CHASER_CHASE_MOTIVE_ACTION_PROPOSAL_IDS,
  CHASER_KNOWLEDGE_MOTIVE_ACTION_PROPOSAL_IDS,
  CHASER_MOTIVE_IDS,
} from "../../../../../config/decision-ids.mjs";
import type { MotiveSignal } from "../../../core/interfaces.ts";

type ActionProposalEnabledResolver = (actionProposalId: string) => boolean;

/**
 * Tests whether at least one action proposal in a motive group can currently run.
 */
function hasEnabledActionProposal(
  isActionProposalEnabled: ActionProposalEnabledResolver,
  actionProposalIds: readonly string[],
): boolean {
  return actionProposalIds.some((actionProposalId) => isActionProposalEnabled(actionProposalId));
}

/**
 * Current mutable policy for reducing motive candidates to one motive signal.
 *
 * Visible evader plus an enabled chase action proposal selects `chase`; otherwise the
 * chaser falls back to `knowledgeAcquisition`. This is hard selection, but it
 * lives with mixing policies because it reduces competing motive conditions.
 */
export function buildVisibilityPriorityMotiveSignal({
  evaderLocation,
  isActionProposalEnabled = () => true,
}: {
  evaderLocation?: Record<string, unknown> | null;
  isActionProposalEnabled?: ActionProposalEnabledResolver;
} = {}): MotiveSignal {
  const evaderInLineOfSight = Boolean(evaderLocation?.visible);
  const chaseActionProposalEnabled = hasEnabledActionProposal(
    isActionProposalEnabled,
    CHASER_CHASE_MOTIVE_ACTION_PROPOSAL_IDS,
  );
  const knowledgeActionProposalEnabled = hasEnabledActionProposal(
    isActionProposalEnabled,
    CHASER_KNOWLEDGE_MOTIVE_ACTION_PROPOSAL_IDS,
  );
  const shouldChase = evaderInLineOfSight && chaseActionProposalEnabled;
  const reason = evaderInLineOfSight
    ? chaseActionProposalEnabled
      ? "evader-visible"
      : knowledgeActionProposalEnabled
        ? "evader-visible-chase-disabled"
        : "evader-visible-no-enabled-action-proposal"
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
