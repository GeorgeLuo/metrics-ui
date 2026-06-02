import { DEFAULT_EVADER_WALL_AVOID_WEIGHT } from "../../../config/constants.mjs";
import {
  createStatefulActionProposal,
  getActionProposalOutput,
  updateActionProposal,
} from "../core/stateful-action-proposal.mjs";
import { getEvaderPolicyNumber } from "./policy.mjs";
import { getWorldWallPressure } from "../../../world/world.mjs";

export const EVADER_WALL_AVOID_PROPOSAL_ID = "wallAvoidance";

export function createEvaderWallAvoidProposal() {
  return createStatefulActionProposal({
    id: EVADER_WALL_AVOID_PROPOSAL_ID,
    createState: () => null,
    createOutput: () => ({
      direction: { x: 0, z: 0 },
      active: false,
      nearestWall: null,
      nearestDistance: null,
      magnitude: 0,
    }),
    deriveOutput: (_state, context = {}) => {
      const wallPressure = getWorldWallPressure(
        context.position,
        context.columns,
        context.rows,
        context.obstacles,
      );
      const wallAvoidWeight = getEvaderPolicyNumber(
        context.policy,
        "wallAvoidWeight",
        DEFAULT_EVADER_WALL_AVOID_WEIGHT,
      );
      return {
        direction: {
          x: wallPressure.direction.x * wallPressure.magnitude * wallAvoidWeight,
          z: wallPressure.direction.z * wallPressure.magnitude * wallAvoidWeight,
        },
        active: wallPressure.active,
        nearestWall: wallPressure.nearestWall,
        nearestDistance: wallPressure.nearestDistance,
        magnitude: wallPressure.magnitude,
      };
    },
    getConfidence: (output) => Number(output?.magnitude) || 0,
    isActionable: () => true,
  });
}

export function updateEvaderWallAvoidProposal(proposal, context) {
  return updateActionProposal(proposal, context);
}

export function getEvaderWallAvoidProposalOutput(proposal) {
  return getActionProposalOutput(proposal);
}
