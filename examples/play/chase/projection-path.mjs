import { normalizeVector } from "./math.mjs";
import { predictTargetMotionWithKuramoto } from "./prediction.mjs";
import { getWallAvoidanceSignal } from "./prediction-strategies.mjs";
import { constrainDirectionToBounds } from "./target.mjs";
import { resolveObstacleCollisions } from "./world.mjs";

function createProjectedEstimate(sourceEstimate, position, direction) {
  return {
    ...sourceEstimate,
    position: { ...position },
    direction: { ...direction },
    previousObservedDirection: sourceEstimate?.lastObservedDirection
      ? { ...sourceEstimate.lastObservedDirection }
      : sourceEstimate?.previousObservedDirection ?? null,
    lastObservedDirection: { ...direction },
  };
}

function hasActiveWallAvoidancePrediction(prediction) {
  return Boolean(prediction?.wallAvoidance || getWallAvoidanceSignal(prediction?.oscillators ?? []));
}

export function buildTargetProjectionPath({
  estimate,
  initialPrediction,
  horizonFrames,
  speedUnitsPerFrame,
  columns,
  rows,
  obstacles,
  wallAvoidanceEvidence,
}) {
  if (
    !estimate?.position
    || !Number.isFinite(horizonFrames)
    || !Number.isFinite(speedUnitsPerFrame)
    || horizonFrames <= 0
    || speedUnitsPerFrame <= 0
  ) {
    return [];
  }

  const samples = [];
  let position = { ...estimate.position };
  let direction = normalizeVector(
    initialPrediction?.direction?.x ?? estimate.direction?.x ?? 0,
    initialPrediction?.direction?.z ?? estimate.direction?.z ?? 0,
  );
  let projectedEstimate = createProjectedEstimate(estimate, position, direction);

  for (let index = 0; index < horizonFrames; index += 1) {
    const prediction = index === 0
      ? initialPrediction
      : predictTargetMotionWithKuramoto(projectedEstimate, {
        columns,
        rows,
        obstacles,
        wallAvoidanceEvidence,
      });
    const framesAhead = index + 1;
    direction = normalizeVector(
      prediction?.direction?.x ?? direction.x,
      prediction?.direction?.z ?? direction.z,
    );
    const useWallAvoidanceModel = hasActiveWallAvoidancePrediction(prediction);
    if (useWallAvoidanceModel) {
      direction = constrainDirectionToBounds(position, direction, columns, rows);
    }

    const intendedPosition = {
      x: position.x + direction.x * speedUnitsPerFrame,
      z: position.z + direction.z * speedUnitsPerFrame,
    };
    const nextPosition = obstacles
      ? resolveObstacleCollisions(intendedPosition, position, columns, rows, obstacles)
      : intendedPosition;

    samples.push({
      index,
      framesAhead,
      position: nextPosition,
      direction,
      prediction,
    });

    position = nextPosition;
    projectedEstimate = createProjectedEstimate(projectedEstimate, position, direction);
  }

  return samples;
}
