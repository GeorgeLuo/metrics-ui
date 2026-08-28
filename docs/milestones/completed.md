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

## 2026-08-28: Atomic Chase Evaluation Capture

Milestone 002 delivered one playback-neutral request whose camera frame and
bounded evaluator shadow come from the same Chase state. Capture identity is
`gameId + simulationEpoch + frameIndex`. The controller sensor path is
image-only. Evaluator output is count plus a bounded control reference. Passive
observation is advertised and proven with a before/after session fingerprint,
or rejected without a sensor artifact. Remaining Automa adapter and
exact-current alignment work stays in auto-driving. See the
[plan](002-atomic-chase-evaluation-capture/plan.md) and
[closeout](002-atomic-chase-evaluation-capture/closeout.md).
