import { constrainDirectionToBounds } from "../../../actors/evader/evader.mjs";
import {
  getEvaderPolicyBoolean,
} from "./policy.mjs";
import { normalizeVector } from "../../core/math.ts";
import {
  createStatefulActionProposal,
  getActionProposalOutput,
  updateActionProposal,
} from "../core/stateful-action-proposal.mjs";

export const EVADER_VISIBLE_CHASER_EVADE_PROPOSAL_ID = "visible-chaser-evade";

function createEvadeVisibleChaserState() {
  return {
    lastUpdatedFrameIndex: null,
    lastExecutionFrameIndex: null,
    visibleLastFrame: false,
    actionableLastFrame: false,
    executedLastFrame: false,
    visibleFrameCount: 0,
    actionableFrameCount: 0,
    executedFrameCount: 0,
    visibilityEpisodeCount: 0,
    actionableEpisodeCount: 0,
    executionEpisodeCount: 0,
    lastSeenDistance: null,
    lastSeenBearingRadians: null,
  };
}

export function createEvaderVisibleChaserEvadeProposal() {
  return createStatefulActionProposal({
    id: EVADER_VISIBLE_CHASER_EVADE_PROPOSAL_ID,
    createState: createEvadeVisibleChaserState,
    createOutput: () => null,
    deriveOutput: (state, context = {}) => {
      const frameIndex = Number.isFinite(context.frameIndex) ? context.frameIndex : null;
      const isVisible = Boolean(
        context.position
        && context.chaserLocation?.visible
        && context.chaserLocation.position,
      );

      if (frameIndex !== null && state?.lastUpdatedFrameIndex !== frameIndex) {
        if (isVisible) {
          state.visibleFrameCount += 1;
          state.lastSeenDistance = Number.isFinite(context.chaserLocation?.distance)
            ? context.chaserLocation.distance
            : null;
          state.lastSeenBearingRadians = Number.isFinite(context.chaserLocation?.bearingRadians)
            ? context.chaserLocation.bearingRadians
            : null;
        }
        if (isVisible && !state.visibleLastFrame) {
          state.visibilityEpisodeCount += 1;
        }
        state.visibleLastFrame = isVisible;
        state.lastUpdatedFrameIndex = frameIndex;
      }

      const policyAllowsEvade = getEvaderPolicyBoolean(context.policy, "evadeChaserWhenVisible", true);
      const isActionable = Boolean(isVisible && policyAllowsEvade);

      if (frameIndex !== null && state) {
        if (isActionable) {
          state.actionableFrameCount += 1;
        }
        if (isActionable && !state.actionableLastFrame) {
          state.actionableEpisodeCount += 1;
        }
        state.actionableLastFrame = isActionable;
      }

      if (!isVisible || !policyAllowsEvade) {
        return null;
      }

      const awayFromChaser = normalizeVector(
        context.position.x - context.chaserLocation.position.x,
        context.position.z - context.chaserLocation.position.z,
      );

      return {
        direction: constrainDirectionToBounds(
          context.position,
          awayFromChaser,
          context.columns,
          context.rows,
        ),
        debug: {
          ...(context.baselineMovementOutput?.debug ?? null),
          policyId: EVADER_VISIBLE_CHASER_EVADE_PROPOSAL_ID,
          chaserVisible: true,
          chaserDistance: context.chaserLocation.distance,
          chaserBearingRadians: context.chaserLocation.bearingRadians,
          evadeActive: true,
        },
      };
    },
    getConfidence: (output) => (output ? 1 : 0),
    isActionable: (output) => Boolean(output?.direction),
  });
}

export function recordEvaderVisibleChaserExecution(
  proposal,
  {
    frameIndex = null,
    executed = false,
  } = {},
) {
  const state = proposal?.state;
  if (!state || frameIndex === null || state.lastExecutionFrameIndex === frameIndex) {
    return;
  }

  if (executed) {
    state.executedFrameCount += 1;
  }
  if (executed && !state.executedLastFrame) {
    state.executionEpisodeCount += 1;
  }
  state.executedLastFrame = Boolean(executed);
  state.lastExecutionFrameIndex = frameIndex;
}

export function updateEvaderVisibleChaserEvadeProposal(proposal, context) {
  return updateActionProposal(proposal, context);
}

export function getEvaderVisibleChaserEvadeProposalOutput(proposal) {
  return getActionProposalOutput(proposal);
}

export function getEvaderVisibleChaserEvadeProposalState(proposal) {
  return proposal?.state ?? null;
}
