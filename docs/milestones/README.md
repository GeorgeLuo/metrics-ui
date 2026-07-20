# Milestone Planning Contract

This file defines the planning and delivery format for every active and future
milestone. Individual milestone plans contain their own goals, evidence, work,
and decisions; they should link here instead of restating these general rules.
Closed milestone plans are frozen historical records and are not required to be
retrofitted.

## Planning Model

A milestone has a stable objective and exit criteria, but not a fixed schedule
of pull requests. Keep the next review unit concrete and let evidence from each
merge determine the next one. This prevents early implementation assumptions
from becoming commitments while still making the direction and stopping
conditions explicit.

The plan must distinguish:

- **Observed state:** verified repository behavior, measurements, and gaps.
- **Current delivery:** implemented or actively changing work with one review
  question.
- **Queued delivery:** the one likely next review unit, defined but not started.
- **Preparation horizon:** ordered needs that remain provisional until promoted.
- **Completion usage:** the small, stable set of new human workflows the
  completed milestone must make possible.
- **Exit criteria:** fixed milestone outcomes that do not depend on a particular
  implementation path.

### Completion Usage Contract

Every active milestone enumerates the straightforward usage that should be
possible after closeout. Describe each workflow from the user's perspective:
the starting context, a proposed command, API, or UI execution path, and the
observable result that tells them it worked. The proposal must be concrete
enough for a reviewer to understand how the completed behavior will be run,
while remaining free of internal implementation steps. Clearly label commands
or interfaces that do not exist yet as proposed rather than observed behavior.

The workflow set is part of milestone scope and should not drift casually.
Adding or removing a workflow requires an explicit scope decision in the plan's
decision log. Exact command spelling, flags, schemas, limits, and presentation
may evolve during implementation as long as the original usage remains apparent
and executable. Update the proposal when those details settle. Every completion
workflow must be supported by exit criteria and closeout evidence; otherwise it
is aspiration rather than delivered usage.

Each completion workflow records:

- **Starting state:** what must already be available or selected.
- **Proposed execution:** the shortest expected human path through the public
  interface.
- **Success signal:** the concise output or state change that proves it worked.
- **Automation path, when needed:** structured output suitable for tests without
  making machine-oriented flags the default human experience.

## Common Plan Format

Each active milestone uses a standalone `plan.html` with the same high-level
shape as the active plan linked from [`../README.md`](../README.md). Keep it
portable, readable without a server, responsive on narrow screens, and free of
external assets.

Use these sections in this order unless one is genuinely irrelevant:

1. **Header:** milestone number, literal title, objective summary, status,
   start date, important operating constraints, and delivery model.
2. **High-Level Objective:** a small set of outcome cards and a concise statement
   of what success means.
3. **Completion Usage:** an implementation-agnostic enumeration of the new
   workflows a human can run after closeout, proposed public execution paths,
   and the result each workflow exposes.
4. **Baseline:** observed status, evidence, and remaining gap for each major area.
5. **Current Delivery Horizon:** current PR, next-after-review candidate,
   preparation horizon, and current delivery state.
6. **Milestone-Specific Contracts:** architecture, interfaces, output policies,
   target structures, or other rules needed to evaluate the milestone.
7. **Work Plan:** expandable work packages with `pending`, `active`, `blocked`,
   or `done` status and an accurate aggregate progress indicator.
8. **Scope Boundaries:** explicit in-scope and out-of-scope work.
9. **Risks And Controls:** likely failure modes paired with concrete controls.
10. **Exit Criteria:** observable conditions required before closeout.
11. **Decision Log:** dated decisions and reasons, including assumptions that
    changed during implementation.

Plans should support quick scanning. Use status pills, compact tables, cards for
distinct concepts, and expandable work packages when they improve navigation.
Do not add interactive elements that merely decorate the page. Plan text should
describe outcomes, evidence, and decisions rather than narrating every code edit.

### Shared Contract Visibility

Every active plan embeds the rendered version of this contract in a collapsed,
expandable section. The canonical content remains this Markdown file; do not
copy its rules into individual plans or edit `planning-contract.html` directly.

Refresh and validate it with:

```sh
npm run docs:milestones
npm run docs:milestones:check
```

The repository check verifies the source digest, active-plan link, required
sections, completion workflows, valid work statuses, and progress count. The
repository-native npm commands remain authoritative; shared policy does not
require every repository to use the same rendering implementation.

## Pull Request Delivery Contract

Every pull request is one complete, reviewable deliverable. Review size is a
logical-complexity budget, not a line-count target.

### Deep And Narrow

Introduce or settle one policy, abstraction, or behavioral contract in a small
number of owning files. The reviewer should be able to reason deeply about one
question without also auditing a repository-wide rollout.

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

List file impacts at ownership granularity with one purpose per path. The list
should make the shape of the change inspectable before implementation without
becoming a line-by-line design. Reconcile meaningful deviations in the final PR
description.

Every pull request leaves the repository complete. Do not define a pattern and
roll it out broadly in the same review unit. Land the pattern first, merge each
deliverable before branching the next by default, and split work when the
primary review question stops being singular.

## Milestone Git Isolation

Use one integration branch per active milestone so the complete milestone can
be reviewed as one cumulative change without making its individual pull
requests too large. The branch topology for the next planned milestone is:

```text
main
└── milestone/002-atomic-chase-evaluation-capture
    ├── m002/01-same-state-bundle
    ├── m002/02-play-transport
    └── m002/03-live-validation
```

The branch roles are fixed:

- **`main`:** completed milestones and explicitly approved maintenance only.
- **`milestone/<number>-<slug>`:** all accepted changes for one active
  milestone, including its plan, evidence, and closeout.
- **`m<number>/<review-unit>-<slug>`:** one review-sized deliverable targeting
  the milestone branch, never `main`.

Do not mix two milestones on one integration branch. Do not merge a milestone
work-block pull request directly into `main`. A review repair branches from the
milestone branch and targets that same milestone branch, so the cumulative
milestone pull request updates automatically.

### Start A Milestone

Start from current remote `main`, create the integration branch, and make the
plan bootstrap its first commit:

```sh
git switch main
git pull --ff-only
git switch -c milestone/002-atomic-chase-evaluation-capture
git push -u origin milestone/002-atomic-chase-evaluation-capture
```

After the plan commit is pushed, open a **draft** cumulative pull request from
the milestone branch to `main`. Keep it open for the milestone's lifetime. Its
diff is the authoritative whole-milestone review surface; its description links
the plan, current exit-criteria status, and accepted work-block pull requests.

```sh
gh pr create \
  --draft \
  --base main \
  --head milestone/002-atomic-chase-evaluation-capture \
  --title "Milestone 002: Atomic Chase Evaluation Capture"
```

### Deliver A Review Unit

Branch each review unit from the updated milestone branch:

```sh
git switch milestone/002-atomic-chase-evaluation-capture
git pull --ff-only
git switch -c m002/01-same-state-bundle
```

Push it and open its pull request against the milestone branch:

```sh
git push -u origin m002/01-same-state-bundle
gh pr create \
  --base milestone/002-atomic-chase-evaluation-capture \
  --head m002/01-same-state-bundle
```

The pull request title starts with `M002 / 01`, and the description states its
base branch explicitly. Prefer squash-merging each work-block pull request so
the milestone branch contains one commit per accepted review unit. Start the
next branch only after the prior pull request merges and the local milestone
branch is updated.

### Close A Milestone

The closeout, completed-milestone ledger update, and final evidence belong on
the milestone branch. When every exit criterion is met, mark the cumulative
pull request ready for review. That final review answers whether the milestone
objective, usage contract, evidence, code organization, and unresolved-risk
accounting are complete as a whole.

Merge the cumulative pull request into `main` with a merge commit so its
reviewed work-unit commits remain visible. Tag the resulting mainline merge
`milestone-<number>`, then delete the milestone and work branches. GitHub keeps
the individual pull request discussions after branch deletion.

```sh
gh pr ready <cumulative-pr-number>
gh pr merge <cumulative-pr-number> --merge --delete-branch
git switch main
git pull --ff-only
git tag milestone-002
git push origin milestone-002
```

If approved maintenance reaches `main` during an active milestone, merge the
updated `main` into the milestone branch before starting another review unit.
Do not rebase or force-push a published milestone branch. CI must run for pull
requests whose base is a milestone branch as well as for the cumulative pull
request to `main`.

This branching model is repository-development infrastructure. A future helper
may automate these exact steps, but it must fail visibly on uncommitted changes,
a stale base, an existing branch, or an incorrect pull request target rather
than hiding Git state.

## Rolling Delivery Horizon

Only the current pull request is committed in detail. A milestone plan also
names one likely next review unit so current work can prepare a clean boundary,
but that next unit remains unstarted until the current one is accepted.
Everything beyond it stays in the preparation horizon.

The current pull request records:

- status and review shape;
- deliverable and review question;
- expected or actual file impacts;
- non-goals; and
- measured validation evidence.

The next-after-review entry records:

- the expected review shape and question;
- a bounded expected deliverable;
- proposed file impacts when they are known; and
- non-goals that prevent work from leaking forward.

After each merge:

1. Re-read the milestone objective and exit criteria.
2. Record what changed, what was learned, and which assumptions failed.
3. Update baseline evidence and work-package status.
4. Promote one preparation-horizon item into the next concrete pull request.
5. Leave later work provisional rather than constructing a detailed schedule.

## Status And Evidence

Use `pending`, `active`, `blocked`, and `done` consistently. A work package is
`done` only when all of its acceptance conditions are met; completing one pull
request inside it does not complete the whole package.

Evidence should be reproducible and appropriately scoped. Record test counts,
timings, artifacts, or live-system observations when they support a conclusion.
Do not present planned behavior as observed behavior, a skipped check as a pass,
or an unlabeled visual result as an accuracy claim.

## Milestone Lifecycle

1. Create the milestone integration branch from current remote `main`.
2. Create one numbered directory and a `plan.html` following this contract.
3. Define completion usage, fixed exit criteria, a concrete first pull request,
   and a preparation horizon; push the plan and open the draft cumulative pull
   request to `main`.
4. Merge one review-unit pull request into the milestone branch at a time and
   update the plan after each accepted unit.
5. At closeout, freeze the plan and write `closeout.md` with outcomes,
   decisions, validation, unresolved work, and durable references.
6. Append a concise entry to [`completed.md`](completed.md), update the
   active-work link in [`../README.md`](../README.md), and make the cumulative
   pull request ready for whole-milestone review.
7. Merge the cumulative pull request, tag the mainline merge, remove milestone
   branches, then make the next milestone active or promote its pre-plan.

Closeouts preserve durable context; they do not duplicate source-level details.
Settled architecture belongs in durable documentation, while future-facing
research remains explicitly noncommittal until it supports a bounded milestone.

## Immediate Deferred Work And Pre-Plans

Closeouts may leave residual work. That residual is not a free-form backlog.
Route it into exactly one of these places:

1. **Durable documentation:** settled current behavior and architecture.
2. **Research synthesis:** evidence and candidate approaches without a delivery
   commitment.
3. **At most one pre-plan** after the active milestone: the single most
   immediate next problem that is already known and would block a named later
   capability.

### What Counts As Immediate Deferred Work

Immediate deferred work is the smallest next milestone-shaped question already
forced by evidence. It is not a wishlist, a long-range roadmap, or a growing
list of possible enhancements.

### Pre-Plan Rules

- A pre-plan lives at `milestones/<number>-<slug>/plan.html` with status such as
  `pre-plan - queued after NNN`.
- It has a fixed objective, explicit non-goals, a stop condition, and
  provisional packages: the same honesty as an active plan without competing
  for implementation attention.
- Pre-plans are **not active work**. Do not implement them while another
  milestone is active unless the active plan's decision log explicitly allows
  a narrow parallel exception.
- Prefer **one** written pre-plan for the work immediately after the active
  milestone. Do not stack many future milestone drafts.
- Revise a pre-plan only when prerequisite closeout evidence changes the bounded
  question, not to absorb every new idea found during active work.
- On activation, promote the pre-plan to active status, name the first review
  unit, and update the documentation guide. On abandonment, record why.

### Stop Expanding

If a residual cannot be stated as a single milestone objective with a stop
condition, it is not ready for a pre-plan. Leave it as research synthesis or
omit it until evidence forces a sharper question.
