/**
 * Free-form metadata attached to an action container.
 *
 * Generic action code should treat metadata as descriptive context only. The
 * actor that owns the action decides which fields are meaningful.
 */
export type ActionMetadata = Record<string, unknown>;

/**
 * Generic envelope for actor-owned action payloads.
 *
 * `TAction` is intentionally opaque to the core action layer. A vehicle actor,
 * arm actor, UI actor, or non-spatial actor can each define its own capability
 * shape while sharing this wrapper for debug and provenance fields.
 */
export type ActionEnvelope<
  TAction = unknown,
  TMetadata extends ActionMetadata = ActionMetadata,
> = {
  action: TAction;
  metadata?: TMetadata;
};

/**
 * Common status fields for one proposed actor action.
 *
 * The proposed action itself remains actor-specific. The common layer only
 * captures whether the proposal can currently contribute, its confidence, and
 * optional metadata for diagnostics.
 */
export type ActionProposal<
  TAction = unknown,
  TMetadata extends ActionMetadata = ActionMetadata,
> = {
  id: string;
  active: boolean;
  confidence: number;
  action?: TAction | null;
  metadata?: TMetadata;
};

/**
 * Ranked target or option considered by an action-selection process.
 *
 * Position, route, and component fields are intentionally generic so the same
 * shape can represent map cells, visible targets, search sectors, or other
 * actor-specific options.
 */
export type ActionCandidate<
  TPosition = unknown,
  TRoute = unknown,
  TMetadata extends ActionMetadata = ActionMetadata,
> = {
  id: string;
  kind?: string;
  position?: TPosition | null;
  score: number;
  components?: Record<string, number | unknown>;
  route?: TRoute | null;
  metadata?: TMetadata;
  [key: string]: unknown;
};

/**
 * Selection output produced before concrete action proposals are built.
 */
export type ActionSelectionSignal<
  TCandidate extends ActionCandidate = ActionCandidate,
  TMetadata extends ActionMetadata = ActionMetadata,
> = MotiveSignal<TMetadata> & {
  motiveId?: string;
  frameIndex?: number | null;
  candidates?: TCandidate[];
  selected?: Record<string, TCandidate | null>;
  selectedCandidateId?: string | null;
  [key: string]: unknown;
};

/**
 * Map of proposals keyed by actor-defined proposal id.
 */
export type ActionProposalMap<
  TProposal extends ActionProposal = ActionProposal,
> = Record<string, TProposal>;

/**
 * Proposal map with optional diagnostic entries that are not themselves
 * proposals. Proposal ids remain actor-owned strings instead of core fields.
 */
export type ActionProposalCollection<
  TProposal extends ActionProposal = ActionProposal,
> = Record<string, TProposal | unknown>;

/**
 * Common shape for a motive-level signal feeding action selection.
 */
export type MotiveSignal<
  TMetadata extends ActionMetadata = ActionMetadata,
> = {
  id: string;
  confidence: number;
  source?: string;
  reason?: string;
  metadata?: TMetadata;
  [key: string]: unknown;
};

/**
 * Diagnostic contribution from one proposal into a mixed action.
 */
export type ActionContribution<
  TMetadata extends ActionMetadata = ActionMetadata,
> = {
  id: string;
  confidence: number;
  weight?: number;
  metadata?: TMetadata;
};

/**
 * Generic action plan envelope.
 *
 * The core owns plan provenance and proposal collections. The concrete
 * executable action stays in `action` and is defined by the actor capability.
 */
export type ActionPlan<
  TAction = unknown,
  TProposals extends Record<string, unknown> = ActionProposalMap,
  TMotiveSignal extends MotiveSignal = MotiveSignal,
  TMetadata extends ActionMetadata = ActionMetadata,
> = ActionEnvelope<TAction, TMetadata> & {
  selectedProposalId?: string | null;
  motiveSignal?: TMotiveSignal | null;
  proposals?: TProposals;
  contributions?: ActionContribution[];
};

export const ACTION_ENVELOPE_FIELDS = Object.freeze([
  "action",
  "metadata",
]);

export const ACTION_PROPOSAL_FIELDS = Object.freeze([
  "id",
  "active",
  "confidence",
  "action",
  "metadata",
]);

export const ACTION_CANDIDATE_FIELDS = Object.freeze([
  "id",
  "kind",
  "position",
  "score",
  "components",
  "route",
  "metadata",
]);

export const ACTION_SELECTION_SIGNAL_FIELDS = Object.freeze([
  "id",
  "confidence",
  "source",
  "reason",
  "metadata",
  "motiveId",
  "frameIndex",
  "candidates",
  "selected",
  "selectedCandidateId",
]);

export const MOTIVE_SIGNAL_FIELDS = Object.freeze([
  "id",
  "confidence",
  "source",
  "reason",
  "metadata",
]);

export const ACTION_CONTRIBUTION_FIELDS = Object.freeze([
  "id",
  "confidence",
  "weight",
  "metadata",
]);

export const ACTION_PLAN_FIELDS = Object.freeze([
  "action",
  "metadata",
  "selectedProposalId",
  "motiveSignal",
  "proposals",
  "contributions",
]);
