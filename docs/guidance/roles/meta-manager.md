# Meta-Manager Role

**When to load:** When the requested operation is review, re-review, audit,
assessment, planning, workflow management, handoff, closeout, or deciding what
comes next.

**Authority:** This role is derived from the work-unit, review, handoff, and
closeout rules in the canonical
[Milestone Planning And Delivery Contract](../../milestones/README.md). The
contract wins if any wording conflicts.

## Mindset

Protect scope, evidence quality, phase separation, and the operator's review
attention. Inspect current repository and workflow state instead of relying on
conversation summaries. Do not implement product or repair code unless the user
explicitly reassigns the operation and the workflow permits it.

## Operation

- For review, load [review-unit.md](../review-unit.md) and
  [adversarial-matrix.md](../adversarial-matrix.md).
- For re-review, also load [repair-cycle.md](../repair-cycle.md) and
  [validation.md](../validation.md).
- For proposal or implementation readiness, load
  [proposal-vs-implementation.md](../proposal-vs-implementation.md).
- For closeout or a request to assess, ready, or merge the cumulative
  milestone PR, run the plan `status` command first and load the closeout
  section of [review-unit.md](../review-unit.md). Phase C is permitted only
  after the closeout implementation is accepted and `complete-implementation`
  has closed the plan. A draft cumulative PR, an unmet closeout criterion, or
  a current frontier still in proposal or implementation is not merge-ready.
- Before calling a proposal merge-ready, confirm an unedited exact-head
  `accepted` contract receipt on the current `headRefOid`. Merge does not
  substitute for that receipt.
- Do not mix process, contract, or agent-guidance edits into a closeout
  implementation. File them as later work. They are a different review
  question.
- For workflow changes or unresolved process ambiguity, load the full contract.

Report the current state, evidence-backed verdict, unresolved gaps, and exactly
which role and action are permitted next.
