import { normalizeVector } from "../../../core/math.ts";
import { predictEvaderMotionWithKuramoto } from "./motion-prediction.ts";
import { constrainDirectionToBounds } from "../../../../actors/evader/evader.mjs";
import { resolveObstacleCollisions } from "../../../../world/world.mjs";
import type { ProjectionSample } from "../../core/interfaces.ts";
import type { VectorXZ } from "../../../core/math.ts";
import type {
  EvaderMotionEstimate,
  EvaderMotionPrediction,
  EvaderMotionPredictor,
  EvaderProjectionObstacleLayout,
  WallAvoidanceEvidence,
} from "./interfaces.ts";

/**
 * Input required to roll an evader-motion estimate forward into sampled frames.
 */
export type EvaderProjectionPathOptions = {
  estimate?: EvaderMotionEstimate | null;
  initialPrediction?: EvaderMotionPrediction | null;
  predictMotion?: EvaderMotionPredictor;
  horizonFrames?: number;
  sampleSpacingFrames?: number;
  speedUnitsPerFrame?: number;
  columns?: number;
  rows?: number;
  obstacles?: EvaderProjectionObstacleLayout | null;
  wallAvoidanceEvidence?: WallAvoidanceEvidence | null;
};

/**
 * Clones the latest projected position/direction back into estimate form.
 */
function createProjectedEstimate(
  sourceEstimate: EvaderMotionEstimate | null | undefined,
  position: VectorXZ,
  direction: VectorXZ,
  framesSinceObservation: number,
): EvaderMotionEstimate {
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

/**
 * Checks whether wall avoidance is active in a prediction result.
 */
function hasActiveWallAvoidancePrediction(
  prediction: EvaderMotionPrediction | null | undefined,
): boolean {
  return Boolean(
    prediction?.wallAvoidance
    || prediction?.oscillators?.some((oscillator) => oscillator.id === "wall-avoidance"),
  );
}

/**
 * Rolls a motion estimate forward and records spaced future samples.
 *
 * The path builder uses projection-local obstacle knowledge, not scenario meta
 * knowledge. It only applies wall/bounds correction when wall avoidance is an
 * active part of the predicted behavior.
 */
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
}: EvaderProjectionPathOptions): ProjectionSample[] {
  if (
    !estimate?.position
    || !Number.isFinite(horizonFrames)
    || !Number.isFinite(sampleSpacingFrames)
    || !Number.isFinite(speedUnitsPerFrame)
    || Number(horizonFrames) <= 0
    || Number(sampleSpacingFrames) <= 0
    || Number(speedUnitsPerFrame) <= 0
  ) {
    return [];
  }

  const resolvedHorizonFrames = Math.floor(Number(horizonFrames));
  const resolvedSampleSpacingFrames = Math.floor(Number(sampleSpacingFrames));
  const resolvedSpeedUnitsPerFrame = Number(speedUnitsPerFrame);
  const resolvedColumns = Number(columns);
  const resolvedRows = Number(rows);
  const samples: ProjectionSample[] = [];
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

  for (let frame = 1; frame <= resolvedHorizonFrames; frame += 1) {
    const prediction = frame === 1
      ? initialPrediction
      : predictMotion(projectedEstimate, {
        columns: resolvedColumns,
        rows: resolvedRows,
        obstacles,
        wallAvoidanceEvidence,
      });
    direction = normalizeVector(
      prediction?.direction?.x ?? direction.x,
      prediction?.direction?.z ?? direction.z,
    );
    if (hasActiveWallAvoidancePrediction(prediction)) {
      direction = constrainDirectionToBounds(position, direction, resolvedColumns, resolvedRows);
    }

    const intendedPosition = {
      x: position.x + direction.x * resolvedSpeedUnitsPerFrame,
      z: position.z + direction.z * resolvedSpeedUnitsPerFrame,
    };
    const nextPosition = obstacles
      ? resolveObstacleCollisions(intendedPosition, position, resolvedColumns, resolvedRows, obstacles)
      : intendedPosition;

    position = nextPosition;
    projectedEstimate = createProjectedEstimate(projectedEstimate, position, direction, frame);

    if (frame % resolvedSampleSpacingFrames === 0 || frame === resolvedHorizonFrames) {
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
