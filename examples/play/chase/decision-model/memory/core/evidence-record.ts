import type { EvidenceRecord, MemoryFrameIndex } from "./interfaces.ts";

/**
 * Creates a timestamped evidence record with normalized confidence.
 */
export function createEvidenceRecord<TPayload>(
  id: string,
  payload: TPayload,
  {
    frameIndex = null,
    source,
    confidence = 1,
  }: {
    frameIndex?: MemoryFrameIndex;
    source?: string;
    confidence?: number;
  } = {},
): EvidenceRecord<TPayload> {
  return {
    id,
    frameIndex,
    source,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, Number(confidence)))
      : 1,
    payload,
  };
}
