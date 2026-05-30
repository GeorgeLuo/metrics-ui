import type { RetentionPolicy } from "./interfaces.ts";

/**
 * Normalizes optional retention configuration for temporal memory collections.
 */
export function normalizeRetentionPolicy({
  maxAgeFrames = null,
  maxEntries = null,
}: RetentionPolicy = {}): Required<RetentionPolicy> {
  return {
    maxAgeFrames: Number.isFinite(maxAgeFrames) && Number(maxAgeFrames) >= 0
      ? Math.floor(Number(maxAgeFrames))
      : null,
    maxEntries: Number.isFinite(maxEntries) && Number(maxEntries) >= 0
      ? Math.floor(Number(maxEntries))
      : null,
  };
}
