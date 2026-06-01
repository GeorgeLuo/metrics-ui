import type {
  ProjectionPlan,
  ProjectionStatus,
  StatefulProjection,
} from "../../core/interfaces.ts";
import {
  buildEvaderMotionProjectionPlan,
  createEvaderMotionProjectionState,
  type EvaderMotionProjectionPlanOptions,
} from "./plan.ts";
import {
  createStatefulProjection,
  getProjectionConfidence,
  getProjectionOutput,
  isProjectionActionable,
  updateProjection,
} from "../../core/stateful-projection.ts";
import type { EvaderMotionProjectionState } from "./interfaces.ts";

export const CHASER_EVADER_MOTION_PROJECTION_ID = "evaderMotion";

/**
 * Creates an inactive evader-motion projection plan.
 *
 * Disabled plans keep the output shape stable for debug views and actions while
 * explaining why no future path is currently actionable.
 */
export function createDisabledEvaderMotionProjection(
  invalidReason = "projection-disabled",
): ProjectionPlan {
  return {
    actionable: false,
    invalidReason,
    prediction: {
      strategy: invalidReason,
      direction: { x: 0, z: 0 },
      consensus: 0,
      oscillators: [],
    },
    path: [],
    sampleCount: 0,
    sampleSpacingFrames: 0,
    horizonFrames: 0,
    validationErrorDistance: 0,
  };
}

/**
 * Creates the chaser projection that estimates future evader motion.
 *
 * This is the stateful module installed in the chaser IDAE projection stage.
 * It keeps validation/persistence state private and exposes only plan output,
 * confidence, and actionable status to callers.
 */
export function createEvaderMotionProjection(): StatefulProjection<ProjectionPlan> {
  return createStatefulProjection<EvaderMotionProjectionState, ProjectionPlan>({
    id: CHASER_EVADER_MOTION_PROJECTION_ID,
    createState: () => createEvaderMotionProjectionState(),
    createOutput: () => createDisabledEvaderMotionProjection("projection-not-yet-built"),
    deriveOutput: (projectionState, context = {}) => {
      const projectionContext = context as EvaderMotionProjectionPlanOptions;
      return buildEvaderMotionProjectionPlan({
        estimate: projectionContext.estimate,
        patternUnits: projectionContext.patternUnits,
        evaderVisible: projectionContext.evaderVisible,
        projectionState,
        columns: projectionContext.columns,
        rows: projectionContext.rows,
        obstacles: projectionContext.obstacles,
        horizonFrames: projectionContext.horizonFrames,
        sampleSpacingFrames: projectionContext.sampleSpacingFrames,
      });
    },
    getConfidence: (plan) => Number(plan?.prediction?.consensus) || 0,
    isActionable: (plan) => plan?.actionable !== false,
  }) as StatefulProjection<ProjectionPlan>;
}

/**
 * Advances the evader-motion projection by one decision frame.
 *
 * The context is intentionally the planner option shape so upstream actor code
 * can pass memory, pattern, world, and sampling settings without exposing the
 * projection's private state.
 */
export function updateEvaderMotionProjection(
  projection: StatefulProjection<ProjectionPlan>,
  context: EvaderMotionProjectionPlanOptions = {},
): ProjectionPlan | null {
  return updateProjection(projection, context as Record<string, unknown>) as ProjectionPlan | null;
}

/**
 * Reads the latest evader-motion projection output.
 */
export function getEvaderMotionProjection(
  projection: StatefulProjection<ProjectionPlan> | null | undefined,
): ProjectionPlan | null {
  return getProjectionOutput(projection) as ProjectionPlan | null;
}

/**
 * Builds a projection status object for debug views and selector UIs.
 */
export function getEvaderMotionProjectionStatus(
  projection: StatefulProjection<ProjectionPlan> | null | undefined,
): ProjectionStatus {
  return {
    id: projection?.id ?? CHASER_EVADER_MOTION_PROJECTION_ID,
    confidence: getProjectionConfidence(projection),
    actionable: isProjectionActionable(projection),
  };
}
