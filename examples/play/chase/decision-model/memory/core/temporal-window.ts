import type { MemoryFrameIndex } from "./interfaces.ts";

export { normalizeRetentionPolicy } from "./retention-policy.ts";

/**
 * Resolves a frame index from explicit input or previous memory state.
 */
export function resolveFrameIndex(
  frameIndex: unknown,
  previousFrameIndex: unknown = null,
): number {
  if (Number.isFinite(frameIndex)) {
    return Number(frameIndex);
  }
  return Number.isFinite(previousFrameIndex)
    ? Number(previousFrameIndex) + 1
    : 0;
}

/**
 * Returns `null` when either side of an age calculation is unknown.
 */
export function getFrameAge(
  currentFrameIndex: unknown,
  observedFrameIndex: unknown,
): number | null {
  return Number.isFinite(currentFrameIndex) && Number.isFinite(observedFrameIndex)
    ? Math.max(0, Number(currentFrameIndex) - Number(observedFrameIndex))
    : null;
}

/**
 * Keeps entries whose frame value is within the configured temporal window.
 */
export function pruneEntriesByFrameAge<TEntry>(
  entries: TEntry[] = [],
  {
    currentFrameIndex,
    getFrameIndex,
    maxAgeFrames = null,
  }: {
    currentFrameIndex: MemoryFrameIndex;
    getFrameIndex: (entry: TEntry) => unknown;
    maxAgeFrames?: number | null;
  },
): TEntry[] {
  if (!Number.isFinite(currentFrameIndex) || !Number.isFinite(maxAgeFrames)) {
    return [...entries];
  }
  return entries.filter((entry) => {
    const ageFrames = getFrameAge(currentFrameIndex, getFrameIndex(entry));
    return ageFrames !== null && ageFrames <= Number(maxAgeFrames);
  });
}

/**
 * Keeps only the most recent entries after temporal pruning.
 */
export function limitEntries<TEntry>(
  entries: TEntry[] = [],
  maxEntries: number | null = null,
): TEntry[] {
  if (!Number.isFinite(maxEntries) || Number(maxEntries) <= 0) {
    return [...entries];
  }
  return entries.slice(-Math.floor(Number(maxEntries)));
}
