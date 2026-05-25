export const DEFAULT_SUCCESS_RATE_THRESHOLDS = Object.freeze([1]);

function formatThreshold(threshold) {
  const numericThreshold = Number(threshold);
  return Number.isFinite(numericThreshold)
    ? String(Number(numericThreshold.toFixed(2)))
    : "unknown";
}

function getThresholdKey(threshold) {
  return formatThreshold(threshold);
}

function createThresholdSuccessStat(threshold, frameOffset = null) {
  const stat = {
    threshold,
    count: 0,
    successCount: 0,
  };
  if (Number.isFinite(frameOffset)) {
    stat.frameOffset = frameOffset;
  }
  return stat;
}

export function normalizeSuccessRateThresholds(thresholds) {
  const values = Array.isArray(thresholds) ? thresholds : DEFAULT_SUCCESS_RATE_THRESHOLDS;
  const normalized = [...new Set(values
    .map((threshold) => Number(threshold))
    .filter((threshold) => Number.isFinite(threshold) && threshold >= 0))]
    .sort((first, second) => first - second);
  return normalized.length > 0 ? normalized : [...DEFAULT_SUCCESS_RATE_THRESHOLDS];
}

export function createThresholdSuccessStats(thresholds) {
  return Object.fromEntries(
    normalizeSuccessRateThresholds(thresholds).map((threshold) => [
      getThresholdKey(threshold),
      createThresholdSuccessStat(threshold),
    ]),
  );
}

function addValidationToStat(stat, validation, threshold) {
  stat.count += 1;
  if (validation.positionError <= threshold) {
    stat.successCount += 1;
  }
}

function getFrameOffsetKey(frameOffset) {
  const numericFrameOffset = Number(frameOffset);
  return Number.isFinite(numericFrameOffset) && numericFrameOffset > 0
    ? String(Math.max(1, Math.floor(numericFrameOffset)))
    : null;
}

export function addThresholdSuccessValidation(state, validation) {
  if (!state.thresholdSuccessStats) {
    state.thresholdSuccessStats = createThresholdSuccessStats(
      state.options?.successRateThresholds,
    );
  }
  state.thresholdSuccessStatsByFrameOffset = state.thresholdSuccessStatsByFrameOffset ?? {};
  const thresholds = normalizeSuccessRateThresholds(state.options?.successRateThresholds);
  const frameOffsetKey = getFrameOffsetKey(validation.frameOffset);
  const frameOffset = frameOffsetKey === null ? null : Number(frameOffsetKey);
  for (const threshold of thresholds) {
    const thresholdKey = getThresholdKey(threshold);
    const stat = state.thresholdSuccessStats[thresholdKey] ?? createThresholdSuccessStat(threshold);
    addValidationToStat(stat, validation, threshold);
    state.thresholdSuccessStats[thresholdKey] = stat;

    if (frameOffsetKey !== null) {
      const horizonKey = `${thresholdKey}|${frameOffsetKey}`;
      const horizonStat = state.thresholdSuccessStatsByFrameOffset[horizonKey]
        ?? createThresholdSuccessStat(threshold, frameOffset);
      addValidationToStat(horizonStat, validation, threshold);
      state.thresholdSuccessStatsByFrameOffset[horizonKey] = horizonStat;
    }
  }
}

export function summarizeThresholdSuccessStat(stat) {
  return {
    threshold: stat.threshold,
    frameOffset: Number.isFinite(stat.frameOffset) ? stat.frameOffset : null,
    count: stat.count,
    successCount: stat.successCount,
    successRate: stat.count > 0 ? stat.successCount / stat.count : 0,
  };
}
