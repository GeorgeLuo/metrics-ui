# Live Controller Evidence

This directory records one public WebSocket evaluation flow against the
`chaser-depth-obstacles` scenario. SimEval persisted each response as separate
metadata and image files; the Metrics UI validator then checked the files
without reading live simulation state.

## Result

- `before` and `repeat` both identify frame `0` of the same simulation epoch and
  have the same PNG SHA-256.
- A reverse input latched through the WS controller advances the same epoch to
  a later frame; `after-move.png` has a different SHA-256 and visibly places the
  obstacles farther away. The exact frame is recorded in `validation.json`
  because browser animation cadence varies by run.
- `after-reset` returns to frame `0` with the original image bytes but a new
  simulation epoch and capture ID.
- All four captures report `playback.advanced=false`.
- All four sensor branches contain only the persisted camera image. The
  count-only observation shadow and bounded control reference remain under
  `evaluator.classification=non-sensor`.
- Every control reference records the scenario, control authority, action frame,
  normalized input, and normalized action without map geometry or actor poses.
- [`validation.json`](./validation.json) passes all 31 contract, identity,
  movement, reset, control-reference, and privilege-boundary checks.

## Reproduce

With Metrics UI open on Play and a frontend tab kept active:

```bash
npm run play:chase:evaluation:capture -- \
  --ui ws://127.0.0.1:5050/ws/control \
  --out-dir /tmp/chase-evaluation-capture
```

The Chase loop advances from browser animation frames. A suspended background
tab may not advance during the bounded movement window; the command treats that
as a failed validation instead of accepting unchanged evidence.

Validate an existing four-capture directory independently:

```bash
npm run play:chase:evaluation:validate -- \
  --dir /tmp/chase-evaluation-capture \
  --out /tmp/chase-evaluation-capture/validation.json
```

The persistence command used by the fixture is introduced in
[SimEval PR #148](https://github.com/GeorgeLuo/simtest0/pull/148).
