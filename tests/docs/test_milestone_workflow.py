from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import subprocess
import tempfile
import unittest

from docs.milestones.workflow import (
    Frontier,
    FrontierMap,
    PlanContractError,
    apply_handoff,
    start_proposal_branch,
    validate_merged_pr_metadata,
    validate_plan_text,
    verify_handoff_git_state,
    _append_workflow_history,
    _frontier_body,
    _replace_frontier,
    _replace_frontier_map,
    _replace_header_value,
    render_plan_text,
)
from tests.docs.milestone_workflow_fixtures import (
    BASELINE_SHA,
    CLOSEOUT_CRITERION,
    CURRENT_CRITERION,
    CURRENT_FRONTIER,
    IMPLEMENTATION_BRANCH,
    MILESTONE_BRANCH,
    NEXT_FRONTIER,
    NEXT_IMPLEMENTATION_BRANCH,
    PLAN_RELATIVE,
    PROPOSAL_BRANCH,
    RESOLVED_RISK,
    handoff_receipt,
    implementation_review_plan_text,
    ready_plan_text,
)


ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / PLAN_RELATIVE


def _receipt(*, merge_commit: str = "deadbee") -> dict[str, object]:
    return handoff_receipt(merge_commit=merge_commit)


def _select_work_order_head(
    text: str,
    *,
    workflow_state: str = "ready_for_proposal",
) -> str:
    state = validate_plan_text(text)
    if state.next_frontier.is_empty or state.next_frontier.name is None:
        raise AssertionError("work order has no remaining node to select")
    node = state.next_frontier
    remaining = state.frontier_map.path[1:]
    remaining_nodes = tuple(
        item for item in state.frontier_map.nodes if item.name in remaining
    )
    new_current = Frontier(
        name=node.name,
        fields={**node.fields, "workflow state": workflow_state},
    )
    if remaining_nodes:
        new_next = remaining_nodes[0]
    else:
        new_next = Frontier(
            name=None,
            fields={
                "reason": "No remaining work-order node is contracted.",
                "revisit when": "The next proposal may introduce a node.",
            },
        )
    updated = _replace_header_value(text, "Current frontier", node.name)
    updated = _replace_frontier(
        updated,
        "### Current Frontier",
        _frontier_body(new_current, current=True),
    )
    updated = _replace_frontier(
        updated,
        "### Next-Frontier Candidate",
        _frontier_body(new_next, current=False),
    )
    updated = _replace_frontier_map(
        updated,
        FrontierMap(
            path=remaining,
            cadence=state.frontier_map.cadence,
            nodes=remaining_nodes,
            off_path=state.frontier_map.off_path,
        ),
    )
    return _append_workflow_history(
        updated,
        frontier=node.name,
        state=workflow_state,
        evidence="Selected remaining work-order head.",
    )


class MilestonePlanContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.plan_text = ready_plan_text()
        self.open_plan_text = implementation_review_plan_text()

    def test_invalid_exit_status_is_rejected_in_its_table_cell(self) -> None:
        invalid = self.plan_text.replace(
            f"| {CLOSEOUT_CRITERION} | Milestone closeout is accepted | Blocked |",
            f"| {CLOSEOUT_CRITERION} | Milestone closeout is accepted | READY |",
        )

        with self.assertRaisesRegex(
            PlanContractError,
            f"{CLOSEOUT_CRITERION}.*invalid status",
        ):
            validate_plan_text(invalid)

    def test_missing_current_frontier_owner_is_rejected(self) -> None:
        invalid = self.plan_text.replace(
            "- Acceptance owner: Synthetic evidence ledger\n",
            "",
        )

        with self.assertRaisesRegex(
            PlanContractError,
            "Current Frontier.*acceptance owner",
        ):
            validate_plan_text(invalid)

    def test_frontier_criteria_must_be_known_explicit_ids(self) -> None:
        invalid = self.plan_text.replace(
            f"- Exit criteria affected: {CURRENT_CRITERION}\n",
            f"- Exit criteria affected: {CURRENT_CRITERION} through M900-02\n",
            1,
        )

        with self.assertRaisesRegex(
            PlanContractError,
            "comma-separated list of IDs",
        ):
            validate_plan_text(invalid)

    def test_next_frontier_branch_must_use_milestone_prefix(self) -> None:
        start = self.plan_text.index("### Frontier Map")
        end = self.plan_text.index("## Workflow History", start)
        legacy = self.plan_text[:start] + self.plan_text[end:]
        invalid = legacy.replace(
            f"- Implementation branch: `{NEXT_IMPLEMENTATION_BRANCH}`\n",
            "- Implementation branch: `agent/closeout`\n",
        )

        with self.assertRaisesRegex(
            PlanContractError,
            "implementation branch must start",
        ):
            validate_plan_text(invalid)

    def test_mapped_plan_derives_successor_without_markdown_view(self) -> None:
        start = self.plan_text.index("### Next-Frontier Candidate")
        end = self.plan_text.index("### Frontier Map", start)
        without_view = self.plan_text[:start] + self.plan_text[end:]

        state = validate_plan_text(without_view)
        self.assertEqual(state.next_frontier.name, NEXT_FRONTIER)
        rendered = render_plan_text(without_view)
        self.assertIn("### Next-Frontier Candidate", rendered)
        self.assertIn(f"**{NEXT_FRONTIER}**", rendered)

    def test_mapped_plan_ignores_stale_markdown_successor_view(self) -> None:
        start = self.plan_text.index("### Next-Frontier Candidate")
        end = self.plan_text.index("### Frontier Map", start)
        view = self.plan_text[start:end].replace(
            "- Review question: Is the synthetic milestone complete?",
            "- Review question: Stale duplicate state",
        )
        stale = self.plan_text[:start] + view + self.plan_text[end:]

        state = validate_plan_text(stale)
        self.assertEqual(
            state.next_frontier.fields["review question"],
            "Is the synthetic milestone complete?",
        )
        rendered = render_plan_text(stale)
        self.assertIn(
            "- Review question: Is the synthetic milestone complete?",
            rendered,
        )

    def test_handoff_renders_successor_view_for_mapped_plan(self) -> None:
        start = self.open_plan_text.index("### Next-Frontier Candidate")
        end = self.open_plan_text.index("### Frontier Map", start)
        without_view = self.open_plan_text[:start] + self.open_plan_text[end:]

        updated = apply_handoff(without_view, _receipt())
        state = validate_plan_text(updated)
        self.assertEqual(state.next_frontier.name, NEXT_FRONTIER)
        self.assertIn("### Next-Frontier Candidate", updated)

    def test_milestone_branch_must_match_milestone_number(self) -> None:
        invalid = self.plan_text.replace(
            f"`{MILESTONE_BRANCH}`",
            "`milestone/901-wrong-milestone`",
            1,
        )

        with self.assertRaisesRegex(
            PlanContractError,
            "Milestone branch must start with 'milestone/900-'",
        ):
            validate_plan_text(invalid)

    def test_mid_milestone_adoption_requires_cutover_and_baseline_ledger(self) -> None:
        missing_cutover = self.plan_text.replace(
            "| Cutover | Synthetic mid-milestone workflow fixture |\n",
            "",
        )
        with self.assertRaisesRegex(PlanContractError, "baseline and Cutover"):
            validate_plan_text(missing_cutover)

        missing_baseline_row = self.plan_text.replace(
            f"| Baseline #1 (`{BASELINE_SHA}`) | Is the fixture baseline accepted? | Accepted before compact-contract adoption | M900-01-M900-03 | Synthetic baseline |\n",
            "",
        )
        with self.assertRaisesRegex(PlanContractError, "Contract baseline row"):
            validate_plan_text(missing_baseline_row)

    def test_mid_milestone_adoption_names_grandfathered_prs(self) -> None:
        missing_field = self.plan_text.replace(
            "| Grandfathered PRs | #1 |\n",
            "",
        )
        with self.assertRaisesRegex(PlanContractError, "Grandfathered PRs"):
            validate_plan_text(missing_field)

    def test_advance_allows_empty_remaining_work_order(self) -> None:
        start = self.open_plan_text.index("### Next-Frontier Candidate")
        end = self.open_plan_text.index("### Frontier Map")
        empty_next = (
            "### Next-Frontier Candidate\n\n"
            "**None**\n\n"
            "- Reason: No further unit is contracted.\n"
            "- Revisit when: The next proposal may introduce a node.\n\n"
        )
        plan = self.open_plan_text[:start] + empty_next + self.open_plan_text[end:]
        plan = plan.replace(f"- Path: `{NEXT_FRONTIER}`", "- Path: none", 1)
        node_start = plan.index("#### Node:")
        history = plan.index("## Workflow History")
        plan = plan[:node_start] + plan[history:]
        updated = apply_handoff(plan, _receipt())
        state = validate_plan_text(updated)
        self.assertTrue(state.current.is_empty)
        self.assertTrue(state.next_frontier.is_empty)
        self.assertEqual(state.frontier_map.path, ())

    def test_block_keeps_remaining_work_order(self) -> None:
        receipt = _receipt()
        receipt["outcome"] = "block"
        receipt["blocked_reason"] = "Need operator input"
        receipt["revisit_when"] = "Operator unblocks"
        updated = apply_handoff(self.open_plan_text, receipt)
        state = validate_plan_text(updated)
        self.assertEqual(state.status, "Blocked")
        self.assertTrue(state.current.is_empty)
        self.assertEqual(state.next_frontier.name, NEXT_FRONTIER)
        self.assertEqual(state.frontier_map.path, (NEXT_FRONTIER,))

    def test_handoff_returns_to_idle_and_keeps_remaining_work_order(self) -> None:
        updated = apply_handoff(self.open_plan_text, _receipt())
        state = validate_plan_text(updated)

        self.assertEqual(state.status, "Active")
        self.assertTrue(state.current.is_empty)
        self.assertEqual(state.next_frontier.name, NEXT_FRONTIER)
        self.assertEqual(state.frontier_map.path, (NEXT_FRONTIER,))
        self.assertIn(
            ("#59",),
            tuple((row[0],) for row in state.ledger.rows),
        )
        statuses = {row[0]: row[2] for row in state.criteria.rows}
        self.assertEqual(statuses[CURRENT_CRITERION], "Met")
        self.assertEqual(statuses["M900-02"], "Met")
        self.assertNotIn(
            RESOLVED_RISK,
            updated,
        )

    def test_handoff_rejects_before_implementation_review(self) -> None:
        with self.assertRaisesRegex(
            PlanContractError,
            "requires workflow state implementation_in_review",
        ):
            apply_handoff(self.plan_text, _receipt())

    def test_handoff_rejects_duplicate_ledger_entry(self) -> None:
        marker = "\n\nThe baseline row is the explicit adoption boundary"
        duplicate_plan = self.open_plan_text.replace(
            marker,
            f"\n| #59 | Already accepted | Accepted | {CURRENT_CRITERION} | duplicate |"
            + marker,
        )

        with self.assertRaisesRegex(PlanContractError, "already in the accepted ledger"):
            apply_handoff(duplicate_plan, _receipt())

    def test_plan_validation_rejects_duplicate_ledger_pr_rows(self) -> None:
        marker = "\n\nThe baseline row is the explicit adoption boundary"
        duplicate_plan = self.plan_text.replace(
            marker,
            f"\n| #57 | First result | Accepted | {CURRENT_CRITERION} | first |"
            f"\n| #57 | Duplicate accepted result | Accepted | {CURRENT_CRITERION} | duplicate |"
            + marker,
        )

        with self.assertRaisesRegex(PlanContractError, "duplicate accepted ledger PR"):
            validate_plan_text(duplicate_plan)

    def test_handoff_rejects_criterion_updates_outside_current_frontier(self) -> None:
        receipt = _receipt()
        receipt["criterion_updates"]["M900-02"] = {
            "status": "Met",
            "evidence": "unowned update",
        }

        with self.assertRaisesRegex(
            PlanContractError,
            "outside the current frontier: M900-02",
        ):
            apply_handoff(self.open_plan_text, receipt)

    def test_handoff_cannot_invent_next_candidate(self) -> None:
        receipt = _receipt()
        receipt["next_frontier"] = {
            "state": "candidate",
            "name": "Unreviewed work",
        }

        with self.assertRaisesRegex(
            PlanContractError,
            "cannot invent an unreviewed next candidate",
        ):
            apply_handoff(self.open_plan_text, receipt)

    def test_handoff_does_not_force_closeout_when_other_criteria_remain(self) -> None:
        incomplete = self.open_plan_text.replace(
            "| M900-02 | Existing operator path remains stable | Met |",
            "| M900-02 | Existing operator path remains stable | Partial |",
        )
        updated = apply_handoff(incomplete, _receipt())
        state = validate_plan_text(updated)
        self.assertTrue(state.current.is_empty)
        self.assertEqual(state.next_frontier.name, NEXT_FRONTIER)
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot select milestone closeout.*M900-02",
        ):
            validate_plan_text(_select_work_order_head(updated))

    def test_closeout_handoff_requires_and_records_all_criteria_met(self) -> None:
        promoted = apply_handoff(self.open_plan_text, _receipt())
        promoted = _select_work_order_head(promoted)
        promoted = promoted.replace(
            "- Workflow state: ready_for_proposal\n",
            "- Workflow state: implementation_in_review\n",
            1,
        )
        promoted = promoted.replace(
            f"**{NEXT_FRONTIER}**\n",
            f"**{NEXT_FRONTIER}**\n\n- PR: [#60](https://example.invalid/60)\n",
            1,
        )
        promoted = promoted.replace(
            "- Proposal path: `docs/milestones/900-workflow-fixture/proposals/closeout.md`\n",
            "- Proposal path: `docs/milestones/900-workflow-fixture/proposals/closeout.md`\n"
            "- Accepted proposal: [#61](https://example.invalid/61) at `cab1234` "
            "(reviewed head `ffffffffffffffffffffffffffffffffffffffff` by "
            "`workflow-reviewer` as `COLLABORATOR` at "
            "`2026-08-12T18:00:00Z`)\n",
            1,
        )
        promoted = promoted.replace(
            "\n\n## Accepted Review Units",
            f"\n| {NEXT_FRONTIER} | proposal_in_review | Proposal branch started. |"
            f"\n| {NEXT_FRONTIER} | ready_for_implementation | Proposal PR #61 accepted. |"
            f"\n| {NEXT_FRONTIER} | implementation_in_review | Implementation branch started. |"
            "\n\n## Accepted Review Units",
            1,
        )
        close_receipt = {
            "schema": "milestone_handoff_v1",
            "accepted_pr": 60,
            "accepted_merge_commit": "feedbee",
            "outcome": "close",
            "result": "Accepted",
            "durable_evidence": "closeout.md",
            "criterion_updates": {},
            "risk_remove": [],
            "risk_upsert": [],
        }
        with self.assertRaisesRegex(
            PlanContractError,
            f"cannot close milestone.*{CLOSEOUT_CRITERION}",
        ):
            apply_handoff(promoted, close_receipt)

        close_receipt["criterion_updates"] = {
            CLOSEOUT_CRITERION: {
                "status": "Met",
                "evidence": "Milestone closeout accepted",
            }
        }
        closed = validate_plan_text(apply_handoff(promoted, close_receipt))
        self.assertEqual(closed.status, "closed")
        self.assertTrue(closed.current.is_empty)
        self.assertTrue(closed.next_frontier.is_empty)

    def test_github_metadata_must_match_merge_and_milestone_branch(self) -> None:
        state = validate_plan_text(self.open_plan_text)
        receipt = _receipt(merge_commit="abc1234")
        valid = {
            "state": "MERGED",
            "baseRefName": MILESTONE_BRANCH,
            "headRefName": IMPLEMENTATION_BRANCH,
            "mergeCommit": {"oid": "abc123456789"},
            "body": (
                "## Review Kind\n\n"
                "Deterministic invariant closure\n"
            ),
        }
        validate_merged_pr_metadata(valid, state, receipt)

        wrong_base = {**valid, "baseRefName": "main"}
        with self.assertRaisesRegex(PlanContractError, "did not target"):
            validate_merged_pr_metadata(wrong_base, state, receipt)

        wrong_sha = {**valid, "mergeCommit": {"oid": "def567890"}}
        with self.assertRaisesRegex(PlanContractError, "does not match"):
            validate_merged_pr_metadata(wrong_sha, state, receipt)

        wrong_kind = {
            **valid,
            "body": "## Review Kind\n\nBehavioral feature slice\n",
        }
        with self.assertRaisesRegex(PlanContractError, "review kind does not match"):
            validate_merged_pr_metadata(wrong_kind, state, receipt)

    def test_missing_frontier_map_is_legacy_current_plus_next(self) -> None:
        start = self.plan_text.index("### Frontier Map")
        end = self.plan_text.index("## Workflow History")
        missing = self.plan_text[:start] + self.plan_text[end:]
        state = validate_plan_text(missing)
        self.assertEqual(state.frontier_map.path, (NEXT_FRONTIER,))
        self.assertEqual(state.next_frontier.name, NEXT_FRONTIER)

    def test_next_frontier_view_is_derived_from_map_head(self) -> None:
        state = validate_plan_text(self.plan_text)
        replacement = Frontier(
            name="Replacement successor",
            fields={"review question": "A replacement is visible."},
        )
        updated = replace(
            state,
            frontier_map=FrontierMap(
                path=(replacement.name,),
                cadence=state.frontier_map.cadence,
                nodes=(replacement,),
                off_path=state.frontier_map.off_path,
            ),
        )

        self.assertEqual(updated.next_frontier, replacement)

    def test_path_cannot_repeat_a_node_name(self) -> None:
        invalid = self.plan_text.replace(
            f"- Path: `{NEXT_FRONTIER}`",
            f"- Path: `{NEXT_FRONTIER}` → `{NEXT_FRONTIER}`",
            1,
        )
        with self.assertRaisesRegex(PlanContractError, "cannot repeat a node name"):
            validate_plan_text(invalid)

    def test_current_cannot_appear_on_remaining_path(self) -> None:
        invalid = self.plan_text.replace(
            f"- Path: `{NEXT_FRONTIER}`",
            f"- Path: `{CURRENT_FRONTIER}` → `{NEXT_FRONTIER}`",
            1,
        )
        with self.assertRaisesRegex(
            PlanContractError,
            "cannot include the current frontier",
        ):
            validate_plan_text(invalid)

    def test_handoff_keeps_remaining_path_nodes(self) -> None:
        inserted = "Capability inventory"
        longer = self.open_plan_text.replace(
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
        longer = longer.replace(
            f"#### Node: {NEXT_FRONTIER}",
            node + f"#### Node: {NEXT_FRONTIER}",
            1,
        )
        next_block = """**Capability inventory**

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
        start = longer.index("### Next-Frontier Candidate")
        end = longer.index("### Frontier Map")
        longer = (
            longer[:start]
            + "### Next-Frontier Candidate\n\n"
            + next_block
            + "\n"
            + longer[end:]
        )
        updated = apply_handoff(longer, _receipt())
        state = validate_plan_text(updated)
        self.assertTrue(state.current.is_empty)
        self.assertEqual(state.next_frontier.name, inserted)
        self.assertEqual(
            state.frontier_map.path,
            (inserted, NEXT_FRONTIER),
        )


class MilestoneHandoffGitOrderingTests(unittest.TestCase):
    def _git(self, root: Path, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def test_handoff_requires_clean_matching_branch_with_merge_ancestor(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            plan.write_text(
                implementation_review_plan_text(),
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
                "accepted review unit",
            )
            merge_commit = self._git(root, "rev-parse", "HEAD")
            state = validate_plan_text(plan.read_text(encoding="utf-8"))
            receipt = _receipt(merge_commit=merge_commit)

            verify_handoff_git_state(plan, state, receipt, repo_root=root)

            (root / "uncommitted.txt").write_text("dirty", encoding="utf-8")
            with self.assertRaisesRegex(PlanContractError, "clean worktree"):
                verify_handoff_git_state(plan, state, receipt, repo_root=root)

    def test_handoff_rejects_branch_before_milestone_integration(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            plan.write_text(
                implementation_review_plan_text(),
                encoding="utf-8",
            )
            self._git(root, "init", "-b", "m900/incorrect-review-unit")
            self._git(root, "add", ".")
            self._git(
                root,
                "-c",
                "user.name=Milestone Test",
                "-c",
                "user.email=milestone@example.invalid",
                "commit",
                "-m",
                "not merged to milestone branch",
            )
            merge_commit = self._git(root, "rev-parse", "HEAD")
            state = validate_plan_text(plan.read_text(encoding="utf-8"))

            with self.assertRaisesRegex(PlanContractError, "handoff must run on"):
                verify_handoff_git_state(
                    plan,
                    state,
                    _receipt(merge_commit=merge_commit),
                    repo_root=root,
                )

    def test_start_creates_only_the_current_proposal_branch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            current = ready_plan_text().replace(
                f"- Proposal branch: `{PROPOSAL_BRANCH}`\n",
                f"- Proposal branch: `{PROPOSAL_BRANCH}` (planned; not opened)\n",
                1,
            )
            plan.write_text(current, encoding="utf-8")
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
                "frontier handoff",
            )
            state = validate_plan_text(current)

            start_proposal_branch(
                plan,
                state,
                PROPOSAL_BRANCH,
                repo_root=root,
            )

            self.assertEqual(
                self._git(root, "branch", "--show-current"),
                PROPOSAL_BRANCH,
            )
            transitioned = validate_plan_text(plan.read_text(encoding="utf-8"))
            self.assertEqual(
                transitioned.current.fields["workflow state"],
                "proposal_in_review",
            )
            self.assertEqual(
                transitioned.current.fields["proposal branch"],
                f"`{PROPOSAL_BRANCH}`",
            )

    def test_proposal_start_rejects_frontier_past_proposal_state(self) -> None:
        state = validate_plan_text(implementation_review_plan_text())
        with self.assertRaisesRegex(
            PlanContractError,
            "requires ready_for_proposal",
        ):
            start_proposal_branch(
                PLAN,
                state,
                PROPOSAL_BRANCH,
                repo_root=ROOT,
            )

    def test_start_reuses_an_existing_local_branch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan = root / PLAN_RELATIVE
            plan.parent.mkdir(parents=True)
            current = ready_plan_text()
            plan.write_text(current, encoding="utf-8")
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
                "frontier handoff",
            )
            self._git(root, "switch", "-c", PROPOSAL_BRANCH)
            state = validate_plan_text(current)
            start_proposal_branch(
                plan,
                state,
                PROPOSAL_BRANCH,
                repo_root=root,
            )
            self.assertEqual(
                self._git(root, "branch", "--show-current"),
                PROPOSAL_BRANCH,
            )
            transitioned = validate_plan_text(plan.read_text(encoding="utf-8"))
            self.assertEqual(
                transitioned.current.fields["workflow state"],
                "proposal_in_review",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
