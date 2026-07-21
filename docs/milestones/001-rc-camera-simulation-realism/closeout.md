# Milestone 001 Closeout: RC Camera Simulation Realism

Closed: 2026-07-17

## Outcome

Chase now has three named rendering profiles: stable `simulation`, calibrated
`rc-indoor`, and seed-derived `randomized`. The main scene, popout actor views,
and SimEval/WS PNG captures consume the same resolved profile. Rendering is
explicitly separate from world geometry, vehicle dynamics, perception, memory,
and action selection.

The RC indoor profile adds carpet and cardboard appearance, room-wall material,
warm lighting, soft shadows, a low camera mount, calibrated pinhole-equivalent
projection, and a bounded radial-vignette sensor pass. The randomized profile
varies only documented appearance values around that calibrated center.

## Delivered Workflows

- Select `simulation`, `rc-indoor`, or `randomized` in Game settings.
- Set a deterministic rendering seed in Game settings or through
  `simeval ui play-game-action --action-id rendering-seed --value 17`.
- Capture a front-view PNG and resolved profile, camera, and sensor metadata
  with `simeval ui play-front-view-snapshot`.
- Compare the fixed PiRacer-room scenario with the physical source and retained
  simulator artifacts under `evidence/`.

## Validation

- `npm run play:chase:regress`: 72 passing tests.
- Chase typecheck, `npx tsc --noEmit`, milestone documentation, JSON, and
  whitespace checks passed.
- The exact pre-milestone revision (`404bacd`) measured a 5.6 ms p95 total in
  the PiRacer room. Final `simulation` and `rc-indoor` measured 5.3 ms p95 in
  the same browser setup, satisfying the no-regression criterion.
- Randomized seed 17 measured 6.6 ms p95, below the 24 ms visual threshold.
- Twenty-five sequential 320 by 240 snapshots all produced PNG and metadata
  files with no blank output. The first and last static-pose PNG hashes matched.
- Two reset-based seed-17 snapshots at frame 3 had identical pose, resolved
  metadata, and 640 by 480 PNG SHA-256.

Exact measurements, revisions, hashes, and commands are in
[`evidence/closeout/validation.json`](evidence/closeout/validation.json).

## Decisions

- Composition selected an 86-degree horizontal pinhole-equivalent view instead
  of the archived default-FOV prior, which was not a measured intrinsic.
- The only retained sensor effect is bounded radial distortion and vignette.
  Blur, grain, and compression remain rejected because the available physical
  reference cannot calibrate them without reducing geometric clarity.
- Variation changes visual appearance only. Camera geometry, world state,
  perception, vehicle dynamics, and decision behavior do not vary by seed.

## Remaining Gaps

- Camera mount and optical values are visual estimates, not measured PiRacer
  intrinsics or extrinsics.
- The room is intentionally simplified: door, trim, furniture, artwork, and
  physical carpet microgeometry are not represented.
- The sensor pass does not model measured lens distortion, exposure dynamics,
  motion blur, rolling shutter, noise, or codec artifacts.
- Automated Chrome showed roughly 34 ms RAF gaps in both compared revisions;
  profile work remained below the visual budget, but this is not a full
  real-device latency characterization.

## Follow-On

Milestone 002, [Chaser Observation Interpretation](../002-chaser-observation-interpretation/plan.html),
will establish the layer that maps captured visual evidence into observer-world
inputs before generic decision-model processing begins.
