import {
  createActorLocationMemory,
} from "../../../decision-model/memory/actors/perceived-actor-location.ts";
import {
  createMapShapeMemory,
} from "../../../decision-model/memory/chaser/map/memory.ts";
import {
  createObservedEvaderMotionMemory,
} from "../../../decision-model/memory/chaser/observed-evader-motion.ts";
import {
  createChaserSuccessMetricsMemory,
} from "../../../decision-model/memory/chaser/success-memory.ts";
import {
  createContinuancePattern,
} from "../../../decision-model/patterns/chaser/evader-motion/continuance/pattern.ts";
import {
  createWallAvoidancePattern,
} from "../../../decision-model/patterns/chaser/evader-motion/wall-avoidance/pattern.ts";
import {
  createEvaderMotionProjection,
} from "../../../decision-model/projections/chaser/evader-motion/projection.ts";
import {
  createChaserKnowledgeEngines,
  createChaserPatternEngines,
} from "./runtime-settings/index.ts";
import type { VectorXZ } from "../../../decision-model/core/math.ts";

type CreateChaserKnowledgeBaseOptions = {
  evaderDirection?: VectorXZ | null;
  engines?: Record<string, boolean | undefined>;
  patterns?: Record<string, boolean | undefined>;
};

/**
 * Creates the chaser's decision-model state.
 *
 * The state groups IDAE-owned memory, patterns, projections, and status fields.
 * Simulation embodiment and controller state are added by the actor adapter.
 */
export function createChaserKnowledgeBase({
  evaderDirection = { x: 0, z: 0 },
  engines,
  patterns,
}: CreateChaserKnowledgeBaseOptions = {}): Record<string, any> {
  const evaderMotionProjection = createEvaderMotionProjection();
  const resolvedEvaderDirection = evaderDirection ?? { x: 0, z: 0 };
  return {
    evaderExists: true,
    engines: createChaserKnowledgeEngines(engines),
    patternEngines: createChaserPatternEngines(patterns),
    memory: {
      directObservation: {
        evaderLocation: createActorLocationMemory(),
      },
      abstracted: {
        observedEvaderMotion: createObservedEvaderMotionMemory(resolvedEvaderDirection),
        mapShape: createMapShapeMemory(),
        successMetrics: createChaserSuccessMetricsMemory(),
      },
    },
    patterns: {
      wallAvoidance: createWallAvoidancePattern(),
      continuance: createContinuancePattern(resolvedEvaderDirection),
    },
    projections: {
      evaderMotion: evaderMotionProjection,
    },
    assumedBehavior: {
      evaderMotion: {
        strategy: "uninitialized",
        actionable: false,
        invalidReason: "prediction-not-yet-built",
        consensus: 0,
        wallAvoidanceScore: 0,
        observationCount: 0,
        motionObservationCount: 0,
        visibleNow: false,
      },
    },
  };
}
