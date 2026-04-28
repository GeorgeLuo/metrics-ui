import { DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME } from "./constants.mjs";
import { createStatefulPattern, getPatternOutput, updatePattern } from "./patterns.mjs";
import { resolveObstacleCollisions } from "./world.mjs";

export const TARGET_MOTION_PATTERN_ID = "targetMotionHypothesis";

export function createTargetMotionHypothesisState(
  targetDirection = { x: 0, z: 0 },
) {
  const safeTargetDirection = targetDirection
    ? { ...targetDirection }
    : { x: 0, z: 0 };
  return {
    position: null,
    direction: safeTargetDirection,
    framesSinceObservation: 0,
  };
}

export function updateTargetMotionHypothesisState(
  targetMotionHypothesis,
  {
    observedTargetMotion,
    targetLocationMemory,
    worldContext = {},
  } = {},
) {
  if (!targetMotionHypothesis) {
    return null;
  }

  if (targetLocationMemory?.visible && targetLocationMemory.position) {
    targetMotionHypothesis.position = { ...targetLocationMemory.position };
    targetMotionHypothesis.framesSinceObservation = 0;
    if (observedTargetMotion?.lastObservedDirection) {
      targetMotionHypothesis.direction = { ...observedTargetMotion.lastObservedDirection };
    }
    return targetMotionHypothesis;
  }

  if (targetMotionHypothesis.position && targetMotionHypothesis.direction) {
    targetMotionHypothesis.framesSinceObservation += 1;
    const speedEstimate = Number.isFinite(observedTargetMotion?.speedEstimateUnitsPerFrame)
      ? observedTargetMotion.speedEstimateUnitsPerFrame
      : DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME;
    const nextPosition = {
      x: targetMotionHypothesis.position.x
        + targetMotionHypothesis.direction.x * speedEstimate,
      z: targetMotionHypothesis.position.z
        + targetMotionHypothesis.direction.z * speedEstimate,
    };
    const canResolveWorldCollision = worldContext.obstacles
      && Number.isFinite(worldContext.columns)
      && Number.isFinite(worldContext.rows);
    targetMotionHypothesis.position = canResolveWorldCollision
      ? resolveObstacleCollisions(
        nextPosition,
        targetMotionHypothesis.position,
        worldContext.columns,
        worldContext.rows,
        worldContext.obstacles,
      )
      : nextPosition;
  }

  return targetMotionHypothesis;
}

export function createTargetMotionPattern(targetDirection = { x: 0, z: 0 }) {
  return createStatefulPattern({
    id: TARGET_MOTION_PATTERN_ID,
    createState: () => createTargetMotionHypothesisState(targetDirection),
    updateState: (state, context) => updateTargetMotionHypothesisState(state, context),
    getOutput: (state) => state,
    getConfidence: (state) => {
      if (!state?.position) {
        return 0;
      }
      return 1 / (1 + Math.max(0, Number(state.framesSinceObservation) || 0));
    },
  });
}

export function updateTargetMotionPattern(pattern, context) {
  return updatePattern(pattern, context);
}

export function getTargetMotionHypothesis(pattern) {
  return getPatternOutput(pattern);
}

export function buildTargetMotionModel({
  observedTargetMotion,
  targetMotionPattern,
  targetMotionHypothesis,
} = {}) {
  const resolvedTargetMotionHypothesis = getTargetMotionHypothesis(
    targetMotionPattern ?? targetMotionHypothesis,
  );
  return {
    position: resolvedTargetMotionHypothesis?.position ?? null,
    direction: resolvedTargetMotionHypothesis?.direction ?? { x: 0, z: 0 },
    framesSinceObservation: Number(resolvedTargetMotionHypothesis?.framesSinceObservation) || 0,
    speedEstimateUnitsPerFrame: Number.isFinite(observedTargetMotion?.speedEstimateUnitsPerFrame)
      ? observedTargetMotion.speedEstimateUnitsPerFrame
      : DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_FRAME,
    speedObservationCount: Number(observedTargetMotion?.speedObservationCount) || 0,
    lastObservedDirection: observedTargetMotion?.lastObservedDirection ?? { x: 0, z: 0 },
    previousObservedDirection: observedTargetMotion?.previousObservedDirection ?? null,
    observedTurnRadiansPerFrame: Number(observedTargetMotion?.observedTurnRadiansPerFrame) || 0,
    lastObservedPosition: observedTargetMotion?.lastObservedPosition ?? null,
    observationCount: Number(observedTargetMotion?.observationCount) || 0,
    motionObservationCount: Number(observedTargetMotion?.motionObservationCount) || 0,
  };
}
