import {
  EVADER_PREDICTION_KURAMOTO_COUPLING,
  EVADER_PREDICTION_KURAMOTO_ITERATIONS,
} from "../../../../config/constants.mjs";
import { runKuramotoConsensus } from "../../../core/kuramoto.ts";
import { normalizeVector } from "../../../core/math.ts";
import { resolveObstacleCollisions } from "../../../../world/world.mjs";
import { clonePosition, cloneVector } from "./sample-utils.ts";
import type { ProjectionPrediction } from "../../core/interfaces.ts";
import type { VectorXZ } from "../../../core/math.ts";
import type {
  EvaderMotionEstimate,
  EvaderPatternProjectionSample,
  EvaderProjectionWorldContext,
  PatternProjectionUnit,
  PatternProjectionUnitMap,
  RectifiedProjectionFrame,
} from "./interfaces.ts";

const RECTIFICATION_STRATEGY_ID = "rectified-evader-projection";

/**
 * Reads the future frame offset from either pattern or projection sample shape.
 */
function getPredictionFrameOffset(sample: Record<string, any> | null | undefined): number | null {
  const frameOffset = Number(sample?.frameOffset ?? sample?.framesAhead);
  return Number.isFinite(frameOffset) && frameOffset > 0
    ? Math.max(1, Math.floor(frameOffset))
    : null;
}

/**
 * Normalizes one pattern-produced projection sample.
 */
function clonePatternPredictionSample(
  patternId: string,
  patternUnit: PatternProjectionUnit | null | undefined,
  sample: Record<string, any> | null | undefined,
  index: number,
): EvaderPatternProjectionSample | null {
  const frameOffset = getPredictionFrameOffset(sample);
  const position = clonePosition(sample?.position ?? sample?.predictedPosition);
  if (!frameOffset || !position) {
    return null;
  }

  return {
    index,
    framesAhead: frameOffset,
    frameOffset,
    position,
    direction: cloneVector(sample?.direction ?? sample?.predictedDirection),
    prediction: sample?.prediction ?? null,
    confidence: Number.isFinite(Number(sample?.confidence))
      ? Math.max(0, Math.min(1, Number(sample?.confidence)))
      : 0,
    confidenceParts: sample?.confidenceParts ?? null,
    metadata: sample?.metadata ?? {},
    sourcePatternId: sample?.sourcePatternId ?? patternUnit?.id ?? patternId,
  };
}

/**
 * Flattens all pattern-owned future samples into one projection input list.
 */
function getPatternPredictionSamples(
  patternUnits: PatternProjectionUnitMap | null | undefined,
): EvaderPatternProjectionSample[] {
  return Object.entries(patternUnits ?? {}).flatMap(([patternId, patternUnit]) => {
    const predictions = Array.isArray(patternUnit?.predictions)
      ? patternUnit.predictions
      : [];
    return predictions
      .map((sample, index) => clonePatternPredictionSample(
        patternId,
        patternUnit,
        sample,
        index,
      ))
      .filter((sample): sample is EvaderPatternProjectionSample => sample !== null);
  });
}

/**
 * Lists unique pattern ids that contributed to a rectified projection frame.
 */
function getSourcePatternIds(samples: EvaderPatternProjectionSample[]): string[] {
  return [...new Set(
    samples
      .map((sample) => sample.sourcePatternId)
      .filter(Boolean),
  )].sort();
}

/**
 * Chooses a stable debug strategy label for a rectified prediction.
 */
function getRectifiedStrategyId(sourcePatternIds: string[]): string {
  if (sourcePatternIds.length === 1 && sourcePatternIds[0] === "continuance") {
    return "continuance-default";
  }
  if (sourcePatternIds.length === 1 && sourcePatternIds[0] === "wallAvoidance") {
    return "wall-avoidance-intercept";
  }
  return RECTIFICATION_STRATEGY_ID;
}

/**
 * Combines independent pattern confidences into one frame confidence.
 */
function combinePredictionConfidence(samples: EvaderPatternProjectionSample[]): number {
  return Math.max(
    0,
    Math.min(
      1,
      1 - samples.reduce((missProbability, sample) => {
        const confidence = Number.isFinite(sample?.confidence)
          ? Math.max(0, Math.min(1, sample.confidence))
          : 0;
        return missProbability * (1 - confidence);
      }, 1),
    ),
  );
}

/**
 * Uses the strongest pattern sample as the fallback position for a frame.
 */
function getHighestConfidencePosition(samples: EvaderPatternProjectionSample[]): VectorXZ | null {
  const selectedSample = [...samples].sort((first, second) => {
    const confidenceDelta = second.confidence - first.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return String(first.sourcePatternId).localeCompare(String(second.sourcePatternId));
  })[0];
  return clonePosition(selectedSample?.position);
}

/**
 * Measures world-space distance between two projected positions.
 */
function getDistance(
  first: VectorXZ | null | undefined,
  second: VectorXZ | null | undefined,
): number {
  return first && second
    ? Math.hypot(first.x - second.x, first.z - second.z)
    : 0;
}

/**
 * Computes confidence-weighted displacement magnitude from a reference point.
 */
function getWeightedDistance(
  samples: EvaderPatternProjectionSample[],
  referencePosition: VectorXZ | null | undefined,
): number {
  if (!referencePosition) {
    return 0;
  }
  const totalWeight = samples.reduce((sum, sample) => sum + sample.confidence, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return samples.reduce(
    (sum, sample) => sum + getDistance(referencePosition, sample.position) * sample.confidence,
    0,
  ) / totalWeight;
}

/**
 * Gets the direction from current estimate to a future sample.
 */
function getDisplacementDirection(
  sample: EvaderPatternProjectionSample,
  referencePosition: VectorXZ | null | undefined,
): VectorXZ | null {
  if (referencePosition && sample?.position) {
    const direction = normalizeVector(
      sample.position.x - referencePosition.x,
      sample.position.z - referencePosition.z,
    );
    if (direction.x !== 0 || direction.z !== 0) {
      return direction;
    }
  }
  return sample?.direction ? cloneVector(sample.direction) : null;
}

/**
 * Mixes pattern-provided directions for one future frame.
 */
function runPredictionDirectionConsensus(
  samples: EvaderPatternProjectionSample[],
  getDirection: (sample: EvaderPatternProjectionSample) => VectorXZ | null,
): VectorXZ {
  const consensusInputs = samples
    .map((sample) => ({
      id: sample.sourcePatternId,
      direction: getDirection(sample),
      confidence: sample.confidence,
      weight: sample.confidence,
    }))
    .filter((sample) => sample.direction && sample.confidence > 0);
  const consensus = runKuramotoConsensus(consensusInputs, {
    coupling: EVADER_PREDICTION_KURAMOTO_COUPLING,
    iterations: EVADER_PREDICTION_KURAMOTO_ITERATIONS,
  });
  return consensus.direction.x === 0 && consensus.direction.z === 0
    ? { x: 0, z: 0 }
    : consensus.direction;
}

/**
 * Checks whether the projection has enough remembered world shape to resolve
 * collisions.
 */
function canResolveWorldContext(worldContext: EvaderProjectionWorldContext): boolean {
  return Boolean(worldContext?.obstacles)
    && Number.isFinite(worldContext.columns)
    && Number.isFinite(worldContext.rows);
}

/**
 * Builds one consensus position from pattern positions and displacement
 * direction.
 */
function buildConsensusPosition(
  samples: EvaderPatternProjectionSample[],
  referencePosition: VectorXZ | null | undefined,
  worldContext: EvaderProjectionWorldContext,
): VectorXZ | null {
  const fallbackPosition = getHighestConfidencePosition(samples);
  if (!referencePosition) {
    return fallbackPosition;
  }

  const displacementDirection = runPredictionDirectionConsensus(
    samples,
    (sample) => getDisplacementDirection(sample, referencePosition),
  );
  const distance = getWeightedDistance(samples, referencePosition);
  const projectedPosition = displacementDirection.x === 0 && displacementDirection.z === 0
    ? fallbackPosition
    : {
      x: referencePosition.x + displacementDirection.x * distance,
      z: referencePosition.z + displacementDirection.z * distance,
    };
  if (!projectedPosition) {
    return null;
  }

  return canResolveWorldContext(worldContext)
    ? resolveObstacleCollisions(
      projectedPosition,
      referencePosition,
      worldContext.columns as number,
      worldContext.rows as number,
      worldContext.obstacles,
    )
    : projectedPosition;
}

/**
 * Rectifies all pattern samples for one future frame into a single sample.
 */
function rectifyPredictionFrame(
  frameOffset: number,
  samples: EvaderPatternProjectionSample[],
  {
    referencePosition = null,
    worldContext = {},
  }: {
    referencePosition?: VectorXZ | null;
    worldContext?: EvaderProjectionWorldContext;
  } = {},
): RectifiedProjectionFrame | null {
  const usableSamples = samples
    .filter((sample) => sample?.position && sample.confidence > 0);
  if (usableSamples.length === 0) {
    return null;
  }

  const sourcePatternIds = getSourcePatternIds(usableSamples);
  const confidence = combinePredictionConfidence(usableSamples);
  const direction = runPredictionDirectionConsensus(
    usableSamples,
    (sample) => sample.direction ?? null,
  );
  const wallAvoidancePrediction = usableSamples.find(
    (sample) => sample.sourcePatternId === "wallAvoidance" && sample.prediction?.wallAvoidance,
  )?.prediction ?? null;
  const position = buildConsensusPosition(usableSamples, referencePosition, worldContext);
  if (!position) {
    return null;
  }

  return {
    framesAhead: frameOffset,
    frameOffset,
    position,
    direction,
    confidence,
    confidenceParts: {
      model: "pattern-prediction-rectification",
      confidence,
      sourceCount: sourcePatternIds.length,
      sourcePatternIds,
    },
    prediction: {
      strategy: getRectifiedStrategyId(sourcePatternIds),
      direction,
      consensus: confidence,
      oscillators: usableSamples.map((sample) => ({
        id: sample.sourcePatternId,
        direction: cloneVector(sample.direction),
        confidence: sample.confidence,
        weight: sample.confidence,
      })),
      sourcePatternIds,
      wallAvoidance: wallAvoidancePrediction?.wallAvoidance ?? null,
      actionable: true,
    },
    sourcePatternIds,
    sourcePredictions: usableSamples.map((sample) => ({
      sourcePatternId: sample.sourcePatternId,
      position: clonePosition(sample.position),
      direction: cloneVector(sample.direction),
      confidence: sample.confidence,
      confidenceParts: sample.confidenceParts,
      metadata: sample.metadata,
      prediction: sample.prediction,
    })),
  };
}

/**
 * Rectifies each future frame across every pattern predictor.
 */
export function buildRectifiedPredictionPath(
  patternUnits: PatternProjectionUnitMap | null | undefined,
  {
    estimate,
    worldContext = {},
  }: {
    estimate?: EvaderMotionEstimate | null;
    worldContext?: EvaderProjectionWorldContext;
  } = {},
): RectifiedProjectionFrame[] {
  const samples = getPatternPredictionSamples(patternUnits);
  const frameOffsets = [...new Set(samples.map((sample) => sample.frameOffset))]
    .sort((first, second) => first - second);

  const rectifiedFrames: RectifiedProjectionFrame[] = [];
  frameOffsets.forEach((frameOffset, index) => {
    const rectified = rectifyPredictionFrame(
      frameOffset,
      samples.filter((sample) => sample.frameOffset === frameOffset),
      {
        referencePosition: estimate?.position ?? null,
        worldContext,
      },
    );
    if (rectified) {
      rectifiedFrames.push({ ...rectified, index });
    }
  });
  return rectifiedFrames;
}

/**
 * Builds the compact direction-level prediction from the first path frame.
 */
export function buildRectifiedPrediction(path: RectifiedProjectionFrame[]): ProjectionPrediction {
  const firstSample = path?.[0] ?? null;
  if (!firstSample) {
    return {
      strategy: "pattern-predictions-unavailable",
      direction: { x: 0, z: 0 },
      consensus: 0,
      oscillators: [],
      sourcePatternIds: [],
      actionable: false,
    };
  }

  return {
    ...firstSample.prediction,
    direction: cloneVector(firstSample.direction) ?? { x: 0, z: 0 },
    consensus: Number(firstSample.confidence) || 0,
    sourcePatternIds: firstSample.sourcePatternIds,
    rectification: {
      model: firstSample.confidenceParts?.model ?? "pattern-prediction-rectification",
      sourcePatternIds: firstSample.sourcePatternIds,
      sourceCount: firstSample.sourcePatternIds.length,
    },
  };
}
