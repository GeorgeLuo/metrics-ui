import type { ChaserObservedWorld } from "../../decision-model/observer-world/interfaces.ts";
import type { VectorXZ } from "../../decision-model/core/math.ts";
import { getObservedActor } from "../core/actor-visibility.ts";
import { getObservedMap } from "../core/map-visibility.ts";

type ChaserObservationContext = {
  chaserPosition?: VectorXZ | null;
  evaderPosition?: VectorXZ | null;
  chaserLookDirection?: VectorXZ | null;
  fieldOfViewAngleRadians?: number;
  obstacles?: unknown;
  columns?: number;
  rows?: number;
};

/**
 * Maps the simulator's current chaser-relative world state into an observation.
 *
 * The decision model consumes this trusted shape without owning the geometry
 * that decides what the chaser can physically see.
 */
export function observeChaserWorld({
  chaserPosition,
  evaderPosition,
  chaserLookDirection,
  fieldOfViewAngleRadians = 0,
  obstacles,
  columns,
  rows,
}: ChaserObservationContext = {}): ChaserObservedWorld {
  const evader = getObservedActor(
    chaserPosition,
    evaderPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
  );

  return {
    ...evader,
    evader,
    map: getObservedMap(
      chaserPosition,
      chaserLookDirection,
      fieldOfViewAngleRadians,
      obstacles,
      { columns, rows },
    ),
  };
}
