# Milestone 002 Closeout: Atomic Chase Evaluation Capture

Closed: 2026-07-22

## Outcome

Chase now exposes one playback-neutral evaluation request that binds a rendered
front-camera artifact and a separately classified evaluator shadow to the same
immutable capture source. Every response carries a capture ID plus
`gameId + simulationEpoch + frameIndex`; reset starts a new opaque epoch, so
frame-zero captures from different runs remain distinct.

The controller-facing `sensor` branch contains only the image artifact. The
`evaluator` branch is explicitly non-sensor and limited to counts derived from
the same visible-only record. Generic Play query transport carries the Chase
contract without adding Chase-specific behavior to the host, while SimEval owns
artifact persistence.

## Delivered Workflows

- Persist one atomic capture with
  `simeval ui play-evaluation-capture --actor chaser --out-dir ./evaluation-captures`.
- Run the bounded before/repeat/move/reset fixture with
  `npm run play:chase:evaluation:capture -- --out-dir /tmp/chase-evaluation-capture`.
- Recheck existing artifacts without live simulation state with
  `npm run play:chase:evaluation:validate -- --dir /tmp/chase-evaluation-capture`.

## Exit Evidence

| Criterion | Evidence |
| --- | --- |
| One image and bounded evaluator shadow share one identity. | Atomic-capture regressions assert the capture ID, full frame identity, image, and count-only shadow produced from one frozen source. |
| Capture does not mutate playback. | The pure builder and public transport tests preserve the frame index and return `playback.advanced=false`; all four persisted captures report the same. |
| Sensor data excludes simulator-only facts. | Regression and offline validation require the sensor branch to contain exactly one image object and reject additional geometry fields. |
| SimEval persists public evaluation artifacts. | SimEval PR [#148](https://github.com/GeorgeLuo/simtest0/pull/148) writes a PNG plus metadata with the inline image removed and a local file reference retained. |
| Controller and reset behavior remain attributable. | [`validation.json`](evidence/live-controller/validation.json) passes 25 of 25 checks: repeated frame-zero captures are byte-identical, WS movement reaches a later frame with changed image bytes, and reset returns to frame zero under a new epoch and capture ID. |

## Validation

- `npm run play:chase:regress`: 83 passing tests at closeout.
- `npm exec -- tsc`: passed.
- `npm run docs:ws:check`: passed.
- `npm run docs:milestones:check`: passed.
- Live controller evidence: 25 of 25 checks passed.

The retained captures, hashes, frame identities, and reproduction notes are in
[`evidence/live-controller/`](evidence/live-controller/).

## Decisions

- Capture identity and frame identity remain separate: a capture is an actor
  artifact, while `gameId + simulationEpoch + frameIndex` identifies its source
  simulation state across resets.
- The Chase runtime, not callers or transport, owns simulation epochs.
- The evaluator shadow remains count-only and classified as non-sensor.
- SimEval persists generic public responses; Metrics UI owns Chase validation.
- A stalled browser animation loop is a failed live run, not acceptable movement
  evidence.

## Remaining Limits

- The evaluator shadow is a bounded consistency aid, not independent semantic
  ground truth and not a world-state export.
- A later frame and changed image prove observable response to controller input;
  they do not prove a specific path, distance, collision result, or policy
  quality.
- Live movement validation requires an active frontend animation loop. A
  suspended browser tab may prevent frame advancement and is reported as a
  failure.
- The capture contains no object interpretation, depth, persistent memory, or
  decision input. Those remain intentionally outside this milestone.

## Follow-On

Milestone 003, [Chaser Observation Interpretation](../003-chaser-observation-interpretation/plan.html),
can consume the persisted sensor image and retain the full capture identity. Its
interpreter and decision-model path must not read the evaluator branch. The
first review unit should settle that observer-world input and provenance
boundary before any image interpretation strategy is implemented.
