import {
  createChaserSuccessMetricsMemory,
  updateChaserSuccessMetricsMemory,
} from "../../../../decision-model/memory/chaser/success-memory.ts";
import type { VectorXZ } from "../../../../decision-model/core/math.ts";

type ChaserSuccessMetricsContext = {
  chaserPosition?: VectorXZ | null;
  evaderPosition?: VectorXZ | null;
  evaderExists?: boolean;
  frameIndex?: number | null;
};

/**
 * Records chaser success metrics after the simulation applies a frame outcome.
 */
export function updateChaserSuccessMetricsStage(
  knowledgeBase: Record<string, any> | null | undefined,
  {
    chaserPosition,
    evaderPosition,
    evaderExists = true,
    frameIndex = null,
  }: ChaserSuccessMetricsContext = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  if (!knowledgeBase.memory.abstracted.successMetrics) {
    knowledgeBase.memory.abstracted.successMetrics = createChaserSuccessMetricsMemory();
  }

  return updateChaserSuccessMetricsMemory(
    knowledgeBase.memory.abstracted.successMetrics,
    {
      chaserPosition,
      evaderPosition: evaderExists === false ? null : evaderPosition,
      evaderExists,
      frameIndex,
    },
  );
}
