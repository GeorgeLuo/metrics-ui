/**
 * Chaser action-stage public facade.
 *
 * Actor controllers import from this file so the internal action modules can be
 * reorganized without changing the simulation adapter path.
 */
export { planProgrammaticChaserAction } from "./plan.ts";
export { buildChaserMotiveSignal } from "./motives.ts";
export { buildVisibilityPriorityMotiveSignal } from "./mixing/motive/visibility-priority.ts";
export {
  buildEvaderPredictionPursuitProposal,
  buildVisibleBearingFallbackProposal,
  selectPursuitPoint,
} from "./proposals/chase.ts";
export { buildSpinProposal } from "./proposals/spin.ts";
export {
  buildActionPathConsensus,
  buildDirectionConsensus,
  buildLocalNavigationProposal,
  createPeerConsensusSignal,
  getActivePathProposals,
  getDirectionConsensusProposals,
  getPrimaryPeerProposal,
} from "./consensus.ts";
