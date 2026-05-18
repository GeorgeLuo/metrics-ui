# Chase Example Architecture

The chase example is split between a generic decision model and the RC chase implementation.

- `decision-model/` contains reusable decision primitives: staged decision engines, actor decision models, stateful patterns, stateful strategies, confidence helpers, Kuramoto consensus, and vector math. These modules should not know about chasers, evaders, vehicles, walls, or rendering.
- `simulation/` advances world state. It applies actor actions to positions, resolves collisions, updates metrics, records traces, and coordinates the chaser and evader decision models.
- `actors/` contains RC chase actor implementations. Chaser and evader decision-model adapters live beside their actor-specific controllers, strategies, and memory code.
- `world/` contains chase field geometry, obstacle layout, bounds, and collision helpers.
- `prediction/` contains chase-specific prediction and pattern implementations, including evader projection and wall-avoidance inference.
- `ui/` contains browser runtime, rendering, sidebar controls, stored settings, and keyboard input.
- `debug/` contains debug panel, performance snapshots, and derived debug payloads.
- `config/` contains chase constants and strategy identifiers.

The intended direction is that IDAE-style actor reasoning stays generic in `decision-model/`, while the RC chase game supplies concrete observation, memory, pattern, strategy, and action stages through the actor adapters.
