import {
  updateActorLocationMemory,
} from "../../../../decision-model/memory/actors/perceived-actor-location.ts";
import {
  updateMapShapeMemory,
} from "../../../../decision-model/memory/chaser/map/memory.ts";
import {
  updateObservedEvaderMotionMemory,
} from "../../../../decision-model/memory/chaser/observed-evader-motion.ts";
import type { VectorXZ } from "../../../../decision-model/core/math.ts";
import { CHASER_KNOWLEDGE_ENGINE_IDS } from "../engines.ts";

type ChaserMemoryStageContext = {
  perception?: Record<string, any> | null;
  chaserPosition?: VectorXZ | null;
  chaserLookDirection?: VectorXZ | null;
  frameIndex?: unknown;
};

/**
 * Updates direct and abstracted chaser memory from the latest observation.
 */
export function updateChaserMemoryStage(
  knowledgeBase: Record<string, any> | null | undefined,
  {
    perception,
    chaserPosition,
    chaserLookDirection,
    frameIndex = null,
  }: ChaserMemoryStageContext = {},
) {
  if (!knowledgeBase) {
    return null;
  }

  const evaderPerception = perception?.evader ?? perception ?? { visible: false };
  updateActorLocationMemory(
    knowledgeBase.memory.directObservation.evaderLocation,
    evaderPerception,
    chaserPosition,
    chaserLookDirection,
  );
  updateMapShapeMemory(
    knowledgeBase.memory.abstracted.mapShape,
    perception?.map,
    frameIndex,
  );

  if (knowledgeBase.engines[CHASER_KNOWLEDGE_ENGINE_IDS.EVADER_TRACKING]) {
    updateObservedEvaderMotionMemory(
      knowledgeBase.memory.abstracted.observedEvaderMotion,
      knowledgeBase.memory.directObservation.evaderLocation,
    );
  }

  return knowledgeBase.memory;
}
