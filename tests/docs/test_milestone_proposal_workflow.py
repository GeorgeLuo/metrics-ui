from __future__ import annotations

import copy
import json
import re
import subprocess
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from docs.milestones.workflow import (
    ContractReviewReceipt,
    Frontier,
    FrontierMap,
    PlanContractError,
    apply_handoff,
    RepairReviewMetadata,
    _require_merged_head_unchanged,
    _fetch_pr_repair_review_metadata,
    _fetch_pr_review_metadata,
    _cmd_validate_pr,
    accept_proposal,
    accept_proposal_amendment,
    start_implementation_branch,
    start_proposal_amendment_branch,
    validate_merged_proposal_amendment_metadata,
    validate_merged_proposal_metadata,
    validate_implementation_adjunct_body,
    validate_plan_text,
    validate_proposal_amendment_text,
    validate_proposal_text,
    validate_repair_cycle_governance_body,
    validate_review_unit_transition,
    validate_review_unit_git_diff,
    _frontier_body,
    _replace_frontier,
    _replace_frontier_map,
    _replace_header_value,
)
from tests.docs.milestone_workflow_fixtures import (
    CURRENT_CRITERION,
    CURRENT_FRONTIER,
    IMPLEMENTATION_ADJUNCT_BRANCH,
    IMPLEMENTATION_BRANCH,
    MILESTONE_BRANCH,
    NEXT_FRONTIER,
    NEXT_PROPOSAL_BRANCH,
    PLAN_RELATIVE,
    PROPOSAL_AMENDMENT_BRANCH,
    PROPOSAL_AMENDMENT_RELATIVE,
    PROPOSAL_BRANCH,
    PROPOSAL_RELATIVE,
    handoff_receipt,
    implementation_adjunct_body,
    implementation_review_plan_text,
    proposal_amendment_text,
    proposal_text,
    ready_plan_text,
    repair_cycle_governance_body,
)

PLAN_REVISION_BRANCH = "m900/plan-shadow-proposals"
REVISED_FRONTIER = "Shadow action proposals"
REVIEW_KIND = "Deterministic invariant closure"


def _review_unit_body(review_kind: str = REVIEW_KIND) -> str:
    return (
        "# Synthetic review unit\n\n"
        "## Review Kind\n\n"
        f"{review_kind}\n\n"
        "## Review Question\n\n"
        "Is the bounded contract acceptable?\n\n"
        f"{repair_cycle_governance_body()}\n"
    )


def _contract_review(
    *,
    head_oid: str,
    state: str = "COMMENTED",
    outcome: str = "accepted",
    submitted_at: str = "2026-08-12T18:00:00Z",
) -> dict[str, object]:
    body = (
        "## Contract Review Receipt\n\n"
        f"- Outcome: `{outcome}`\n"
        if state == "COMMENTED"
        else ""
    )
    return {
        "state": state,
        "body": body,
        "commit": {"oid": head_oid},
        "submittedAt": submitted_at,
        "author": {"login": "workflow-reviewer"},
        "authorAssociation": "COLLABORATOR",
        "authorCanPushToRepository": True,
        "includesCreatedEdit": False,
    }


def _accepted_review_receipt(
    head_oid: str = "f" * 40,
) -> ContractReviewReceipt:
    return ContractReviewReceipt(
        head_oid=head_oid,
        reviewer="workflow-reviewer",
        reviewer_association="COLLABORATOR",
        submitted_at="2026-08-12T18:00:00Z",
    )


REPAIR_PR_URL = "https://github.com/example/repository/pull/60"
REPAIR_PR_AUTHOR = "repair-author"


def _repair_review_record(
    *,
    url: str,
    body: str,
    head_oid: str,
    submitted_at: str,
    actor: str,
    comments: list[dict[str, str]] | None = None,
    state: str = "COMMENTED",
    association: str = "COLLABORATOR",
    can_push: bool = True,
) -> dict[str, object]:
    comment_nodes = comments or []
    return {
        "url": url,
        "state": state,
        "body": body,
        "commit": {"oid": head_oid},
        "submittedAt": submitted_at,
        "author": {"login": actor},
        "authorAssociation": association,
        "authorCanPushToRepository": can_push,
        "includesCreatedEdit": False,
        "comments": {
            "nodes": comment_nodes,
            "totalCount": len(comment_nodes),
        },
    }


def _contract_receipt_review(
    *,
    head_oid: str,
    outcome: str,
    actor: str = "workflow-reviewer",
    submitted_at: str = "2026-08-14T19:30:00Z",
) -> dict[str, object]:
    return _repair_review_record(
        url=f"{REPAIR_PR_URL}#pullrequestreview-800",
        body=(
            "## Contract Review Receipt\n\n"
            f"- Outcome: `{outcome}`\n"
        ),
        head_oid=head_oid,
        submitted_at=submitted_at,
        actor=actor,
    )


def _with_head_receipt(
    metadata: RepairReviewMetadata,
    outcome: str,
) -> RepairReviewMetadata:
    return RepairReviewMetadata(
        pull_request_number=metadata.pull_request_number,
        pull_request_url=metadata.pull_request_url,
        pull_request_author=metadata.pull_request_author,
        head_oid=metadata.head_oid,
        commits=metadata.commits,
        reviews=metadata.reviews
        + (
            _contract_receipt_review(
                head_oid=metadata.head_oid,
                outcome=outcome,
            ),
        ),
    )


def _governed_repair_case(
    *,
    classifications: tuple[str, ...] = ("substantial",),
    severities: tuple[str, ...] = ("P1",),
    head_changes_requested: bool = False,
) -> tuple[str, RepairReviewMetadata]:
    if len(classifications) != len(severities):
        raise AssertionError("classification and severity fixtures must align")
    commits = [f"{index:x}" * 40 for index in range(1, len(classifications) + 2)]
    reviews: list[dict[str, object]] = []
    ledger_rows: list[str] = []

    for cycle, (classification, severity) in enumerate(
        zip(classifications, severities, strict=True),
        start=1,
    ):
        reviewed_head = commits[cycle - 1]
        repair_head = commits[cycle]
        verdict_url = f"{REPAIR_PR_URL}#pullrequestreview-{100 + cycle}"
        finding_url = f"{REPAIR_PR_URL}#discussion_r{400 + cycle}"
        reviews.append(
            _repair_review_record(
                url=verdict_url,
                body=(
                    "Verdict: changes requested\n\n"
                    f"Classification: {classification}\n"
                    f"Highest severity: {severity}\n"
                ),
                head_oid=reviewed_head,
                submitted_at=f"2026-08-14T18:{cycle * 10:02d}:00Z",
                actor="workflow-reviewer",
                comments=[
                    {
                        "url": finding_url,
                        "body": f"[{severity}] Cycle {cycle} contract finding",
                    }
                ],
            )
        )
        ledger_rows.append(
            f"| {cycle} | {verdict_url} | {classification} | {severity} | "
            f"{repair_head} | Cycle {cycle} enforcement repair. |"
        )

    if head_changes_requested:
        reviews.append(
            _repair_review_record(
                url=f"{REPAIR_PR_URL}#pullrequestreview-999",
                body="Still blocked\n\nClassification: substantial\nHighest severity: P1\n",
                head_oid=commits[-1],
                submitted_at="2026-08-14T19:00:00Z",
                actor="workflow-reviewer",
                comments=[
                    {
                        "url": f"{REPAIR_PR_URL}#discussion_r999",
                        "body": "[P1] Still open on head",
                    }
                ],
                state="CHANGES_REQUESTED",
            )
        )

    body = repair_cycle_governance_body(
        rows="\n".join(ledger_rows),
    )
    metadata = RepairReviewMetadata(
        pull_request_number=60,
        pull_request_url=REPAIR_PR_URL,
        pull_request_author=REPAIR_PR_AUTHOR,
        head_oid=commits[-1],
        commits=tuple(commits),
        reviews=tuple(reviews),
    )
    return body, metadata



def _metadata_review(
    metadata: RepairReviewMetadata,
    url_suffix: str,
) -> dict[str, object]:
    matches = [
        review for review in metadata.reviews if str(review.get("url", "")).endswith(url_suffix)
    ]
    if len(matches) != 1:
        raise AssertionError(f"fixture review not found: {url_suffix}")
    return matches[0]


def _replace_section_body(text: str, heading: str, body: str) -> str:
    pattern = rf"(?ms)^{re.escape(heading)}\n.*?(?=^## |\Z)"
    replacement = f"{heading}\n\n{body.strip()}\n\n"
    updated, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise AssertionError(f"missing fixture section: {heading}")
    return updated


def _remove_section(text: str, heading: str) -> str:
    pattern = rf"(?ms)^{re.escape(heading)}\n.*?(?=^## |\Z)"
    updated, count = re.subn(pattern, "", text, count=1)
    if count != 1:
        raise AssertionError(f"missing fixture section: {heading}")
    return updated


def _move_to_review(text: str, *, implementation: bool = False) -> str:
    state = validate_plan_text(text)
    old_state = state.current.fields["workflow state"]
    new_state = (
        "implementation_in_review" if implementation else "proposal_in_review"
    )
    updated = text.replace(
        f"- Workflow state: {old_state}\n",
        f"- Workflow state: {new_state}\n",
        1,
    )
    return updated.replace(
        "\n\n## Accepted Review Units",
        f"\n| {state.current.name} | {new_state} | Review branch started. |"
        "\n\n## Accepted Review Units",
        1,
    )


def _terminal_plan(text: str, status: str) -> str:
    empty = Frontier(
        name=None,
        fields={
            "reason": f"{status} milestone is not proposal-eligible.",
            "revisit when": "A separate activation or resume route is defined.",
        },
    )
    updated = _replace_header_value(text, "Status", status)
    updated = _replace_header_value(updated, "Current frontier", "None")
    updated = _replace_frontier(
        updated,
        "### Current Frontier",
        _frontier_body(empty, current=True),
    )
    updated = _replace_frontier(
        updated,
        "### Next-Frontier Candidate",
        _frontier_body(empty, current=False),
    )
    return _replace_frontier_map(
        updated,
        FrontierMap(path=(), cadence="linked-list", nodes=(), off_path=()),
    )


def _revise_plan(text: str) -> str:
    revised = text.replace(
        "| Process state is local | Restart continuity is absent | Explicit non-goal |",
        "| Process state is local | Restart continuity is absent | Documented handoff |",
        1,
    )
    return revised.replace(
        "\n\n## Accepted Review Units",
        f"\n| {CURRENT_FRONTIER} | ready_for_proposal | "
        "Plan revision: documented the handoff risk. |"
        "\n\n## Accepted Review Units",
        1,
    )


def _idle_plan_with_revision() -> str:
    idle = _terminal_plan(ready_plan_text(), "Active")
    return idle.replace(
        "\n\n## Accepted Review Units",
        "\n| Idle | idle | Plan revision: established the idle baseline. |"
        "\n\n## Accepted Review Units",
        1,
    )


def _accepted_plan() -> str:
    return accept_proposal(
        _move_to_review(ready_plan_text()),
        proposal_pr=60,
        merge_commit="a" * 40,
        proposal_url="https://example.invalid/60",
        review_receipt=_accepted_review_receipt(),
    )


def _move_to_amendment_review(
    text: str,
    *,
    branch: str = PROPOSAL_AMENDMENT_BRANCH,
    path: str = PROPOSAL_AMENDMENT_RELATIVE,
) -> str:
    state = validate_plan_text(text)
    accepted = state.current.fields["accepted proposal"]
    updated = text.replace(
        "- Workflow state: ready_for_implementation\n",
        "- Workflow state: proposal_amendment_in_review\n",
        1,
    )
    if state.current.fields.get("proposal amendment branch"):
        old_branch = state.current.fields["proposal amendment branch"]
        old_path = state.current.fields["proposal amendment path"]
        updated = updated.replace(
            f"- Proposal amendment branch: {old_branch}\n",
            f"- Proposal amendment branch: `{branch}`\n",
            1,
        ).replace(
            f"- Proposal amendment path: {old_path}\n",
            f"- Proposal amendment path: `{path}`\n",
            1,
        )
    else:
        updated = updated.replace(
            f"- Accepted proposal: {accepted}\n",
            f"- Accepted proposal: {accepted}\n"
            f"- Proposal amendment branch: `{branch}`\n"
            f"- Proposal amendment path: `{path}`\n",
            1,
        )
    return updated.replace(
        "\n\n## Accepted Review Units",
        f"\n| {CURRENT_FRONTIER} | proposal_amendment_in_review | "
        "Proposal amendment branch started. |"
        "\n\n## Accepted Review Units",
        1,
    )


class ProposalDocumentTests(unittest.TestCase):
    def test_required_proposal_shape_is_accepted(self) -> None:
        validate_proposal_text(proposal_text())

    def test_universal_claim_requires_trust_and_authority_model(self) -> None:
        invalid = proposal_text().replace(
            "## Trust And Authority Model",
            "## Trust Notes",
        )
        with self.assertRaisesRegex(PlanContractError, "Trust And Authority Model"):
            validate_proposal_text(invalid)

    def test_universal_claim_requires_evidence_topology_and_capture(self) -> None:
        invalid = proposal_text().replace(
            "## Evidence Topology And Capture Strategy",
            "## Evidence Notes",
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "Evidence Topology And Capture Strategy",
        ):
            validate_proposal_text(invalid)

    def test_universal_claim_rejects_an_empty_contractability_section(self) -> None:
        invalid = _replace_section_body(
            proposal_text(),
            "## Trust And Authority Model",
            "<!-- model pending -->",
        )
        with self.assertRaisesRegex(PlanContractError, "must be completed"):
            validate_proposal_text(invalid)

    def test_non_universal_proposal_does_not_require_contractability_sections(
        self,
    ) -> None:
        ordinary = proposal_text().replace(
            "Deterministic invariant closure",
            "Behavioral feature slice",
        ).replace(
            "Is the evidence policy bounded and deterministic?",
            "Does the evidence policy assign one structural contract?",
        )
        ordinary = _remove_section(
            ordinary,
            "## Trust And Authority Model",
        )
        ordinary = _remove_section(
            ordinary,
            "## Evidence Topology And Capture Strategy",
        )
        validate_proposal_text(ordinary)

    def test_universal_language_does_not_trigger_without_invariant_kind(self) -> None:
        ordinary = proposal_text().replace(
            "Deterministic invariant closure",
            "Broad mechanical rollout",
        ).replace(
            "One slot has one structural contract.",
            "One slot has one exact structural contract.",
        )
        ordinary = _remove_section(ordinary, "## Trust And Authority Model")
        ordinary = _remove_section(
            ordinary,
            "## Evidence Topology And Capture Strategy",
        )
        validate_proposal_text(ordinary)

    def test_missing_validation_plan_is_rejected(self) -> None:
        with self.assertRaisesRegex(PlanContractError, "Validation Plan"):
            validate_proposal_text(
                proposal_text().replace("## Validation Plan", "## Checks")
            )

    def test_missing_expected_handoff_is_rejected(self) -> None:
        with self.assertRaisesRegex(PlanContractError, "Expected Handoff"):
            validate_proposal_text(
                proposal_text().replace("## Expected Handoff", "## Later State")
            )

    def test_required_proposal_amendment_shape_is_accepted(self) -> None:
        validate_proposal_amendment_text(proposal_amendment_text())

    def test_universal_amendment_requires_contractability_delta(self) -> None:
        invalid = _remove_section(
            proposal_amendment_text(),
            "## Evidence Topology And Capture Strategy",
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "Evidence Topology And Capture Strategy",
        ):
            validate_proposal_amendment_text(invalid)

    def test_non_universal_amendment_does_not_require_contractability_sections(
        self,
    ) -> None:
        ordinary = proposal_amendment_text().replace(
            "Deterministic invariant closure",
            "Behavioral feature slice",
        ).replace(
            "Is bounded lag accepted without weakening attributable evidence?",
            "Is attributable lag accepted without weakening evidence?",
        ).replace(
            "Accept current or bounded-stale observations with an explicit lag value.",
            "Accept current or recent observations with an explicit lag value.",
        )
        ordinary = _remove_section(ordinary, "## Trust And Authority Model")
        ordinary = _remove_section(
            ordinary,
            "## Evidence Topology And Capture Strategy",
        )
        validate_proposal_amendment_text(ordinary)

    def test_proposal_amendment_requires_contract_delta(self) -> None:
        with self.assertRaisesRegex(PlanContractError, "Contract Delta"):
            validate_proposal_amendment_text(
                proposal_amendment_text().replace(
                    "## Contract Delta",
                    "## Revised Idea",
                )
            )

    def test_required_implementation_adjunct_body_is_accepted(self) -> None:
        validate_implementation_adjunct_body(
            implementation_adjunct_body(),
            base_branch=IMPLEMENTATION_BRANCH,
        )

    def test_implementation_adjunct_requires_implement_now_direction(self) -> None:
        invalid = implementation_adjunct_body().replace(
            "Requested disposition: `implement-now`",
            "Requested disposition: `later`",
        )
        with self.assertRaisesRegex(PlanContractError, "implement-now"):
            validate_implementation_adjunct_body(
                invalid,
                base_branch=IMPLEMENTATION_BRANCH,
            )

    def test_implementation_adjunct_requires_checked_compatibility(self) -> None:
        invalid = implementation_adjunct_body().replace(
            "- [x] The parent contract remains true without this adjunct.",
            "- [ ] The parent contract remains true without this adjunct.",
        )
        with self.assertRaisesRegex(PlanContractError, "not checked"):
            validate_implementation_adjunct_body(
                invalid,
                base_branch=IMPLEMENTATION_BRANCH,
            )

    def test_implementation_adjunct_names_its_actual_base(self) -> None:
        with self.assertRaisesRegex(PlanContractError, "must match its PR base"):
            validate_implementation_adjunct_body(
                implementation_adjunct_body(),
                base_branch="m900/different-parent",
            )


class RepairCycleGovernanceTests(unittest.TestCase):
    def test_initial_review_receipt_is_accepted(self) -> None:
        self.assertEqual(
            validate_repair_cycle_governance_body(
                repair_cycle_governance_body()
            ),
            0,
        )

    def test_declared_cycle_requires_github_metadata(self) -> None:
        body, _ = _governed_repair_case()
        with self.assertRaisesRegex(PlanContractError, "structured GitHub"):
            validate_repair_cycle_governance_body(body)

    def test_one_substantial_cycle_is_bound_to_exact_review_evidence(self) -> None:
        body, metadata = _governed_repair_case()
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            1,
        )

    def test_arbitrary_review_reference_is_rejected(self) -> None:
        body, metadata = _governed_repair_case()
        body = body.replace(
            f"{REPAIR_PR_URL}#pullrequestreview-101",
            "#1",
            1,
        )
        with self.assertRaisesRegex(PlanContractError, "review on PR"):
            validate_repair_cycle_governance_body(body, review_metadata=metadata)

    def test_second_substantial_cycle_does_not_require_a_stop(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial", "substantial"),
            severities=("P1", "P1"),
        )
        self.assertNotIn("## Repair Stop", body)
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            2,
        )

    def test_completion_requires_accepted_receipt_not_inline_findings(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial",),
            severities=("P1",),
        )
        with self.assertRaisesRegex(PlanContractError, "Outcome: accepted"):
            validate_repair_cycle_governance_body(
                body,
                review_metadata=metadata,
                require_resolved_findings=True,
            )
        accepted = _with_head_receipt(metadata, "accepted")
        self.assertEqual(
            validate_repair_cycle_governance_body(
                body,
                review_metadata=accepted,
                require_resolved_findings=True,
            ),
            1,
        )

    def test_completion_rejects_head_moved_after_merge(self) -> None:
        _, metadata = _governed_repair_case()
        stale = RepairReviewMetadata(
            pull_request_number=metadata.pull_request_number,
            pull_request_url=metadata.pull_request_url,
            pull_request_author=metadata.pull_request_author,
            head_oid=metadata.head_oid,
            commits=metadata.commits,
            reviews=metadata.reviews,
            merged_at="2026-08-14T18:00:00Z",
            head_committed_at="2026-08-14T19:00:00Z",
        )
        with self.assertRaisesRegex(PlanContractError, "head changed after merge"):
            _require_merged_head_unchanged(stale)
        frozen = RepairReviewMetadata(
            pull_request_number=metadata.pull_request_number,
            pull_request_url=metadata.pull_request_url,
            pull_request_author=metadata.pull_request_author,
            head_oid=metadata.head_oid,
            commits=metadata.commits,
            reviews=metadata.reviews,
            merged_at="2026-08-14T19:00:00Z",
            head_committed_at="2026-08-14T18:00:00Z",
        )
        _require_merged_head_unchanged(frozen)

    def test_completion_rejects_changes_requested_receipt(self) -> None:
        body, metadata = _governed_repair_case()
        rejected = _with_head_receipt(metadata, "changes_requested")
        with self.assertRaisesRegex(PlanContractError, "changes_requested"):
            validate_repair_cycle_governance_body(
                body,
                review_metadata=rejected,
                require_resolved_findings=True,
            )

    def test_open_review_unit_migration_preserves_historical_cycles(self) -> None:
        migration = """## Repair Contract Migration

- PR: #60
- Prior governing base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- Adopted contract: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
- Cumulative cycles: 2
- Cumulative classifications: substantial, substantial
- Unresolved finding manifest: https://github.com/example/repository/pull/60#discussion_r401
- Migration point: cccccccccccccccccccccccccccccccccccccccc
- Decision receipt: https://github.com/example/repository/pull/60#issuecomment-999
- Route: continue-current-unit
- Disposition: Continue the existing review unit under the adopted contract.
"""
        metadata = RepairReviewMetadata(
            pull_request_number=60,
            pull_request_url=REPAIR_PR_URL,
            pull_request_author=REPAIR_PR_AUTHOR,
            head_oid="d" * 40,
            commits=("d" * 40,),
            reviews=(),
        )
        body = repair_cycle_governance_body() + "\n" + migration
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            2,
        )
        with self.assertRaisesRegex(PlanContractError, "Outcome: accepted"):
            validate_repair_cycle_governance_body(
                body,
                review_metadata=metadata,
                require_resolved_findings=True,
            )
        accepted = _with_head_receipt(metadata, "accepted")
        self.assertEqual(
            validate_repair_cycle_governance_body(
                body,
                review_metadata=accepted,
                require_resolved_findings=True,
            ),
            2,
        )

    def test_minor_cycles_do_not_consume_substantial_cycle_budget(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("minor", "substantial"),
            severities=("P3", "P1"),
        )
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            1,
        )

    def test_minor_cycle_after_threshold_preserves_prior_exact_head_decision(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial", "substantial", "minor"),
            severities=("P1", "P1", "P3"),
        )
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            2,
        )

    def test_later_substantial_cycles_remain_ordinary_repairs(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial", "substantial", "substantial"),
            severities=("P1", "P1", "P1"),
        )
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            3,
        )

    def test_missing_reviewer_severity_fails_closed(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial",),
            severities=("P0",),
        )
        metadata = copy.deepcopy(metadata)
        verdict = _metadata_review(metadata, "pullrequestreview-101")
        comments = verdict["comments"]
        assert isinstance(comments, dict)
        nodes = comments["nodes"]
        assert isinstance(nodes, list)
        nodes[0]["body"] = "Unsafe boundary without a structured severity"
        with self.assertRaisesRegex(PlanContractError, "reviewer-owned.*severity"):
            validate_repair_cycle_governance_body(body, review_metadata=metadata)

    def test_negated_p0_impact_does_not_create_reviewer_severity(self) -> None:
        body, metadata = _governed_repair_case()
        body = body.replace(
            "Cycle 1 enforcement repair.",
            "No P0 remains after the enforcement repair.",
        )
        self.assertEqual(
            validate_repair_cycle_governance_body(body, review_metadata=metadata),
            1,
        )

    def test_ledger_severity_must_match_reviewer_manifest(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial",),
            severities=("P0",),
        )
        body = body.replace("| substantial | P0 |", "| substantial | P1 |", 1)
        with self.assertRaisesRegex(PlanContractError, "highest severity"):
            validate_repair_cycle_governance_body(body, review_metadata=metadata)

    def test_reviewer_severity_declaration_cannot_conflict_with_findings(self) -> None:
        body, metadata = _governed_repair_case(
            classifications=("substantial",),
            severities=("P0",),
        )
        metadata = copy.deepcopy(metadata)
        verdict = _metadata_review(metadata, "pullrequestreview-101")
        verdict["body"] = str(verdict["body"]).replace(
            "Highest severity: P0",
            "Highest severity: P1",
        )
        with self.assertRaisesRegex(PlanContractError, "conflicts"):
            validate_repair_cycle_governance_body(body, review_metadata=metadata)

    def test_cycle_numbers_must_be_consecutive(self) -> None:
        body, metadata = _governed_repair_case()
        body = body.replace("| 1 |", "| 2 |", 1)
        with self.assertRaisesRegex(PlanContractError, "consecutive from 1"):
            validate_repair_cycle_governance_body(body, review_metadata=metadata)


class RepairMetadataFetchTests(unittest.TestCase):
    def _response(self) -> dict[str, object]:
        body, metadata = _governed_repair_case()
        del body
        return {
            "data": {
                "repository": {
                    "pullRequest": {
                        "number": metadata.pull_request_number,
                        "url": metadata.pull_request_url,
                        "headRefOid": metadata.head_oid,
                        "author": {"login": metadata.pull_request_author},
                        "commits": {
                            "totalCount": len(metadata.commits),
                            "nodes": [
                                {"commit": {"oid": oid}} for oid in metadata.commits
                            ],
                        },
                        "reviews": {
                            "totalCount": len(metadata.reviews),
                            "nodes": list(metadata.reviews),
                        },
                    }
                }
            }
        }

    def test_fetch_exposes_pr_identity_commits_reviews_and_findings(self) -> None:
        completed = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout='{"nameWithOwner":"example/repository"}',
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(self._response()),
                stderr="",
            ),
        ]
        with mock.patch(
            "docs.milestones.workflow.subprocess.run",
            side_effect=completed,
        ):
            metadata = _fetch_pr_repair_review_metadata(60)

        self.assertEqual(metadata.pull_request_author, REPAIR_PR_AUTHOR)
        self.assertEqual(metadata.head_oid, metadata.commits[-1])
        verdict = _metadata_review(metadata, "pullrequestreview-101")
        comments = verdict["comments"]
        assert isinstance(comments, dict)
        self.assertEqual(comments["totalCount"], 1)

    def test_fetch_fails_closed_when_review_history_would_truncate(self) -> None:
        response = self._response()
        pull_request = response["data"]["repository"]["pullRequest"]  # type: ignore[index]
        pull_request["reviews"] = {"totalCount": 101, "nodes": []}  # type: ignore[index]
        completed = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout='{"nameWithOwner":"example/repository"}',
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(response),
                stderr="",
            ),
        ]
        with mock.patch(
            "docs.milestones.workflow.subprocess.run",
            side_effect=completed,
        ):
            with self.assertRaisesRegex(PlanContractError, "100-review"):
                _fetch_pr_repair_review_metadata(60)


class WorkflowStateContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plan = ready_plan_text()

    def test_implementation_ready_requires_accepted_proposal_receipt(self) -> None:
        invalid = self.plan.replace(
            "- Workflow state: ready_for_proposal\n",
            "- Workflow state: ready_for_implementation\n",
            1,
        ).replace(
            f"| {CURRENT_FRONTIER} | ready_for_proposal |",
            f"| {CURRENT_FRONTIER} | ready_for_implementation |",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "requires an accepted proposal",
        ):
            validate_plan_text(invalid)

    def test_latest_history_must_match_current_state(self) -> None:
        invalid = self.plan.replace(
            "- Workflow state: ready_for_proposal\n",
            "- Workflow state: proposal_in_review\n",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "latest state does not match",
        ):
            validate_plan_text(invalid)

    def test_ready_for_implementation_requires_durable_review_receipt(self) -> None:
        accepted = _accepted_plan()
        without_receipt = accepted.replace(
            " (reviewed head `ffffffffffffffffffffffffffffffffffffffff` by "
            "`workflow-reviewer` as `COLLABORATOR` at "
            "`2026-08-12T18:00:00Z`)",
            "",
            1,
        )
        with self.assertRaisesRegex(PlanContractError, "contract review receipt"):
            validate_plan_text(without_receipt)

    def test_frontier_rejects_unsupported_review_kind(self) -> None:
        invalid = self.plan.replace(
            f"- Review kind: {REVIEW_KIND}\n",
            "- Review kind: Exploratory bundle\n",
            1,
        )
        with self.assertRaisesRegex(PlanContractError, "unsupported review kind"):
            validate_plan_text(invalid)

    def test_preproposal_plan_revision_preserves_history(self) -> None:
        state = validate_plan_text(_revise_plan(self.plan))

        self.assertEqual(state.current.name, CURRENT_FRONTIER)
        self.assertEqual(
            state.workflow_history.rows[-2:],
            (
                (
                    CURRENT_FRONTIER,
                    "ready_for_proposal",
                    "Synthetic frontier is ready.",
                ),
                (
                    CURRENT_FRONTIER,
                    "ready_for_proposal",
                    "Plan revision: documented the handoff risk.",
                ),
            ),
        )

    def test_consecutive_idle_plan_revisions_preserve_history(self) -> None:
        base = _idle_plan_with_revision()
        revised = base.replace(
            "\n\n## Accepted Review Units",
            "\n| Idle | idle | Plan revision: refined milestone facts. |"
            "\n\n## Accepted Review Units",
            1,
        )

        state = validate_plan_text(revised)
        transition = validate_review_unit_transition(
            base,
            revised,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
            },
            head_branch=PLAN_REVISION_BRANCH,
        )

        self.assertEqual(transition, "plan_revision")
        self.assertEqual(
            state.workflow_history.rows[-2:],
            (
                (
                    "Idle",
                    "idle",
                    "Plan revision: established the idle baseline.",
                ),
                (
                    "Idle",
                    "idle",
                    "Plan revision: refined milestone facts.",
                ),
            ),
        )


class ReviewUnitTransitionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base = ready_plan_text()
        self.proposal_head = _move_to_review(self.base)

    def test_opening_proposal_rejects_non_active_empty_base(self) -> None:
        for status in ("Blocked", "pre-plan", "closed"):
            with self.subTest(status=status):
                with self.assertRaisesRegex(
                    PlanContractError,
                    "opening proposal requires an Active milestone",
                ):
                    validate_review_unit_transition(
                        _terminal_plan(self.base, status),
                        self.proposal_head,
                        plan_path=PLAN_RELATIVE,
                        changed_paths={
                            PLAN_RELATIVE,
                            str(Path(PLAN_RELATIVE).with_suffix(".html")),
                            PROPOSAL_RELATIVE,
                        },
                        head_branch=PROPOSAL_BRANCH,
                        proposal_text=proposal_text(),
                        pr_body=_review_unit_body(),
                    )

    def test_proposal_pr_is_documentation_only(self) -> None:
        transition = validate_review_unit_transition(
            self.base,
            self.proposal_head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                PROPOSAL_RELATIVE,
            },
            head_branch=PROPOSAL_BRANCH,
            proposal_text=proposal_text(),
            pr_body=_review_unit_body(),
        )
        self.assertEqual(transition, "proposal")

    def test_opening_proposal_can_edit_current_before_contract_receipt(self) -> None:
        changed = self.proposal_head.replace(
            "Does repeated evidence follow one deterministic contract?",
            "Does the revised evidence follow one deterministic contract?",
            1,
        )

        transition = validate_review_unit_transition(
            self.base,
            changed,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                PROPOSAL_RELATIVE,
            },
            head_branch=PROPOSAL_BRANCH,
            proposal_text=proposal_text(),
            pr_body=_review_unit_body(),
        )

        self.assertEqual(transition, "proposal")

    def test_proposal_pr_may_rewire_remaining_path(self) -> None:
        inserted = "Capability inventory"
        head = self.proposal_head.replace(
            f"- Path: `{NEXT_FRONTIER}`",
            f"- Path: `{inserted}` → `{NEXT_FRONTIER}`",
            1,
        )
        node = f"""
#### Node: {inserted}

- Proposal branch: `m900/inventory-proposal`
- Implementation branch: `m900/inventory`
- Proposal path: `docs/milestones/900-workflow-fixture/proposals/inventory.md`
- Review kind: Deterministic invariant closure
- Review question: Are unreached regions grouped?
- Acceptance owner: Inventory validator
- Exit criteria affected: M900-02
- Prerequisite: Current policy is accepted
- Non-goals: Product deletion
"""
        head = head.replace(
            f"#### Node: {NEXT_FRONTIER}",
            node + f"#### Node: {NEXT_FRONTIER}",
            1,
        )
        next_block = f"""**{inserted}**

- Proposal branch: `m900/inventory-proposal`
- Implementation branch: `m900/inventory`
- Proposal path: `docs/milestones/900-workflow-fixture/proposals/inventory.md`
- Review kind: Deterministic invariant closure
- Review question: Are unreached regions grouped?
- Acceptance owner: Inventory validator
- Exit criteria affected: M900-02
- Prerequisite: Current policy is accepted
- Non-goals: Product deletion
"""
        start = head.index("### Next-Frontier Candidate")
        end = head.index("### Frontier Map")
        head = (
            head[:start]
            + "### Next-Frontier Candidate\n\n"
            + next_block
            + "\n"
            + head[end:]
        )
        transition = validate_review_unit_transition(
            self.base,
            head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                PROPOSAL_RELATIVE,
            },
            head_branch=PROPOSAL_BRANCH,
            proposal_text=proposal_text(),
            pr_body=_review_unit_body(),
        )
        self.assertEqual(transition, "proposal")

    def test_proposal_pr_cannot_delete_contracted_nodes(self) -> None:
        head = self.proposal_head.replace(
            f"- Path: `{NEXT_FRONTIER}`",
            "- Path: none",
            1,
        )
        start = head.index("#### Node:")
        end = head.index("## Workflow History")
        head = head[:start] + head[end:]
        start = head.index("### Next-Frontier Candidate")
        end = head.index("### Frontier Map")
        head = (
            head[:start]
            + "### Next-Frontier Candidate\n\n**None**\n\n"
            "- Reason: No successor is contracted yet.\n"
            "- Revisit when: Closeout is queued on a later proposal.\n\n"
            + head[end:]
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot delete contracted frontier nodes",
        ):
            validate_review_unit_transition(
                self.base,
                head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    PROPOSAL_RELATIVE,
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
                pr_body=_review_unit_body(),
            )

    def test_implementation_pr_cannot_change_frontier_map(self) -> None:
        base = _accepted_plan()
        parked = """
#### Off-path: Parked later unit

- Proposal branch: `m900/parked-proposal`
- Implementation branch: `m900/parked`
- Proposal path: `docs/milestones/900-workflow-fixture/proposals/parked.md`
- Review kind: Deterministic invariant closure
- Review question: Should this remain off-path?
- Acceptance owner: Parked owner
- Exit criteria affected: M900-02
- Prerequisite: Current policy is accepted
- Non-goals: Product deletion
- Off-path reason: Discovered during implementation and parked
"""
        head = _move_to_review(base, implementation=True).replace(
            "\n## Workflow History",
            parked + "\n## Workflow History",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot change the frontier map",
        ):
            validate_review_unit_transition(
                base,
                head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    "implementations/memory/bounded_evidence.py",
                },
                head_branch=IMPLEMENTATION_BRANCH,
                pr_body=_review_unit_body(),
            )

    def test_proposal_pr_review_kind_must_match_plan(self) -> None:
        with self.assertRaisesRegex(PlanContractError, "does not match"):
            validate_review_unit_transition(
                self.base,
                self.proposal_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    PROPOSAL_RELATIVE,
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
                pr_body=_review_unit_body("Behavioral feature slice"),
            )

    def test_proposal_pr_requires_one_completed_review_kind(self) -> None:
        duplicate = _review_unit_body() + "\n## Review Kind\n\nReview repair\n"
        with self.assertRaisesRegex(PlanContractError, "exactly one"):
            validate_review_unit_transition(
                self.base,
                self.proposal_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={PLAN_RELATIVE, PROPOSAL_RELATIVE},
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
                pr_body=duplicate,
            )

    def test_proposal_pr_requires_pr_body(self) -> None:
        with self.assertRaisesRegex(PlanContractError, "requires the PR body"):
            validate_review_unit_transition(
                self.base,
                self.proposal_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={PLAN_RELATIVE, PROPOSAL_RELATIVE},
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
            )

    def test_milestone_review_unit_pr_body_requires_repair_receipts(self) -> None:
        # Keep a valid Review Kind so the repair-cycle gate is the failing check.
        body = (
            "# Synthetic review unit\n\n"
            f"## Review Kind\n\n{REVIEW_KIND}\n\n"
            "## Review Question\n\n"
            "Is the bounded contract acceptable?\n"
        )
        with self.assertRaisesRegex(PlanContractError, "Repair Cycle Ledger"):
            validate_review_unit_transition(
                self.base,
                self.proposal_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    PROPOSAL_RELATIVE,
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
                pr_body=body,
            )

    def test_proposal_pr_must_write_frontier_map(self) -> None:
        start = self.proposal_head.index("### Frontier Map")
        end = self.proposal_head.index("## Workflow History")
        head = self.proposal_head[:start] + self.proposal_head[end:]
        with self.assertRaisesRegex(
            PlanContractError,
            "proposal PR must write ### Frontier Map",
        ):
            validate_review_unit_transition(
                self.base,
                head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    PROPOSAL_RELATIVE,
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
                pr_body=_review_unit_body(),
            )

    def test_proposal_cannot_change_current_after_contract_receipt(self) -> None:
        frozen = validate_plan_text(self.proposal_head).current
        changed = self.proposal_head.replace(
            "Does repeated evidence follow one deterministic contract?",
            "Did the review question move after the receipt?",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot change frozen current field 'review question'",
        ):
            validate_review_unit_transition(
                self.base,
                changed,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    PROPOSAL_RELATIVE,
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
                pr_body=_review_unit_body(),
                frozen_current=frozen,
            )

    def test_plan_revision_can_edit_milestone_facts(self) -> None:
        transition = validate_review_unit_transition(
            self.base,
            _revise_plan(self.base),
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
            },
            head_branch=PLAN_REVISION_BRANCH,
        )

        self.assertEqual(transition, "plan_revision")

    def test_plan_revision_cannot_change_current_or_work_order(self) -> None:
        renamed = self.base.replace(
            f"| Current frontier | {CURRENT_FRONTIER} |",
            f"| Current frontier | {REVISED_FRONTIER} |",
            1,
        ).replace(
            f"**{CURRENT_FRONTIER}**",
            f"**{REVISED_FRONTIER}**",
            1,
        ).replace(
            "\n\n## Accepted Review Units",
            f"\n| {REVISED_FRONTIER} | ready_for_proposal | "
            "Plan revision: renamed the current frontier. |"
            "\n\n## Accepted Review Units",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot change the current frontier",
        ):
            validate_review_unit_transition(
                self.base,
                renamed,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                },
                head_branch=PLAN_REVISION_BRANCH,
            )

    def test_plan_revision_normalizes_markdown_formatted_workflow_state(self) -> None:
        formatted_base = self.base.replace(
            "- Workflow state: ready_for_proposal\n",
            "- Workflow state: `ready_for_proposal`\n",
            1,
        )
        transition = validate_review_unit_transition(
            formatted_base,
            _revise_plan(formatted_base),
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
            },
            head_branch=PLAN_REVISION_BRANCH,
        )

        self.assertEqual(transition, "plan_revision")

    def test_plan_revision_rejects_non_plan_files(self) -> None:
        with self.assertRaisesRegex(
            PlanContractError,
            "contains non-plan changes",
        ):
            validate_review_unit_transition(
                self.base,
                _revise_plan(self.base),
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    "implementations/decision/proposals.py",
                },
                head_branch=PLAN_REVISION_BRANCH,
            )

    def test_plan_revision_requires_rendered_html(self) -> None:
        with self.assertRaisesRegex(
            PlanContractError,
            "must update canonical plan and rendered HTML",
        ):
            validate_review_unit_transition(
                self.base,
                _revise_plan(self.base),
                plan_path=PLAN_RELATIVE,
                changed_paths={PLAN_RELATIVE},
                head_branch=PLAN_REVISION_BRANCH,
            )

    def test_plan_revision_is_unavailable_after_review_starts(self) -> None:
        started = _move_to_review(self.base)
        with self.assertRaisesRegex(
            PlanContractError,
            "unavailable after proposal work has started",
        ):
            validate_review_unit_transition(
                started,
                started,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                },
                head_branch=PLAN_REVISION_BRANCH,
            )

    def test_plan_revision_cannot_rewrite_accepted_ledger(self) -> None:
        revised = _revise_plan(self.base).replace(
            "Synthetic baseline",
            "Reinterpreted baseline",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot rewrite accepted review-unit evidence",
        ):
            validate_review_unit_transition(
                self.base,
                revised,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                },
                head_branch=PLAN_REVISION_BRANCH,
            )

    def test_plan_revision_cannot_preclaim_met_criterion(self) -> None:
        revised = _revise_plan(self.base).replace(
            f"| {CURRENT_CRITERION} | Evidence conflicts are deterministic "
            "| Partial | Policy remains open |",
            f"| {CURRENT_CRITERION} | Evidence conflicts are deterministic "
            "| Met | Plan says so |",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot add or rewrite a Met exit criterion",
        ):
            validate_review_unit_transition(
                self.base,
                revised,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                },
                head_branch=PLAN_REVISION_BRANCH,
            )

    def test_plan_revision_requires_reserved_branch(self) -> None:
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot pre-claim risk resolution",
        ):
            validate_review_unit_transition(
                self.base,
                _revise_plan(self.base),
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                },
                head_branch="m900/shadow-proposals",
            )

    def test_proposal_pr_normalizes_opened_branch_annotation(self) -> None:
        annotated = f"`{PROPOSAL_BRANCH}` (planned; not opened)"
        base = self.base.replace(f"`{PROPOSAL_BRANCH}`", annotated, 1)
        head = _move_to_review(base).replace(annotated, f"`{PROPOSAL_BRANCH}`", 1)

        transition = validate_review_unit_transition(
            base,
            head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                PROPOSAL_RELATIVE,
            },
            head_branch=PROPOSAL_BRANCH,
            proposal_text=proposal_text(),
            pr_body=_review_unit_body(),
        )

        self.assertEqual(transition, "proposal")

    def test_proposal_pr_cannot_change_opened_branch_identity(self) -> None:
        annotated = f"`{PROPOSAL_BRANCH}` (planned; not opened)"
        base = self.base.replace(f"`{PROPOSAL_BRANCH}`", annotated, 1)
        head = _move_to_review(base).replace(
            annotated,
            "`m900/different-proposal`",
            1,
        )

        with self.assertRaisesRegex(
            PlanContractError,
            "changed frozen proposal branch identity",
        ):
            validate_review_unit_transition(
                base,
                head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                    PROPOSAL_RELATIVE,
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
            )

    def test_proposal_pr_rejects_implementation_file(self) -> None:
        with self.assertRaisesRegex(
            PlanContractError,
            "contains implementation changes",
        ):
            validate_review_unit_transition(
                self.base,
                self.proposal_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    PROPOSAL_RELATIVE,
                    "implementations/memory/bounded_evidence.py",
                },
                head_branch=PROPOSAL_BRANCH,
                proposal_text=proposal_text(),
            )

    def test_opening_proposal_can_rewrite_non_goals_before_contract_receipt(
        self,
    ) -> None:
        changed_contract = self.proposal_head.replace(
            "Semantic identity",
            "Anything the implementer chooses",
            1,
        )
        transition = validate_review_unit_transition(
            self.base,
            changed_contract,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                PROPOSAL_RELATIVE,
            },
            head_branch=PROPOSAL_BRANCH,
            proposal_text=proposal_text(),
            pr_body=_review_unit_body(),
        )

        self.assertEqual(transition, "proposal")

    def test_proposal_amendment_is_additive_contract_only(self) -> None:
        accepted = _accepted_plan()
        amendment_head = _move_to_amendment_review(accepted)

        transition = validate_review_unit_transition(
            accepted,
            amendment_head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                PROPOSAL_AMENDMENT_RELATIVE,
            },
            head_branch=PROPOSAL_AMENDMENT_BRANCH,
            proposal_amendment_text=proposal_amendment_text(),
            pr_body=_review_unit_body(),
        )

        self.assertEqual(transition, "proposal_amendment")

    def test_proposal_amendment_cannot_rewrite_accepted_proposal(self) -> None:
        accepted = _accepted_plan()
        amendment_head = _move_to_amendment_review(accepted)

        with self.assertRaisesRegex(PlanContractError, "non-contract changes"):
            validate_review_unit_transition(
                accepted,
                amendment_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    PROPOSAL_RELATIVE,
                    PROPOSAL_AMENDMENT_RELATIVE,
                },
                head_branch=PROPOSAL_AMENDMENT_BRANCH,
                proposal_amendment_text=proposal_amendment_text(),
            )

    def test_accepted_amendment_unlocks_implementation(self) -> None:
        amendment_review = _move_to_amendment_review(_accepted_plan())
        accepted = accept_proposal_amendment(
            amendment_review,
            amendment_pr=61,
            merge_commit="b" * 40,
            amendment_url="https://example.invalid/61",
            review_receipt=_accepted_review_receipt("e" * 40),
        )
        state = validate_plan_text(accepted)
        self.assertEqual(
            state.current.fields["workflow state"],
            "ready_for_implementation",
        )
        self.assertIn("#61", state.current.fields["accepted proposal amendments"])
        self.assertIn(
            PROPOSAL_AMENDMENT_RELATIVE,
            state.current.fields["accepted proposal amendments"],
        )

        implementation_head = _move_to_review(accepted, implementation=True)
        transition = validate_review_unit_transition(
            accepted,
            implementation_head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                "implementations/memory/bounded_evidence.py",
            },
            head_branch=IMPLEMENTATION_BRANCH,
            pr_body=_review_unit_body(),
        )
        self.assertEqual(transition, "implementation")

    def test_implementation_pr_review_kind_must_match_plan(self) -> None:
        accepted = accept_proposal(
            self.proposal_head,
            proposal_pr=60,
            merge_commit="a" * 40,
            proposal_url="https://example.invalid/60",
            review_receipt=_accepted_review_receipt(),
        )
        implementation_head = _move_to_review(accepted, implementation=True)
        with self.assertRaisesRegex(PlanContractError, "does not match"):
            validate_review_unit_transition(
                accepted,
                implementation_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    "implementations/memory/bounded_evidence.py",
                },
                head_branch=IMPLEMENTATION_BRANCH,
                pr_body=_review_unit_body("Review repair"),
            )

    def test_implementation_cannot_modify_accepted_amendment(self) -> None:
        amendment_review = _move_to_amendment_review(_accepted_plan())
        accepted = accept_proposal_amendment(
            amendment_review,
            amendment_pr=61,
            merge_commit="b" * 40,
            amendment_url="https://example.invalid/61",
            review_receipt=_accepted_review_receipt("e" * 40),
        )
        implementation_head = _move_to_review(accepted, implementation=True)

        with self.assertRaisesRegex(
            PlanContractError,
            "cannot modify the accepted proposal or its amendments",
        ):
            validate_review_unit_transition(
                accepted,
                implementation_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={PLAN_RELATIVE, PROPOSAL_AMENDMENT_RELATIVE},
                head_branch=IMPLEMENTATION_BRANCH,
            )

    def test_proposal_amendments_are_cumulative(self) -> None:
        first_review = _move_to_amendment_review(_accepted_plan())
        first_accepted = accept_proposal_amendment(
            first_review,
            amendment_pr=61,
            merge_commit="b" * 40,
            amendment_url="https://example.invalid/61",
            review_receipt=_accepted_review_receipt("e" * 40),
        )
        second_branch = "m900/amend-evidence-policy-timeout"
        second_path = (
            "docs/milestones/900-workflow-fixture/proposals/"
            "evidence-policy-timeout-amendment.md"
        )
        second_review = _move_to_amendment_review(
            first_accepted,
            branch=second_branch,
            path=second_path,
        )
        transition = validate_review_unit_transition(
            first_accepted,
            second_review,
            plan_path=PLAN_RELATIVE,
            changed_paths={PLAN_RELATIVE, second_path},
            head_branch=second_branch,
            proposal_amendment_text=proposal_amendment_text(),
            pr_body=_review_unit_body(),
        )
        self.assertEqual(transition, "proposal_amendment")

        second_accepted = accept_proposal_amendment(
            second_review,
            amendment_pr=62,
            merge_commit="c" * 40,
            amendment_url="https://example.invalid/62",
            review_receipt=_accepted_review_receipt("d" * 40),
        )
        receipts = validate_plan_text(second_accepted).current.fields[
            "accepted proposal amendments"
        ]
        self.assertIn("#61", receipts)
        self.assertIn("#62", receipts)
        self.assertIn(PROPOSAL_AMENDMENT_RELATIVE, receipts)
        self.assertIn(second_path, receipts)

    def test_implementation_requires_accepted_proposal(self) -> None:
        premature = _move_to_review(self.base, implementation=True)
        with self.assertRaises(PlanContractError):
            validate_review_unit_transition(
                self.base,
                premature,
                plan_path=PLAN_RELATIVE,
                changed_paths={
                    PLAN_RELATIVE,
                    "implementations/memory/bounded_evidence.py",
                },
                head_branch=IMPLEMENTATION_BRANCH,
            )

    def test_accepted_proposal_unlocks_implementation(self) -> None:
        accepted = accept_proposal(
            self.proposal_head,
            proposal_pr=60,
            merge_commit="a" * 40,
            proposal_url="https://example.invalid/60",
            review_receipt=_accepted_review_receipt(),
        )
        implementation_head = _move_to_review(accepted, implementation=True)
        transition = validate_review_unit_transition(
            accepted,
            implementation_head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                "implementations/memory/bounded_evidence.py",
                "tests/implementations/memory/test_bounded_evidence.py",
            },
            head_branch=IMPLEMENTATION_BRANCH,
            pr_body=_review_unit_body(),
        )
        self.assertEqual(transition, "implementation")

    def test_implementation_pr_normalizes_opened_branch_annotation(self) -> None:
        accepted = accept_proposal(
            self.proposal_head,
            proposal_pr=60,
            merge_commit="a" * 40,
            proposal_url="https://example.invalid/60",
            review_receipt=_accepted_review_receipt(),
        )
        annotated = f"`{IMPLEMENTATION_BRANCH}` (planned; not opened)"
        accepted = accepted.replace(f"`{IMPLEMENTATION_BRANCH}`", annotated, 1)
        implementation_head = _move_to_review(
            accepted,
            implementation=True,
        ).replace(annotated, f"`{IMPLEMENTATION_BRANCH}`", 1)

        transition = validate_review_unit_transition(
            accepted,
            implementation_head,
            plan_path=PLAN_RELATIVE,
            changed_paths={
                PLAN_RELATIVE,
                str(Path(PLAN_RELATIVE).with_suffix(".html")),
                "implementations/memory/bounded_evidence.py",
            },
            head_branch=IMPLEMENTATION_BRANCH,
            pr_body=_review_unit_body(),
        )

        self.assertEqual(transition, "implementation")

    def test_implementation_cannot_modify_accepted_proposal(self) -> None:
        accepted = accept_proposal(
            self.proposal_head,
            proposal_pr=60,
            merge_commit="a" * 40,
            proposal_url="https://example.invalid/60",
            review_receipt=_accepted_review_receipt(),
        )
        implementation_head = _move_to_review(accepted, implementation=True)
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot modify the accepted proposal",
        ):
            validate_review_unit_transition(
                accepted,
                implementation_head,
                plan_path=PLAN_RELATIVE,
                changed_paths={PLAN_RELATIVE, PROPOSAL_RELATIVE},
                head_branch=IMPLEMENTATION_BRANCH,
            )


class ProposalAcceptanceMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        proposal_plan = _move_to_review(ready_plan_text())
        self.state = validate_plan_text(proposal_plan)
        self.allowed = {
            PLAN_RELATIVE,
            str(Path(PLAN_RELATIVE).with_suffix(".html")),
            PROPOSAL_RELATIVE,
        }

    def _payload(self) -> dict[str, object]:
        head_oid = "c" * 40
        return {
            "state": "MERGED",
            "baseRefName": MILESTONE_BRANCH,
            "headRefName": PROPOSAL_BRANCH,
            "headRefOid": head_oid,
            "mergeCommit": {"oid": "b" * 40},
            "mergedAt": "2026-08-12T18:02:00Z",
            "url": "https://example.invalid/60",
            "body": _review_unit_body(),
            "reviews": [_contract_review(head_oid=head_oid)],
            "files": [
                {"path": PLAN_RELATIVE},
                {"path": str(Path(PLAN_RELATIVE).with_suffix(".html"))},
                {"path": PROPOSAL_RELATIVE},
            ],
        }

    def test_merged_proposal_records_exact_commit(self) -> None:
        commit, url, review_receipt = validate_merged_proposal_metadata(
            self._payload(),
            self.state,
            proposal_pr=60,
            allowed_paths=self.allowed,
        )
        self.assertEqual(commit, "b" * 40)
        self.assertEqual(url, "https://example.invalid/60")
        self.assertEqual(review_receipt.head_oid, "c" * 40)
        self.assertEqual(review_receipt.reviewer, "workflow-reviewer")
        self.assertEqual(review_receipt.reviewer_association, "COLLABORATOR")

    def test_formal_approval_on_exact_head_is_accepted(self) -> None:
        payload = self._payload()
        head_oid = payload["headRefOid"]
        assert isinstance(head_oid, str)
        payload["reviews"] = [
            _contract_review(head_oid=head_oid, state="APPROVED")
        ]

        _, _, review_receipt = validate_merged_proposal_metadata(
            payload,
            self.state,
            proposal_pr=60,
            allowed_paths=self.allowed,
        )

        self.assertEqual(review_receipt.head_oid, head_oid)

    def test_review_on_stale_head_does_not_accept_final_head(self) -> None:
        payload = self._payload()
        payload["headRefOid"] = "d" * 40
        with self.assertRaisesRegex(PlanContractError, "no decisive.*exact head"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_latest_decisive_exact_head_review_owns_outcome(self) -> None:
        payload = self._payload()
        head_oid = payload["headRefOid"]
        assert isinstance(head_oid, str)
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        reviews.append(
            _contract_review(
                head_oid=head_oid,
                state="CHANGES_REQUESTED",
                submitted_at="2026-08-12T18:01:00Z",
            )
        )

        with self.assertRaisesRegex(PlanContractError, "outstanding.*changes"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_one_reviewer_cannot_clear_another_reviewers_changes(self) -> None:
        payload = self._payload()
        head_oid = payload["headRefOid"]
        reviews = payload["reviews"]
        assert isinstance(head_oid, str)
        assert isinstance(reviews, list)
        first = reviews[0]
        assert isinstance(first, dict)
        first.update(
            {
                "state": "CHANGES_REQUESTED",
                "body": "",
                "author": {"login": "reviewer-a"},
            }
        )
        accepted = _contract_review(
            head_oid=head_oid,
            state="APPROVED",
            submitted_at="2026-08-12T18:01:00Z",
        )
        accepted["author"] = {"login": "reviewer-b"}
        reviews.append(accepted)

        with self.assertRaisesRegex(PlanContractError, "reviewer-a"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_same_reviewer_can_clear_their_own_changes_request(self) -> None:
        payload = self._payload()
        head_oid = payload["headRefOid"]
        reviews = payload["reviews"]
        assert isinstance(head_oid, str)
        assert isinstance(reviews, list)
        first = reviews[0]
        assert isinstance(first, dict)
        first.update({"state": "CHANGES_REQUESTED", "body": ""})
        reviews.append(
            _contract_review(
                head_oid=head_oid,
                submitted_at="2026-08-12T18:01:00Z",
            )
        )

        _, _, receipt = validate_merged_proposal_metadata(
            payload,
            self.state,
            proposal_pr=60,
            allowed_paths=self.allowed,
        )

        self.assertEqual(receipt.reviewer, "workflow-reviewer")

    def test_edited_comment_receipt_is_rejected(self) -> None:
        payload = self._payload()
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        review = reviews[0]
        assert isinstance(review, dict)
        review["includesCreatedEdit"] = True
        with self.assertRaisesRegex(PlanContractError, "malformed or edited"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_fetch_fails_closed_when_review_window_would_truncate(self) -> None:
        response = {
            "data": {
                "repository": {
                    "pullRequest": {
                        "mergedAt": "2026-08-12T18:02:00Z",
                        "reviews": {"nodes": [], "totalCount": 101},
                    }
                }
            }
        }
        completed = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout='{"nameWithOwner":"example/repository"}',
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(response),
                stderr="",
            ),
        ]
        with mock.patch(
            "docs.milestones.workflow.subprocess.run",
            side_effect=completed,
        ):
            with self.assertRaisesRegex(PlanContractError, "100-review"):
                _fetch_pr_review_metadata(60)

    def test_untrusted_review_cannot_accept_contract(self) -> None:
        payload = self._payload()
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        review = reviews[0]
        assert isinstance(review, dict)
        review["authorAssociation"] = "CONTRIBUTOR"
        with self.assertRaisesRegex(PlanContractError, "no decisive authorized"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_reviewer_without_current_push_authority_cannot_accept(self) -> None:
        payload = self._payload()
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        review = reviews[0]
        assert isinstance(review, dict)
        review["authorCanPushToRepository"] = False
        with self.assertRaisesRegex(PlanContractError, "no decisive authorized"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_malformed_receipt_from_unauthorized_reviewer_is_ignored(self) -> None:
        payload = self._payload()
        head_oid = payload["headRefOid"]
        reviews = payload["reviews"]
        assert isinstance(head_oid, str)
        assert isinstance(reviews, list)
        malformed = _contract_review(
            head_oid=head_oid,
            submitted_at="2026-08-12T18:01:00Z",
        )
        malformed.update(
            {
                "body": "## Contract Review Receipt\n\n- Maybe: `accepted`\n",
                "author": {"login": "drive-by-reviewer"},
                "authorAssociation": "CONTRIBUTOR",
                "authorCanPushToRepository": False,
            }
        )
        reviews.append(malformed)

        _, _, receipt = validate_merged_proposal_metadata(
            payload,
            self.state,
            proposal_pr=60,
            allowed_paths=self.allowed,
        )

        self.assertEqual(receipt.reviewer, "workflow-reviewer")

    def test_review_submitted_after_merge_is_rejected(self) -> None:
        payload = self._payload()
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        review = reviews[0]
        assert isinstance(review, dict)
        review["submittedAt"] = "2026-08-12T18:03:00Z"
        with self.assertRaisesRegex(PlanContractError, "no decisive authorized"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_embedded_example_receipt_cannot_accept_contract(self) -> None:
        payload = self._payload()
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        review = reviews[0]
        assert isinstance(review, dict)
        review["body"] = (
            "I request changes; the following is only an example.\n\n"
            "## Contract Review Receipt\n\n"
            "- Outcome: `accepted`\n"
        )
        with self.assertRaisesRegex(PlanContractError, "malformed or edited"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_malformed_comment_receipt_is_rejected(self) -> None:
        payload = self._payload()
        reviews = payload["reviews"]
        assert isinstance(reviews, list)
        review = reviews[0]
        assert isinstance(review, dict)
        review["body"] = (
            "## Contract Review Receipt\n\n"
            "- Outcome: `accepted`\n"
            "- Caveat: maybe\n"
        )
        with self.assertRaisesRegex(PlanContractError, "malformed or edited"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_later_unedited_receipt_replaces_same_reviewers_malformed_one(self) -> None:
        payload = self._payload()
        head_oid = payload["headRefOid"]
        reviews = payload["reviews"]
        assert isinstance(head_oid, str)
        assert isinstance(reviews, list)
        malformed = reviews[0]
        assert isinstance(malformed, dict)
        malformed["body"] = (
            "## Contract Review Receipt\n\n- Outcome: `accepted`\nextra\n"
        )
        reviews.append(
            _contract_review(
                head_oid=head_oid,
                submitted_at="2026-08-12T18:01:00Z",
            )
        )

        _, _, receipt = validate_merged_proposal_metadata(
            payload,
            self.state,
            proposal_pr=60,
            allowed_paths=self.allowed,
        )

        self.assertEqual(receipt.reviewer, "workflow-reviewer")

    def test_merged_proposal_rejects_mismatched_review_kind(self) -> None:
        payload = self._payload()
        payload["body"] = _review_unit_body("Behavioral feature slice")
        with self.assertRaisesRegex(PlanContractError, "does not match"):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )

    def test_merged_proposal_rejects_code_changes(self) -> None:
        payload = self._payload()
        payload["files"].append(
            {"path": "implementations/memory/bounded_evidence.py"}
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "contains implementation changes",
        ):
            validate_merged_proposal_metadata(
                payload,
                self.state,
                proposal_pr=60,
                allowed_paths=self.allowed,
            )


class ProposalAmendmentAcceptanceMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        amendment_plan = _move_to_amendment_review(_accepted_plan())
        self.state = validate_plan_text(amendment_plan)
        self.allowed = {
            PLAN_RELATIVE,
            str(Path(PLAN_RELATIVE).with_suffix(".html")),
            PROPOSAL_AMENDMENT_RELATIVE,
        }

    def _payload(self) -> dict[str, object]:
        head_oid = "d" * 40
        return {
            "state": "MERGED",
            "baseRefName": MILESTONE_BRANCH,
            "headRefName": PROPOSAL_AMENDMENT_BRANCH,
            "headRefOid": head_oid,
            "mergeCommit": {"oid": "b" * 40},
            "mergedAt": "2026-08-12T18:02:00Z",
            "url": "https://example.invalid/61",
            "body": _review_unit_body(),
            "reviews": [_contract_review(head_oid=head_oid)],
            "files": [
                {"path": PLAN_RELATIVE},
                {"path": str(Path(PLAN_RELATIVE).with_suffix(".html"))},
                {"path": PROPOSAL_AMENDMENT_RELATIVE},
            ],
        }

    def test_merged_amendment_records_exact_commit(self) -> None:
        commit, url, review_receipt = (
            validate_merged_proposal_amendment_metadata(
                self._payload(),
                self.state,
                amendment_pr=61,
                allowed_paths=self.allowed,
            )
        )
        self.assertEqual(commit, "b" * 40)
        self.assertEqual(url, "https://example.invalid/61")
        self.assertEqual(review_receipt.head_oid, "d" * 40)

    def test_amendment_requires_exact_head_review(self) -> None:
        payload = self._payload()
        payload["reviews"] = []
        with self.assertRaisesRegex(PlanContractError, "no decisive.*exact head"):
            validate_merged_proposal_amendment_metadata(
                payload,
                self.state,
                amendment_pr=61,
                allowed_paths=self.allowed,
            )

    def test_amendment_acceptance_records_review_authority(self) -> None:
        amendment_review = _move_to_amendment_review(_accepted_plan())
        receipt = ContractReviewReceipt(
            head_oid="d" * 40,
            reviewer="workflow-reviewer",
            reviewer_association="COLLABORATOR",
            submitted_at="2026-08-12T18:00:00Z",
        )
        accepted = accept_proposal_amendment(
            amendment_review,
            amendment_pr=61,
            merge_commit="b" * 40,
            amendment_url="https://example.invalid/61",
            review_receipt=receipt,
        )

        state = validate_plan_text(accepted)
        record = state.current.fields["accepted proposal amendments"]
        self.assertIn("reviewed head", record)
        self.assertIn("workflow-reviewer", record)

    def test_merged_amendment_rejects_mismatched_review_kind(self) -> None:
        payload = self._payload()
        payload["body"] = _review_unit_body("Review repair")
        with self.assertRaisesRegex(PlanContractError, "does not match"):
            validate_merged_proposal_amendment_metadata(
                payload,
                self.state,
                amendment_pr=61,
                allowed_paths=self.allowed,
            )

    def test_merged_amendment_rejects_code_changes(self) -> None:
        payload = self._payload()
        payload["files"].append(
            {"path": "implementations/memory/bounded_evidence.py"}
        )
        with self.assertRaisesRegex(PlanContractError, "non-contract changes"):
            validate_merged_proposal_amendment_metadata(
                payload,
                self.state,
                amendment_pr=61,
                allowed_paths=self.allowed,
            )


class ReviewUnitGitDiffTests(unittest.TestCase):
    def _git(self, root: Path, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def _create_implementation_parent(self, root: Path) -> tuple[Path, str]:
        plan = root / PLAN_RELATIVE
        plan.parent.mkdir(parents=True)
        plan.write_text(implementation_review_plan_text(), encoding="utf-8")
        parent_file = root / "implementations" / "evidence" / "policy.py"
        parent_file.parent.mkdir(parents=True)
        parent_file.write_text("POLICY = 'accepted'\n", encoding="utf-8")
        self._git(root, "init", "-b", IMPLEMENTATION_BRANCH)
        self._git(root, "add", ".")
        self._git(
            root,
            "-c",
            "user.name=Milestone Test",
            "-c",
            "user.email=milestone@example.invalid",
            "commit",
            "-m",
            "start implementation review",
        )
        return plan, self._git(root, "rev-parse", "HEAD")

    def test_git_diff_gate_recognizes_hitl_implementation_adjunct(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _, base_sha = self._create_implementation_parent(root)
            self._git(root, "switch", "-c", IMPLEMENTATION_ADJUNCT_BRANCH)
            adjunct = root / "implementations" / "evidence" / "inspection.py"
            adjunct.write_text("OPTIONAL_VIEW = True\n", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "add optional evidence inspection",
            )
            head_sha = self._git(root, "rev-parse", "HEAD")

            transition = validate_review_unit_git_diff(
                base_ref=IMPLEMENTATION_BRANCH,
                head_ref=IMPLEMENTATION_ADJUNCT_BRANCH,
                base_sha=base_sha,
                head_sha=head_sha,
                pr_body=implementation_adjunct_body(),
                repo_root=root,
            )

            self.assertEqual(transition, "implementation_adjunct")

    def test_implementation_adjunct_rejects_contract_artifact_change(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan, base_sha = self._create_implementation_parent(root)
            self._git(root, "switch", "-c", IMPLEMENTATION_ADJUNCT_BRANCH)
            plan.write_text(
                plan.read_text(encoding="utf-8") + "\nUnreviewed plan note.\n",
                encoding="utf-8",
            )
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "change plan from adjunct",
            )

            with self.assertRaisesRegex(
                PlanContractError,
                "cannot change the canonical milestone plan",
            ):
                validate_review_unit_git_diff(
                    base_ref=IMPLEMENTATION_BRANCH,
                    head_ref=IMPLEMENTATION_ADJUNCT_BRANCH,
                    base_sha=base_sha,
                    head_sha=self._git(root, "rev-parse", "HEAD"),
                    pr_body=implementation_adjunct_body(),
                    repo_root=root,
                )

    def test_implementation_adjunct_requires_reserved_child_branch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _, base_sha = self._create_implementation_parent(root)
            wrong_branch = "m900/evidence-inspection"
            self._git(root, "switch", "-c", wrong_branch)
            adjunct = root / "implementations" / "evidence" / "inspection.py"
            adjunct.write_text("OPTIONAL_VIEW = True\n", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "use wrong adjunct branch",
            )

            with self.assertRaisesRegex(PlanContractError, "must match"):
                validate_review_unit_git_diff(
                    base_ref=IMPLEMENTATION_BRANCH,
                    head_ref=wrong_branch,
                    base_sha=base_sha,
                    head_sha=self._git(root, "rev-parse", "HEAD"),
                    pr_body=implementation_adjunct_body(),
                    repo_root=root,
                )

    def test_reserved_adjunct_branch_requires_pr_body(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _, base_sha = self._create_implementation_parent(root)
            self._git(root, "switch", "-c", IMPLEMENTATION_ADJUNCT_BRANCH)
            adjunct = root / "implementations" / "evidence" / "inspection.py"
            adjunct.write_text("OPTIONAL_VIEW = True\n", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "omit adjunct metadata",
            )

            with self.assertRaisesRegex(PlanContractError, "requires.*body"):
                validate_review_unit_git_diff(
                    base_ref=IMPLEMENTATION_BRANCH,
                    head_ref=IMPLEMENTATION_ADJUNCT_BRANCH,
                    base_sha=base_sha,
                    head_sha=self._git(root, "rev-parse", "HEAD"),
                    repo_root=root,
                )

    def test_implementation_adjunct_must_include_current_parent_head(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._create_implementation_parent(root)
            self._git(root, "switch", "-c", IMPLEMENTATION_ADJUNCT_BRANCH)
            adjunct = root / "implementations" / "evidence" / "inspection.py"
            adjunct.write_text("OPTIONAL_VIEW = True\n", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "add inspection from old parent",
            )
            head_sha = self._git(root, "rev-parse", "HEAD")
            self._git(root, "switch", IMPLEMENTATION_BRANCH)
            parent_file = root / "implementations" / "evidence" / "policy.py"
            parent_file.write_text("POLICY = 'advanced'\n", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "advance parent implementation",
            )
            current_base_sha = self._git(root, "rev-parse", "HEAD")

            with self.assertRaisesRegex(PlanContractError, "current parent"):
                validate_review_unit_git_diff(
                    base_ref=IMPLEMENTATION_BRANCH,
                    head_ref=IMPLEMENTATION_ADJUNCT_BRANCH,
                    base_sha=current_base_sha,
                    head_sha=head_sha,
                    pr_body=implementation_adjunct_body(),
                    repo_root=root,
                )

    def test_non_adjunct_child_does_not_claim_hitl_lane(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            _, base_sha = self._create_implementation_parent(root)
            repair_branch = f"{IMPLEMENTATION_BRANCH}--repair-policy"
            self._git(root, "switch", "-c", repair_branch)
            repair = root / "implementations" / "evidence" / "repair.py"
            repair.write_text("REPAIR = True\n", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "repair parent review finding",
            )

            transition = validate_review_unit_git_diff(
                base_ref=IMPLEMENTATION_BRANCH,
                head_ref=repair_branch,
                base_sha=base_sha,
                head_sha=self._git(root, "rev-parse", "HEAD"),
                repo_root=root,
            )

            self.assertIsNone(transition)

    def test_adjunct_branch_cannot_be_a_pr_base(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(
                PlanContractError,
                "cannot be used as a PR base",
            ):
                validate_review_unit_git_diff(
                    base_ref=IMPLEMENTATION_ADJUNCT_BRANCH,
                    head_ref=f"{IMPLEMENTATION_ADJUNCT_BRANCH}--adjunct-nested",
                    base_sha="0" * 40,
                    head_sha="1" * 40,
                    repo_root=Path(temp_dir),
                )

    def test_git_diff_gate_recognizes_proposal_transition(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            plan.write_text(ready_plan_text(), encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "ready for proposal",
            )
            base_sha = self._git(root, "rev-parse", "HEAD")
            self._git(root, "switch", "-c", PROPOSAL_BRANCH)
            plan.write_text(
                _move_to_review(plan.read_text(encoding="utf-8")),
                encoding="utf-8",
            )
            proposal = root / PROPOSAL_RELATIVE
            proposal.parent.mkdir(parents=True)
            proposal.write_text(proposal_text(), encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "propose conflict policy",
            )
            head_sha = self._git(root, "rev-parse", "HEAD")

            transition = validate_review_unit_git_diff(
                base_ref=MILESTONE_BRANCH,
                head_ref=PROPOSAL_BRANCH,
                base_sha=base_sha,
                head_sha=head_sha,
                pr_body=_review_unit_body(),
                repo_root=root,
            )

            self.assertEqual(transition, "proposal")

    def test_git_diff_gate_rejects_opening_from_non_active_empty_base(self) -> None:
        for status in ("Blocked", "pre-plan", "closed"):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                plan = root / PLAN_RELATIVE
                plan.parent.mkdir(parents=True)
                plan.write_text(
                    _terminal_plan(ready_plan_text(), status),
                    encoding="utf-8",
                )
                self._git(root, "init", "-b", MILESTONE_BRANCH)
                self._git(root, "add", ".")
                self._git(
                    root,
                    "-c",
                    "user.name=Milestone Test",
                    "-c",
                    "user.email=milestone@example.invalid",
                    "commit",
                    "-m",
                    f"create {status} milestone",
                )
                base_sha = self._git(root, "rev-parse", "HEAD")
                self._git(root, "switch", "-c", PROPOSAL_BRANCH)
                plan.write_text(
                    _move_to_review(ready_plan_text()),
                    encoding="utf-8",
                )
                proposal = root / PROPOSAL_RELATIVE
                proposal.parent.mkdir(parents=True)
                proposal.write_text(proposal_text(), encoding="utf-8")
                self._git(root, "add", ".")
                self._git(
                    root,
                    "-c",
                    "user.name=Milestone Test",
                    "-c",
                    "user.email=milestone@example.invalid",
                    "commit",
                    "-m",
                    "attempt proposal from terminal state",
                )

                with self.assertRaisesRegex(
                    PlanContractError,
                    "opening proposal requires an Active milestone",
                ):
                    validate_review_unit_git_diff(
                        base_ref=MILESTONE_BRANCH,
                        head_ref=PROPOSAL_BRANCH,
                        base_sha=base_sha,
                        head_sha=self._git(root, "rev-parse", "HEAD"),
                        pr_body=_review_unit_body(),
                        repo_root=root,
                    )

    def test_git_diff_gate_freezes_current_against_first_receipt_head(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            plan.write_text(ready_plan_text(), encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "ready for proposal",
            )
            base_sha = self._git(root, "rev-parse", "HEAD")
            self._git(root, "switch", "-c", PROPOSAL_BRANCH)
            plan.write_text(
                _move_to_review(plan.read_text(encoding="utf-8")),
                encoding="utf-8",
            )
            proposal = root / PROPOSAL_RELATIVE
            proposal.parent.mkdir(parents=True)
            proposal.write_text(proposal_text(), encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "open proposal",
            )
            first_head = self._git(root, "rev-parse", "HEAD")

            plan.write_text(
                plan.read_text(encoding="utf-8").replace(
                    "Does repeated evidence follow one deterministic contract?",
                    "Did the review question move after the receipt?",
                    1,
                ),
                encoding="utf-8",
            )
            self._git(root, "add", PLAN_RELATIVE)
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "retarget current after receipt",
            )
            second_head = self._git(root, "rev-parse", "HEAD")
            metadata = RepairReviewMetadata(
                pull_request_number=60,
                pull_request_url=REPAIR_PR_URL,
                pull_request_author=REPAIR_PR_AUTHOR,
                head_oid=second_head,
                commits=(base_sha, first_head, second_head),
                reviews=(
                    _contract_receipt_review(
                        head_oid=first_head,
                        outcome="changes_requested",
                    ),
                ),
            )

            with self.assertRaisesRegex(
                PlanContractError,
                "cannot change frozen current field 'review question'",
            ):
                validate_review_unit_git_diff(
                    base_ref=MILESTONE_BRANCH,
                    head_ref=PROPOSAL_BRANCH,
                    base_sha=base_sha,
                    head_sha=second_head,
                    pr_body=_review_unit_body(),
                    repair_review_metadata=metadata,
                    repo_root=root,
                )

    def test_git_diff_gate_opens_proposal_from_idle(self) -> None:
        from tests.docs.test_milestone_workflow import _select_work_order_head

        closeout_proposal = """# Proposal: Milestone closeout

## Review Kind

Milestone closeout

## Review Question

Is the synthetic milestone complete?

## Proposed Contract

Close the fixture.

## Ownership

Closeout.

## Affected Paths

Plan.

## Adversarial Matrix

| Case | Expected |
| --- | --- |
| Unmet criterion | Fail |

## External Assumptions

None.

## Non-Goals

New runtime.

## File Impact

closeout.md

## Validation Plan

Plan validation.

## Expected Handoff

```json
{
  "schema": "milestone_handoff_template_v1",
  "outcome": "close",
  "result": "Accepted",
  "durable_evidence": "closeout.md",
  "criterion_updates": {
    "M900-03": {
      "status": "Met",
      "evidence": "Closed in PR #{pr}"
    }
  },
  "risk_remove": [],
  "risk_upsert": [],
  "next_frontier": {
    "state": "none",
    "reason": "Closed.",
    "revisit_when": "Next milestone."
  }
}
```
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            idle = apply_handoff(
                implementation_review_plan_text(),
                handoff_receipt(),
            )
            plan.write_text(idle, encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "idle after implementation",
            )
            base_sha = self._git(root, "rev-parse", "HEAD")
            self._git(root, "switch", "-c", NEXT_PROPOSAL_BRANCH)
            plan.write_text(
                _select_work_order_head(idle, workflow_state="proposal_in_review"),
                encoding="utf-8",
            )
            proposal = (
                root
                / "docs/milestones/900-workflow-fixture/proposals/closeout.md"
            )
            proposal.parent.mkdir(parents=True, exist_ok=True)
            proposal.write_text(closeout_proposal, encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "select closeout from idle work order",
            )
            transition = validate_review_unit_git_diff(
                base_ref=MILESTONE_BRANCH,
                head_ref=NEXT_PROPOSAL_BRANCH,
                base_sha=base_sha,
                head_sha=self._git(root, "rev-parse", "HEAD"),
                pr_body=_review_unit_body("Milestone closeout"),
                repo_root=root,
            )
            self.assertEqual(transition, "proposal")

    def test_git_diff_gate_recognizes_plan_revision(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            plan.write_text(ready_plan_text(), encoding="utf-8")
            plan_html = plan.with_suffix(".html")
            plan_html.write_text("base", encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "ready for proposal",
            )
            base_sha = self._git(root, "rev-parse", "HEAD")
            self._git(root, "switch", "-c", PLAN_REVISION_BRANCH)
            plan.write_text(_revise_plan(ready_plan_text()), encoding="utf-8")
            plan_html.write_text("revised", encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "revise unstarted frontier",
            )
            head_sha = self._git(root, "rev-parse", "HEAD")

            transition = validate_review_unit_git_diff(
                base_ref=MILESTONE_BRANCH,
                head_ref=PLAN_REVISION_BRANCH,
                base_sha=base_sha,
                head_sha=head_sha,
                repo_root=root,
            )

            self.assertEqual(transition, "plan_revision")

    def test_git_diff_gate_recognizes_proposal_amendment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            plan.write_text(_accepted_plan(), encoding="utf-8")
            plan_html = plan.with_suffix(".html")
            plan_html.write_text("accepted", encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "accept proposal",
            )
            base_sha = self._git(root, "rev-parse", "HEAD")
            self._git(root, "switch", "-c", PROPOSAL_AMENDMENT_BRANCH)
            plan.write_text(
                _move_to_amendment_review(plan.read_text(encoding="utf-8")),
                encoding="utf-8",
            )
            plan_html.write_text("amendment review", encoding="utf-8")
            amendment = root / PROPOSAL_AMENDMENT_RELATIVE
            amendment.parent.mkdir(parents=True, exist_ok=True)
            amendment.write_text(proposal_amendment_text(), encoding="utf-8")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "amend accepted proposal",
            )
            head_sha = self._git(root, "rev-parse", "HEAD")

            transition = validate_review_unit_git_diff(
                base_ref=MILESTONE_BRANCH,
                head_ref=PROPOSAL_AMENDMENT_BRANCH,
                base_sha=base_sha,
                head_sha=head_sha,
                pr_body=_review_unit_body(),
                repo_root=root,
            )

            self.assertEqual(transition, "proposal_amendment")

    def test_proposal_amendment_branch_starts_after_proposal_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            accepted = _accepted_plan()
            plan.write_text(accepted, encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "accept proposal",
            )

            start_proposal_amendment_branch(
                plan,
                validate_plan_text(accepted),
                PROPOSAL_AMENDMENT_BRANCH,
                PROPOSAL_AMENDMENT_RELATIVE,
                repo_root=root,
            )

            self.assertEqual(
                self._git(root, "branch", "--show-current"),
                PROPOSAL_AMENDMENT_BRANCH,
            )
            transitioned = validate_plan_text(plan.read_text(encoding="utf-8"))
            self.assertEqual(
                transitioned.current.fields["workflow state"],
                "proposal_amendment_in_review",
            )
            self.assertEqual(
                transitioned.current.fields["proposal amendment path"],
                f"`{PROPOSAL_AMENDMENT_RELATIVE}`",
            )

    def test_implementation_branch_starts_only_after_proposal_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            proposal_review = _move_to_review(
                ready_plan_text().replace(
                    f"- Implementation branch: `{IMPLEMENTATION_BRANCH}`\n",
                    f"- Implementation branch: `{IMPLEMENTATION_BRANCH}` "
                    "(planned; not opened)\n",
                    1,
                )
            )
            accepted = accept_proposal(
                proposal_review,
                proposal_pr=60,
                merge_commit="c" * 40,
                proposal_url="https://example.invalid/60",
                review_receipt=_accepted_review_receipt("d" * 40),
            )
            plan.write_text(accepted, encoding="utf-8")
            self._git(root, "init", "-b", MILESTONE_BRANCH)
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "accept proposal",
            )

            start_implementation_branch(
                plan,
                validate_plan_text(accepted),
                IMPLEMENTATION_BRANCH,
                repo_root=root,
            )

            self.assertEqual(
                self._git(root, "branch", "--show-current"),
                IMPLEMENTATION_BRANCH,
            )
            transitioned = validate_plan_text(plan.read_text(encoding="utf-8"))
            self.assertEqual(
                transitioned.current.fields["workflow state"],
                "implementation_in_review",
            )
            self.assertEqual(
                transitioned.current.fields["implementation branch"],
                f"`{IMPLEMENTATION_BRANCH}`",
            )


class ValidatePrCommandTests(unittest.TestCase):
    def test_event_validation_fetches_zero_cycle_review_history(self) -> None:
        metadata = RepairReviewMetadata(
            pull_request_number=60,
            pull_request_url=REPAIR_PR_URL,
            pull_request_author=REPAIR_PR_AUTHOR,
            head_oid="a" * 40,
            commits=("a" * 40,),
            reviews=(_contract_review(head_oid="a" * 40),),
        )
        payload = {
            "pull_request": {
                "number": 60,
                "body": _review_unit_body(),
            }
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "event.json"
            event_path.write_text(json.dumps(payload), encoding="utf-8")
            with (
                mock.patch(
                    "docs.milestones.workflow._fetch_pr_repair_review_metadata",
                    return_value=metadata,
                ) as fetch_metadata,
                mock.patch(
                    "docs.milestones.workflow.validate_review_unit_git_diff",
                    return_value="proposal",
                ) as validate_diff,
            ):
                result = _cmd_validate_pr(
                    base_ref=MILESTONE_BRANCH,
                    head_ref=PROPOSAL_BRANCH,
                    base_sha="b" * 40,
                    head_sha="a" * 40,
                    event_path=event_path,
                    body_path=None,
                )

        self.assertEqual(result, 0)
        fetch_metadata.assert_called_once_with(60)
        self.assertIs(
            validate_diff.call_args.kwargs["repair_review_metadata"],
            metadata,
        )

    def test_event_validation_rejects_proposal_without_exact_head_receipt(self) -> None:
        for head_ref, transition in (
            (PROPOSAL_BRANCH, "proposal"),
            (PROPOSAL_AMENDMENT_BRANCH, "proposal_amendment"),
        ):
            with self.subTest(transition=transition):
                metadata = RepairReviewMetadata(
                    pull_request_number=60,
                    pull_request_url=REPAIR_PR_URL,
                    pull_request_author=REPAIR_PR_AUTHOR,
                    head_oid="a" * 40,
                    commits=("a" * 40,),
                    reviews=(),
                )
                payload = {
                    "pull_request": {
                        "number": 60,
                        "body": _review_unit_body(),
                    }
                }
                with tempfile.TemporaryDirectory() as temp_dir:
                    event_path = Path(temp_dir) / "event.json"
                    event_path.write_text(json.dumps(payload), encoding="utf-8")
                    with (
                        mock.patch(
                            "docs.milestones.workflow._fetch_pr_repair_review_metadata",
                            return_value=metadata,
                        ),
                        mock.patch(
                            "docs.milestones.workflow.validate_review_unit_git_diff",
                            return_value=transition,
                        ),
                    ):
                        with self.assertRaisesRegex(
                            PlanContractError,
                            "proposal merge requires an exact-head",
                        ):
                            _cmd_validate_pr(
                                base_ref=MILESTONE_BRANCH,
                                head_ref=head_ref,
                                base_sha="b" * 40,
                                head_sha="a" * 40,
                                event_path=event_path,
                                body_path=None,
                            )

    def test_event_validation_does_not_gate_implementation(self) -> None:
        metadata = RepairReviewMetadata(
            pull_request_number=60,
            pull_request_url=REPAIR_PR_URL,
            pull_request_author=REPAIR_PR_AUTHOR,
            head_oid="a" * 40,
            commits=("a" * 40,),
            reviews=(),
        )
        payload = {
            "pull_request": {
                "number": 60,
                "body": _review_unit_body(),
            }
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "event.json"
            event_path.write_text(json.dumps(payload), encoding="utf-8")
            with (
                mock.patch(
                    "docs.milestones.workflow._fetch_pr_repair_review_metadata",
                    return_value=metadata,
                ),
                mock.patch(
                    "docs.milestones.workflow.validate_review_unit_git_diff",
                    return_value="implementation",
                ),
            ):
                result = _cmd_validate_pr(
                    base_ref=MILESTONE_BRANCH,
                    head_ref=IMPLEMENTATION_BRANCH,
                    base_sha="b" * 40,
                    head_sha="a" * 40,
                    event_path=event_path,
                    body_path=None,
                )

        self.assertEqual(result, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
