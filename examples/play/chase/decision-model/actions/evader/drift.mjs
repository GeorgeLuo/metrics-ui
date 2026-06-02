import {
  DEFAULT_EVADER_DRIFT_X_PHASE_PER_FRAME,
  DEFAULT_EVADER_DRIFT_Z_PHASE_PER_FRAME,
} from "../../../config/constants.mjs";
import { normalizeVector } from "../../core/math.ts";
import {
  createStatefulActionProposal,
  getActionProposalOutput,
  updateActionProposal,
} from "../core/stateful-action-proposal.mjs";
import { getEvaderPolicyNumber } from "./policy.mjs";

export const EVADER_DRIFT_PROPOSAL_ID = "driftMotion";

export function getEvaderDriftDirection(frameIndex, policy = {}) {
  const safeFrameIndex = Number.isFinite(frameIndex) ? frameIndex : 0;
  const driftXPhasePerFrame = getEvaderPolicyNumber(
    policy,
    "driftXPhasePerFrame",
    DEFAULT_EVADER_DRIFT_X_PHASE_PER_FRAME,
  );
  const driftZPhasePerFrame = getEvaderPolicyNumber(
    policy,
    "driftZPhasePerFrame",
    DEFAULT_EVADER_DRIFT_Z_PHASE_PER_FRAME,
  );
  const driftXPhaseOffset = getEvaderPolicyNumber(policy, "driftXPhaseOffset", 0);
  const driftZPhaseOffset = getEvaderPolicyNumber(policy, "driftZPhaseOffset", 0);
  return normalizeVector(
    Math.sin(safeFrameIndex * driftXPhasePerFrame + driftXPhaseOffset),
    Math.cos(safeFrameIndex * driftZPhasePerFrame + driftZPhaseOffset),
  );
}

export function createEvaderDriftProposal() {
  return createStatefulActionProposal({
    id: EVADER_DRIFT_PROPOSAL_ID,
    createState: () => null,
    createOutput: () => ({
      direction: { x: 0, z: 0 },
    }),
    deriveOutput: (_state, context = {}) => ({
      direction: getEvaderDriftDirection(context.frameIndex, context.policy),
    }),
    getConfidence: () => 1,
    isActionable: () => true,
  });
}

export function updateEvaderDriftProposal(proposal, context) {
  return updateActionProposal(proposal, context);
}

export function getEvaderDriftProposalOutput(proposal) {
  return getActionProposalOutput(proposal);
}
