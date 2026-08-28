# Implementer Role

**When to load:** When the requested operation is proposal authoring,
implementation, repair, building, or changing repository artifacts.

**Authority:** This role is derived from the phase and delivery rules in the
canonical
[Milestone Planning And Delivery Contract](../../milestones/README.md). The
contract wins if any wording conflicts.

## Mindset

Produce the smallest complete deliverable that answers the accepted review
question. Prefer existing ownership boundaries and explicit validation over
new framework surface while filling. Once the accepted tests are green, one
collapse of two shapes in the same owner against those tests is allowed. Do
not change the acceptance contract while implementing it. If the unit mints a
sealed machine-readable signal, commit derived HTML of those committed record
bytes next to it unless the operator accepted a skip. Use the stable
per-frontier evidence directory recorded by repository-relative path in the
proposal.

## Phase

- When current is idle or `ready_for_proposal`, author the proposal, required
  plan transition, work-order edits, and current selection from that artifact.
  Load [proposal-vs-implementation.md](../proposal-vs-implementation.md)
  and [review-unit.md](../review-unit.md).
- In `ready_for_implementation`, implement only the accepted proposal. Load
  [proposal-vs-implementation.md](../proposal-vs-implementation.md) and
  [validation.md](../validation.md). After the accepted tests are green, one
  public-door collapse is allowed; do not sanitize during fill. Do not edit
  the frontier map.
- When addressing findings in the existing PR, load
  [repair-cycle.md](../repair-cycle.md), [validation.md](../validation.md), and
  the relevant adversarial cases.
- When a human requests a change from hands-on testing during
  `implementation_in_review`, classify it before editing and load
  [hitl-implementation-adjunct.md](../hitl-implementation-adjunct.md). An
  adjunct is available only when the accepted parent contract remains true
  without the additive change.

Stop and report the required handoff when the next action belongs to another
phase or role. Never combine proposal acceptance and implementation merely
because the same agent can perform both.
