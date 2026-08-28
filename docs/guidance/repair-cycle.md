# Repair Cycle

**When to load:** When addressing review findings or re-reviewing a PR after
repairs.

**Authority:** This summarizes
[Repair Cycle](../milestones/README.md#repair-cycle) and
[Author Repair Response](../milestones/README.md#author-repair-response) in the
canonical contract. The contract wins if any wording conflicts.

## Author

Treat one consolidated changes-requested verdict followed by its repair revision
as one cycle. Before requesting re-review, add one consecutive row to the PR
body's `Repair Cycle Ledger` with the verdict receipt, reviewer-owned `minor` or
`substantial` classification and highest severity, full repair revision, and
contract impact.

Add the missing case at the public test door and the cheapest close. Do not
move enforcement to a different named owner in the finding diff. Re-check
prior findings and the accepted matrix. Do not invent a new adversarial pass.
There is no cycle-count stop.

Same-account review cannot use GitHub `CHANGES_REQUESTED`. An unedited
`COMMENTED` review containing only `## Contract Review Receipt` and
`Outcome: accepted` or `changes_requested` is the verdict. Other comments are
concerns and do not force action. Completion binds that receipt to the
implementation tip at merge time.

## Reviewer

Verify each prior finding against the repair evidence, then review the current
diff against the accepted proposal. Raise P0–P2 only when the case is in the
accepted matrix or falsifies the stated review question. Leftover two-shapes,
requests to collapse internals, and requests to add or polish derived
evidence HTML are P3 unless the operator required that page or the accepted
question named one type. Everything else is P3 or a later want.

Classify a cycle as substantial when its verdict contains a P0–P2 contract
failure or its repair changes the review question, contract, external
assumption, or adversarial failure class. A same-question collapse inside
the accepted owner that keeps artifacts and Met predicates unchanged is not
substantial. Moving enforcement to a different named owner is a contract
change.
