# Milestone 002 — Atomic Chase Evaluation Capture

| Field | Value |
| --- | --- |
| Status | Active |
| Milestone branch | `milestone/002-atomic-chase-evaluation-capture` |
| Cumulative PR | [#146](https://github.com/GeorgeLuo/metrics-ui/pull/146) (draft until whole-milestone closeout; transitional complete-milestone delta after #143/#145) |
| Current frontier | None |
| Contract baseline | `7508289` — M002 mixed review units through PR #151, before compact-contract adoption |
| Grandfathered PRs | #146 (cumulative draft targeting `main`; keeps whole-milestone review kind) |
| Cutover | PR #153 merged the compact contract to `main`; this plan replaces the hand-authored `plan.html` as the Markdown source. Later in-milestone review units use `m002/<frontier>-proposal` then `m002/<frontier>` targeting the milestone branch. Do not retarget #146. |
| Started | 2026-07-20 |
| Action policy | Playback-neutral capture; controller sensor is image-only; no vehicle-behavior change |

Shared planning contract: [README.md](../README.md) · [planning-contract.html](../planning-contract.html)

## Objective

Give an external controller one camera frame and one bounded evaluator shadow
from the same Chase state without advancing playback or exposing
simulator-only geometry through the sensor interface.

## Completion Usage

| Workflow | Starting state | Execution | Success signal | Criteria |
| --- | --- | --- | --- | --- |
| Primary demonstration | Play is loaded with Chase and a frontend owns the configured session | Inspect `get_play_game_usage`, then run `simeval ui play-evaluation-capture --actor chaser --out-dir ./evaluation-captures` | SimEval writes one image and one metadata file with a shared capture ID, `gameId + simulationEpoch + frameIndex` identity, `playback.advanced=false`, an equal before/after preservation fingerprint, and a bounded evaluator-only control reference | M002-01, M002-02, M002-04, M002-05, M002-06, M002-07 |
| Validate a controller flow | The Play frontend tab is active and SimEval can reach its WS endpoint | `npm run play:chase:evaluation:capture -- --out-dir /tmp/chase-evaluation-capture` | The fixture reports all checks passed for same-state repetition, later-frame movement under WS input, changed image evidence, reset-safe identity, sensor/evaluator separation, and bounded controller-reference persistence | M002-08 |
| Discover passive observation | Chase usage is queried before capture | Read advertised actors, cameras, and preserved fields from Play usage | Unsupported or drifted targets return a structured response without a sensor artifact; a matching paused session returns the image and an equal before/after receipt | M002-03, M002-04 |

## Scope Boundaries

| In scope | Out of scope |
| --- | --- |
| Capture identity, frozen visible-only source records, bounded evaluator count and control-reference policy | VLM interpretation, decision-model input changes, vehicle-behavior changes |
| Play transport, SimEval persistence, live-controller validation | Exposing global geometry to a controller, or recording arbitrary world/debug snapshots |
| Passive-observation capability discovery, session fingerprints, and structured unsupported responses | Making auto-driving's remaining adapter or live-alignment work a Metrics UI implementation unit |

## Exit Criteria

| ID | Criterion | Status | Evidence / remaining gap |
| --- | --- | --- | --- |
| M002-01 | One public request returns a camera artifact and bounded evaluator data with one capture ID and one `gameId + simulationEpoch + frameIndex` frame identity | Met | Same-state bundle and Play transport in #144 and #147; control reference in #149 |
| M002-02 | The request does not advance, pause, reset, change scenario, or alter control input | Met | Pure builder in #144; session fingerprint and fail-closed drift in #151 |
| M002-03 | The active Chase usage advertises supported passive-observation actors, cameras, and preserved fields | Met | Capability metadata in #151 |
| M002-04 | Successful capture includes an equal before/after session receipt; state drift or an unsupported target returns a structured response without a sensor artifact | Met | Passive-observation contract in #151 |
| M002-05 | Sensor output contains no simulator-only geometry or evaluator facts | Met | Image-only sensor branch in #144 |
| M002-06 | Evaluator output contains only documented count and control-reference fields, with no map geometry, poses, reasoning snapshots, or proposal collections | Met | Bounded control reference in #149 |
| M002-07 | SimEval can persist the artifact and structured metadata for an external-controller run | Met | Persistence path and live fixture in #148 |
| M002-08 | Regression and live evidence prove before/after controller behavior without identity drift, including across simulation resets | Met | `evidence/live-controller/`; 31/31 checks in #148/#149 |
| M002-09 | Closeout records delivered usage, every criterion, residual risk, and whether the 003 pre-plan should be activated | Unmet | Closeout is the remaining work-order node |

## Current Delivery

### Current Frontier

**None**

- Reason: PR #151 is accepted. Current is idle until the next proposal selects Milestone closeout from the work order.
- Revisit when: The operator is ready to open the closeout proposal.

### Next-Frontier Candidate

**Milestone closeout**

- Proposal branch: `m002/closeout-proposal`
- Implementation branch: `m002/closeout`
- Proposal path: `docs/milestones/002-atomic-chase-evaluation-capture/proposals/closeout.md`
- Review kind: Milestone closeout
- Review question: Is Milestone 002 complete as a whole—every exit criterion Met, completion usage supported, residual risk stated—and should the 003 observation-interpretation pre-plan be activated?
- Acceptance owner: Whole-milestone closeout judgment
- Exit criteria affected: M002-09
- Prerequisite: Every other criterion is Met
- Non-goals: Product-code repair, reopening accepted capture units, VLM interpretation, or changing the accepted sensor/evaluator privilege boundary

### Frontier Map

- Path: `Milestone closeout`
- Cadence: linked-list

#### Node: Milestone closeout

- Proposal branch: `m002/closeout-proposal`
- Implementation branch: `m002/closeout`
- Proposal path: `docs/milestones/002-atomic-chase-evaluation-capture/proposals/closeout.md`
- Review kind: Milestone closeout
- Review question: Is Milestone 002 complete as a whole—every exit criterion Met, completion usage supported, residual risk stated—and should the 003 observation-interpretation pre-plan be activated?
- Acceptance owner: Whole-milestone closeout judgment
- Exit criteria affected: M002-09
- Prerequisite: Every other criterion is Met
- Non-goals: Product-code repair, reopening accepted capture units, VLM interpretation, or changing the accepted sensor/evaluator privilege boundary

## Workflow History

| Frontier | State | Evidence |
| --- | --- | --- |
| M002 activation | ready_for_proposal | Historical mixed review units #144, #147, #148, #149, and #151 landed on the milestone branch before compact-contract adoption. |
| Idle | idle | Plan revision: replace the hand-authored HTML plan with compact Markdown after #153; record mid-milestone cutover; leave current idle; keep Milestone closeout as the remaining work-order node. |

## Accepted Review Units

| PR | Accepted review question | Result | Exit criteria | Durable evidence |
| --- | --- | --- | --- | --- |
| Baseline #144–#151 (`7508289`) | Are the pre-contract M002 same-state bundle, Play transport, live validation, bounded control reference, and passive-observation contract accepted as historical starting state? | Accepted before compact-contract adoption | M002-01–M002-08 at the statuses recorded above | Mainline-reverted then restored milestone history through `7508289`; `evidence/live-controller/` |
| #144 | Does one frozen visible-only source yield reset-safe identity, an image-only sensor branch, and a separately labeled count-only evaluator shadow without playback mutation? | Accepted | M002-01, M002-02, M002-05 | Same-state bundle; image-only sensor branch |
| #147 | Do generic read-only Play queries expose Chase-owned capture semantics and runtime epochs through stable host transport? | Accepted | M002-01, M002-07 | Play evaluation-capture query |
| #148 | Do SimEval persistence, a bounded live fixture, and strict offline validation prove the public path including movement and reset identity? | Accepted | M002-07, M002-08 | `evidence/live-controller/` before the control-reference extension |
| #149 | Does atomic capture include a same-state evaluator-only control reference without map geometry or debug dumps? | Accepted | M002-01, M002-06, M002-08 | `evidence/live-controller/validation.json` 31/31 |
| #151 | Can an external observer discover Chase capture support and receive an image only when scenario, epoch, frame, playback phase, control state, actor, and camera remain unchanged? | Accepted | M002-02, M002-03, M002-04 | Passive-observation capability, fingerprint, and fail-closed unsupported/drift responses |

The baseline row is the explicit adoption boundary; post-baseline rows restated
the already-merged mixed units for auditability.

## Open Risks And Unverified Assumptions

| Risk or assumption | Consequence | Resolution path |
| --- | --- | --- |
| Auto-driving still needs an atomic-response adapter and live Chase alignment before *its* memory work is unblocked | Closeout could either treat that as a 002 obligation or as an external residual | Closeout must choose explicitly; do not hide it inside M002-09 |
| Live movement evidence depends on an active browser animation frame | A backgrounded frontend can fail validation without a capture-contract defect | Keep the fixture fail-closed on unchanged movement evidence; do not weaken the capture contract |

## Milestone Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-20 | Redefine Milestone 002 as Atomic Chase Evaluation Capture | Customer evaluation needs an auditable frame identity and a strict sensor/evaluator privilege boundary before visual interpretation can be trusted |
| 2026-07-20 | Queue observation interpretation as Milestone 003 | Image-to-world interpretation must consume a stable capture contract |
| 2026-07-21 | Separate capture ID from `gameId + simulationEpoch + frameIndex` | Frame indexes restart at zero across resets |
| 2026-07-21 | Recover cumulative review after premature merge | PR #143 was reverted; #146 is the replacement whole-milestone surface |
| 2026-07-22 | Do not close on count-only evaluator evidence alone | Sequential debug/image pairing still could not align in a live auto-driving loop |
| 2026-07-22 | Add a bounded evaluator control reference | Scenario, authority, phase, action-frame, and normalized controls are enough for same-capture scoring |
| 2026-07-30 | Insert passive observation before closeout | Issue #150 requires discoverable integration and machine-verifiable session preservation |
| 2026-08-28 | Adopt the compact Markdown contract mid-milestone | PR #153 landed the shared workflow on `main`; remaining work is closeout under proposal/implementation split |

## Closeout

Blocked until every exit criterion is `Met`.

Closeout will produce:

- `closeout.md`;
- a completed-milestone ledger entry;
- residual-risk disposition of the auto-driving adapter/alignment remainder;
- a decision to activate, revise, or abandon the 003 pre-plan;
- cumulative PR #146 marked ready for whole-milestone review.
