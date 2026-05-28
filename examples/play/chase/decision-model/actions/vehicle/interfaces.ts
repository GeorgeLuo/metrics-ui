import type {
  ActionCandidate,
  ActionProposal,
  ActionProposalCollection,
  ActionSelectionSignal,
  MotiveSignal,
  ActionPlan,
} from "../core/interfaces.ts";
import type { VectorXZ } from "../../observer-world/interfaces.ts";

/**
 * Executable control surface for RC-car-like actors.
 */
export type VehicleAction = {
  forward: boolean;
  reverse?: boolean;
  steering: number;
};

/**
 * Vehicle action that also carries direction intent used by the simulator.
 */
export type VehicleSteeringAction = VehicleAction & {
  desiredDirection?: VectorXZ | null;
  nextDirection?: VectorXZ | null;
};

/**
 * One simulated future frame for a feasible vehicle path.
 *
 * This captures vehicle capability state only: throttle, steering, and the
 * predicted pose after applying that control. Actor-specific planners can
 * extend it with proposal ids, target metadata, or debug context.
 */
export type VehicleActionFrame = VehicleAction & {
  reverse: boolean;
  frameOffset: number;
  framesAhead: number;
  throttle: number;
  steer: number;
  predictedPosition: VectorXZ;
  predictedDirection: VectorXZ;
  [key: string]: unknown;
};

/**
 * Ordered feasible vehicle frames for debug rendering or path mixing.
 */
export type VehicleActionPath = VehicleActionFrame[];

/**
 * Ranked vehicle target or waypoint candidate.
 */
export type VehicleActionCandidate = ActionCandidate<VectorXZ>;

/**
 * One vehicle-capability proposal with an optional feasible path.
 */
export type VehicleActionProposal<
  TCandidate extends ActionCandidate = VehicleActionCandidate,
> = ActionProposal<VehicleAction> & {
  actionPath: VehicleActionPath;
  firstAction: VehicleActionFrame | null;
  goalDirection?: VectorXZ | null;
  targetCandidate?: TCandidate | null;
  pursuitPoint?: {
    position: VectorXZ;
    source?: string;
    sample?: unknown;
  } | null;
  pursuitSource?: string | null;
  inactiveReason?: string;
  disabledReason?: string;
  [key: string]: unknown;
};

/**
 * Direction consensus over active vehicle action proposals.
 */
export type VehiclePeerConsensus = {
  id: string;
  active: boolean;
  activePeerIds: string[];
  consensus: unknown;
  direction: VectorXZ | null;
};

/**
 * Per-frame blended path produced from active vehicle proposals.
 */
export type VehicleActionPathConsensus = {
  id: string;
  active: boolean;
  path: VehicleActionPath;
  firstAction: VehicleActionFrame | null;
  sourceProposalIds: string[];
};

/**
 * Local movement adjustment payload for vehicle actors.
 */
export type VehicleLocalNavigationMovement = {
  direction: VectorXZ;
  wallPressure?: unknown;
  wallFollowSign?: number;
  signals?: unknown[];
  consensus?: unknown;
  actionPath: VehicleActionPath;
};

/**
 * Optional local navigation adjustment proposal.
 */
export type VehicleLocalNavigationProposal = {
  id: string;
  active: boolean;
  disabledReason?: string;
  movement: VehicleLocalNavigationMovement;
};

/**
 * Vehicle proposal map plus common diagnostic proposals.
 */
export type VehicleActionProposalCollection<
  TProposal extends VehicleActionProposal = VehicleActionProposal,
> = ActionProposalCollection<TProposal> & {
  peerConsensus?: VehiclePeerConsensus;
  actionPathConsensus?: VehicleActionPathConsensus;
  motiveSignal?: MotiveSignal;
  selectionSignal?: ActionSelectionSignal;
  localNavigation?: VehicleLocalNavigationProposal;
};

/**
 * Generic vehicle action-stage plan.
 */
export type VehicleActionPlan<
  TProposalCollection extends VehicleActionProposalCollection = VehicleActionProposalCollection,
  TMotiveSignal extends MotiveSignal = MotiveSignal,
> = VehicleAction & {
  desiredDirection?: VectorXZ | null;
  actionPath?: VehicleActionPath;
  selectedProposalId?: string | null;
  selectedProposalLabel?: string;
  motiveSignal?: TMotiveSignal | null;
  spinSteeringHint?: number | null;
  wallFollowSign?: number;
  proposals?: TProposalCollection;
};

/**
 * Optional envelope form for consumers that want a wrapped vehicle action.
 */
export type VehicleActionPlanEnvelope<
  TProposalCollection extends VehicleActionProposalCollection = VehicleActionProposalCollection,
  TMotiveSignal extends MotiveSignal = MotiveSignal,
> = ActionPlan<VehicleAction, TProposalCollection, TMotiveSignal>;

/**
 * Stable executable vehicle action field names.
 */
export const VEHICLE_ACTION_FIELDS = Object.freeze([
  "forward",
  "reverse",
  "steering",
]);

/**
 * Vehicle action field names including direction-intent diagnostics.
 */
export const VEHICLE_STEERING_ACTION_FIELDS = Object.freeze([
  "forward",
  "reverse",
  "steering",
  "desiredDirection",
  "nextDirection",
]);

/**
 * Stable future-frame field names for generated vehicle paths.
 */
export const VEHICLE_ACTION_FRAME_FIELDS = Object.freeze([
  "frameOffset",
  "framesAhead",
  "throttle",
  "steer",
  "steering",
  "forward",
  "reverse",
  "predictedPosition",
  "predictedDirection",
]);

/**
 * Stable proposal field names shared by vehicle-capability strategies.
 */
export const VEHICLE_ACTION_PROPOSAL_FIELDS = Object.freeze([
  "id",
  "active",
  "confidence",
  "action",
  "metadata",
  "actionPath",
  "firstAction",
  "goalDirection",
  "targetCandidate",
  "pursuitPoint",
  "pursuitSource",
]);

/**
 * Stable field names for a mixed vehicle action path.
 */
export const VEHICLE_ACTION_PATH_CONSENSUS_FIELDS = Object.freeze([
  "id",
  "active",
  "path",
  "firstAction",
  "sourceProposalIds",
]);

/**
 * Stable vehicle action-plan field names.
 */
export const VEHICLE_ACTION_PLAN_FIELDS = Object.freeze([
  "forward",
  "reverse",
  "steering",
  "desiredDirection",
  "actionPath",
  "selectedProposalId",
  "selectedProposalLabel",
  "spinSteeringHint",
  "wallFollowSign",
  "proposals",
]);
