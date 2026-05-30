import {
  DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
  EVADER_ESTIMATE_MIN_MOVE_DISTANCE,
  EVADER_SPEED_ESTIMATE_ALPHA,
  EVADER_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
} from "../../../config/constants.mjs";
import type { VectorXZ } from "../../core/math.ts";
import {
  createSampledVectorSignalMemory,
  updateSampledVectorSignalMemory,
  type SampledVectorSignalMemory,
} from "../core/sampled-signal.ts";
import type { ActorLocationMemory } from "../actors/perceived-actor-location.ts";

/** Chaser-specific motion memory derived from repeated evader sightings. */
export type ObservedEvaderMotionMemory = SampledVectorSignalMemory & {
  speedEstimateUnitsPerFrame: number;
  speedObservationCount: number;
};

/**
 * Creates chaser memory for evader motion inferred from visible positions.
 */
export function createObservedEvaderMotionMemory(
  evaderDirection: VectorXZ = { x: 0, z: 0 },
): ObservedEvaderMotionMemory {
  return {
    ...createSampledVectorSignalMemory(evaderDirection),
    speedEstimateUnitsPerFrame: DEFAULT_EVADER_SPEED_ESTIMATE_UNITS_PER_FRAME,
    speedObservationCount: 0,
  };
}

/**
 * Updates evader motion estimates from the latest perceived evader location.
 */
export function updateObservedEvaderMotionMemory(
  observedEvaderMotion: ObservedEvaderMotionMemory | null | undefined,
  evaderLocationMemory: ActorLocationMemory | null | undefined,
): ObservedEvaderMotionMemory | null {
  if (!observedEvaderMotion) {
    return null;
  }

  if (evaderLocationMemory?.visible && evaderLocationMemory.position) {
    const update = updateSampledVectorSignalMemory(observedEvaderMotion, {
      observedPosition: evaderLocationMemory.position,
      observationGapFrames: evaderLocationMemory.observationGapFrames,
      minMoveDistance: EVADER_ESTIMATE_MIN_MOVE_DISTANCE,
    });

    if (update?.moved) {
      const clampedObservedSpeed = Math.min(
        EVADER_SPEED_ESTIMATE_MAX_UNITS_PER_FRAME,
        Math.max(0, update.moveDistance / update.observationGapFrames),
      );
      observedEvaderMotion.speedEstimateUnitsPerFrame =
        observedEvaderMotion.speedObservationCount > 0
          ? observedEvaderMotion.speedEstimateUnitsPerFrame
            + (clampedObservedSpeed - observedEvaderMotion.speedEstimateUnitsPerFrame)
              * EVADER_SPEED_ESTIMATE_ALPHA
          : clampedObservedSpeed;
      observedEvaderMotion.speedObservationCount += 1;
    }
  }

  return observedEvaderMotion;
}
