# Chase Example Architecture

The chase example keeps decision logic grouped by IDAE stage, with the RC chase implementation supplying concrete modules inside those stage directories. Generic core primitives and flat interface files are TypeScript first; chase-specific implementation modules can remain `.mjs` while they migrate incrementally.

- `decision-model/core/` contains reusable decision primitives: staged decision engines, actor decision models, Kuramoto consensus, and vector math.
- `decision-model/observer-world/` contains observer-centric world model interfaces, including positions, obstacles, world context, and observed actor memory shapes.
- `decision-model/memory/` contains actor memory models, including chaser map and success memory.
- `decision-model/patterns/` groups concrete pattern implementations by actor owner. Generic pattern lifecycle, confidence, and prediction-unit helpers live in `core/`; chaser-owned evader motion pattern models live under `patterns/chaser/`, with each sub-pattern in its own directory.
- `decision-model/strategies/` groups concrete strategy implementations by actor owner, with core strategy contracts and confidence helpers in `core/`. Chaser-owned evader prediction planning lives under `strategies/chaser/`, and evader movement strategies live under `strategies/evader/`.
- `decision-model/actions/` contains action proposal and action selection modules. Generic action envelopes, proposal metadata, and motive signal contracts live in `core/`; shared vehicle capability shapes live in `vehicle/`; actor-specific plans, motives, mutable mixing policies, and debug payloads live with the actor-owned action modules.
- `simulation/` advances world state. It applies actor actions to positions, resolves collisions, updates metrics, records traces, and coordinates the chaser and evader decision models.
- `actors/` contains RC chase actor shells, perception helpers, vehicle controllers, and IDAE adapters that wire the stage modules together.
- `world/` contains chase field geometry, obstacle layout, bounds, and collision helpers.
- `ui/` contains browser runtime, rendering, sidebar controls, stored settings, and keyboard input.
- `debug/` contains debug panel, prediction performance snapshots, and derived debug payloads.
- `config/` contains chase constants and strategy identifiers.

The intended direction is that IDAE-stage code is discoverable in `decision-model/`, while actor adapters stay thin and world/UI/debug code remains outside the decision model.
