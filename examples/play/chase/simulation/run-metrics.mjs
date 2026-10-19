import { CAR_BOUND_RADIUS } from "../config/constants.mjs";
import { getGroundBounds, isPositionInsideWall } from "../world/world.mjs";

export function createRunMetrics() {
  return {
    elapsedFrames: 0,
    touchCount: 0,
    touchRatePerThousandFrames: 0,
    evaderTouchActive: false,
    wallTouchCount: 0,
    wallTouchFrames: 0,
    wallTouchActive: false,
    wallTouchRatePerThousandFrames: 0,
  };
}

export function updateRunMetrics({ runMetrics, chaserPosition, evaderPosition, columns, rows, obstacles }) {
  if (!runMetrics) {
    return;
  }

  runMetrics.elapsedFrames += 1;
  // Match collision resolution: padded rectangles plus the ground clamp, including
  // invisible field bounds. Sustained contact or a corner is one contact episode.
  const bounds = getGroundBounds(columns, rows);
  const epsilon = 1e-9;
  const touchesWall = Boolean(chaserPosition) && (
    chaserPosition.x <= bounds.minX + epsilon
    || chaserPosition.x >= bounds.maxX - epsilon
    || chaserPosition.z <= bounds.minZ + epsilon
    || chaserPosition.z >= bounds.maxZ - epsilon
    || (obstacles?.walls ?? []).some((wall) => wall.boundary !== true
      && isPositionInsideWall(chaserPosition, wall, CAR_BOUND_RADIUS + epsilon))
  );
  if (touchesWall && !runMetrics.wallTouchActive) {
    runMetrics.wallTouchCount += 1;
  }
  if (touchesWall) {
    runMetrics.wallTouchFrames += 1;
  }
  runMetrics.wallTouchActive = touchesWall;
  runMetrics.wallTouchRatePerThousandFrames =
    (runMetrics.wallTouchCount / runMetrics.elapsedFrames) * 1000;
  if (!chaserPosition || !evaderPosition) {
    runMetrics.evaderTouchActive = false;
    runMetrics.touchRatePerThousandFrames = runMetrics.elapsedFrames > 0
      ? (runMetrics.touchCount / runMetrics.elapsedFrames) * 1000
      : 0;
    return;
  }

  const touchesTarget = Math.hypot(
    chaserPosition.x - evaderPosition.x,
    chaserPosition.z - evaderPosition.z,
  ) <= CAR_BOUND_RADIUS * 2;

  if (touchesTarget && !runMetrics.evaderTouchActive) {
    runMetrics.touchCount += 1;
  }
  runMetrics.evaderTouchActive = touchesTarget;
  runMetrics.touchRatePerThousandFrames = runMetrics.elapsedFrames > 0
    ? (runMetrics.touchCount / runMetrics.elapsedFrames) * 1000
    : 0;
}
