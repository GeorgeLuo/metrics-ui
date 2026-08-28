# Milestone Planning And Delivery Contract

This file is the canonical planning and pull-request delivery contract for the
repository. Individual milestone plans contain their own objectives, usage,
status, and decisions. They link here instead of restating these rules.

Closed milestone plans are frozen historical records and are not required to be
retrofitted to this format.

## Goals

Separate:

1. feature-level milestone outcomes;
2. planning priority (frontier);
3. review-sized proposal and implementation PR deliverables (review units);
4. implementation tasks inside an accepted proposal;
5. external evidence units;
6. milestone closeout;
7. Git branches.

Minimize manual synchronization after a merge. A normal accepted implementation
should require only a handful of milestone-plan edits:

1. add one accepted-review-unit ledger row;
2. update affected exit criteria;
3. update unresolved risks;
4. leave remaining work-order nodes in place (do not delete them to make room);
5. return to idle so the next proposal selects current from the work order.

Do not preserve redundant sections merely because they already exist.

## Work-Unit Model

### Milestone

A **milestone** is a feature-level user or operator outcome.

It defines:

- a stable objective;
- observable completion usage;
- fixed exit criteria;
- milestone-level scope boundaries;
- safety or operating constraints;
- final external proof where required;
- residual-risk and closeout expectations.

A milestone is **not** a predetermined sequence of pull requests.

A milestone answers:

> What new thing can a user or operator reliably do after this work is complete?

### Frontier

The **frontier** is a planning position, not a branch or task.

It identifies the milestone claim ready for active attention.

The plan contains:

- a **work order** (`### Frontier Map`): durable named nodes and their remaining
  walk;
- a **current** pointer, which may be idle (`**None**`);
- **off-path** nodes that were contracted but are not on the remaining walk.

The work order is the sequence artifact. Current is selected from it. Completing
a unit does **not** force work on its predecessor's successor.

The current cadence is a **linked list** of remaining unstarted nodes. Treat the
map as a graph of durable nodes whose active walk is that list. Do not add
branches, joins, or a picker until a real unit needs them.

Nodes persist. Introducing a frontier, or rewiring the remaining path, must not
delete a previously contracted node. Move it off-path instead. Accepted work
stays in the review-unit ledger; the map is for nodes that are still queued or
off-path. The current node is the pointer, not a second copy on the path.

The frontier determines priority and readiness. It is not a detailed speculative
roadmap and not a ticket backlog of uncontracted names.

A node on the remaining path is not a name stub. It defines a minimal
pre-implementation acceptance contract so a later proposal can select it as
current. Full adversarial matrices, file impact, and exact validation are
settled in that node's own proposal. A title with a vague likely question
cannot sit on the path.

Select a node as **current** only when it is:

1. **contractable now** through one review question; and
2. **reviewable in one careful human pass**.

Idle current is the normal state at milestone start, after a unit is accepted,
and when the remaining path is empty. An empty remaining path is not a
deadlock: the next proposal may introduce a node (including closeout). `advance`
does not require a successor. Closeout is selected as current when the operator
is ready to close, not because the previous unit queued it.

Human review attention is the throughput limit. Prefer fewer sequential units
that close a contractable edge over many named subdivisions that multiply
handoffs.

### Review Unit

A **review unit** is one complete pull-request deliverable. A frontier normally
has a proposal review unit followed by an implementation review unit.

It proposes, implements, or proves one frontier claim and answers **one primary
review question**.

A review unit may be:

- deterministic invariant closure;
- a behavioral feature slice;
- a broad mechanical rollout;
- live or external evidence;
- a migration;
- a review repair;
- milestone closeout.

Do not call all review units “features.” Use the generic term **review unit**.

### Task

A **task** is a concrete implementation action inside a review unit.

Tasks normally do **not** receive separate branches or PRs. Group tasks only
when they support the same review question and acceptance boundary.

### Evidence Unit

When the review question changes from implementation correctness to real-system
proof, create a separate **evidence** review unit.

Examples: guided simulator validation, physical-device validation, benchmark,
operator acceptance procedure, tracked provenance artifact.

Do not combine deep deterministic contract review and substantial live-system
proof merely because they support the same milestone.

A bounded live check may remain in an implementation review unit when it is
immediate, requires no additional implementation, and adds little independent
review burden. Split it into an evidence unit when it needs separate environment
preparation, repeatable operator procedure, tracked artifacts, or an acceptance
judgment that could fail while the implementation contract still passes.

For a universal or deterministic implementation claim, the proposal chooses the
evidence topology before implementation starts. It states whether bounded proof
remains in the implementation review unit or whether capture and acceptance use
a later evidence review unit. Do not begin canonical live-artifact capture until
the proposal's stated capture-readiness conditions hold; repeated capture while
the artifact schema, authority mapping, semantic verifier, or adversarial
mutation cases are still changing is contract discovery, not acceptance proof.

### Repair Cycle

A review finding remains in the existing PR when it still challenges that PR’s
stated contract.

A **repair cycle** is one consolidated changes-requested verdict followed by an
author revision that addresses that verdict. Count the round once regardless of
how many findings, commits, or comments it contains.

The reviewer classifies the cycle in the verdict. It is **substantial** when
either the verdict contains a P0–P2 contract failure or the repair changes the
review question, contract, external assumptions, or adversarial failure class.
Collapsing two shapes inside the accepted owner, while artifacts and Met
predicates stay true, is not substantial. Moving enforcement to a different
named owner is a contract change. Editorial cleanup, evidence formatting, and
localized P3 corrections are **minor** only when none of those conditions
applies. A disputed or omitted classification is treated as
substantial until the reviewer resolves it.

Every review-unit PR body keeps a `Repair Cycle Ledger` with the verdict receipt,
classification, highest severity, full repair revision, and contract impact for
each cycle. The receipt must identify one unedited GitHub review on that PR. Its
reviewed head, reviewer-owned classification, `[P0]` through `[P3]` inline
finding headings, stable finding URLs, and GitHub submission time are the
authority. The repair revision must follow the reviewed head. The count belongs
to the review unit and does not reset after force-push, reopen, or a change of
author.

The consolidated verdict body contains exactly one line in the form
`Classification: minor` or `Classification: substantial`. Every inline comment
attached to that verdict begins with `[P0]`, `[P1]`, `[P2]`, or `[P3]`.

#### Closed implementation review

After a proposal is accepted, implementation review may raise P0–P2 only when
the case is already in the accepted proposal's adversarial matrix or it
falsifies the stated review question. Any other observation is P3 or a later
want. Two leftover shapes in the same owner, a request to collapse
internals, or a request to add or polish derived evidence HTML are P3 unless
the operator required that page or the accepted question named one type as
the claim. A new failure class discovered during fill is a proposal amendment
or an explicit residual, not proof that the current implementation is false.

Do not invent a broader matrix during re-review. Re-check prior findings and
the accepted matrix only.

There is no cycle count that pauses review. A second or later substantial
repair is ordinary work when it still addresses the accepted question. If the
accepted contract is wrong, amend the proposal. If the unit is not singular,
stop and re-scope. Do not treat another repair round as evidence that the
process must escalate.

Review and implementation use the same GitHub account, so GitHub will not emit
`CHANGES_REQUESTED` or `APPROVED` on these PRs. The only action-forcing signal
is an unedited exact-head `COMMENTED` review containing only:

```text
## Contract Review Receipt

- Outcome: `accepted`
```

or `changes_requested`. Inline findings, want/reject notes, and `## Concerns`
are documentary. They may be rendered later. They do not force repair and do
not block or authorize `complete-implementation`.

Completion requires that exact-head receipt to be `accepted`, with no later
exact-head `changes_requested` receipt. The receipt head must be the
implementation tip at merge time; a later push to the implementation branch
cannot authorize handoff of an older merge. A migration's unresolved-finding
manifest is history, not a lock. `split-or-replace-review-unit` remains
fail-closed pending structured lineage verification. A new PR number does not
reset review history.

This revision becomes authoritative only after the PR introducing it merges
into the governing base. The introducing PR remains governed by its base
contract and cannot use the proposed rule to authorize itself. Review units
already open at merge do not migrate automatically. A migration requires an
explicit `## Repair Contract Migration` receipt for that specific PR:

```text
## Repair Contract Migration

- PR: #<number>
- Prior governing base: <full commit SHA>
- Adopted contract: <full contract merge SHA>
- Cumulative cycles: <integer>
- Cumulative classifications: <minor|substantial, ...>
- Unresolved finding manifest: <ordered comma-separated durable URLs or None>
- Migration point: <full commit SHA>
- Decision receipt: <durable GitHub issue-comment URL>
- Route: <selected route>
- Disposition: <unambiguous migration decision>
```

Create a separate repair review unit only when a distinct PR is genuinely
necessary.

#### Late implementer collapse

After the accepted tests are green and the review question is answerable, and
before requesting review, the implementer may treat those tests as the black
box and collapse two shapes in the same owner against them. Do this once, not
during fill and not after each repair.

Drive the tests through the public door: committed artifacts or the documented
command in, pass or fail on the named mutation out. Do not pin helper names or
error substrings as the contract.

The pass is implementer-owned and documentary. It has no receipt, ledger row,
or CI gate. Leftover two-shapes are `## Concerns`, not a completion lock.

If the collapse would change artifacts, Met predicates, the review question,
or the named owner, stop. That is an amendment or a later want, not
sanitation.

During a repair cycle, add the missing case at that public door and the
cheapest close. Do not move enforcement to a different named owner in the
finding diff.

#### Derived evidence rendering

When an implementation mints a durable machine-readable signal (report,
inventory, registry, disposition record, or equivalent), also commit a derived
HTML view of those bytes. A frontier that renders one or more signals uses one
stable evidence directory and records its repository-relative path in the
proposal's `Evidence rendering` section. Put the committed records and their
pages beneath that directory, with each page next to the record it presents.
The record stays the authority. The page, when produced, is a view of that
committed record, not a fixture or sample. Page format and the internal
record-to-page relation stay underspecified until a real frontier teaches what
is useful. Do not invent same-stem, in-page link, or manifest rules in advance.

Skip the page only with a one-line reason in the proposal. Need, and whether
a skip is enough, are owned by the operator (or someone the operator
explicitly deputizes). Reviewers and implementers do not decide that a page
is required, sufficient, or good-looking.

This default has no receipt, ledger row, or CI gate. Missing, crude, or absent
HTML is `## Concerns` unless the operator already required that page. Do not
fail Met on layout. Do not treat volume or coverage on the page as a gate.
Do not build a frontier-picker website in this rule; an index may be composed
later from the committed pages.

Units that mint no sealed signal (proposal-only, plan revision, docs-only)
need no page and no skip reason.

### HITL Implementation Adjunct

A **HITL implementation adjunct** is an exceptional child review unit for a
bounded change first requested by a human during hands-on testing after an
implementation review has started. It targets the canonical implementation
branch, not the milestone branch, and leaves the frontier in
`implementation_in_review`.

An adjunct is neither a repair nor a contract amendment. The parent’s accepted
contract must remain true without it, while the requested behavior is additive,
compatible, and useful to the same frontier and operator journey. Human
direction supplies the need and `implement-now` priority; it does not waive
contract compatibility, safety review, or evidence refresh.

### Closeout

**Milestone closeout** is a separate review unit asking:

> Is the milestone complete as a whole?

It evaluates completion usage, every exit criterion, cumulative implementation,
external evidence, durable documentation, unresolved risks, and whether the next
milestone or pre-plan should be activated.

Closeout must not conceal unfinished implementation or validation.

## Information Ownership

| Information | Canonical location |
| --- | --- |
| Milestone objective | Milestone plan |
| Completion usage | Milestone plan |
| Exit criteria and status | Milestone plan |
| Current frontier, remaining path, and off-path nodes | Milestone plan frontier map |
| Detailed invariant, trust/authority model, evidence topology, and adversarial matrix | Accepted proposal document |
| Planned file impact and validation commands | Accepted proposal document |
| Actual file impact and validation results | Implementation PR |
| Derived HTML of a sealed implementation signal | Proposal-declared per-frontier evidence directory, next to the committed record |
| Operator skip of that HTML | Proposal; operator-accepted |
| Human user-testing request and implement-now direction | Durable issue and adjunct PR |
| Review findings and repair history | Review-unit PR |
| Accepted result of a merged PR | One-row plan ledger |
| Current architecture behavior | `docs/reference/` |
| Repository navigation | `docs/README.md` |
| Final milestone judgment | `closeout.md` |
| Future research without commitment | `docs/synthesis/` |

Do not copy complete PR descriptions into milestone plans.

Do not copy architecture facts into milestone plans when they belong in durable
reference documentation.

Do not make `docs/README.md` a second source of detailed milestone status.

## Milestone Layout

Prefer:

```text
docs/milestones/<number>-<slug>/
├── plan.md          # canonical plan (active milestones)
├── plan.html        # generated; do not edit directly
├── proposals/       # independently reviewed frontier contracts
├── closeout.md      # created at closeout
└── evidence/
```

`plan.md` is canonical for active milestones. `plan.html` is generated from it.

The shared contract lives in this file (`docs/milestones/README.md`). Its
browser rendering is `planning-contract.html`.

Refresh generated HTML after contract or plan Markdown changes:

```sh
python3 -m pip install -r docs/requirements.txt
python3 docs/render_markdown.py
python3 docs/render_markdown.py --check
```

Closed historical plans may remain hand-authored `plan.html` files and are not
required to gain a `plan.md`.

## Git Branch Model

Use one integration branch per active milestone.

```text
main
└── milestone/<number>-<slug>
    ├── m<number>/<frontier>-proposal
    ├── m<number>/<frontier>
    │   └── m<number>/<frontier>--adjunct-<slug>
    └── ...
```

### `main`

Completed milestones and explicitly approved maintenance only.

### `milestone/<number>-<slug>`

All accepted work for one active milestone: accepted review units, plan updates,
evidence, reference updates, and closeout.

Open one long-lived **draft cumulative PR** from the milestone branch to `main`.

### Frontier branches

Each frontier has two independently reviewed branches:

- `m<number>/<frontier>-proposal` contains only the tracked proposal, canonical
  plan transition, and generated plan HTML;
- `m<number>/<frontier>` implements only the accepted proposal.

If evidence shows that an accepted proposal is materially wrong before its
implementation is accepted, an optional `m<number>/amend-<slug>` branch may add
a proposal amendment. It is a contract review unit, not a third implementation
branch.

Both branches:

- start from the updated milestone branch at their permitted workflow state;
- **targets the milestone branch**, never `main` directly;
- contains one primary review question;
- leaves the milestone branch coherent after merge.

Prefer squash-merging both PRs into the milestone branch. A proposal's
exact-head contract review and merge together form its approval receipt; merge
alone is not proposal acceptance or implementation acceptance. Merge the final
cumulative milestone PR into `main` with a **merge commit** so accepted
frontier history remains visible.

### HITL implementation adjunct branches

When a human explicitly requests an eligible additive change during hands-on
testing, branch `m<number>/<frontier>--adjunct-<slug>` from the current head of
the canonical `m<number>/<frontier>` implementation branch. The adjunct PR:

- targets that implementation branch, never the milestone branch or `main`;
- uses `.github/PULL_REQUEST_TEMPLATE/implementation-adjunct.md`;
- links the parent implementation PR and durable operator-request issue;
- records the HITL discovery context and explicit `implement-now` disposition;
- contains one bounded review question and compatibility assertion; and
- does not change the milestone plan, accepted proposal, or accepted amendment.

Do not base an adjunct on another adjunct. Keep it current with the parent
implementation branch, merge it back into that parent, then re-review the
parent PR in totality. The parent implementation remains the frontier’s sole
acceptance and ledger unit.

Do not create an implementation branch until its proposal PR has merged and the
workflow records `ready_for_implementation`. Do not begin the next frontier
before the current implementation PR merges unless the milestone decision log
records a narrow parallel exception.

If approved maintenance reaches `main` during an active milestone, merge updated
`main` into the milestone branch before starting another review unit. Do not
rebase or force-push a published milestone branch.

### Historical deviation note

Earlier 001 work often targeted `main` directly. New review units for active
milestones must use the milestone-branch topology above. Document any temporary
exception in the milestone decision log.

### Adopting This Contract Mid-Milestone

Do not pretend an already-active milestone always used this topology. Its plan
must record:

1. a **historical baseline** commit or accepted-review-unit summary for work
   merged before adoption;
2. a `Grandfathered PRs` header field naming every open grandfathered PR, with
   its existing target branch and whether it keeps a mixed review kind
   temporarily;
3. the exact **cutover point** after which review units use the milestone branch;
4. how conflicting hand-authored and generated planning files will resolve in
   favor of the canonical Markdown source; and
5. whether the first cumulative PR is a transitional closeout delta rather than
   a literal diff of all earlier milestone work.

Do not retarget or reconstruct a published historical PR merely for topology
purity when doing so adds risk without improving its review. Reconcile its
description and evidence to the new contract proportionately, then begin the new
branch model at the declared cutover.

## Compact Milestone Plan Structure

Active plans use these sections only.

### 1. Header

| Field | Value |
| --- | --- |
| Status | Active / Blocked / pre-plan / closed |
| Milestone branch | `milestone/<number>-<slug>` |
| Cumulative PR | `#…` or `TBD` |
| Current frontier | short name |
| Started | YYYY-MM-DD |
| Action policy | e.g. Idle / no movement |

### 2. Objective

One concise paragraph: what becomes possible, not how it is implemented.

### 3. Completion Usage

Stable human workflows after closeout:

| Workflow | Starting state | Execution | Success signal | Criteria |
| --- | --- | --- | --- | --- |

The first body row must be `Primary demonstration`. It states one bounded,
end-to-end feature outcome that a human can execute and recognize after
closeout. Keep it to one row and leave schemas, lifecycle matrices, edge cases,
and validation mechanics to the frontier proposal. Supporting workflow rows may
then cover setup, inspection, replay, or environment-specific execution without
creating another feature-goal section.

### 4. Scope Boundaries

One concise in-scope / out-of-scope table. Review-unit non-goals live in the PR.

### 5. Exit Criteria

Authoritative completion table:

| ID | Criterion | Status | Evidence / remaining gap |
| --- | --- | --- | --- |

Allowed statuses: `Unmet`, `Partial`, `Met`, `Blocked`.

Do **not** maintain separate remaining-for-closeout, remediation-order, package
progress, or completion-percentage sections. Those must be derivable from this
table.

### 6. Current Delivery

A frontier map (the work-order artifact), a current pointer that may be idle,
and a successor slot derived from the remaining path.

**Frontier map** records remaining unstarted work:

- **Path:** ordered remaining nodes, using `→`. Cadence is `linked-list`.
  `Path: none` is legal while idle, including a fresh milestone.
- **Node:** one subsection per remaining path name, using the minimal
  acceptance fields below.
- **Off-path:** contracted nodes not on the remaining path, with the same
  fields plus an off-path reason. They remain on the map so a later proposal
  can put them back without re-authoring.

The path does **not** include the current pointer. Current, if set, must not
also appear as a remaining or off-path node. Path names cannot repeat. The
successor slot is `path[0]`, or **None** when the path is empty. Closeout, if
on the path, is last. Active and blocked plans require this section, except a
one-time legacy read: if `### Frontier Map` is missing, Current plus
Next-Frontier Candidate is the old shape (current pointer and at most one
remaining node). The next proposal PR must write the real map. Closed plans
use `Path: none` with no queued or off-path nodes.

For mapped plans, `### Next-Frontier Candidate` is a generated successor view:
validation derives it from `Frontier Map` path[0], and Markdown rendering
regenerates the view from that node. Only the bounded no-map legacy adapter
parses that section as input.

```markdown
### Frontier Map

- Path: `Successor` → `Milestone closeout`
- Cadence: linked-list

#### Node: Successor
```

**Current frontier** records: name, workflow state, separate proposal and
implementation branches, proposal path, review kind, one review question,
enforcement or acceptance owner, affected exit criteria, prerequisite, and
concise milestone-level non-goal. Record the accepted proposal PR and merge
commit before implementation starts. Record each accepted additive proposal
amendment with its artifact path, PR, and merge commit. Add the active PR only
for the phase currently under review.

The current frontier and every remaining-path or off-path node must use one of
the supported values in [Review Kinds](#review-kinds). The value is the stable
review focus for that frontier across its proposal, any proposal amendments,
and its implementation.

When populated, the **next-frontier candidate** (the path successor) is a
pre-implementation acceptance contract. It is valid only when it records at
least:

- **name;**
- **planned proposal branch;**
- **planned implementation branch;**
- **planned proposal path;**
- **expected review kind;**
- **one review question** stable enough that promotion would open proposal work
  against it;
- **enforcement or acceptance owner** (module, boundary, procedure surface, or
  closeout judgment surface);
- **affected exit criteria** (stable IDs);
- **prerequisite;**
- **concise non-goals** (what must not leak into that unit).

It is not started and must not yet have either branch or a PR. The **proposal
PR** is the review surface for the work order. While opening a proposal
(idle or `ready_for_proposal` → `proposal_in_review`), it may:

- add nodes;
- rewire the remaining path;
- move a not-yet-started node off-path;
- update a not-yet-started node's minimal contract;
- select current from the artifact (path[0] after that rewire, or a newly
  introduced node).

Those edits are not a second review question and must not block accepting a
bounded selected unit. Until an exact-head contract receipt exists on the PR,
the proposal may retarget current from the work order. After a receipt, later
commits cannot change current identity, question, owner, or kind. Remaining-path
edits may continue. CI compares that freeze to the plan at the first receipt
commit, not only to the milestone base.

The proposal cannot delete a contracted node. Implementation, amendment, and
repair PRs may not edit the map or current identity. The mechanical handoff
may not invent a node or start the next unit.

A name plus a vague “likely question” alone is not a candidate. Use an explicit
empty successor instead:

```markdown
### Next-Frontier Candidate

**None**

- Reason: <why another contract is not justified now>
- Revisit when: <named evidence, decision, or closeout result>
```

The empty successor opens no proposal or implementation branch. It is honest
at milestone start, after the last remaining node is selected as current, and
when no further unit is contracted yet. It is required after closeout is
current. It does not block `advance`.

**Frontier handoff:** accepting the current review unit records the ledger,
criteria, and risks, then sets current to idle. Remaining work-order nodes
stay. Do not promote a successor, wipe later contracted nodes, or invent one.
The receipt's `next_frontier.state` remains `none` because the map, not the
receipt, owns remaining work. The next proposal selects current from that
artifact (or introduces the first/next node, including closeout).

Windows:

| Window | Work order | Current |
| --- | --- | --- |
| Fresh milestone | `Path: none` or unstarted nodes | Idle |
| Opening proposal | May rewire, add, or select | Becomes path[0] or a new node |
| Implementation | Frozen | Frozen |
| After `advance` | Unchanged remaining path | Idle |
| `block` | Keeps queued and off-path nodes | Idle / blocked |
| Closeout selected | Remaining path must be empty | Closeout |
| After `close` | `Path: none` | Closed |

### 7. Workflow History

Append-only state-transition ledger:

| Frontier | State | Evidence |
| --- | --- | --- |

While current is set, the latest row must match that frontier and its
machine-readable workflow state. Idle current (milestone start or after
`advance`) need not match a live pointer; the latest row may be `accepted`.
A new frontier may start at `proposal_in_review` when selected from the work
order after `accepted` or idle. Preserve proposal acceptance and implementation
acceptance as separate events.

### 8. Accepted Review Units

Append-only one-row-per-merged-PR ledger:

| PR | Accepted review question | Result | Exit criteria | Durable evidence |
| --- | --- | --- | --- | --- |

### 9. Open Risks And Unverified Assumptions

Only unresolved items that affect milestone acceptance or frontier selection.
Remove resolved rows.

### 10. Milestone Decisions

Only decisions that change objective, usage, scope, exit criteria, review-unit
boundaries, external assumptions, or activation/closeout policy.

### 11. Closeout

While active, keep minimal: blocked until every exit criterion is `Met`; list
closeout outputs. Write substantive closeout only when closeout is the current
review unit.

## Pull Request Delivery

### Attention Budget

Review size is a logical-complexity and human-attention budget, not a line-count
limit. A unit that cannot be reviewed carefully in one pass is too large.

### Singular Review Question Rule

A review question must represent one independently acceptable claim.

**Split** when:

- the question requires “and” to connect independently acceptable guarantees;
- it contains multiple primary enforcement boundaries;
- deterministic implementation and substantial live proof both require deep review;
- the reviewer must alternate between unrelated subsystems;
- one half could be accepted while the other remains false;
- repairs reveal the original abstraction cannot close the claimed class;
- closeout judgment is mixed with unfinished implementation.

**Do not split** merely because the diff is large, several files participate in
one contract, one invariant needs coordinated tasks, or a repair adds adjacent
paths and tests.

### Review Kinds

The values below are the complete supported set for canonical milestone plans
and review-unit PR bodies. Use one value; do not invent a hybrid label.

| Kind | Focus |
| --- | --- |
| Deterministic invariant closure | Universal guarantee, owner, bypasses, boundaries, final external values |
| Behavioral feature slice | User path, success/failure, contract compatibility |
| Broad mechanical rollout | Faithful application of an accepted pattern; link pattern PR |
| Live or external evidence | Procedure, artifacts, assumptions, non-claims; CI alone is insufficient |
| Review repair | Separate PR only when needed; root cause, owner, adjacent paths, regressions |
| Milestone closeout | Whole-milestone acceptance judgment |

### Proposal And Implementation Are Separate

Every frontier moves through these states in order, with an optional amendment
loop after proposal acceptance:

| Workflow state | Meaning | Permitted work |
| --- | --- | --- |
| `ready_for_proposal` | The bounded frontier is ready to hand to a proposal author | Start the proposal branch, or review a necessary pre-proposal plan revision |
| `proposal_in_review` | A proposal is being authored or reviewed | Proposal document and plan transition only |
| `ready_for_implementation` | The proposal PR and any amendments have accepted exact-head contract reviews, are merged, and have their reviewed heads and merge commits recorded | Start the implementation branch, or start a bounded proposal amendment when established evidence requires one |
| `proposal_amendment_in_review` | New evidence requires a bounded correction to the accepted proposal | Additive amendment document and plan transition only; implementation remains blocked |
| `implementation_in_review` | Accepted scope is being implemented or reviewed | Product, test, and documentation changes described by the accepted proposal |

The expected collaboration is explicit:

1. the reviewer reports **ready for proposal** and stops;
2. the operator gives proposal work to the proposal author;
3. the reviewer reviews and finalizes that proposal without implementation;
4. the reviewer records an accepted review on the proposal's exact final head;
   merge and the acceptance command then record both commits, and the reviewer
   reports **ready for implementation**;
5. the operator gives the accepted proposal to the implementer;
6. implementation review begins only after implementation is complete enough
   to answer the accepted review question.

The proposal author and implementer may be the same person or model, but they
must operate in separate branches and review phases. The reviewer must not
silently fill both roles in one change.

### Exact-Head Contract Review Receipts

A proposal or proposal amendment must have an accepted GitHub review attached
to the PR's final head commit before merge. The review is the contract judgment;
the subsequent merge establishes repository ancestry. They are separate facts,
and neither substitutes for the other. An authorized contract reviewer must
have current repository push authority and an `OWNER`, `MEMBER`, or
`COLLABORATOR` association when acceptance is recorded.

- An `APPROVED` review records `accepted`.
- A `CHANGES_REQUESTED` review records `changes_requested`.
- When GitHub prevents a reviewer from approving their own PR, a new, unedited
  formal `COMMENTED` review may contain only:

  ```text
  ## Contract Review Receipt

  - Outcome: `accepted`
  ```

  Use `changes_requested` instead when the contract is not acceptable.
- Only formal GitHub reviews count. PR conversation comments are not bound to a
  commit and never count as contract receipts.
- For each authorized reviewer, their latest decisive review on the exact head
  owns their outcome. Promotion requires at least one accepted outcome and no
  authorized reviewer with an outstanding `changes_requested` outcome.
- A later commit invalidates every receipt attached to an earlier head and
  requires another review. A review submitted or edited after merge cannot
  retroactively authorize promotion.

The proposal acceptance commands verify the complete review history within a
bounded 100-review window, fail closed if that window would truncate, compare
`headRefOid` with each review's commit, enforce reviewer authority and
pre-merge timing, and record the reviewer, authority, review time, reviewed
head, and merge commit in the canonical plan. A merged PR without that receipt
remains `proposal_in_review`; do not begin implementation.

Every proposal, proposal amendment, and implementation PR body must provide
exactly one completed `## Review Kind` section. Its value must be supported and
must match the current frontier's canonical plan value. This keeps the review
focus stable across the proposal and implementation phases; changing the kind
requires a reviewed plan revision before proposal work starts, not a PR-body
reclassification during delivery.

If milestone-level facts are wrong (objective, completion usage, exit-criterion
identity, action policy), revise them in a separate plan-only review unit. Use
a `m<number>/plan-<slug>` branch, keep idle or `ready_for_proposal`, and change
only canonical `plan.md` plus generated `plan.html`. Do not change current,
next, or the work order. Preserve accepted review-unit evidence and every
existing `Met` criterion, append one Workflow History row whose evidence
begins `Plan revision:` (frontier `Idle` / state `idle` when current is idle),
and do not add a proposal, tests, or product code.

Retargeting remaining work, skipping a queued successor, inserting a unit, or
selecting closeout belongs on the next proposal PR via the work-order artifact.
Do not use a plan-revision PR for that. Do not implement a queued successor
merely because the previous unit completed.

If the accepted proposal is later shown to be materially insufficient, amend
it before implementation acceptance instead of rewriting history or knowingly
shipping the same gap into another frontier. Existing evidence of a
deterministic failure is sufficient to justify amendment review; do not require
a redundant live run merely to reproduce a condition already established. Use
`m<number>/amend-<slug>` and a new document under the frontier's `proposals/`
directory. The amendment PR may change only that new artifact, canonical
`plan.md`, and generated `plan.html`. It must preserve the original accepted
proposal, prior amendments, exit-criterion state, accepted ledger, risks, and
queued frontier.

An amendment document starts with `# Proposal Amendment:` and records Review
Question, Reason For Amendment, Contract Delta, Ownership, Affected Paths,
Adversarial Matrix, External Assumptions, Non-Goals, File Impact, and Validation
Plan. It narrows or corrects the implementation contract; it cannot replace the
proposal's reviewed Expected Handoff. After exact-head contract review and
merge, record the amendment PR, reviewed head, exact merge commit, and artifact
path, then return the frontier to `ready_for_implementation`. Amendments are
cumulative and immutable. The implementation PR must link and reconcile the
original proposal plus every accepted amendment, and CI rejects changes to any
of those artifacts.

When an amendment's Review Question or Contract Delta introduces or changes a
universal invariant, its artifact also completes `## Trust And Authority Model`
and `## Evidence Topology And Capture Strategy` for that delta. An amendment
cannot bypass contractability requirements merely because the original proposal
has already been accepted.

### Human Discovery During Implementation

Classify a human request from hands-on testing before changing code:

| Discovery | Required route |
| --- | --- |
| The parent review question is false without the change | Repair the parent implementation PR; this is not adjunct scope |
| The accepted contract, exit criteria, safety authority, schema, external assumption, expected handoff, or explicit non-goal must change | Stop and use proposal-amendment or later-frontier review; never conceal the change in an adjunct |
| The parent contract remains true and the human explicitly wants a bounded additive change in the same journey now | Use a HITL implementation adjunct |
| The request has a different goal, journey, primary owner, or independently acceptable feature outcome | Queue and contract a later frontier |

An adjunct is eligible only when all of the following are true:

1. a durable issue records the human user-testing request, and the adjunct PR
   records the requester, discovery context, and `implement-now` direction;
2. the parent implementation is already in `implementation_in_review` and the
   request serves its current frontier and operator journey;
3. the change is additive or optional, and every parent contract claim remains
   true if the adjunct is omitted;
4. it changes no exit criterion, safety or enforcement authority, schema,
   external assumption, expected handoff, or explicit non-goal;
5. it changes no canonical plan, accepted proposal, accepted amendment, or
   workflow state;
6. it has one bounded acceptance owner and one review question; and
7. it declares which evidence remains valid, which evidence must be refreshed,
   and what parent-level integration check will be run.

The human request authorizes consideration and priority, not a compatibility
waiver. If any eligibility assertion is uncertain, do not start the adjunct;
route the request through repair, amendment, or frontier planning.

Open the child PR from
`m<number>/<frontier>--adjunct-<slug>` to `m<number>/<frontier>`. Prefer one
active adjunct at a time. After it is reviewed and merged, update the parent
implementation PR’s `Integrated HITL Adjuncts`, scope reconciliation, affected
paths, adversarial matrix, file impact, assumptions, and exact validation.
Refresh invalidated evidence and review the integrated parent in totality
before accepting it. If the child is rejected or abandoned, the parent
contract remains reviewable without it.

An adjunct creates no plan transition or accepted-review-unit ledger row. CI
recognizes the canonical implementation branch as its base, requires the child
branch shape and completed adjunct template, rejects stale parent ancestry, and
rejects milestone plan or proposal-artifact edits. The machine validates the
recorded topology and assertions; the reviewer owns whether the asserted
compatibility is actually true.

Each proposal lives at the current frontier’s declared `proposal path` and uses
`.github/PULL_REQUEST_TEMPLATE/proposal.md`. It records the review question,
proposed contract, owner, affected paths, adversarial matrix, assumptions,
non-goals, file impacts, validation plan, and the expected successful handoff.
When the review question or proposed contract claims a universal invariant, it
also records the trust and authority model plus the evidence topology and
capture strategy defined below. It contains no product code, tests of
unimplemented behavior, generated runtime artifacts, or implementation repair.

`## Expected Handoff` contains exactly one `json` code block. It uses
`milestone_handoff_template_v1`, which is the normal handoff receipt without
`accepted_pr` or `accepted_merge_commit`. Those facts do not exist until merge.
The reviewed template may use `{pr}` and `{merge_commit}` inside strings; the
completion command substitutes them without changing any other judgment:

```json
{
  "schema": "milestone_handoff_template_v1",
  "outcome": "advance",
  "result": "Accepted",
  "durable_evidence": "Accepted implementation and focused tests in PR #{pr}",
  "criterion_updates": {
    "M000-01": {
      "status": "Met",
      "evidence": "Contract accepted in PR #{pr}"
    }
  },
  "risk_remove": [],
  "risk_upsert": [],
  "next_frontier": {
    "state": "none",
    "reason": "No later candidate is reviewed.",
    "revisit_when": "The promoted frontier determines what follows."
  }
}
```

Proposal validation simulates the later implementation handoff against the
frozen plan. It rejects templates that update unowned criteria, remove unknown
risks, promote closeout while other criteria remain unmet, or invent an
unreviewed next candidate.

Each implementation PR uses `.github/pull_request_template.md`, links the
accepted proposal PR and merge commit, and reconciles its actual diff to that
proposal. A changed proposal requires a new proposal review; implementation may
not rewrite its own acceptance boundary.

### Review-Unit PR States

| State | Meaning |
| --- | --- |
| Draft | Question still changing, required behavior missing, validation incomplete, or adversarial pass incomplete |
| Ready for review | Singular stable question, complete for scope, validation recorded, limitations explicit, description matches diff |
| Changes requested | Stated question cannot yet be answered affirmatively |
| Approved | Reviewer accepts that this PR answers its stated question within its scope, assumptions, and non-goals |

Approval does **not** mean the milestone is complete, every improvement belongs
in this PR, the next frontier is automatically approved, or external
assumptions are proven.

Every review-unit template includes a `Repair Cycle Ledger`. Cycle numbers are
consecutive. Do not delete or rewrite a prior row, combine verdict rounds, or
downgrade reviewer-owned severity or classification. The ledger is history, not
a throttle.

### Proposal PR Template

Use `.github/PULL_REQUEST_TEMPLATE/proposal.md`. The proposal document itself is
the durable contract; the PR body gives the reviewer its milestone context,
review kind, question, scope, and explicit confirmation that no implementation
is present. Proposal amendments use the same canonical review kind.

### Implementation PR Template

Use `.github/pull_request_template.md` (required headings):

- Milestone context
- Accepted proposal
- Review kind
- Review question
- Validation
- Repair cycle ledger

The accepted proposal owns the matrix, owner, assumptions, limits, and intended
file impact. The implementation PR links that proposal, reports exact
validation, and notes a drift only when the diff departed from it. Do not
restate the contract in the PR body.

### Invariant Closure (When Claiming Universals)

Words such as `bounded`, `detached`, `deterministic`, `exact`, `fail-closed`,
`fresh`, and `no movement` are universal guarantees when the review kind is
**deterministic invariant closure**. They are not a hidden trigger on other
kinds. A mechanical rollout or behavioral slice that uses those words in passing
does not become an authenticity exam.

When the canonical review kind is `deterministic invariant closure`, the
proposal artifact must complete both of these sections before it can be
accepted:

- `## Trust And Authority Model`: distinguish consistency, provenance, and
  authenticity guarantees; identify trusted and untrusted actors and inputs;
  map each externally visible claim to its source of authority; and state the
  covered and excluded adversaries, including whether same-user mutation is
  inside the model.
- `## Evidence Topology And Capture Strategy`: map each claim and explicit
  non-claim through authoritative raw evidence, derivation, and semantic
  verifier; choose bounded implementation evidence or a separate evidence review
  unit; and define capture readiness, freshness, reproducibility, invalidation,
  and retained-versus-derived artifact boundaries.

If the guarantee depends on process, library, or external-system behavior whose
ownership is uncertain, cite the smallest feasibility evidence that settles the
boundary. Otherwise narrow the guarantee and record the behavior as an
unverified limit; do not leave ownership discovery for implementation.

Before requesting review:

1. Test the accepted failure class and adjacent paths named in the proposal
   matrix, not only the first reproduction.
2. Enforce the claim at the owning boundary. Do not use this step to demand a
   mid-cycle rewrite of internals; the late implementer collapse is optional
   and not a review finding.
3. Validate the final externally visible value after normalize/store/serialize.
4. Prove cross-system assumptions against the relevant live system before
   presenting them as observed.
5. After a repair, re-check prior findings and the accepted matrix. Do not run
   a fresh open-ended adversarial pass.

### Externally Owned Capability Gaps

Treat a separately owned repository as an available contract owner, not as an
unchangeable black box. Automa (`auto-driving`) is the primary consumer example
for this repository.

When an operator journey is blocked or made situational by an external
capability:

1. inspect the installed and documented interface and record concrete version,
   command, protocol, or response evidence;
2. identify whether the clean enforcement boundary belongs locally or in the
   external repository;
3. prefer the smallest owner-level capability, flag, query, or structured
   failure contract over UI automation, undocumented state scraping, implicit
   reconfiguration, duplicated protocol logic, or a permissive local fallback;
4. state the external gap, its consequence, and whether the current review
   question can still be accepted without it;
5. surface an external feature request as an explicit option instead of
   silently treating the dependency as fixed; and
6. link an authorized external issue from the relevant proposal, PR, evidence,
   or unresolved-risk record.

Creating or updating an issue changes external state. Do it only when the
operator explicitly authorizes the write or an accepted workflow step
specifically includes external issue creation. Read-only repository and issue
inspection may be used to resolve ownership and avoid duplicates.

An external request should be independently actionable. Include:

- the blocked user or operator journey;
- observed interface and version evidence;
- the minimum requested contract and acceptable equivalent outcomes;
- required safety and state-preservation behavior;
- structured unsupported or failure behavior;
- a bounded acceptance test; and
- links back to the consuming proposal or implementation.

If a small external flag or response field would remove a substantial local
workaround, say so directly. Do not conceal the option merely because the
dependency lives in another repository.

### Review Finding Format

```markdown
[P1] <Concise finding title>

**Violated contract**
<Invariant or acceptance condition that does not hold.>

**Bypass or failure class**
<How the implementation escapes the owning boundary.>

**Reproduction**
<Concrete input, state, command, or test.>

**Why this belongs in the current PR**
<Why it challenges the stated review question.>

**Required outcome**
<Observable result required for acceptance.>
```

Severities: `P0` unsafe/destructive; `P1` stated question materially false;
`P2` an accepted-matrix case that fails (normally fix before merge); `P3`
nonblocking or a new want outside the accepted contract.

### Author Repair Response

```markdown
## Review Repair Summary

Revision: `<commit>`
Cycle: `<consecutive integer>`
Classification: `<minor | substantial>`
Highest severity: `<P0 | P1 | P2 | P3>`
Review receipt: `<exact GitHub review URL for the consolidated verdict>`

### Finding 1 — <title>

- Root cause:
- Owning boundary changed:
- Adjacent paths audited:
- Regression coverage:
- Remaining assumption:

## Validation

<commands and results>
```

Repair as many times as the accepted question still requires. Split/replacement
remains fail-closed until structured lineage verification exists.

Before every review or re-review request, reconcile the PR description to the
current diff and refresh exact validation results. Do not expand the accepted
matrix in the PR body.

### Cumulative Milestone PR

Use `.github/PULL_REQUEST_TEMPLATE/milestone.md`. Keep it compact: objective,
link to completion usage and exit criteria, list of accepted review units,
status, unresolved risks, final validation at closeout. Do not paste every
child PR matrix.

## Merge And Promotion Procedure

Inspect the current handoff before assigning work:

```sh
python3 docs/milestones/workflow.py status \
  --plan docs/milestones/<number>-<slug>/plan.md
```

When it reports idle current or `ready_for_proposal`, open a git branch and a
proposal PR that selects current from the work order (or introduces the first
node). Git creates the branch. `workflow.py start-proposal` is optional. Use a
`m<number>/plan-<slug>` branch only for milestone-level facts (objective,
exit-criterion IDs, action policy). Remaining-path, skip-successor, and
closeout-selection edits belong on the proposal PR.

```sh
git fetch origin
git switch -c m<number>/<frontier>-proposal origin/milestone/<number>-<slug>
```

Commit the proposal artifact, plan transition (including work-order edits), and
rendered HTML, then open the PR to the milestone branch. Its `Review Kind` must
match the selected frontier. When the contract is acceptable, submit the
exact-head GitHub review receipt described above before merging. Any later
proposal commit requires another receipt. After merge, the maintainer updates
the milestone branch and records acceptance; the acceptance command rechecks
the merged PR body and exact-head review receipt before promotion:

```sh
python3 docs/milestones/workflow.py accept-proposal \
  --plan docs/milestones/<number>-<slug>/plan.md \
  --pr <proposal-pr-number>
```

Inspect and commit the resulting plan and HTML transition. If known evidence
requires a bounded contract correction, open an additive amendment git branch
and PR instead of a `start-proposal-amendment` wrapper:

```sh
git switch -c m<number>/amend-<slug> origin/milestone/<number>-<slug>
```

Apply the same exact-head review rule to the contract-only amendment PR. After
it merges, record its reviewed head and exact merge acceptance receipt. The
amendment acceptance command also rechecks the canonical review kind:

```sh
python3 docs/milestones/workflow.py accept-proposal-amendment \
  --plan docs/milestones/<number>-<slug>/plan.md \
  --pr <amendment-pr-number>
```

Only when status reports `ready_for_implementation` may implementation start.
Create that git branch the same way; `start-implementation` is optional:

```sh
git switch -c m<number>/<frontier> origin/milestone/<number>-<slug>
```

If explicit human testing then produces an eligible implement-now request,
create its child from the published parent head without changing plan state:

```sh
git fetch origin m<number>/<frontier>
git switch -c m<number>/<frontier>--adjunct-<slug> \
  origin/m<number>/<frontier>
```

Open the child PR back to `m<number>/<frontier>` with the implementation-adjunct
template. After child acceptance, merge it into the parent branch, reconcile
the parent description, refresh affected evidence, and request one parent
totality re-review.

After the implementation PR is accepted:

1. squash-merge it into the milestone branch;
2. from a clean local milestone branch, run the completion command below;
3. confirm current is idle and the work order still holds remaining nodes;
4. open the next proposal PR from git when ready; do not wait on `start-proposal`.

```sh
python3 docs/milestones/workflow.py complete-implementation \
  --plan docs/milestones/<number>-<slug>/plan.md \
  --pr <implementation-pr-number>
```

`complete-implementation` fetches and fast-forwards the milestone branch,
confirms the implementation PR is merged and its body still matches the
canonical review kind, fills the reviewed template with the PR number and merge
SHA, applies the existing handoff owner, verifies that only canonical `plan.md`
and generated `plan.html` changed, commits them, and pushes the milestone
branch. It returns current to idle. It does not start the next proposal.

The lower-level `handoff --receipt <path>` command remains available for a
reviewed exceptional receipt or recovery, but normal successful completion
must not reconstruct acceptance judgment after merge.

Git creates and switches review-unit branches. Do not require
`start-proposal`, `start-proposal-amendment`, or `start-implementation` to
enter a state; those commands are optional helpers. An existing branch is
usable. CI `validate-pr` is the gate on the PR. Post-merge `accept-proposal`,
`accept-proposal-amendment`, and `complete-implementation` record receipts
that cannot exist until merge: GitHub identity, exact-head review, ancestry,
ledger, and idle return. They may refuse a dirty milestone worktree because
they commit plan HTML, and they refuse a merge commit that is not already an
ancestor of the milestone branch. They do not police how the review-unit
branch was created.

CI runs `workflow.py validate-pr` when a PR is opened, synchronized, reopened,
or its description is edited. It applies the frontier gate to PRs targeting a
milestone branch and the adjunct gate to reserved adjunct PRs targeting the
active plan's canonical implementation branch. Proposal, proposal-amendment,
and implementation PRs must provide the canonical review kind. A proposal PR
may change only its declared proposal document, canonical plan, and generated
plan HTML. A
proposal amendment PR has the same contract-only boundary and must add a new
artifact without modifying accepted proposal history. An implementation PR is
rejected unless its base records an accepted proposal; it may not modify that
proposal, an accepted amendment, or the work-order map. An adjunct PR must use
the reserved child branch, current parent head, completed HITL template, and
immutable milestone contract artifacts.
For each recognized milestone review-unit transition and adjunct, CI also
fetches GitHub PR reviews, inline comments, authority, and commit order, then
validates the declared repair ledger against GitHub review evidence. The
pull-request workflow runs when that body is edited so a newly recorded ledger
row can satisfy the gate without an unrelated code commit.
`docs/render_markdown.py` invokes the same plan validator, so hand-edited state
that omits required fields or history is rejected.

CI supplies `validate-pr` with the PR event payload. For an equivalent local
check, save the current PR description and pass it with
`--pr-body-file <path>`; a milestone proposal, amendment, or implementation
cannot receive a complete validation result without its PR body. A local body
with declared repair cycles also cannot establish GitHub evidence by itself;
the event-backed CI path supplies that metadata.

The machine cannot discover an unrecorded review round, decide whether a cycle
was intellectually substantial, prove which model authored a phase, prove that a
reviewer understood a proposal, or prove that approval was intellectually sound.
The reviewer and operator own those judgments. It can prove that a decisive
review was submitted on a specific proposal head and preserve that fact
separately from merge ancestry. For repair cycles it can prove that declared
cycles advance through the PR commit order and that classification and severity
come from the linked reviewer-owned GitHub evidence. Completion requires an
exact-head `Contract Review Receipt` with `Outcome: accepted`. Inline comments
and concern lists do not complete or block a unit. Replacement currently fails
closed until structured lineage verification exists; a new PR number is not
reviewability evidence.
The repository also guarantees that the current state and next handoff are
visible, the accepted proposal is durable, proposal and implementation diffs
are separate, and implementation cannot pass CI before proposal acceptance.

The handoff commit is a narrow exception to PR-only changes because it applies
mechanical post-merge facts that cannot truthfully exist in the merged review
unit beforehand. It must not introduce code, widen an acceptance contract,
invent an unreviewed candidate, delete remaining map nodes, or change
milestone scope. If the handoff needs judgment beyond the already reviewed
plan state, stop; do not invent the successor in the receipt.

The proposal PR is the window to edit the work-order artifact and to select
current from it. That is not a second review question; current-PR acceptance
does not depend on the rest of the milestone path being perfect.
Implementation stays inside the accepted current contract and must not edit
the map. After acceptance, current is idle; the next proposal may reorder,
skip, or introduce the next node. When no successor is contracted, leave the
path empty rather than forcing one.

At milestone closeout:

1. complete `closeout.md`;
2. update the completed-milestone ledger;
3. update `docs/README.md` navigation only;
4. mark the cumulative milestone PR ready;
5. review the milestone as a whole;
6. merge into `main` with a merge commit;
7. tag the mainline merge;
8. remove obsolete milestone, proposal, and implementation branches;
9. activate or revise the next pre-plan only after closeout
   (this is the cross-milestone handoff, distinct from in-milestone
   frontier handoff above).

## Immediate Deferred Work And Pre-Plans

Closeouts may leave residual work. Route it into exactly one of:

1. **Durable reference** (`docs/reference/`): settled current behavior.
2. **Synthesis** (`docs/synthesis/`): research without commitment.
3. **At most one pre-plan** after the active milestone: the single most immediate
   next problem already forced by evidence.

Pre-plans are not active work. Do not implement them while another milestone is
active unless the decision log records an explicit parallel exception.

## Shared Contract Visibility

Active plans should link this contract (Markdown and/or rendered HTML). Do not
copy its rules into individual plans. Do not edit `planning-contract.html`
directly.

## Selective Agent Operating Surface

`docs/guidance/` is a short, derived operating surface for selective agent
loading. It exists to reduce repeated context cost; this contract remains the
single source of truth.

For repository-aware agents, root `AGENTS.md` is the automatic entrypoint. It
routes each requested operation through `docs/guidance/agent-surface.md`, then
only the selected role- or task-specific guidance. Load this full contract when
a guidance file directs it, when workflow meaning is ambiguous, or when
changing the workflow itself.

Guidance files may summarize or route to this contract. They must not introduce
new process rules, carry current milestone state, or override this contract. If
the two conflict, this contract wins. Operation classification does not
authorize a workflow phase transition. Long-running conversations should
retain current work state and findings, not act as the durable store for
process rules.

## Non-Goals Of This Contract

This contract does not:

- redesign product architecture;
- create a detailed long-term roadmap or a backlog of uncontracted frontier names;
- introduce many package sub-IDs;
- turn the milestone plan into a ticket backlog;
- copy proposal-level matrices into the plan;
- require one branch per implementation task;
- equate PR quality with line count;
- make generated HTML a second manually edited source of truth.
