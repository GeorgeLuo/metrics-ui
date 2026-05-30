import {
  getActorPerception,
} from "../../decision-model/memory/actors/perceived-actor-location.ts";

export {
  createActorLocationMemory,
  getActorPerception,
  getPerceivedActorPosition,
  updateActorLocationMemory,
} from "../../decision-model/memory/actors/perceived-actor-location.ts";
export {
  createObservedEvaderMotionMemory,
  updateObservedEvaderMotionMemory,
} from "../../decision-model/memory/chaser/observed-evader-motion.ts";

/**
 * Backward-compatible named helper for chaser-to-evader perception.
 */
export function getChaserEvaderPerception(
  chaserPosition,
  evaderPosition,
  chaserLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  return getActorPerception(
    chaserPosition,
    evaderPosition,
    chaserLookDirection,
    fieldOfViewAngleRadians,
    obstacles,
  );
}
