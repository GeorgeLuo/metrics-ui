import type {
  ProjectionPlan,
  ProjectionStatus,
  StatefulProjection,
} from "../../core/interfaces.ts";
import {
  buildEvaderMotionProjectionPlan,
  createEvaderMotionProjectionState,
} from "./plan.mjs";
import {
  createStatefulProjection,
  getProjectionConfidence,
  getProjectionOutput,
  isProjectionActionable,
  updateProjection,
} from "../../core/stateful-projection.ts";

export const CHASER_EVADER_MOTION_PROJECTION_ID = "evaderMotion";

/**
 * Creates an inactive evader-motion projection plan.
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
 */
export function createEvaderMotionProjection(): StatefulProjection<ProjectionPlan> {
  return createStatefulProjection<unknown, ProjectionPlan>({
    id: CHASER_EVADER_MOTION_PROJECTION_ID,
    createState: () => createEvaderMotionProjectionState(),
    createOutput: () => createDisabledEvaderMotionProjection("projection-not-yet-built"),
    deriveOutput: (projectionState, context = {}) => {
      const projectionContext = context as Record<string, any>;
      const buildProjectionPlan = buildEvaderMotionProjectionPlan as (
        options: Record<string, any>,
      ) => ProjectionPlan;
      return buildProjectionPlan({
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
 */
export function updateEvaderMotionProjection(
  projection: StatefulProjection<ProjectionPlan>,
  context: Record<string, unknown> = {},
): ProjectionPlan | null {
  return updateProjection(projection, context) as ProjectionPlan | null;
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
