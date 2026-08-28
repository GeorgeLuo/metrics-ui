# Milestone 004 — High-Throughput Passive Camera Stream

| Field | Value |
| --- | --- |
| Status | Active |
| Milestone branch | `milestone/004-high-throughput-passive-camera-stream` |
| Cumulative PR | [#159](https://github.com/GeorgeLuo/metrics-ui/pull/159) (draft until whole-milestone closeout) |
| Current frontier | Camera stream contract |
| Started | 2026-08-28 |
| Action policy | Playback-neutral camera stream; sensor is image-only; no vehicle-behavior change |

Shared planning contract: [README.md](../README.md) · [planning-contract.html](../planning-contract.html)

## Objective

Give an external perception client a read-only Chase camera stream on the
existing WebSocket that can sustain representative 10–30 FPS while pairing each
image with `gameId + simulationEpoch + frameIndex`, without mutating the
operator session and without exposing evaluator facts as perception.

## Completion Usage

| Workflow | Starting state | Execution | Success signal | Criteria |
| --- | --- | --- | --- | --- |
| Primary demonstration | Play is loaded with Chase and a frontend owns the configured session | Inspect `get_play_game_usage` for `protocol.cameraStream`, subscribe over the existing control WebSocket, then receive pushed frames until unsubscribe | Each frame carries image bytes plus `simulationEpoch`/`frameIndex`, subscribe/unsubscribe do not play/pause/reset/control, and one-shot `atomic-evaluation-capture` remains available | M004-01, M004-02, M004-03, M004-04, M004-05, M004-06 |
| Prove live throughput | The Play frontend tab is active and a subscriber is attached | Run the accepted live-throughput procedure against the stream | A recorded run shows representative 10–30 FPS without per-frame `get_play_debug` or `atomic-evaluation-capture` polling | M004-07 |
| Discover unsupported stream | Chase usage is queried, or subscribe is sent without a frontend / with a bad target | Read advertised actors, cameras, and stream controls; send the failing subscribe | Structured unsupported/ended result; no sensor artifact | M004-02 |

## Scope Boundaries

| In scope | Out of scope |
| --- | --- |
| Push subscription over the existing control WebSocket, frame identity, image-only sensor payload, latest-frame backpressure, disconnect/unsubscribe, capability advertisement | VLM interpretation, decision-model input, vehicle-behavior changes, Milestone 003 observation interpretation |
| Keep one-shot `atomic-evaluation-capture` and M002 passive-observation capability unchanged | Replacing one-shot capture, leaking evaluator control references as perception, or requiring Automa to poll `get_play_debug` per frame |
| Bounded live 10–30 FPS evidence as a later review unit | Lossless buffering, binary WebSocket frames, multi-camera fan-out, SimEval CLI redesign, or Metrics UI dashboard redesign |

## Exit Criteria

| ID | Criterion | Status | Evidence / remaining gap |
| --- | --- | --- | --- |
| M004-01 | Chase usage advertises a camera-stream capability with actors, cameras, image controls, rate/backpressure policy, and the one-shot query that remains available | Unmet | `protocol.passiveObservation` exists; no stream capability |
| M004-02 | Subscribe and unsubscribe are request/response over the existing WS; missing frontend, bad actor/camera, or duplicate subscribe fail closed with a structured result and no sensor artifact | Unmet | Only one-shot `play_game_query` exists |
| M004-03 | Each streamed frame pairs image data with `gameId + simulationEpoch + frameIndex`; subscribe/stream/unsubscribe do not play, pause, reset, change scenario, or apply control | Unmet | Pull capture is playback-neutral; no push path |
| M004-04 | Stream sensor payload is image-only; evaluator shadow and control reference are absent | Unmet | Atomic capture still bundles evaluator data on the one-shot path, which must stay off the stream |
| M004-05 | Backpressure is latest-frame-only with an explicit dropped-frame count; disconnect and unsubscribe end the stream with a structured event | Unmet | No subscription lifecycle |
| M004-06 | `atomic-evaluation-capture` remains available for one-shot diagnostics with its M002 preservation contract | Unmet | Must be proven unchanged after the stream lands |
| M004-07 | A live Play session records representative 10–30 FPS on the accepted stream without per-frame debug or one-shot capture polling | Unmet | Issue #152 measured ~0.96 FPS on the pull path; proof is a later evidence unit |
| M004-08 | Closeout records completion usage, every criterion, residual risk, and that 003 remains observation interpretation | Unmet | Selected only after M004-01–M004-07 are Met |

## Current Delivery

### Current Frontier

**Camera stream contract**

- Workflow state: proposal_in_review
- Proposal branch: `m004/camera-stream-contract-proposal`
- Implementation branch: `m004/camera-stream-contract`
- Proposal path: `docs/milestones/004-high-throughput-passive-camera-stream/proposals/camera-stream-contract.md`
- Review kind: Deterministic invariant closure
- Review question: Can a WS agent subscribe to a read-only Chase camera stream that pairs each image with `gameId + simulationEpoch + frameIndex`, never mutates the session, never includes evaluator facts, and fail-closes without a sensor artifact on unsupported, disconnect, or session-identity drift?
- Acceptance owner: Chase camera-stream builder (`examples/play/chase/evaluation/camera-stream.ts`) and the dedicated WS subscription registry that forwards frames only to the subscriber
- Exit criteria affected: M004-01, M004-02, M004-03, M004-04, M004-05, M004-06
- Prerequisite: M002 closed on `main`; one-shot `atomic-evaluation-capture` and `protocol.passiveObservation` remain the compatibility baseline
- Milestone-level non-goal: Live 10–30 FPS measurement, VLM/003 interpretation, evaluator-as-perception, lossless buffering, binary WS frames, SimEval CLI, or changing vehicle behavior

### Next-Frontier Candidate

**Live throughput evidence**

- Proposal branch: `m004/live-throughput-evidence-proposal`
- Implementation branch: `m004/live-throughput-evidence`
- Proposal path: `docs/milestones/004-high-throughput-passive-camera-stream/proposals/live-throughput-evidence.md`
- Review kind: Live or external evidence
- Review question: Does a live Play session with an active frontend deliver representative 10–30 FPS on the accepted camera stream without per-frame `get_play_debug` or `atomic-evaluation-capture` polling?
- Acceptance owner: Recorded live-throughput procedure and artifacts under this milestone's evidence directory
- Exit criteria affected: M004-07
- Prerequisite: Accepted Camera stream contract implementation on the milestone branch
- Non-goals: Redesigning the stream contract, changing one-shot capture, or treating browser-backgrounded-tab stalls as a contract defect

### Frontier Map

- Path: `Live throughput evidence` → `Milestone closeout`
- Cadence: linked-list

#### Node: Live throughput evidence

- Proposal branch: `m004/live-throughput-evidence-proposal`
- Implementation branch: `m004/live-throughput-evidence`
- Proposal path: `docs/milestones/004-high-throughput-passive-camera-stream/proposals/live-throughput-evidence.md`
- Review kind: Live or external evidence
- Review question: Does a live Play session with an active frontend deliver representative 10–30 FPS on the accepted camera stream without per-frame `get_play_debug` or `atomic-evaluation-capture` polling?
- Acceptance owner: Recorded live-throughput procedure and artifacts under this milestone's evidence directory
- Exit criteria affected: M004-07
- Prerequisite: Accepted Camera stream contract implementation on the milestone branch
- Non-goals: Redesigning the stream contract, changing one-shot capture, or treating browser-backgrounded-tab stalls as a contract defect

#### Node: Milestone closeout

- Proposal branch: `m004/closeout-proposal`
- Implementation branch: `m004/closeout`
- Proposal path: `docs/milestones/004-high-throughput-passive-camera-stream/proposals/closeout.md`
- Review kind: Milestone closeout
- Review question: Is Milestone 004 complete as a whole—every exit criterion Met, completion usage supported, residual risk stated—and does 003 remain the observation-interpretation pre-plan?
- Acceptance owner: Whole-milestone closeout judgment
- Exit criteria affected: M004-08
- Prerequisite: M004-01 through M004-07 are Met
- Non-goals: Product changes, 003 implementation, or closing GitHub issue #150 as unfinished Metrics UI protocol work

## Workflow History

| Frontier | State | Evidence |
| --- | --- | --- |
| M004 activation | ready_for_proposal | Activated from `main` after M002 closeout to deliver GitHub issue #152 as a compact milestone, without hijacking the 003 observation-interpretation pre-plan. |
| Idle | idle | Fresh compact plan: remaining path is Camera stream contract → Live throughput evidence → Milestone closeout; current stays idle until the first proposal selects Camera stream contract. |
| Camera stream contract | proposal_in_review | Started m004/camera-stream-contract-proposal. |

## Accepted Review Units

| PR | Accepted review question | Result | Exit criteria | Durable evidence |
| --- | --- | --- | --- | --- |

## Open Risks And Unverified Assumptions

| Risk or assumption | Consequence | Resolution path |
| --- | --- | --- |
| Live 10–30 FPS depends on an active browser animation frame and JPEG encode cost | A correct stream contract can still miss the FPS target in a backgrounded tab or at 640×480 PNG | Camera stream contract makes FPS architecturally possible; M004-07 is a separate live evidence unit; PNG/lossless is out of stream scope |
| Auto-driving still polls `get_state` / `get_play_debug` / one-shot capture | Metrics UI can ship the stream while Automa keeps the slow client path | Residual for auto-driving; this milestone owns the Metrics UI contract only |
| GitHub issue #150 remains OPEN | Operators may think passive observation is unimplemented | #151 already delivered `protocol.passiveObservation`; #150 is consumer tracking, not M004 product work |
| `shared/schema.ts` is already at the file-size-lint ceiling | Adding stream types in place may fail lint | Camera stream proposal must allow extracting stream types to a dedicated shared module rather than a schema redesign |

## Milestone Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-08-28 | Open Milestone 004 for issue #152 instead of extending closed M002 or activating 003 | 002 closed the one-shot capture contract; 003 is observation interpretation; 152 is throughput of the camera sensor path |
| 2026-08-28 | Prefer a push subscription over a batched `play_game_query` | Issue #152 measured ~0.96 FPS because each sample is a frontend request/response (`play_game_query` plus debug probes). Batching still pulls and still pays one RTT plus encoder burst per request |
| 2026-08-28 | Split the stream contract from live 10–30 FPS proof | Deterministic fail-closed identity/privilege/lifecycle is independently acceptable; FPS is live evidence and must not block the protocol unit |
| 2026-08-28 | Keep `atomic-evaluation-capture` as the one-shot path; do not put evaluator data on the stream | Issue #152 forbids leaking evaluator control references as perception; one-shot capture remains the diagnostic/evaluation bundle |
| 2026-08-28 | Latest-frame-only backpressure, JPEG image data URLs, JSON text frames | Lossless queues and binary WS frames are new transport projects; JPEG plus drop-old-frames is the smallest path that can reach 10–30 FPS |
| 2026-08-28 | Do not treat issue #150 as M004 product work | M002 PR #151 delivered the requested capability and preservation receipt |

## Closeout

Blocked until every exit criterion is `Met`.

Closeout will produce:

- `closeout.md`;
- a completed-milestone ledger entry;
- residual-risk disposition of auto-driving client adoption and browser-animation limits;
- a decision that 003 remains the observation-interpretation pre-plan;
- the cumulative PR marked ready for whole-milestone review.
