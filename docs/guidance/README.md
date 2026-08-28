# Agent Guidance

**When to load:** When choosing which process guidance applies to a task or
maintaining this directory.

**Authority:** These files are derived from the canonical
[Milestone Planning And Delivery Contract](../milestones/README.md). The
contract wins if any wording conflicts.

This directory is the short operating surface for agents. It reduces repeated
context loading without replacing the full contract.

## Selection

| File | Load for |
| --- | --- |
| [agent-surface.md](agent-surface.md) | Every new or resumed work session |
| [proposal-vs-implementation.md](proposal-vs-implementation.md) | Proposal authoring, implementation handoff, or phase questions |
| [review-unit.md](review-unit.md) | Scoping or reviewing a PR-sized unit, including closeout and cumulative-PR assessment |
| [repair-cycle.md](repair-cycle.md) | Addressing findings or re-reviewing repairs |
| [validation.md](validation.md) | Planning, running, or reporting validation |
| [adversarial-matrix.md](adversarial-matrix.md) | Universal claims, boundary audits, and fresh adversarial review |
| [roles/meta-manager.md](roles/meta-manager.md) | Planning, review, workflow, handoff, and closeout operations |
| [roles/implementer.md](roles/implementer.md) | Proposal authoring, implementation, and repair operations |

## Maintenance

- Keep each file narrow enough to load independently.
- Summarize existing contract rules; do not create new ones here.
- Keep milestone, branch, PR, finding, and validation state out of this
  directory.
- Keep automatic operation routing in the root `AGENTS.md` entrypoint and this
  directory; do not require conversation preambles.
- Link to the relevant contract section when a summary cannot preserve an
  important condition.
- Review this surface when the contract changes, removing stale or duplicated
  wording instead of accumulating compatibility guidance.
