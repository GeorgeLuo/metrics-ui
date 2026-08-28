from __future__ import annotations

import json


MILESTONE_NUMBER = "900"
MILESTONE_BRANCH = "milestone/900-workflow-fixture"
PLAN_RELATIVE = "docs/milestones/900-workflow-fixture/plan.md"
PROPOSAL_RELATIVE = (
    "docs/milestones/900-workflow-fixture/proposals/evidence-policy.md"
)
PROPOSAL_BRANCH = "m900/evidence-policy-proposal"
IMPLEMENTATION_BRANCH = "m900/evidence-policy"
IMPLEMENTATION_ADJUNCT_BRANCH = (
    "m900/evidence-policy--adjunct-evidence-inspection"
)
PROPOSAL_AMENDMENT_BRANCH = "m900/amend-evidence-policy-lag"
PROPOSAL_AMENDMENT_RELATIVE = (
    "docs/milestones/900-workflow-fixture/proposals/"
    "evidence-policy-lag-amendment.md"
)
NEXT_PROPOSAL_BRANCH = "m900/closeout-proposal"
NEXT_IMPLEMENTATION_BRANCH = "m900/closeout"
CURRENT_FRONTIER = "Evidence policy"
NEXT_FRONTIER = "Milestone closeout"
CURRENT_CRITERION = "M900-01"
CLOSEOUT_CRITERION = "M900-03"
RESOLVED_RISK = "Evidence recurrence has no explicit compatibility contract"
BASELINE_SHA = "abc1234"


def ready_plan_text() -> str:
    return f"""# Milestone 900 - Workflow fixture

| Field | Value |
| --- | --- |
| Status | Active |
| Milestone branch | `{MILESTONE_BRANCH}` |
| Current frontier | {CURRENT_FRONTIER} |
| Contract baseline | `{BASELINE_SHA}` |
| Grandfathered PRs | #1 |
| Cutover | Synthetic mid-milestone workflow fixture |

## Exit Criteria

| ID | Criterion | Status | Evidence / remaining gap |
| --- | --- | --- | --- |
| {CURRENT_CRITERION} | Evidence conflicts are deterministic | Partial | Policy remains open |
| M900-02 | Existing operator path remains stable | Met | Deterministic fixture |
| {CLOSEOUT_CRITERION} | Milestone closeout is accepted | Blocked | Requires current frontier |

## Current Delivery

### Current Frontier

**{CURRENT_FRONTIER}**

- Workflow state: ready_for_proposal
- Proposal branch: `{PROPOSAL_BRANCH}`
- Implementation branch: `{IMPLEMENTATION_BRANCH}`
- Proposal path: `{PROPOSAL_RELATIVE}`
- Review kind: Deterministic invariant closure
- Review question: Does repeated evidence follow one deterministic contract?
- Acceptance owner: Synthetic evidence ledger
- Exit criteria affected: {CURRENT_CRITERION}
- Prerequisite: Baseline behavior is accepted
- Milestone-level non-goal: Semantic identity

### Next-Frontier Candidate

**{NEXT_FRONTIER}**

- Proposal branch: `{NEXT_PROPOSAL_BRANCH}`
- Implementation branch: `{NEXT_IMPLEMENTATION_BRANCH}`
- Proposal path: `docs/milestones/900-workflow-fixture/proposals/closeout.md`
- Review kind: Milestone closeout
- Review question: Is the synthetic milestone complete?
- Acceptance owner: Synthetic closeout
- Exit criteria affected: {CLOSEOUT_CRITERION}
- Prerequisite: Every other criterion is Met
- Milestone-level non-goal: New runtime behavior

### Frontier Map

- Path: `{NEXT_FRONTIER}`
- Cadence: linked-list

#### Node: {NEXT_FRONTIER}

- Proposal branch: `{NEXT_PROPOSAL_BRANCH}`
- Implementation branch: `{NEXT_IMPLEMENTATION_BRANCH}`
- Proposal path: `docs/milestones/900-workflow-fixture/proposals/closeout.md`
- Review kind: Milestone closeout
- Review question: Is the synthetic milestone complete?
- Acceptance owner: Synthetic closeout
- Exit criteria affected: {CLOSEOUT_CRITERION}
- Prerequisite: Every other criterion is Met
- Non-goals: New runtime behavior

## Workflow History

| Frontier | State | Evidence |
| --- | --- | --- |
| {CURRENT_FRONTIER} | ready_for_proposal | Synthetic frontier is ready. |

## Accepted Review Units

| PR | Accepted review question | Result | Exit criteria | Durable evidence |
| --- | --- | --- | --- | --- |
| Baseline #1 (`{BASELINE_SHA}`) | Is the fixture baseline accepted? | Accepted before compact-contract adoption | M900-01-M900-03 | Synthetic baseline |

The baseline row is the explicit adoption boundary.

## Open Risks And Unverified Assumptions

| Risk or assumption | Consequence | Resolution path |
| --- | --- | --- |
| {RESOLVED_RISK} | Recurrence may silently overwrite meaning | Current frontier |
| Process state is local | Restart continuity is absent | Explicit non-goal |
"""


def proposal_review_plan_text() -> str:
    text = ready_plan_text().replace(
        "- Workflow state: ready_for_proposal\n",
        "- Workflow state: proposal_in_review\n",
        1,
    )
    text = text.replace(
        f"**{CURRENT_FRONTIER}**\n\n",
        f"**{CURRENT_FRONTIER}**\n\n- PR: [#58](https://example.invalid/58)\n",
        1,
    )
    return text.replace(
        "\n\n## Accepted Review Units",
        f"\n| {CURRENT_FRONTIER} | proposal_in_review | Proposal branch started. |"
        "\n\n## Accepted Review Units",
        1,
    )


def implementation_review_plan_text() -> str:
    text = ready_plan_text().replace(
        "- Workflow state: ready_for_proposal\n",
        "- Workflow state: implementation_in_review\n",
        1,
    )
    text = text.replace(
        f"**{CURRENT_FRONTIER}**\n\n",
        f"**{CURRENT_FRONTIER}**\n\n- PR: [#59](https://example.invalid/59)\n",
        1,
    )
    text = text.replace(
        f"- Proposal path: `{PROPOSAL_RELATIVE}`\n",
        f"- Proposal path: `{PROPOSAL_RELATIVE}`\n"
        "- Accepted proposal: [#58](https://example.invalid/58) at `def5678` "
        "(reviewed head `ffffffffffffffffffffffffffffffffffffffff` by "
        "`workflow-reviewer` as `COLLABORATOR` at "
        "`2026-08-12T18:00:00Z`)\n",
        1,
    )
    return text.replace(
        "\n\n## Accepted Review Units",
        f"\n| {CURRENT_FRONTIER} | proposal_in_review | Proposal branch started. |"
        f"\n| {CURRENT_FRONTIER} | ready_for_implementation | Proposal PR #58 accepted. |"
        f"\n| {CURRENT_FRONTIER} | implementation_in_review | Implementation branch started. |"
        "\n\n## Accepted Review Units",
        1,
    )


def handoff_template() -> dict[str, object]:
    return {
        "schema": "milestone_handoff_template_v1",
        "outcome": "advance",
        "result": "Accepted",
        "durable_evidence": "Focused evidence tests in PR #{pr}",
        "criterion_updates": {
            CURRENT_CRITERION: {
                "status": "Met",
                "evidence": "Evidence policy accepted in PR #{pr}",
            }
        },
        "risk_remove": [RESOLVED_RISK],
        "risk_upsert": [],
        "next_frontier": {
            "state": "none",
            "reason": "Between frontiers; remaining work is on the map.",
            "revisit_when": "The next proposal selects a node from the work order.",
        },
    }


def proposal_text() -> str:
    template = json.dumps(handoff_template(), indent=2, sort_keys=True)
    return f"""# Proposal: Evidence policy

## Review Kind

Deterministic invariant closure

## Review Question

Is the evidence policy bounded and deterministic?

## Proposed Contract

One slot has one structural contract.

## Trust And Authority Model

The synthetic ledger is authoritative for stored evidence. The claim covers
consistency and provenance, not authenticity against same-user mutation.

## Evidence Topology And Capture Strategy

The stored receipt feeds policy derivation and then the replay validator.
Focused implementation tests are sufficient; no canonical live artifact is
captured. Capture is ready when the receipt shape and mutation cases pass.

## Ownership

The synthetic evidence ledger owns compatibility.

## Affected Paths

Update, expiry, reset, and replay.

## Adversarial Matrix

| Case | Expected |
| --- | --- |
| Conflict | Invalidate |

## External Assumptions

Plugin IDs are stable within a source.

## Non-Goals

Semantic truth selection.

## File Impact

Memory implementation and focused tests.

## Validation Plan

Unit and replay tests.

## Expected Handoff

```json
{template}
```
"""


def proposal_amendment_text() -> str:
    return """# Proposal Amendment: Evidence policy lag tolerance

## Review Kind

Deterministic invariant closure

## Review Question

Is bounded lag accepted without weakening attributable evidence?

## Reason For Amendment

Live observation proved that exact-current correlation rejects known-good lag.

## Contract Delta

Accept current or bounded-stale observations with an explicit lag value.

## Trust And Authority Model

The original evidence authority remains unchanged. Sequence identifiers are
trusted for provenance within one run, not for cross-run authenticity.

## Evidence Topology And Capture Strategy

The observation receipt supplies the sequence value, the validator derives lag,
and focused amendment tests verify the bound. No new live capture is required.

## Ownership

The evidence validator owns the bounded-lag decision.

## Affected Paths

Live validation and operator-visible diagnostics.

## Adversarial Matrix

| Case | Expected |
| --- | --- |
| Beyond bound | Reject with observed lag |

## External Assumptions

Sequence identifiers are monotonic within one run.

## Non-Goals

Unbounded eventual consistency.

## File Impact

Validator, focused tests, and command catalog expectations.

## Validation Plan

Exercise current, bounded-stale, beyond-bound, and malformed observations.
"""


def repair_cycle_governance_body(
    *,
    rows: str = "| None | None | None | None | None | None |",
    stop: str | None = None,
) -> str:
    body = f"""## Repair Cycle Ledger

| Cycle | Review receipt | Classification | Highest severity | Repair revision | Contract impact |
| --- | --- | --- | --- | --- | --- |
{rows}
"""
    if stop:
        body += f"\n{stop.rstrip()}\n"
    return body


def implementation_adjunct_body() -> str:
    repair_governance = repair_cycle_governance_body()
    return f"""# HITL Implementation Adjunct — evidence inspection

## Parent Implementation

- Milestone: M900
- Current frontier: {CURRENT_FRONTIER}
- Parent implementation PR: #59
- Base implementation branch: `{IMPLEMENTATION_BRANCH}`
- Adjunct branch: `{IMPLEMENTATION_ADJUNCT_BRANCH}`

## Operator Request

- Request issue: #101

## HITL Authorization

- Human requester: Test operator
- Discovery context: Hands-on replay inspection exposed a presentation need.
- Requested disposition: `implement-now`

## Review Question

- Acceptance owner: Synthetic evidence presentation

Does the optional inspection view expose the accepted evidence without changing it?

## Compatibility

- [x] The parent contract remains true without this adjunct.
- [x] The change serves the same current frontier and operator journey.
- [x] The behavior is additive or optional and weakens no existing outcome.
- [x] No exit criterion, safety authority, schema, external assumption, expected handoff, or explicit non-goal changes.
- [x] No milestone plan, accepted proposal, or accepted amendment changes.
- [x] There is one bounded review question and the base is the parent branch.

## Scope

### In Scope

- Add the optional inspection presentation.

### Out Of Scope

- Change evidence selection or storage.

## Evidence Impact

- Existing evidence affected: None; the accepted policy is unchanged.
- Evidence to refresh: Presentation tests and the parent deterministic suite.
- Parent integration check: Repeat the parent adversarial matrix after merge.

{repair_governance}

## Validation

```text
python3 -m unittest tests.test_inspection
1 test passed
```
"""


def handoff_receipt(*, merge_commit: str = "deadbee") -> dict[str, object]:
    receipt = handoff_template()
    receipt["schema"] = "milestone_handoff_v1"
    receipt["accepted_pr"] = 59
    receipt["accepted_merge_commit"] = merge_commit
    return receipt
