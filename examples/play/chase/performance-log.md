# Chase Performance Log

This log tracks long-running simulation performance across behavior changes. The
primary comparison metric is `Touches / 1k frames` measured after warmup.

## Method

- Scenario: `examples/play/chase/scenarios/default.scenario.mjs`
- Grid: `9 x 6`
- Combination: baseline, all default configured action proposals
- Warmup: `10%` of total frames
- Metric: `measurementTouchCount / measurementFrames * 1000`
- Runner: `measureChaseScenarioAsymptote`

## Runs

### 2026-05-13 - Current Working Tree Baseline

- Branch: `main`
- Base commit: `1573f30`
- Working tree: dirty
- Notable local state: chaser-side wall safety disabled in action selection
- Total elapsed: `62.609s`

| Total frames | Warmup frames | Measurement frames | Total touches | Measurement touches | Touches / 1k frames | Runtime elapsed | Runtime frames/s |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 40,000 | 4,000 | 36,000 | 201 | 181 | 5.027778 | 9.493s | 4,213.7 |
| 80,000 | 8,000 | 72,000 | 379 | 336 | 4.666667 | 19.051s | 4,199.2 |
| 120,000 | 12,000 | 108,000 | 557 | 493 | 4.564815 | 34.065s | 3,522.7 |

Final states:

| Total frames | Chaser position | Evader position | Chaser direction | Evader direction |
| ---: | --- | --- | --- | --- |
| 40,000 | `x=-0.653108, z=1.247780` | `x=2.656143, z=2.040265` | `x=0.990667, z=0.136306` | `x=0.999999, z=-0.001399` |
| 80,000 | `x=4.073795, z=2.299040` | `x=3.081480, z=1.625152` | `x=0.809716, z=-0.586822` | `x=-0.839466, z=-0.543413` |
| 120,000 | `x=-2.257999, z=1.899925` | `x=-3.807359, z=2.008916` | `x=-0.999295, z=-0.037532` | `x=-0.994603, z=-0.103758` |

Comparison against clean `HEAD` at `1573f30`:

| Total frames | Clean HEAD Touches / 1k | Current Touches / 1k | Delta | Direction |
| ---: | ---: | ---: | ---: | --- |
| 40,000 | 2.277778 | 5.027778 | +2.750000 | improvement |
| 80,000 | 2.680556 | 4.666667 | +1.986111 | improvement |
| 120,000 | 2.620370 | 4.564815 | +1.944445 | improvement |
