import type { ProjectionPredictionSignal } from "./interfaces.ts";
import type { VectorXZ } from "../../core/math.ts";

/**
 * Creates a normalized confidence value in the shared projection range.
 */
export function clampConfidence(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.min(1, Math.max(0, numericValue))
    : 0;
}

/**
 * Converts a raw sample count into confidence.
 *
 * `fullConfidenceSampleCount` is the count where evidence should saturate at
 * 1.0; smaller counts scale linearly and invalid inputs produce no confidence.
 */
export function getSampleConfidence(
  sampleCount: unknown,
  fullConfidenceSampleCount: unknown,
): number {
  const samples = Number(sampleCount);
  const fullConfidenceSamples = Number(fullConfidenceSampleCount);
  if (!Number.isFinite(samples) || !Number.isFinite(fullConfidenceSamples) || fullConfidenceSamples <= 0) {
    return 0;
  }
  return clampConfidence(samples / fullConfidenceSamples);
}

/**
 * Combines a success ratio with evidence volume.
 *
 * This is useful when a projection needs both a high hit rate and enough
 * opportunities before it should affect consensus strongly.
 */
export function getRatioConfidence(
  successCount: unknown,
  possibleCount: unknown,
  fullConfidenceSampleCount: unknown,
): number {
  const successes = Number(successCount);
  const possible = Number(possibleCount);
  if (!Number.isFinite(successes) || !Number.isFinite(possible) || possible <= 0) {
    return 0;
  }
  return clampConfidence(successes / possible)
    * getSampleConfidence(possible, fullConfidenceSampleCount);
}

/**
 * Builds one projection-consensus input from raw predictor output.
 *
 * A zero-confidence signal is dropped by returning `null`; callers can build
 * arrays with optional signals and filter out inactive predictors.
 */
export function createPredictionSignal({
  id,
  direction,
  baseWeight,
  confidence,
  metadata = {},
}: {
  id: string;
  direction: VectorXZ | null | undefined;
  baseWeight: unknown;
  confidence: unknown;
  metadata?: Record<string, unknown>;
}): ProjectionPredictionSignal | null {
  const normalizedConfidence = clampConfidence(confidence);
  if (normalizedConfidence <= 0) {
    return null;
  }
  return {
    id,
    direction,
    confidence: normalizedConfidence,
    weight: Math.max(0, Number(baseWeight) || 0) * normalizedConfidence,
    ...metadata,
  };
}
