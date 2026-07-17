# Documentation Guide

This directory is the entry point for current plans and milestone history.
Read this file before beginning milestone-scoped work.

## Active Work

Milestone 001, [RC Camera Simulation Realism](milestones/001-rc-camera-simulation-realism/plan.html),
is active. It establishes configurable, reproducible RC-camera rendering for
Chase while preserving the deterministic simulation view used for debugging.

## Reading Order

1. Read the shared [`milestones/README.md`](milestones/README.md) planning and
   pull-request delivery contract, or its
   [rendered view](milestones/planning-contract.html).
2. Read the active milestone plan listed above.
3. Read [`milestones/completed.md`](milestones/completed.md) for durable context
   from closed work.
4. Consult source-level documentation only for the area being changed.

Closed plans are frozen historical records. They explain prior decisions but
do not replace current source code or reference documentation.

## Structure

- `milestones/README.md` is the shared planning and delivery contract.
- `milestones/planning-contract.html` is its generated browser rendering.
- `milestones/<number>-<slug>/plan.html` is one milestone's active plan and
  status record.
- `milestones/<number>-<slug>/closeout.md` is written when the milestone closes.
- `milestones/completed.md` is the append-only ledger of closed milestones.

Run `npm run docs:milestones` after changing the shared contract. Run
`npm run docs:milestones:check` to validate the generated contract, active plan
sections, workflow markers, work statuses, and aggregate progress.
