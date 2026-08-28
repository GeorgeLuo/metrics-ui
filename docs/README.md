# Documentation Guide

This directory separates current reference material, future-facing synthesis,
agent operating guidance, and milestone history. Use the selective reading
order below instead of loading the full process contract for every task.

## Milestone state

Canonical status, frontier, and next action live in each
`docs/milestones/<number>-<slug>/plan.md`. This page is navigation only. Do not
copy those fields here.

```sh
python3 docs/milestones/workflow.py status \
  --plan docs/milestones/<number>-<slug>/plan.md
```

Plans: [milestones/](milestones/). Closed ledger:
[completed.md](milestones/completed.md). Contract:
[README.md](milestones/README.md) ·
[planning-contract.html](milestones/planning-contract.html).

## Reading Order

1. Short default [agent surface](guidance/agent-surface.md).
2. The canonical `plan.md` for the milestone under work; run the status command
   above rather than reading a copy from this page.
3. Only the role- or task-specific files selected by the agent surface.
4. Full [planning and delivery contract](milestones/README.md)
   ([rendered](milestones/planning-contract.html)) when resolving ambiguity,
   changing workflow, or directed there by a guidance file.
5. [completed.md](milestones/completed.md) for durable closed-work context.
6. Relevant documents under `reference/` for current system behavior.
7. `synthesis/` for research evidence, not backlog commitments.

Do not treat closed milestone plans as current architecture.
The active milestone plan, not this navigation page, owns current workflow and
frontier state.

## Structure

| Path | Role |
| --- | --- |
| `guidance/` | Short, derived agent operating surface and role guidance |
| `reference/` | Living architecture and contracts |
| `synthesis/` | Research evidence without commitment |
| `milestones/README.md` | Canonical planning and PR delivery contract |
| `milestones/planning-contract.html` | Generated rendering of the contract |
| `milestones/<n>-<slug>/plan.md` | Canonical active-milestone plan |
| `milestones/<n>-<slug>/plan.html` | Generated plan rendering (do not edit by hand) |
| `milestones/<n>-<slug>/closeout.md` | Durable summary at closeout |
| `milestones/completed.md` | Append-only closed-milestone ledger |

Historical closed milestones may retain hand-authored `plan.html` files without
a `plan.md`. Active milestones use Markdown as the source of truth.
