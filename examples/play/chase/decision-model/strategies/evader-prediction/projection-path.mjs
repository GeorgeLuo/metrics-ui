import { normalizeVector } from "../../core/math.ts";
import { predictEvaderMotionWithKuramoto } from "./motion-prediction.mjs";
import { getWallAvoidanceSignal } from "./signals.mjs";
import { constrainDirectionToBounds } from "../../../actors/evader/evader.mjs";
import { resolveObstacleCollisions } from "../../../world/world.mjs";

function createProjectedEstimate(sourceEstimate, position, direction, framesSinceObservation) {
  return {
    ...sourceEstimate,
    position: { ...position },
    direction: { ...direction },
    framesSinceObservation,
    previousObservedDirection: sourceEstimate?.lastObservedDirection
      ? { ...sourceEstimate.lastObservedDirection }
      : sourceEstimate?.previousObservedDirection ?? null,
    lastObservedDirection: { ...direction },
  };
}

function hasActiveWallAvoidancePrediction(prediction) {
  return Boolean(prediction?.wallAvoidance || getWallAvoidanceSignal(prediction?.oscillators ?? []));
}

export function buildEvaderProjectionPath({
  estimate,
  initialPrediction,
  predictMotion = predictEvaderMotionWithKuramoto,
  horizonFrames,
  sampleSpacingFrames,
  speedUnitsPerFrame,
  columns,
  rows,
  obstacles,
  wallAvoidanceEvidence,
}) {
  if (
    !estimate?.position
    || !Number.isFinite(horizonFrames)
    || !Number.isFinite(sampleSpacingFrames)
    || !Number.isFinite(speedUnitsPerFrame)
    || horizonFrames <= 0
    || sampleSpacingFrames <= 0
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
  let projectedEstimate = createProjectedEstimate(
    estimate,
    position,
    direction,
    Number(estimate?.framesSinceObservation) || 0,
  );

  for (let frame = 1; frame <= horizonFrames; frame += 1) {
    const prediction = frame === 1
      ? initialPrediction
      : predictMotion(projectedEstimate, {
        columns,
        rows,
        obstacles,
        wallAvoidanceEvidence,
      });
    direction = normalizeVector(
      prediction?.direction?.x ?? direction.x,
      prediction?.direction?.z ?? direction.z,
    );
    if (hasActiveWallAvoidancePrediction(prediction)) {
      direction = constrainDirectionToBounds(position, direction, columns, rows);
    }

    const intendedPosition = {
      x: position.x + direction.x * speedUnitsPerFrame,
      z: position.z + direction.z * speedUnitsPerFrame,
    };
    const nextPosition = obstacles
      ? resolveObstacleCollisions(intendedPosition, position, columns, rows, obstacles)
      : intendedPosition;

    position = nextPosition;
    projectedEstimate = createProjectedEstimate(projectedEstimate, position, direction, frame);

    if (frame % sampleSpacingFrames === 0 || frame === horizonFrames) {
      samples.push({
        index: samples.length,
        framesAhead: frame,
        position,
        direction,
        prediction,
      });
    }
  }

  return samples;
}
