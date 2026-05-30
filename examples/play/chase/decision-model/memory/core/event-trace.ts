import {
  applyRetentionPolicy,
  resolveFrameIndex,
} from "./temporal-window.ts";

/** Default rolling frame window for repeated-event memory. */
export const DEFAULT_EVENT_TRACE_ROLLING_WINDOW_FRAMES = 600;

/**
 * Generic frame-based event counter for temporal decision memory.
 */
export type EventTraceMemory = {
  elapsedFrames: number;
  eventCount: number;
  eventRatePerThousandFrames: number;
  eventActive: boolean;
  framesSinceLastEvent: number | null;
  lastEventFrameIndex: number | null;
  lastFrameIndex: number | null;
  rollingWindowFrames: number;
  rollingEventCount: number;
  rollingEventRatePerThousandFrames: number;
  recentEventFrameIndices: number[];
};

/**
 * Creates lifetime plus rolling-window counters for a repeated event.
 */
export function createEventTraceMemory({
  rollingWindowFrames = DEFAULT_EVENT_TRACE_ROLLING_WINDOW_FRAMES,
}: {
  rollingWindowFrames?: number;
} = {}): EventTraceMemory {
  return {
    elapsedFrames: 0,
    eventCount: 0,
    eventRatePerThousandFrames: 0,
    eventActive: false,
    framesSinceLastEvent: null,
    lastEventFrameIndex: null,
    lastFrameIndex: null,
    rollingWindowFrames,
    rollingEventCount: 0,
    rollingEventRatePerThousandFrames: 0,
    recentEventFrameIndices: [],
  };
}

function pruneRecentEvents(memory: EventTraceMemory, frameIndex: number): void {
  const rollingWindowFrames = Math.max(
    1,
    Math.floor(Number(memory.rollingWindowFrames) || DEFAULT_EVENT_TRACE_ROLLING_WINDOW_FRAMES),
  );
  memory.rollingWindowFrames = rollingWindowFrames;
  memory.recentEventFrameIndices = applyRetentionPolicy(memory.recentEventFrameIndices, {
    currentFrameIndex: frameIndex,
    getFrameIndex: (eventFrameIndex) => eventFrameIndex,
    retentionPolicy: {
      maxAgeFrames: rollingWindowFrames - 1,
      maxEntries: rollingWindowFrames,
    },
  });
}

function updateRates(memory: EventTraceMemory): void {
  memory.eventRatePerThousandFrames = memory.elapsedFrames > 0
    ? (memory.eventCount / memory.elapsedFrames) * 1000
    : 0;

  const rollingElapsedFrames = Math.min(
    memory.elapsedFrames,
    memory.rollingWindowFrames,
  );
  memory.rollingEventCount = memory.recentEventFrameIndices.length;
  memory.rollingEventRatePerThousandFrames = rollingElapsedFrames > 0
    ? (memory.rollingEventCount / rollingElapsedFrames) * 1000
    : 0;
}

/**
 * Records one frame of event activity.
 *
 * By default, `eventCount` increments only on a false -> true edge. Set
 * `countActiveFrame` when every active frame should count as a separate event.
 */
export function recordEventTraceFrame(
  memory: EventTraceMemory | null | undefined,
  {
    eventActive = false,
    frameIndex,
    countActiveFrame = false,
  }: {
    eventActive?: boolean;
    frameIndex?: number | null;
    countActiveFrame?: boolean;
  } = {},
): EventTraceMemory | null {
  if (!memory) {
    return null;
  }

  const outcomeFrameIndex = resolveFrameIndex(frameIndex, memory.lastFrameIndex);
  const active = Boolean(eventActive);
  const isNewEvent = active && (countActiveFrame || !memory.eventActive);

  memory.elapsedFrames += 1;
  if (isNewEvent) {
    memory.eventCount += 1;
    memory.lastEventFrameIndex = outcomeFrameIndex;
    memory.recentEventFrameIndices.push(outcomeFrameIndex);
  }

  memory.eventActive = active;
  memory.framesSinceLastEvent = memory.lastEventFrameIndex === null
    ? null
    : active
      ? 0
      : Math.max(0, outcomeFrameIndex - memory.lastEventFrameIndex);
  memory.lastFrameIndex = outcomeFrameIndex;

  pruneRecentEvents(memory, outcomeFrameIndex);
  updateRates(memory);

  return memory;
}
