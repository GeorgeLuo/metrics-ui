import type { EvaderObservedWorld } from "../../decision-model/observer-world/interfaces.ts";
import { getObservedActor } from "../core/actor-visibility.ts";

type EvaderObservationContext = Omit<EvaderObservedWorld, "chaserPerception"> & {
  evaderPosition?: EvaderObservedWorld["position"];
  evaderDirection?: EvaderObservedWorld["direction"];
  fieldOfViewAngleRadians?: number;
};

/**
 * Maps simulator truth into the evader's trusted observed-world input.
 */
export function observeEvaderWorld({
  evaderPosition,
  evaderDirection,
  chaserPosition,
  fieldOfViewAngleRadians = 0,
  obstacles,
  columns,
  rows,
  frameIndex,
  turnRateRadiansPerFrame,
  policy,
}: EvaderObservationContext = {}): EvaderObservedWorld {
  const chaserPerception = getObservedActor(
    evaderPosition,
    chaserPosition,
    evaderDirection,
    fieldOfViewAngleRadians,
    obstacles,
  );

  return {
    position: evaderPosition,
    direction: evaderDirection,
    chaserPosition,
    chaserPerception,
    columns,
    rows,
    frameIndex,
    obstacles,
    turnRateRadiansPerFrame,
    policy,
  };
}
