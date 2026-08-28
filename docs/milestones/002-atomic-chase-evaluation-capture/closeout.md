# Milestone 002 Closeout: Atomic Chase Evaluation Capture

Closed: pending Phase B `complete-implementation` and Phase C merge of
cumulative PR [#146](https://github.com/GeorgeLuo/metrics-ui/pull/146).

This Phase A packet records the whole-milestone judgment. It does not mark
M002-09 `Met`, clear plan risks, empty the frontier, or set Status `closed`.

## Outcome

An external controller can request one Chase camera frame and one bounded
evaluator shadow from the same frozen simulation state without advancing
playback or receiving simulator-only geometry as perception. Capture identity
is `gameId + simulationEpoch + frameIndex`. The sensor branch is image-only.
The evaluator branch is count plus a bounded control reference. Passive
observation is advertised on Chase usage and proven with a before/after
session fingerprint, or rejected with a structured unsupported result.

No remaining Metrics UI product work is required to make M002-01 through
M002-08 true.

## Delivered Workflows

- Inspect `get_play_game_usage` for `protocol.passiveObservation`, then run
  `simeval ui play-evaluation-capture --actor chaser --out-dir ./evaluation-captures`.
- Validate a live controller flow with
  `npm run play:chase:evaluation:capture -- --out-dir /tmp/chase-evaluation-capture`.
- Discover supported actors, cameras, and preserved fields before capture;
  unsupported or drifted targets return a structured response without a sensor
  artifact.

## Criterion restatement

| ID | Status | Restatement |
| --- | --- | --- |
| M002-01 | Met | One public request returns camera plus bounded evaluator data with one capture ID and frame identity (#144, #147, #149). |
| M002-02 | Met | Capture does not advance, pause, reset, change scenario, or alter control input (#144, #151). |
| M002-03 | Met | Chase usage advertises passive-observation actors, cameras, and preserved fields (#151). |
| M002-04 | Met | Equal before/after preservation receipt, or structured unsupported output without a sensor artifact (#151). |
| M002-05 | Met | Sensor output contains no simulator-only geometry or evaluator facts (#144). |
| M002-06 | Met | Evaluator output is count plus bounded control reference; no map geometry, poses, reasoning snapshots, or proposal collections (#149). |
| M002-07 | Met | SimEval can persist image and metadata (#148). |
| M002-08 | Met | Live/offline fixture proves same-state, movement, reset identity, and privilege boundary; `evidence/live-controller/validation.json` 31/31 (#148, #149). |
| M002-09 | Unmet until Phase B | This packet plus the mechanical handoff. |

## Frozen evidence

- Same-state bundle: PR [#144](https://github.com/GeorgeLuo/metrics-ui/pull/144).
- Play transport: PR [#147](https://github.com/GeorgeLuo/metrics-ui/pull/147).
- Live controller package: [`evidence/live-controller/`](evidence/live-controller/), including [`validation.json`](evidence/live-controller/validation.json) (`status=pass`, 31/31). Before/repeat share epoch `chase-run:c95724c7-e5e1-43e0-8398-2b31b729ca6e`, frame 0, and PNG SHA-256 `9108b73ce9aac8a239c2d1043f68478fa2367a23a06573179bbd525697b6b943`. After-move is frame 164 in that epoch with a different image hash. After-reset returns to frame 0 under epoch `chase-run:d8d2ec6a-0257-445e-a1f5-d6b861cb290b`.
- Bounded control reference: PR [#149](https://github.com/GeorgeLuo/metrics-ui/pull/149).
- Passive observation: PR [#151](https://github.com/GeorgeLuo/metrics-ui/pull/151).
- Compact-contract cutover: PRs [#153](https://github.com/GeorgeLuo/metrics-ui/pull/153) and [#154](https://github.com/GeorgeLuo/metrics-ui/pull/154).
- Closeout proposal: PR [#155](https://github.com/GeorgeLuo/metrics-ui/pull/155) at `b4e34636fce58e243d580a374dc0739e9af2f0f0` (reviewed head `8757aae5f18e9e5a9137f42d63a19a029161042a`).

This closeout cites those authorities. It does not recapture live Chase
evidence.

## Validation

Phase A records deterministic validation at this implementation head:

- `npm run play:chase:regress`: 100 passed, 0 failed.
- `python3 docs/milestones/workflow.py validate docs/milestones/002-atomic-chase-evaluation-capture/plan.md`
- `python3 docs/render_markdown.py --check`

Accepted evidence bytes under `evidence/live-controller/` are unchanged.

## Decisions

- Redefine Milestone 002 as atomic evaluation capture so identity and
  sensor/evaluator privilege exist before observation interpretation.
- Queue observation interpretation as Milestone 003.
- Recover cumulative review after premature merge: #143 reverted, #146 retained.
- Do not close on count-only evaluator evidence; add a bounded control reference.
- Insert passive observation before closeout (issue #150).
- Treat remaining Automa adapter/live-alignment work as an external residual,
  not unfinished Metrics UI product work.

## Remaining Gaps

- Auto-driving still needs its own atomic-response adapter, exact-current
  correlation, and memory-alignment work. Metrics UI delivered the capture and
  preservation contract.
- Live movement evidence requires an active frontend animation frame. A
  backgrounded tab can fail the fixture without a capture-contract defect.
- GitHub issue [#150](https://github.com/GeorgeLuo/metrics-ui/issues/150) may
  remain open as consumer tracking. The requested Metrics UI capability and
  preservation receipt landed in #151.
- The 003 pre-plan remains HTML until activated after Phase C.

## Follow-On

Activate the existing pre-plan
[Chaser Observation Interpretation](../003-chaser-observation-interpretation/plan.html)
after cumulative PR #146 merges. Compact-plan conversion for 003 is that
milestone's later work, not M002 product work.

## Cumulative PR

Whole-milestone review surface:
[#146](https://github.com/GeorgeLuo/metrics-ui/pull/146)
(`milestone/002-atomic-chase-evaluation-capture` → `main`). Phase A keeps it
draft. Phase C marks it ready after the handoff commit.
