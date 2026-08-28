# Agent Operating Surface

**When to load:** At the start or resumption of every planning, implementation,
review, repair, or closeout session.

**Authority:** This is a derived router for the canonical
[Milestone Planning And Delivery Contract](../milestones/README.md). The
contract wins if any wording conflicts.

## Start

1. Read [docs/README.md](../README.md) for repository documentation navigation.
2. Classify the requested operation using the role routing below.
3. Load the selected role guidance.
4. Identify the active milestone plan and run its documented workflow status
   command when milestone work is involved.
5. Load only the task guidance selected below.
6. Read current task data: the active plan, accepted proposal, relevant diff,
   findings, and latest validation evidence.
7. Load the full contract only when this surface directs it, workflow meaning
   is ambiguous, or the workflow itself is being changed.

## Role Routing

| Requested operation | Role guidance |
| --- | --- |
| Review, re-review, audit, assess, plan, workflow, handoff, closeout, or determine what comes next | [roles/meta-manager.md](roles/meta-manager.md) |
| Author a proposal, implement, fix, build, or address findings | [roles/implementer.md](roles/implementer.md) |

An explicit operation in the latest request wins. A continuation such as
`proceed` retains the established role only when the requested next action is
clear. Otherwise, inspect the active workflow state and current PR before
classifying; ask only if the operation remains ambiguous.

Role classification does not authorize a phase transition. The recorded
workflow state determines whether proposal, implementation, review, handoff, or
closeout work is permitted.

## Task Loading

| Current work | Additional guidance |
| --- | --- |
| Scope or author a proposal | [proposal-vs-implementation.md](proposal-vs-implementation.md), [review-unit.md](review-unit.md) |
| Implement an accepted proposal | [proposal-vs-implementation.md](proposal-vs-implementation.md), [validation.md](validation.md) |
| Review a proposal or implementation | [review-unit.md](review-unit.md), [adversarial-matrix.md](adversarial-matrix.md) |
| Review closeout or assess/merge a cumulative milestone PR | [review-unit.md](review-unit.md) closeout section and [roles/meta-manager.md](roles/meta-manager.md) |
| Repair or re-review findings | [repair-cycle.md](repair-cycle.md), [validation.md](validation.md), and relevant adversarial rows |
| Human-requested change discovered during implementation | [hitl-implementation-adjunct.md](hitl-implementation-adjunct.md), [review-unit.md](review-unit.md), and [validation.md](validation.md) |
| Prepare a handoff | [proposal-vs-implementation.md](proposal-vs-implementation.md) |
| Change process or milestone mechanics | Full canonical contract |

Do not preload every role or task guidance file.

Keep the repository's documented callers and regular paths as the primary
compatibility surface. Apply the selected review or validation guidance to the
happy path first; reject unsupported usage explicitly rather than creating
work for hypothetical callers unless the accepted question or a safety or
integrity contract requires it.

## External Capability Gaps

When work depends on a separately owned repository—especially Automa /
auto-driving—do not silently work around a missing capability or assume the
dependency cannot change. Inspect the available interface, identify the owning boundary, and
surface the smallest external flag, query, capability, or structured failure
contract that would unblock the operator journey. With explicit operator
authorization, create or update the external issue and link it from the current
proposal, PR, evidence, or risk record.

Follow the canonical
[externally owned capability gap contract](../milestones/README.md#externally-owned-capability-gaps)
for required evidence, issue content, authorization, and non-hacky boundaries.

## Conversation State

Use long-running conversations for immediate continuity only. Preserve a short
checkpoint containing:

- repository, branch, PR, base, and head;
- workflow state and current review question;
- unresolved findings or decisions;
- latest validation evidence;
- next permitted action.

Reload durable rules from this directory rather than relying on accumulated
chat history. Reload current milestone state from its plan rather than copying
it into guidance.
