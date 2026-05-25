import { CAR_BOUND_RADIUS } from "../../../config/constants.mjs";

export const SUCCESS_METRICS_ROLLING_WINDOW_FRAMES = 600;

function hasPosition(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.z);
}

function getOutcomeFrameIndex(memory, frameIndex) {
  return Number.isFinite(frameIndex)
    ? frameIndex
    : Number.isFinite(memory?.lastFrameIndex)
      ? memory.lastFrameIndex + 1
      : 0;
}

function getTouchActive({
  chaserPosition,
  evaderPosition,
  evaderExists = true,
  touchRadius = CAR_BOUND_RADIUS * 2,
} = {}) {
  if (
    evaderExists === false
    || !hasPosition(chaserPosition)
    || !hasPosition(evaderPosition)
  ) {
    return false;
  }

  return Math.hypot(
    chaserPosition.x - evaderPosition.x,
    chaserPosition.z - evaderPosition.z,
  ) <= touchRadius;
}

function pruneRecentTouchFrames(memory, frameIndex) {
  const rollingWindowFrames = Math.max(
    1,
    Math.floor(Number(memory.rollingWindowFrames) || SUCCESS_METRICS_ROLLING_WINDOW_FRAMES),
  );
  memory.rollingWindowFrames = rollingWindowFrames;
  const oldestIncludedFrameIndex = frameIndex - rollingWindowFrames + 1;
  memory.recentTouchFrameIndices = memory.recentTouchFrameIndices.filter(
    (touchFrameIndex) => touchFrameIndex >= oldestIncludedFrameIndex,
  );
}

function updateRates(memory) {
  memory.touchRatePerThousandFrames = memory.elapsedFrames > 0
    ? (memory.touchCount / memory.elapsedFrames) * 1000
    : 0;

  const rollingElapsedFrames = Math.min(
    memory.elapsedFrames,
    memory.rollingWindowFrames,
  );
  memory.rollingTouchCount = memory.recentTouchFrameIndices.length;
  memory.rollingTouchRatePerThousandFrames = rollingElapsedFrames > 0
    ? (memory.rollingTouchCount / rollingElapsedFrames) * 1000
    : 0;
}

export function createChaserSuccessMetricsMemory({
  rollingWindowFrames = SUCCESS_METRICS_ROLLING_WINDOW_FRAMES,
} = {}) {
  return {
    elapsedFrames: 0,
    targetPresentFrames: 0,
    touchCount: 0,
    touchRatePerThousandFrames: 0,
    evaderTouchActive: false,
    framesSinceLastTouch: null,
    lastTouchFrameIndex: null,
    lastFrameIndex: null,
    rollingWindowFrames,
    rollingTouchCount: 0,
    rollingTouchRatePerThousandFrames: 0,
    recentTouchFrameIndices: [],
  };
}

export function updateChaserSuccessMetricsMemory(
  memory,
  {
    chaserPosition,
    evaderPosition,
    evaderExists = true,
    frameIndex,
    touchRadius,
  } = {},
) {
  if (!memory) {
    return null;
  }

  const outcomeFrameIndex = getOutcomeFrameIndex(memory, frameIndex);
  const targetPresent = evaderExists !== false && hasPosition(evaderPosition);
  const evaderTouchActive = getTouchActive({
    chaserPosition,
    evaderPosition,
    evaderExists,
    touchRadius,
  });
  const isNewTouch = evaderTouchActive && !memory.evaderTouchActive;

  memory.elapsedFrames += 1;
  if (targetPresent) {
    memory.targetPresentFrames += 1;
  }

  if (isNewTouch) {
    memory.touchCount += 1;
    memory.lastTouchFrameIndex = outcomeFrameIndex;
    memory.recentTouchFrameIndices.push(outcomeFrameIndex);
  }

  memory.evaderTouchActive = evaderTouchActive;
  memory.framesSinceLastTouch = memory.lastTouchFrameIndex === null
    ? null
    : evaderTouchActive
      ? 0
      : Math.max(0, outcomeFrameIndex - memory.lastTouchFrameIndex);
  memory.lastFrameIndex = outcomeFrameIndex;

  pruneRecentTouchFrames(memory, outcomeFrameIndex);
  updateRates(memory);

  return memory;
}
