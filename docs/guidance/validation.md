# Validation

**When to load:** When designing, running, or reporting validation for a
proposal, implementation, repair, evidence unit, or documentation change.

**Authority:** This summarizes validation requirements throughout the canonical
[Milestone Planning And Delivery Contract](../milestones/README.md). The
contract wins if any wording conflicts.

## Sequence

1. Run focused tests for the changed owner and reported failure class.
2. Run the broader deterministic suite required by the accepted proposal.
3. Run milestone workflow and documentation validation when those surfaces
   changed.
4. Check formatting, generated artifacts, and the final externally visible
   representation.
5. Run live or external checks only when the review question requires them;
   record environmental assumptions and non-claims.

## Normal usage boundary

The repository's documented callers are its primary customers. Exercise those
public entry points across regular happy-path usage before generalizing for
hypothetical callers or states. Business logic should explicitly reject
unsupported inputs or states through the existing domain error contract; the
outer CLI or API boundary translates that rejection into its structured form.

Tests should cover representative regular usage. Add off-path cases only when
normal usage can reach them, the accepted contract claims them, or safety,
integrity, or ownership requires them; unsupported usage may be an expected
exception.

## Evidence

Report exact commands, pass/fail status, test counts, skips, and relevant
artifacts. Do not translate an unrun check into a claim. Update the PR
description after repairs so reviewers do not have to reconstruct current
evidence from comments or commit history.

For universal claims, validate the final value after normalization, storage,
serialization, or transport, not only the first internal representation.

Prefer tests that enter through the public door of the owner: committed
artifacts or the documented command, not the helper added by the last repair.
A named mutation should fail closed without depending on a function name or
error substring.

If derived evidence HTML is committed, it must be regenerable from the
committed frontier record it presents, not from a fixture that is not that
record, and live beside that record in the proposal-declared frontier evidence
directory. Do not treat missing HTML, layout, or on-page volume as a validation
failure unless the operator required that page.
