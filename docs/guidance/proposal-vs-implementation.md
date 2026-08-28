# Proposal And Implementation

**When to load:** When authoring or reviewing a proposal, handing accepted work
to an implementer, starting implementation, or deciding what phase permits.

**Authority:** This summarizes
[Proposal And Implementation Are Separate](../milestones/README.md#proposal-and-implementation-are-separate)
in the canonical contract. The contract wins if any wording conflicts.

## Phase Boundary

- Idle current or `ready_for_proposal`: proposal work may start; product
  implementation may not. The proposal selects current from the work order.
- `proposal_in_review`: change the proposal, required plan transition, remaining
  path, and not-yet-started map nodes. Current identity is frozen after the
  proposal opens.
- `ready_for_implementation`: implement only the exact accepted proposal.
- `implementation_in_review`: reconcile product, tests, and documentation to
  that accepted scope. Do not edit the frontier map or successor.

Run the milestone workflow status command instead of inferring the phase from
conversation history.

## Handoffs

The reviewer stops when a phase is ready and states the next permitted role.
The operator assigns proposal authorship or implementation explicitly. A person
or model may fill both roles, but only in separate branches and review phases.

A proposal records the contract, owner, affected paths, adversarial matrix,
assumptions, non-goals, file impact, validation plan, and expected handoff. It
contains no implementation. It is the review surface for the work-order
artifact: it may add nodes, rewire the remaining path, move a not-yet-started
node off-path, and select current from that artifact. Those edits are not a
second review question. It must not delete a contracted node.

Before a proposal or amendment merges, a reviewer with current repository push
authority submits a decisive GitHub review on its exact final head. `APPROVED`
counts as acceptance. If GitHub prevents self-approval, use a new, unedited
formal `COMMENTED` review containing only:

```text
## Contract Review Receipt

- Outcome: `accepted`
```

Conversation comments do not count, and any later commit requires another
review. Each authorized reviewer's latest decision on that head must be clear
of outstanding changes. Merge alone does not promote the frontier; run the
matching acceptance command so the plan records the reviewer, authority,
reviewed head, review time, and merge commit.

When the review kind is `deterministic invariant closure`, complete the
proposal's `Trust And Authority Model` and `Evidence Topology And Capture Strategy`
before handoff. Distinguish consistency, provenance, and authenticity;
map visible claims to authoritative inputs and verification; choose bounded
implementation evidence or a separate evidence unit; and state when canonical capture is ready. A mechanical rollout or behavioral slice does not gain those
sections because the prose uses `exact` or `fail-closed`. Apply the same
sections to a proposal amendment only when that amendment's review kind is
deterministic invariant closure.

The canonical plan selects one supported review kind for the frontier. Copy
that value into the single `## Review Kind` section of every proposal, proposal
amendment, and implementation PR. CI checks it when the PR opens, changes, or
its description is edited; proposal acceptance, amendment acceptance, and
implementation completion recheck the merged PR body before promotion.

Implementation links the accepted proposal and merge commit, stays within that
contract, and reports actual file impact and validation. Once the accepted
tests are green, the implementer may collapse two shapes in the same owner
against those tests without changing the contract. If the unit mints a sealed
signal, commit derived HTML of those bytes next to it in the proposal-declared
per-frontier evidence directory unless the operator accepted a skip. Do not
rewire the remaining path, add a frontier, or change process rules during
implementation. If the contract must change, return to proposal review rather
than rewriting acceptance during implementation.
