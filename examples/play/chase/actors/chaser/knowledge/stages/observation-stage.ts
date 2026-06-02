import { observeChaserWorld } from "../../../../perception/chaser/observe.ts";
import type { VectorXZ } from "../../../../decision-model/core/math.ts";

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
 * Adapts the chaser frame context into the trusted observed-world contract.
 */
export function observeChaserEnvironment(
  knowledgeBase: unknown,
  context: ChaserObservationContext = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  return observeChaserWorld(context);
}
