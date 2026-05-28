import type { ActionSelectionSignal, MotiveSignal } from "../core/interfaces.ts";
import type {
  VehicleAction,
  VehicleActionCandidate,
  VehicleActionFrame,
  VehicleActionPath,
  VehicleActionPathConsensus,
  VehicleActionPlan,
  VehicleActionProposal,
  VehicleActionProposalCollection,
  VehicleLocalNavigationMovement,
} from "../vehicle/interfaces.ts";

/**
 * Chaser currently uses the shared vehicle action surface but always emits an
 * explicit reverse flag for the simulation input path.
 */
export type ChaserVehicleAction = VehicleAction & {
  reverse: boolean;
};

/**
 * One future frame in a chaser-generated feasible vehicle path.
 */
export type ChaserActionFrame = VehicleActionFrame;

/**
 * Feasible future controls and predicted poses for a chaser proposal.
 */
export type ChaserActionPath = VehicleActionPath;

/**
 * Candidate target considered by chaser action selection.
 */
export type ChaserActionCandidate = VehicleActionCandidate;

/**
 * Motive selected before chaser action proposals are generated.
 */
export type ChaserMotiveSignal = MotiveSignal & {
  evaderInLineOfSight?: boolean;
};

/**
 * Diagnostic selection payload produced by chaser action-selection helpers.
 */
export type ChaserActionSelectionSignal = ActionSelectionSignal<ChaserActionCandidate>;

/**
 * One actor-owned action proposal produced by a chaser strategy.
 */
export type ChaserActionProposal = VehicleActionProposal<ChaserActionCandidate>;

/**
 * Mixed path produced from currently active chaser proposals.
 */
export type ChaserActionPathConsensus = VehicleActionPathConsensus;

/**
 * Local movement payload retained for the debug contract.
 */
export type ChaserLocalNavigationMovement = VehicleLocalNavigationMovement;

/**
 * Proposal collection exposed to debug views and controller state.
 */
export type ChaserActionProposalSet = VehicleActionProposalCollection<ChaserActionProposal>;

/**
 * Chaser action-stage plan before the controller stores autopilot side effects.
 *
 * The explicit `chosenStrategy` field is kept for the current debug/UI contract.
 * Generic action code should prefer `selectedProposalLabel` or proposal ids.
 */
export type ChaserActionPlan = ChaserVehicleAction & VehicleActionPlan<
  ChaserActionProposalSet,
  ChaserMotiveSignal
> & {
  pursuitPoint?: ChaserActionProposal["pursuitPoint"];
  movement?: ChaserLocalNavigationMovement;
  actionPath: ChaserActionPath;
  chosenStrategy: string;
  proposals: ChaserActionProposalSet;
};

/**
 * Public chaser action returned to simulation and debug views.
 */
export type ProgrammaticChaserAction = ChaserVehicleAction & {
  source?: string;
  pursuitPoint?: ChaserActionProposal["pursuitPoint"];
  movement?: ChaserLocalNavigationMovement | null;
  actionPath: ChaserActionPath;
  chosenStrategy: string;
  actionStrategies: ChaserActionProposalSet;
  actionPlan: ChaserActionPlan;
};

/**
 * Stable top-level field names for the chaser action plan debug payload.
 */
export const CHASER_ACTION_PLAN_FIELDS = Object.freeze([
  "forward",
  "reverse",
  "steering",
  "pursuitPoint",
  "movement",
  "desiredDirection",
  "actionPath",
  "chosenStrategy",
  "selectedProposalLabel",
  "spinSteeringHint",
  "wallFollowSign",
  "proposals",
]);
