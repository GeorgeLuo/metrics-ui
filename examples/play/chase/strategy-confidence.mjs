export function clampConfidence(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.min(1, Math.max(0, numericValue))
    : 0;
}

export function getSampleConfidence(sampleCount, fullConfidenceSampleCount) {
  const samples = Number(sampleCount);
  const fullConfidenceSamples = Number(fullConfidenceSampleCount);
  if (!Number.isFinite(samples) || !Number.isFinite(fullConfidenceSamples) || fullConfidenceSamples <= 0) {
    return 0;
  }
  return clampConfidence(samples / fullConfidenceSamples);
}

export function getRatioConfidence(successCount, possibleCount, fullConfidenceSampleCount) {
  const successes = Number(successCount);
  const possible = Number(possibleCount);
  if (!Number.isFinite(successes) || !Number.isFinite(possible) || possible <= 0) {
    return 0;
  }
  return clampConfidence(successes / possible)
    * getSampleConfidence(possible, fullConfidenceSampleCount);
}

export function createPredictionSignal({
  id,
  direction,
  baseWeight,
  confidence,
  metadata = {},
}) {
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
