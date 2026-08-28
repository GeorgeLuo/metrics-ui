# Proposal: Milestone closeout

| Field | Value |
| --- | --- |
| Milestone | 002 Atomic Chase Evaluation Capture |
| Frontier | Milestone closeout |
| Proposal branch | `m002/closeout-proposal` |
| Implementation branch | `m002/closeout` |
| Exit criterion | M002-09 |
| Review kind | Milestone closeout |

## Review Kind

Milestone closeout

## Review Question

Is Milestone 002 complete as a whole—every exit criterion Met, completion
usage supported, residual risk stated—and should the 003 observation-interpretation
pre-plan be activated?

This proposal is ready for implementation only if an implementer can publish
the durable closeout judgment, append the completed-milestone ledger, prepare
cumulative PR #146, and leave terminal plan mutations to the post-merge
handoff—without product-code changes, live recapture, or pre-claiming M002-09
`Met`.

## Operator Want

- **Want:** Close M002 on the landed capture, privilege-boundary, and
  passive-observation contract, then activate the existing 003 pre-plan.
- **Reject if:** Closeout treats auto-driving adapter/live-alignment work,
  issue #150 ticket closure, or a fresh live recapture as unfinished Metrics UI
  product work required to make M002-01–M002-08 true.

## Proposed Contract

### Execution phases (must remain separate)

| Phase | When | Owner | Permitted change |
| --- | --- | --- | --- |
| **0. Whole-milestone closeout-readiness review** | While this proposal PR is open and has not merged | Reviewer/operator | Audit objective, usage, every criterion, accepted evidence, and residuals. A product/evidence gap required by an already-Met criterion keeps this proposal unmerged. A new independent want is P3 or later residual. |
| **A. Closeout implementation PR** (`m002/closeout` → milestone) | After this proposal is accepted | Implementer | `closeout.md`, append-only `completed.md` entry, bounded docs reconciliation, and draft cumulative PR #146 body. Must not mark M002-09 `Met`, clear risks, empty current, set Status `closed`, or mark #146 ready. |
| **B. Post-merge handoff** | After the implementation PR is squash-merged to a clean milestone branch | `workflow.py complete-implementation --pr <implementation-pr>` | Mechanical M002-09 `Met`, named risk removal, Status `closed`, empty frontier, accepted-ledger row, workflow history, and generated `plan.html` from Expected Handoff |
| **C. Whole-milestone integration** | After the handoff commit reaches the milestone tip | Operator/reviewer | Mark cumulative PR #146 ready and review M002 as a whole. Packet/docs defects repair on #146. A finding that falsifies an already-Met criterion uses append-only reject restore. Only an exact-head accepted #146 may merge to `main`, be tagged `milestone-002`, and permit 003 activation. |

Phase 0 is the last cheap point to route a new in-milestone node: this
proposal has not merged, so the milestone remains Active with idle current on
the base. Phase A must leave M002 `Active`, M002-09 `Unmet`, the closeout
frontier present, the open-risk table intact, and the accepted ledger
unchanged. Phase B alone applies terminal facts. Phase C is not evidence
supplied by the implementation PR.

### Whole-milestone acceptance rule

M002 closes only when all of the following hold:

1. **Phase 0 finds no node-worthy blocker.** A closeout-contract defect is
   repaired on this proposal. A product or evidence gap required by M002-01–
   M002-08 keeps this proposal unmerged.
2. **Previously accepted criteria remain Met.** M002-01 through M002-08 must
   still be `Met` at implementation start. If any accepted artifact is missing
   or contradicted, stop; closeout cannot conceal it or repair product
   behavior.
3. **No remaining Metrics UI product work is required.** The landed units
   already answer the capture identity, playback-neutrality, capability
   advertisement, preservation receipt, sensor/evaluator privilege, SimEval
   persistence, and live-controller evidence questions. Auto-driving's
   remaining adapter, exact-current alignment, and memory work stay in that
   repository. Closing GitHub issue #150 is operator tracking after the
   protocol is cited, not a new implementation unit.
4. **Phase A publishes the judgment.** `closeout.md` must reconcile completion
   usage, accepted review units, evidence identities, residual limits, the
   003 activate decision, and cumulative PR #146 identity without product or
   runtime changes. The M002 `completed.md` entry is part of this cumulative
   closeout diff, before #146 is marked ready.
5. **Phase B closes the plan mechanically.** The reviewed `outcome: close`
   handoff marks M002-09 `Met`, removes plan risks only after their residual
   meaning is preserved in `closeout.md`, records the accepted closeout PR,
   sets Status `closed`, and empties the in-milestone frontier.
6. **Phase C reviews the cumulative milestone.** Cumulative PR #146 must be
   reconciled from its stale body, marked ready only after Phase B, and
   reviewed as the whole-milestone surface before merge to `main`.
7. **Accepted evidence is cited, not re-authored.** Closeout performs offline
   integrity checks and deterministic validation. It does not recapture live
   Chase evidence merely to refresh dates.

### Criterion judgment basis (do not re-prove)

| Criteria | Accepted authority | Required closeout restatement |
| --- | --- | --- |
| M002-01 | PRs #144, #147, #149 | One public request returns camera plus bounded evaluator data with one capture ID and `gameId + simulationEpoch + frameIndex` |
| M002-02 | PRs #144, #151 | Capture does not advance, pause, reset, change scenario, or alter control input |
| M002-03 | PR #151 | Chase usage advertises passive-observation actors, cameras, and preserved fields |
| M002-04 | PR #151 | Equal before/after preservation receipt, or a structured unsupported result without a sensor artifact |
| M002-05 | PR #144 | Sensor output contains no simulator-only geometry or evaluator facts |
| M002-06 | PR #149 | Evaluator output is count plus bounded control reference only |
| M002-07 | PR #148 | SimEval can persist image and metadata |
| M002-08 | PRs #148, #149 and `evidence/live-controller/` | Live/offline fixture proves same-state, movement, reset identity, and privilege boundary; 31/31 recorded checks |
| M002-09 | Phase A judgment plus Phase B handoff | Durable closeout, completed-ledger entry, residual limits, 003 activate decision, and #146 identity |

### Frozen evidence inventory for closeout

| Evidence | Frozen fact used at closeout |
| --- | --- |
| Same-state bundle | PR #144: frozen visible-only source, image-only sensor, count-only evaluator shadow |
| Play transport | PR #147: generic read-only `atomic-evaluation-capture` query |
| Live controller package | `docs/milestones/002-atomic-chase-evaluation-capture/evidence/live-controller/`; `validation.json` 31/31 |
| Bounded control reference | PR #149: scenario, authority, phase, action-frame, normalized input/action; no map geometry |
| Passive observation | PR #151: `protocol.passiveObservation`, preservation receipt, fail-closed unsupported/drift responses |
| Consumer protocol | Automa already validates `protocol.passiveObservation` and fail-closes on missing proof; remaining adapter/alignment work is not a Metrics UI unit |

If Phase A finds any committed authority missing, malformed, or in conflict
with the accepted ledger, it stops.

### Residual limits that must survive closeout

| Residual | Durable closeout statement |
| --- | --- |
| Auto-driving consumption | Metrics UI delivered the capture and preservation contract. Remaining Automa adapter, exact-current frame correlation, and memory-alignment work stay in auto-driving. |
| Browser animation | Live movement evidence requires an active frontend animation frame; a backgrounded tab can fail the fixture without a capture-contract defect. |
| Issue #150 | The requested Metrics UI capability and preservation receipt landed in #151. The GitHub issue may remain open as consumer tracking until the operator closes it. |
| 003 pre-plan | Observation interpretation remains queued and compact-plan conversion is 003's first later unit, not M002 product work. |
| Premature cumulative merge | PR #143 was reverted; #146 is the replacement whole-milestone surface and stays draft until Phase C. |

### Durable decision after M002

Phase A records **activate** for the existing 003 pre-plan
(`003-chaser-observation-interpretation`). Phase C may update navigation after
M002 is closed. M002 closeout must not implement 003 product work or convert
that pre-plan except as navigation.

### Required outputs by phase

#### Phase A — implementation PR

1. Create `docs/milestones/002-atomic-chase-evaluation-capture/closeout.md`.
2. Append the M002 entry to `docs/milestones/completed.md`.
3. Reconcile navigation only if audit finds drift.
4. Update draft cumulative PR #146 body; keep it draft.

#### Phase B — mechanical handoff

`complete-implementation` applies Expected Handoff only.

#### Phase C — cumulative review

Mark #146 ready after Phase B; review; merge commit to `main`; tag
`milestone-002`; then activate 003 separately.

## Ownership

Whole-milestone closeout judgment. Accepted capture, transport, evidence, and
passive-observation contracts remain owned by the review units that closed
them.

## Affected Paths

- Successful Phase A creates the closeout judgment and updates only the
  documentation/ledger paths declared below; product and evidence authorities
  remain byte-stable.
- Successful Phase B changes only the M002 plan and generated plan HTML through
  the reviewed handoff.
- Successful Phase C changes GitHub/cross-milestone state only after
  whole-milestone review.

## Adversarial Matrix

| Case | Required result |
| --- | --- |
| Any of M002-01–M002-08 is no longer `Met` at implementation start | Stop; closeout cannot repair or hide the gap |
| Phase A sets M002-09 `Met`, clears risks, edits accepted ledger rows, empties current, or sets Status `closed` | Reject; terminal facts belong to Phase B |
| Phase A changes product, runtime, tests, or evidence bytes | Reject as a different review unit |
| Closeout treats auto-driving adapter/live-alignment as unfinished M002 product work | Reject; that remainder is residual |
| Closeout claims issue #150 is still an unimplemented Metrics UI capability | Reject; #151 delivered the protocol |
| Closeout recaptures live Chase evidence merely for recency | Reject; cite `evidence/live-controller/` |
| Closeout claims exact-current Automa correlation or memory alignment | Reject; not an M002 claim |
| Closeout claims VLM interpretation or 003 product behavior | Reject |
| `closeout.md` omits an active-plan risk before Phase B removes it | Reject |
| Cumulative PR #146 retains its stale body | Reject Phase A completeness |
| Implementation PR claims #146 is ready or merged | Reject; that is Phase C |
| M002 closeout implements 003 | Reject cross-milestone scope leak |
| Phase 0 finds a product/evidence gap required by an existing criterion | Do not merge this proposal; keep the milestone Active/idle |
| Phase C finds a packet/docs/#146-body defect | Keep #146 unmerged; repair on #146 without product/evidence changes |
| Phase C treats a new independent want as a completion blocker | Classify P3 or later residual |
| Phase C finds a product/evidence gap that falsifies a Met criterion | Do not merge #146; revert Phase B; append-only `completed.md` withdrawal; exceptional `advance` receipt; leave M002-09 `Unmet` |

## External Assumptions

- Accepted implementation PRs #144, #147, #148, #149, and #151 and their plan
  ledger rows remain the acceptance authority.
- Tracked `evidence/live-controller/` remains committed and offline-verifiable.
- GitHub cumulative PR #146 remains open from
  `milestone/002-atomic-chase-evaluation-capture` to `main`; its body is stale
  and must be reconciled in Phase A.
- Issue #150 may still be open as consumer tracking; Phase A cites the
  delivered protocol rather than implementing a new contract.
- The 003 pre-plan remains HTML until activated after M002 closeout.
- Auto-driving remains a separately owned consumer.

## Non-Goals

- Product, runtime, test, or evidence-byte changes.
- Implementing Automa adapters, exact-current alignment, or memory work.
- Recapturing live controller evidence solely for recency.
- Closing GitHub issue #150 as a required implementation deliverable.
- Implementing or compact-converting Milestone 003 under `m002/closeout`.
- Marking or merging cumulative PR #146 before Phase C.
- Pre-claiming M002-09 `Met`, Status `closed`, or empty frontiers in Phase A.
- VLM interpretation, vehicle-behavior changes, or exposing geometry to a
  controller.

## File Impact

### Proposal PR only

| Path | Change |
| --- | --- |
| `docs/milestones/002-atomic-chase-evaluation-capture/proposals/closeout.md` | This reviewed contract |
| `docs/milestones/002-atomic-chase-evaluation-capture/plan.md` / `plan.html` | Select closeout as current in `proposal_in_review`; remaining path empty; leave criteria, risks, ledger, and status unchanged |

### Expected Phase A implementation PR

| Path | Change |
| --- | --- |
| `docs/milestones/002-atomic-chase-evaluation-capture/closeout.md` | Create durable whole-milestone judgment |
| `docs/milestones/completed.md` | Append M002 entry only |
| `docs/README.md` | Navigation only, if audit finds drift |
| M002 `plan.md` / `plan.html` | Optional non-terminal prose only |
| Cumulative PR #146 body | External GitHub update; keep draft |

No Phase A changes are permitted under `client/`, `server/`, `shared/`,
`examples/`, `scripts/`, or M002 `evidence/`.

### Phase B mechanical changes

- M002 `plan.md` and generated `plan.html` only, through
  `complete-implementation`.

### Phase C external changes

- Accept: cumulative PR #146 ready/review/merge, tag, branch cleanup, then
  separate 003 activation.
- Packet repair: keep #146 open; repair docs/ledger-candidate/#146 body only.
- Criterion-falsifying reject: keep #146 draft; revert Phase B; append-only
  `completed.md` withdrawal; exceptional `advance` receipt; new proposal from
  idle.

## Validation Plan

### Proposal PR

```sh
python3 docs/milestones/workflow.py validate \
  docs/milestones/002-atomic-chase-evaluation-capture/plan.md
python3 docs/render_markdown.py --check
PYTHONPATH=. python3 -m unittest discover -s tests/docs
python3 docs/milestones/workflow.py validate-pr \
  --base-ref milestone/002-atomic-chase-evaluation-capture \
  --head-ref m002/closeout-proposal \
  --base-sha <merge-base> \
  --head-sha <head> \
  --pr-body-file <path-to-pr-body>
```

Review confirms proposal-only paths, one whole-milestone question, Review Kind
`Milestone closeout`, the Phase 0/A/B/C boundary, residual accounting, and no
terminal plan mutation.

### Phase A implementation PR

```sh
npm run play:chase:regress
python3 docs/milestones/workflow.py validate \
  docs/milestones/002-atomic-chase-evaluation-capture/plan.md
python3 docs/render_markdown.py --check
```

The implementation records exact results at its final head. It checks that
accepted evidence paths exist, frozen summary facts match this contract, Phase
A left accepted evidence bytes unchanged, and cumulative PR #146's updated
body matches the closeout judgment.

No live recapture is required unless an accepted authority is missing or
contradicted; that condition blocks closeout.

### Phase B and Phase C

```sh
python3 docs/milestones/workflow.py complete-implementation \
  --plan docs/milestones/002-atomic-chase-evaluation-capture/plan.md \
  --pr <implementation-pr-number>

python3 docs/milestones/workflow.py status \
  --plan docs/milestones/002-atomic-chase-evaluation-capture/plan.md
```

Phase B must report M002 closed with every criterion `Met`, no current or
remaining frontier, and an accepted closeout ledger row.

## Expected Handoff

```json
{
  "schema": "milestone_handoff_template_v1",
  "outcome": "close",
  "result": "Accepted",
  "durable_evidence": "M002 closeout judgment in closeout.md; completed.md 002 entry; accepted capture, transport, live-controller, control-reference, and passive-observation evidence mapped; auto-driving remainder and browser-animation limits recorded; 003 activate decision recorded; cumulative PR #146 prepared for post-handoff whole-milestone review in implementation PR #{pr}",
  "criterion_updates": {
    "M002-09": {
      "status": "Met",
      "evidence": "Closeout confirms completion usage, maps accepted M002-01–M002-08 evidence, records auto-driving and browser-animation residuals, and activates the 003 pre-plan decision in PR #{pr}"
    }
  },
  "risk_remove": [
    "Auto-driving still needs an atomic-response adapter and live Chase alignment before *its* memory work is unblocked",
    "Live movement evidence depends on an active browser animation frame"
  ],
  "risk_upsert": []
}
```

### Sequence after this proposal merges

1. Complete the Phase 0 whole-milestone closeout-readiness review on this PR.
   If it finds a required product/evidence gap, do not accept it.
2. Accept this proposal with an exact-head contract review, merge it to the
   milestone branch, and run `workflow.py accept-proposal`.
3. Start `m002/closeout` only after status reports `ready_for_implementation`.
4. Implement Phase A only; update draft cumulative PR #146 without marking it
   ready.
5. After exact-head implementation acceptance, squash-merge the closeout PR.
6. Run `complete-implementation` to apply Phase B.
7. Mark #146 ready and review M002 as a whole.
