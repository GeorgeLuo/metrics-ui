import { DEFAULT_EVADER_DRIFT_WEIGHT } from "../../../config/constants.mjs";
import { constrainDirectionToBounds } from "../../../actors/evader/evader.mjs";
import { getEvaderPolicyNumber } from "./policy.mjs";
import { normalizeVector } from "../../core/math.ts";
import {
  createStatefulActionProposal,
  getActionProposalOutput,
  updateActionProposal,
} from "../core/stateful-action-proposal.mjs";

export const EVADER_BASELINE_MOVEMENT_PROPOSAL_ID = "baseline-drift-wall-avoid";

export function createEvaderBaselineMovementProposal() {
  return createStatefulActionProposal({
    id: EVADER_BASELINE_MOVEMENT_PROPOSAL_ID,
    createState: () => null,
    createOutput: () => ({
      direction: { x: 0, z: 0 },
      debug: {
        policyId: EVADER_BASELINE_MOVEMENT_PROPOSAL_ID,
        wallAvoidanceActive: false,
        nearestWall: null,
        nearestDistance: null,
      },
      confidence: 1,
    }),
    deriveOutput: (_state, context = {}) => {
      const driftDirection = context.driftProposalOutput?.direction ?? { x: 0, z: 0 };
      const wallAvoidDirection = context.wallAvoidProposalOutput?.direction ?? { x: 0, z: 0 };
      const currentDirection = context.direction ?? { x: 0, z: 0 };
      const driftWeight = getEvaderPolicyNumber(
        context.policy,
        "driftWeight",
        DEFAULT_EVADER_DRIFT_WEIGHT,
      );
      const blendedDirection = normalizeVector(
        driftDirection.x * driftWeight + wallAvoidDirection.x + currentDirection.x,
        driftDirection.z * driftWeight + wallAvoidDirection.z + currentDirection.z,
      );
      const constrainedDirection = constrainDirectionToBounds(
        context.position,
        blendedDirection.x === 0 && blendedDirection.z === 0
          ? driftDirection
          : blendedDirection,
        context.columns,
        context.rows,
      );

      return {
        direction: constrainedDirection,
        confidence: context.chaserLocationVisible ? 0.5 : 1,
        debug: {
          policyId: typeof context.policy?.id === "string"
            ? context.policy.id
            : EVADER_BASELINE_MOVEMENT_PROPOSAL_ID,
          wallAvoidanceActive: Boolean(context.wallAvoidProposalOutput?.active),
          nearestWall: context.wallAvoidProposalOutput?.nearestWall ?? null,
          nearestDistance: context.wallAvoidProposalOutput?.nearestDistance ?? null,
        },
      };
    },
    getConfidence: (output) => Number(output?.confidence) || 0,
    isActionable: () => true,
  });
}

export function updateEvaderBaselineMovementProposal(proposal, context) {
  return updateActionProposal(proposal, context);
}

export function getEvaderBaselineMovementProposalOutput(proposal) {
  return getActionProposalOutput(proposal);
}
