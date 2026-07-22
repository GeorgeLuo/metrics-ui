# Completed Milestones

This append-only ledger records durable context from closed milestones.

## 2026-07-17: RC Camera Simulation Realism

Milestone 001 delivered deterministic and RC-indoor Chase rendering profiles,
explicit camera and sensor contracts, reusable actor-view capture resources,
bounded seeded visual variation, and SimEval snapshot evidence. The final
simulation p95 was 5.3 ms against 5.6 ms at the exact pre-milestone revision;
25 sequential captures completed without blank output and reset-based replay
was byte-identical. Physical camera mount and optics values remain visual
estimates, not measured PiRacer intrinsics or extrinsics. See the frozen
[plan](001-rc-camera-simulation-realism/plan.html) and
[closeout](001-rc-camera-simulation-realism/closeout.md).

## 2026-07-22: Atomic Chase Evaluation Capture

Milestone 002 delivered a playback-neutral Chase evaluation request with one
immutable image/evaluator source, reset-safe
`gameId + simulationEpoch + frameIndex` identity, an image-only controller
sensor branch, a separately classified count-only evaluator shadow, generic
Play transport, and SimEval persistence. Retained before/repeat/move/reset
evidence passes 25 of 25 offline checks; movement changes the image within one
epoch and reset returns to frame zero under a new epoch. The result does not
interpret images or expose world geometry. See the frozen
[plan](002-atomic-chase-evaluation-capture/plan.html) and
[closeout](002-atomic-chase-evaluation-capture/closeout.md).
