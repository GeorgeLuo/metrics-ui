# Milestone Planning Contract

This file defines the planning and delivery format for every active and future
milestone. Individual plans own their goals, evidence, work, and decisions;
they link here rather than restating these general rules. Closed plans are
frozen historical records.

## Planning Model

A milestone has a stable objective and exit criteria, but not a fixed schedule
of pull requests. Keep the current review unit concrete and let evidence from
each merge determine the next one.

Every plan distinguishes:

- **Observed state:** verified repository behavior, measurements, and gaps.
- **Current delivery:** implemented or actively changing work with one review
  question.
- **Queued delivery:** the one likely next review unit, defined but not started.
- **Preparation horizon:** ordered needs that remain provisional until promoted.
- **Completion usage:** the small, stable set of human workflows the completed
  milestone must make possible.
- **Exit criteria:** fixed outcomes independent of one implementation path.

### Completion Usage Contract

Every active milestone enumerates the straightforward usage that should be
possible after closeout. Describe each workflow from the user's perspective and
label interfaces that do not exist yet as proposed.

The workflow set is milestone scope. Adding or removing a workflow requires an
explicit decision-log entry. Exact names, schemas, and presentation may evolve
as long as the original usage remains apparent and executable.

Each completion workflow records:

- **Starting state:** what must already be available or selected.
- **Proposed execution:** the shortest expected path through a public interface.
- **Success signal:** the output or state change that proves it worked.
- **Automation path, when needed:** structured output suitable for tests.

## Common Plan Format

Each active milestone uses a standalone `plan.html`. Keep it portable, readable
without a server, responsive on narrow screens, and free of external assets.

Use these sections in this order unless one is genuinely irrelevant:

1. **Header:** number, literal title, objective, status, date, constraints, and
   delivery model.
2. **High-Level Objective:** outcome cards and a concise success statement.
3. **Completion Usage:** implementation-agnostic workflows and success signals.
4. **Baseline:** observed status, evidence, and gaps.
5. **Current Delivery Horizon:** current review unit, queued unit, preparation
   horizon, and delivery state.
6. **Milestone-Specific Contracts:** architecture and policy needed to evaluate
   the milestone.
7. **Work Plan:** packages with `pending`, `active`, `blocked`, or `done` status
   and an accurate aggregate progress indicator.
8. **Scope Boundaries:** explicit in-scope and out-of-scope work.
9. **Risks And Controls:** likely failures paired with controls.
10. **Exit Criteria:** observable conditions required for closeout.
11. **Decision Log:** dated decisions and reasons.

Plans should support quick scanning. Use compact tables, status labels, and
expandable work packages where they improve navigation. Plan text describes
outcomes, evidence, and decisions rather than narrating every edit.

### Shared Contract Visibility

Every active plan embeds the generated version of this contract in a collapsed
section. This Markdown file remains canonical.

Refresh and validate it with:

```sh
npm run docs:milestones
npm run docs:milestones:check
```

The repository check verifies the source digest, active-plan link, required
sections, completion workflows, valid work statuses, and progress count.

## Pull Request Delivery Contract

Every pull request is one complete, reviewable deliverable. Review size is a
logical-complexity budget, not a line-count target.

### Deep And Narrow

Introduce or settle one policy, abstraction, or behavioral contract in a small
number of owning files. The reviewer should answer one primary question.

### Broad And Mechanical

Apply an already-reviewed pattern across many files without introducing new
behavior, abstractions, or unrelated cleanup.

Every pull request description identifies:

- one explicit review question;
- the review shape and files requiring deeper attention;
- file impacts grouped as `Create`, `Modify`, and `Remove` where applicable;
- dependencies and explicit non-goals;
- validation performed and its result; and
- user, operator, or developer impact.

Every pull request leaves the repository complete. Do not define a pattern and
roll it out broadly in the same review unit. Merge each deliverable before
branching the next by default.

## Rolling Delivery Horizon

Only the current review unit is committed in detail. The plan also names one
likely next unit so current work can prepare a clean boundary. Everything later
stays in the preparation horizon.

The current delivery records status, review shape, deliverable, review question,
file impacts, non-goals, and measured validation. The queued delivery records a
bounded expected outcome, review question, likely file ownership, and non-goals.

After each merge:

1. Re-read the milestone objective and exit criteria.
2. Record what changed, what was learned, and which assumptions failed.
3. Update baseline evidence and work-package status.
4. Promote one preparation-horizon item into the next concrete review unit.
5. Leave later work provisional.

## Status And Evidence

Use `pending`, `active`, `blocked`, and `done` consistently. A work package is
`done` only when all acceptance conditions are met; merging one pull request
inside it does not necessarily complete it.

Evidence must be reproducible and appropriately scoped. Record test counts,
timings, artifacts, or live observations when they support a conclusion. Do not
present planned behavior as observed behavior or a skipped check as a pass.

## Milestone Lifecycle

1. Create one numbered directory and a `plan.html` following this contract.
2. Define completion usage, fixed exit criteria, a concrete first delivery, and
   a preparation horizon.
3. Merge one deliverable at a time and update the plan after each accepted unit.
4. At closeout, freeze the plan and write `closeout.md` with outcomes,
   decisions, validation, unresolved work, and durable references.
5. Append a concise entry to [`completed.md`](completed.md).
6. Create the next milestone and update the active-work link in
   [`../README.md`](../README.md).
