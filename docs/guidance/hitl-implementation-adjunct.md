# HITL Implementation Adjunct

**When to load:** When hands-on human testing requests a change after an
implementation frontier has entered `implementation_in_review`.

**Authority:** This summarizes
[Human Discovery During Implementation](../milestones/README.md#human-discovery-during-implementation)
in the canonical contract. The contract wins if any wording conflicts.

## Classify Before Editing

- Repair the parent when its accepted review question is false without the
  change.
- Use contract amendment or later-frontier review when an exit criterion,
  safety authority, schema, assumption, expected handoff, non-goal, primary
  owner, or feature outcome changes.
- Use an adjunct only for an explicitly requested `implement-now`, additive
  change in the same frontier and operator journey when the parent contract
  remains true without it.

Human direction establishes need and priority. It does not waive compatibility
or safety review.

## Deliver

1. Confirm the durable request issue and record the human requester and testing
   context.
2. Branch `<implementation-branch>--adjunct-<slug>` from the current published
   implementation head; never branch from another adjunct.
3. Use `.github/PULL_REQUEST_TEMPLATE/implementation-adjunct.md`, state one
   review question and owner, complete every compatibility assertion, and
   declare evidence impact.
4. Target the canonical implementation branch. Do not edit the plan, accepted
   proposal, accepted amendment, or workflow state.
5. Validate and review the child independently.
6. After merge, reconcile the parent PR, refresh affected evidence, and review
   the integrated parent in totality before frontier acceptance.

The adjunct creates no independent plan ledger row; the parent implementation
remains the accepted review unit.
