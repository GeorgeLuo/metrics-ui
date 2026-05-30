import { CAR_BOUND_RADIUS } from "../../../config/constants.mjs";
import {
  createEventTraceMemory,
  recordEventTraceFrame,
  type EventTraceMemory,
} from "../core/event-trace.ts";
import type { VectorXZ } from "../../core/math.ts";

/** Rolling frame window used for chaser success-rate diagnostics. */
export const SUCCESS_METRICS_ROLLING_WINDOW_FRAMES = 600;

/** Chaser-specific view of touch events and rolling success rates. */
export type ChaserSuccessMetricsMemory = {
  elapsedFrames: number;
  targetPresentFrames: number;
  touchCount: number;
  touchRatePerThousandFrames: number;
  evaderTouchActive: boolean;
  framesSinceLastTouch: number | null;
  lastTouchFrameIndex: number | null;
  lastFrameIndex: number | null;
  rollingWindowFrames: number;
  rollingTouchCount: number;
  rollingTouchRatePerThousandFrames: number;
  recentTouchFrameIndices: number[];
};

function hasPosition(position: VectorXZ | null | undefined): position is VectorXZ {
  return Number.isFinite(position?.x) && Number.isFinite(position?.z);
}

function getTouchActive({
  chaserPosition,
  evaderPosition,
  evaderExists = true,
  touchRadius = CAR_BOUND_RADIUS * 2,
}: {
  chaserPosition?: VectorXZ | null;
  evaderPosition?: VectorXZ | null;
  evaderExists?: boolean;
  touchRadius?: number;
} = {}): boolean {
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

function fromEventTrace(
  trace: EventTraceMemory,
  targetPresentFrames: number,
): ChaserSuccessMetricsMemory {
  return {
    elapsedFrames: trace.elapsedFrames,
    targetPresentFrames,
    touchCount: trace.eventCount,
    touchRatePerThousandFrames: trace.eventRatePerThousandFrames,
    evaderTouchActive: trace.eventActive,
    framesSinceLastTouch: trace.framesSinceLastEvent,
    lastTouchFrameIndex: trace.lastEventFrameIndex,
    lastFrameIndex: trace.lastFrameIndex,
    rollingWindowFrames: trace.rollingWindowFrames,
    rollingTouchCount: trace.rollingEventCount,
    rollingTouchRatePerThousandFrames: trace.rollingEventRatePerThousandFrames,
    recentTouchFrameIndices: [...trace.recentEventFrameIndices],
  };
}

function toEventTrace(memory: ChaserSuccessMetricsMemory): EventTraceMemory {
  return {
    elapsedFrames: Number(memory.elapsedFrames) || 0,
    eventCount: Number(memory.touchCount) || 0,
    eventRatePerThousandFrames: Number(memory.touchRatePerThousandFrames) || 0,
    eventActive: Boolean(memory.evaderTouchActive),
    framesSinceLastEvent: Number.isFinite(memory.framesSinceLastTouch)
      ? Number(memory.framesSinceLastTouch)
      : null,
    lastEventFrameIndex: Number.isFinite(memory.lastTouchFrameIndex)
      ? Number(memory.lastTouchFrameIndex)
      : null,
    lastFrameIndex: Number.isFinite(memory.lastFrameIndex)
      ? Number(memory.lastFrameIndex)
      : null,
    rollingWindowFrames: Math.max(
      1,
      Math.floor(Number(memory.rollingWindowFrames) || SUCCESS_METRICS_ROLLING_WINDOW_FRAMES),
    ),
    rollingEventCount: Number(memory.rollingTouchCount) || 0,
    rollingEventRatePerThousandFrames: Number(memory.rollingTouchRatePerThousandFrames) || 0,
    recentEventFrameIndices: Array.isArray(memory.recentTouchFrameIndices)
      ? memory.recentTouchFrameIndices.filter(Number.isFinite)
      : [],
  };
}

/**
 * Creates chaser success memory backed by a generic temporal event trace.
 */
export function createChaserSuccessMetricsMemory({
  rollingWindowFrames = SUCCESS_METRICS_ROLLING_WINDOW_FRAMES,
}: {
  rollingWindowFrames?: number;
} = {}): ChaserSuccessMetricsMemory {
  return fromEventTrace(
    createEventTraceMemory({ rollingWindowFrames }),
    0,
  );
}

/**
 * Records whether the chaser touched the evader on this committed frame.
 */
export function updateChaserSuccessMetricsMemory(
  memory: ChaserSuccessMetricsMemory | null | undefined,
  {
    chaserPosition,
    evaderPosition,
    evaderExists = true,
    frameIndex,
    touchRadius,
  }: {
    chaserPosition?: VectorXZ | null;
    evaderPosition?: VectorXZ | null;
    evaderExists?: boolean;
    frameIndex?: number | null;
    touchRadius?: number;
  } = {},
): ChaserSuccessMetricsMemory | null {
  if (!memory) {
    return null;
  }

  const trace = toEventTrace(memory);
  const targetPresent = evaderExists !== false && hasPosition(evaderPosition);
  if (targetPresent) {
    memory.targetPresentFrames += 1;
  }

  recordEventTraceFrame(trace, {
    eventActive: getTouchActive({
      chaserPosition,
      evaderPosition,
      evaderExists,
      touchRadius,
    }),
    frameIndex,
  });

  Object.assign(memory, fromEventTrace(trace, memory.targetPresentFrames));
  return memory;
}
