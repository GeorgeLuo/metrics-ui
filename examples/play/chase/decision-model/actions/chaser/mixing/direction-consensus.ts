import {
  CHASER_STRATEGY_CONSENSUS_COUPLING,
  CHASER_STRATEGY_CONSENSUS_ITERATIONS,
} from "../../../../config/constants.mjs";
import { runKuramotoConsensus } from "../../../core/kuramoto.ts";
import { normalizeVector } from "../../../core/math.ts";
import type {
  VehicleActionProposal,
  VehiclePeerConsensus,
} from "../../vehicle/interfaces.ts";

/**
 * Converts one active proposal into the directional signal consumed by
 * Kuramoto consensus.
 *
 * Confidence is preserved on the signal for diagnostics, but the current
 * direction consensus policy still passes a fixed oscillator weight of `1`.
 */
export function createPeerConsensusSignal(proposal: VehicleActionProposal | null | undefined) {
  const direction = normalizeVector(
    proposal?.firstAction?.predictedDirection?.x ?? proposal?.goalDirection?.x ?? 0,
    proposal?.firstAction?.predictedDirection?.z ?? proposal?.goalDirection?.z ?? 0,
  );
  if (!proposal?.active || (direction.x === 0 && direction.z === 0)) {
    return null;
  }

  return {
    id: proposal.id,
    direction,
    confidence: Number.isFinite(proposal.confidence) ? proposal.confidence : 1,
    weight: 1,
  };
}

/**
 * Picks the strongest active proposal by confidence for zero-vector fallback.
 */
export function getHighestConfidenceProposal(
  activeProposals: VehicleActionProposal[],
): VehicleActionProposal | null {
  return [...activeProposals]
    .sort((first, second) =>
      (Number(second.confidence) || 0) - (Number(first.confidence) || 0))
    [0] ?? null;
}

/**
 * Wraps the direction consensus result in the proposal shape exposed to debug.
 */
export function buildPeerConsensusProposal({
  activePeerIds,
  peerConsensus,
  goalDirection,
}: {
  activePeerIds: string[];
  peerConsensus: unknown;
  goalDirection: VehiclePeerConsensus["direction"];
}): VehiclePeerConsensus {
  return {
    id: "strategyConsensus",
    active: activePeerIds.length > 0,
    activePeerIds,
    consensus: peerConsensus,
    direction: goalDirection,
  };
}

/**
 * Current mutable policy for mixing chaser proposal directions.
 *
 * This uses Kuramoto consensus over active proposal directions and falls back
 * to the highest-confidence proposal when the circular mean cancels to zero.
 */
export function buildDirectionConsensus({
  proposals = [],
}: {
  proposals?: VehicleActionProposal[];
} = {}) {
  const peerSignals = proposals
    .map((proposal) => createPeerConsensusSignal(proposal))
    .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
  const peerConsensus = runKuramotoConsensus(peerSignals, {
    coupling: CHASER_STRATEGY_CONSENSUS_COUPLING,
    iterations: CHASER_STRATEGY_CONSENSUS_ITERATIONS,
  });
  const primaryProposal = getHighestConfidenceProposal(proposals);
  const goalDirection = peerConsensus.direction.x === 0 && peerConsensus.direction.z === 0
    ? primaryProposal?.goalDirection ?? null
    : peerConsensus.direction;
  const activePeerIds = peerSignals.map((signal) => signal.id);
  const chosenPeerLabel = activePeerIds.length > 0
    ? activePeerIds.join("+")
    : "none";

  return {
    peerSignals,
    peerConsensus,
    primaryProposal,
    goalDirection,
    activePeerIds,
    chosenPeerLabel,
    proposal: buildPeerConsensusProposal({
      activePeerIds,
      peerConsensus,
      goalDirection,
    }),
  };
}
