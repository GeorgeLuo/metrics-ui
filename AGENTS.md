# Repository Agent Entry Point

This file is the automatic entrypoint for repository-aware agents. It is a
router, not the process contract.

For every new or resumed request:

1. Read `docs/guidance/agent-surface.md`.
2. Classify the requested operation using its role-routing table.
3. Load only the selected role and task guidance.
4. Read current workflow state from the active milestone plan and tooling.

Do not rely on accumulated conversation history for durable process rules. Do
not silently cross proposal, implementation, review, or closeout phases.

The canonical authority is `docs/milestones/README.md`. It wins over this file
and every file under `docs/guidance/`.
