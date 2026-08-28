from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from docs.milestones.workflow import (
    PlanContractError,
    RepairReviewMetadata,
    complete_implementation,
    load_handoff_template,
    materialize_handoff_receipt,
    validate_handoff_template_against_plan,
)
from tests.docs.milestone_workflow_fixtures import (
    CURRENT_CRITERION,
    IMPLEMENTATION_BRANCH,
    MILESTONE_BRANCH,
    NEXT_FRONTIER,
    PLAN_RELATIVE,
    PROPOSAL_RELATIVE,
    RESOLVED_RISK,
    implementation_review_plan_text,
    proposal_review_plan_text,
    proposal_text,
)


class HandoffTemplateTests(unittest.TestCase):
    def test_template_materializes_only_merge_time_identity(self) -> None:
        template = load_handoff_template(proposal_text())
        receipt = materialize_handoff_receipt(
            template,
            accepted_pr=64,
            accepted_merge_commit="a" * 40,
        )

        self.assertEqual(receipt["schema"], "milestone_handoff_v1")
        self.assertEqual(receipt["accepted_pr"], 64)
        self.assertEqual(receipt["accepted_merge_commit"], "a" * 40)
        self.assertIn("PR #64", receipt["durable_evidence"])
        self.assertNotIn("accepted_pr", template)
        self.assertNotIn("accepted_merge_commit", template)

    def test_template_cannot_predeclare_merge_identity(self) -> None:
        template = load_handoff_template(proposal_text())
        template["accepted_pr"] = 12

        with self.assertRaisesRegex(PlanContractError, "merge-time fields"):
            materialize_handoff_receipt(
                template,
                accepted_pr=64,
                accepted_merge_commit="a" * 40,
            )

    def test_proposal_validation_rejects_unowned_criterion(self) -> None:
        invalid = proposal_text().replace(
            f'"{CURRENT_CRITERION}":',
            '"M900-02":',
            1,
        )

        with self.assertRaisesRegex(
            PlanContractError,
            "outside the current frontier",
        ):
            validate_handoff_template_against_plan(
                invalid,
                proposal_review_plan_text(),
            )

    def test_proposal_validation_rejects_unknown_risk(self) -> None:
        invalid = proposal_text().replace(
            RESOLVED_RISK,
            "Unknown risk",
            1,
        )

        with self.assertRaisesRegex(PlanContractError, "removes unknown risks"):
            validate_handoff_template_against_plan(
                invalid,
                proposal_review_plan_text(),
            )


class CompleteImplementationTests(unittest.TestCase):
    def _git(self, root: Path, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def _repo(self, parent: Path) -> tuple[Path, Path, Path, str]:
        root = parent / "repo"
        remote = parent / "origin.git"
        root.mkdir()
        subprocess.run(
            ["git", "init", "--bare", str(remote)],
            check=True,
            capture_output=True,
            text=True,
        )
        self._git(root, "init", "-b", MILESTONE_BRANCH)
        self._git(root, "config", "user.name", "Milestone Test")
        self._git(root, "config", "user.email", "milestone@example.invalid")

        plan = root / PLAN_RELATIVE
        proposal = root / PROPOSAL_RELATIVE
        html = plan.with_suffix(".html")
        plan.parent.mkdir(parents=True)
        proposal.parent.mkdir(parents=True)
        plan.write_text(implementation_review_plan_text(), encoding="utf-8")
        proposal.write_text(proposal_text(), encoding="utf-8")
        html.write_text("<p>implementation review</p>\n", encoding="utf-8")
        self._git(root, "add", ".")
        self._git(root, "commit", "-m", "Merged implementation")
        self._git(root, "remote", "add", "origin", str(remote))
        self._git(root, "push", "-u", "origin", MILESTONE_BRANCH)

        upstream = parent / "upstream"
        subprocess.run(
            [
                "git",
                "clone",
                "--branch",
                MILESTONE_BRANCH,
                str(remote),
                str(upstream),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self._git(upstream, "config", "user.name", "Implementation Merge")
        self._git(
            upstream,
            "config",
            "user.email",
            "implementation@example.invalid",
        )
        (upstream / "implementation.txt").write_text(
            "accepted implementation\n",
            encoding="utf-8",
        )
        self._git(upstream, "add", "implementation.txt")
        self._git(upstream, "commit", "-m", "Merge implementation PR")
        merge_commit = self._git(upstream, "rev-parse", "HEAD")
        self._git(upstream, "push", "origin", MILESTONE_BRANCH)
        return root, plan, html, merge_commit

    def _payload(self, merge_commit: str) -> dict[str, object]:
        return {
            "state": "MERGED",
            "baseRefName": MILESTONE_BRANCH,
            "headRefName": IMPLEMENTATION_BRANCH,
            "mergeCommit": {"oid": merge_commit},
            "body": (
                "## Review Kind\n\n"
                "Deterministic invariant closure\n"
            ),
        }

    def _accepted_review_metadata(self) -> RepairReviewMetadata:
        head = "a" * 40
        return RepairReviewMetadata(
            pull_request_number=64,
            pull_request_url="https://example.invalid/64",
            pull_request_author="repair-author",
            head_oid=head,
            commits=(head,),
            reviews=(
                {
                    "url": "https://example.invalid/64#pullrequestreview-1",
                    "state": "COMMENTED",
                    "body": (
                        "## Contract Review Receipt\n\n"
                        "- Outcome: `accepted`\n"
                    ),
                    "commit": {"oid": head},
                    "submittedAt": "2026-08-14T19:30:00Z",
                    "author": {"login": "workflow-reviewer"},
                    "authorAssociation": "COLLABORATOR",
                    "authorCanPushToRepository": True,
                    "includesCreatedEdit": False,
                    "comments": {"nodes": [], "totalCount": 0},
                },
            ),
        )

    def test_cli_help_exposes_completion_command(self) -> None:
        script = (
            Path(__file__).resolve().parents[2]
            / "docs"
            / "milestones"
            / "workflow.py"
        )
        result = subprocess.run(
            [sys.executable, str(script), "--help"],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIn("complete-implementation", result.stdout)

    def test_completion_commits_pushes_and_stops_before_next_proposal(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root, plan, html, merge_commit = self._repo(Path(temp_dir))

            def render() -> None:
                html.write_text(
                    "<pre>" + plan.read_text(encoding="utf-8") + "</pre>\n",
                    encoding="utf-8",
                )

            completed = complete_implementation(
                plan,
                64,
                repo_root=root,
                pr_payload=self._payload(merge_commit),
                repair_review_metadata=self._accepted_review_metadata(),
                render_docs=render,
            )

            self.assertTrue(completed.current.is_empty)
            self.assertEqual(completed.next_frontier.name, NEXT_FRONTIER)
            self.assertEqual(completed.frontier_map.path, (NEXT_FRONTIER,))
            self.assertEqual(self._git(root, "status", "--porcelain"), "")
            self.assertEqual(
                self._git(root, "log", "-1", "--format=%s"),
                "Record PR 64 milestone handoff",
            )
            changed = set(
                self._git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
                .splitlines()
            )
            self.assertEqual(
                changed,
                {
                    PLAN_RELATIVE,
                    str(Path(PLAN_RELATIVE).with_suffix(".html")),
                },
            )
            remote_head = self._git(
                root,
                "ls-remote",
                "--heads",
                "origin",
                MILESTONE_BRANCH,
            ).split()[0]
            self.assertEqual(remote_head, self._git(root, "rev-parse", "HEAD"))
            self.assertIn("PR #64", plan.read_text(encoding="utf-8"))

    def test_completion_rejects_wrong_implementation_branch_without_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root, plan, html, merge_commit = self._repo(Path(temp_dir))
            payload = self._payload(merge_commit)
            payload["headRefName"] = "m900/wrong"

            with self.assertRaisesRegex(PlanContractError, "did not use"):
                complete_implementation(
                    plan,
                    64,
                    repo_root=root,
                    pr_payload=payload,
                    repair_review_metadata=self._accepted_review_metadata(),
                    render_docs=lambda: html.write_text(
                        "<p>unexpected</p>\n",
                        encoding="utf-8",
                    ),
                )

            self.assertEqual(self._git(root, "rev-parse", "HEAD"), merge_commit)
            self.assertEqual(self._git(root, "status", "--porcelain"), "")

    def test_completion_rejects_mismatched_review_kind_without_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root, plan, html, merge_commit = self._repo(Path(temp_dir))
            payload = self._payload(merge_commit)
            payload["body"] = "## Review Kind\n\nReview repair\n"

            with self.assertRaisesRegex(PlanContractError, "review kind does not match"):
                complete_implementation(
                    plan,
                    64,
                    repo_root=root,
                    pr_payload=payload,
                    repair_review_metadata=self._accepted_review_metadata(),
                    render_docs=lambda: html.write_text(
                        "<p>unexpected</p>\n",
                        encoding="utf-8",
                    ),
                )

            self.assertEqual(self._git(root, "rev-parse", "HEAD"), merge_commit)
            self.assertEqual(self._git(root, "status", "--porcelain"), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
