/**
 * Minimal time key for memory updates in a frame-based environment.
 */
export type MemoryFrameIndex = number | null;

/**
 * Free-form evidence payload retained by temporal memory primitives.
 */
export type EvidencePayload = Record<string, unknown>;

/**
 * One timestamped observation or outcome available to a decision model.
 */
export type EvidenceRecord<TPayload = EvidencePayload> = {
  id: string;
  frameIndex: MemoryFrameIndex;
  source?: string;
  confidence?: number;
  payload: TPayload;
};

/**
 * Persistent fact keyed by id with first/last observation metadata.
 */
export type BeliefRecord<TPayload = EvidencePayload> = {
  id: string;
  firstObservedFrame: MemoryFrameIndex;
  lastObservedFrame: MemoryFrameIndex;
  confidence?: number;
  payload: TPayload;
};

/**
 * Base shape for durable environment facts observed over time.
 */
export type TemporalRecordBase = {
  id: string;
  firstObservedFrame: MemoryFrameIndex;
  lastObservedFrame: MemoryFrameIndex;
  observationCount?: number;
};

/**
 * Retention policy for temporal memory collections.
 */
export type RetentionPolicy = {
  maxAgeFrames?: number | null;
  maxEntries?: number | null;
};

/**
 * Two-dimensional sampled value used by motion memory.
 */
export type SampledVector = {
  x: number;
  z: number;
};
