import {
  buildDirectionConsensus as buildChaserDirectionConsensus,
  createPeerConsensusSignal,
  getHighestConfidenceProposal,
} from "./mixing/direction-consensus.ts";
import { buildWeightedPathConsensus } from "./mixing/weighted-path-consensus.ts";
import type {
  VehicleActionPathConsensus,
  VehicleActionProposal,
  VehicleLocalNavigationProposal,
} from "../vehicle/interfaces.ts";

type ProposalSet = Record<string, any>;

export {
  createPeerConsensusSignal,
};

/**
 * Builds the local navigation proposal retained by the controller/debug shape.
 *
 * Wall-safety navigation is currently disabled at this layer, so this proposal
 * wraps the already-mixed action path without modifying it.
 */
export function buildLocalNavigationProposal({
  enabled,
  direction,
  actionPath = [],
  previousWallFollowSign,
}: Record<string, any> = {}): VehicleLocalNavigationProposal {
  return {
    id: "localNavigation",
    active: Boolean(enabled),
    disabledReason: "chaser-wall-safety-disabled",
    movement: {
      direction: direction ?? { x: 0, z: 0 },
      wallPressure: null,
      wallFollowSign: previousWallFollowSign ?? 1,
      signals: [],
      consensus: null,
      actionPath,
    },
  };
}

/**
 * Selects chaser proposals that have concrete feasible paths for path mixing.
 */
export function getActivePathProposals(proposals: ProposalSet): VehicleActionProposal[] {
  return [
    proposals.evaderPredictionPursuit,
    proposals.lineOfSightPursuit,
    proposals.mapDiscovery,
    proposals.mapRecencyRefresh,
    proposals.spin,
  ].filter((proposal) => proposal?.active && Array.isArray(proposal.actionPath)
    && proposal.actionPath.length > 0);
}

/**
 * Selects active chaser proposals for direction consensus.
 *
 * Direction consensus can use goal direction even when a proposal has no path,
 * so this deliberately has a looser filter than `getActivePathProposals`.
 */
export function getDirectionConsensusProposals(proposals: ProposalSet): VehicleActionProposal[] {
  return [
    proposals.evaderPredictionPursuit,
    proposals.lineOfSightPursuit,
    proposals.mapDiscovery,
    proposals.mapRecencyRefresh,
    proposals.spin,
  ].filter((proposal) => proposal?.active);
}

/**
 * Applies the current chaser direction-mixing policy to active proposals.
 */
export function buildDirectionConsensus({ proposals = {} }: { proposals?: ProposalSet } = {}) {
  return buildChaserDirectionConsensus({
    proposals: getDirectionConsensusProposals(proposals),
  });
}

/**
 * Applies the current chaser path-mixing policy to active feasible paths.
 */
export function buildActionPathConsensus({
  proposals,
  chaserPosition,
  chaserLookDirection,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
}: Record<string, any> = {}): VehicleActionPathConsensus {
  return buildWeightedPathConsensus({
    activeProposals: getActivePathProposals(proposals),
    vehiclePosition: chaserPosition,
    vehicleDirection: chaserLookDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
  });
}

/**
 * Returns the highest-confidence active path proposal for fallback decisions.
 */
export function getPrimaryPeerProposal(proposals: ProposalSet): VehicleActionProposal | null {
  return getHighestConfidenceProposal(getActivePathProposals(proposals));
}
