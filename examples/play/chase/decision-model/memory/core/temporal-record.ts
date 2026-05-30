import type {
  MemoryFrameIndex,
  TemporalRecordBase,
} from "./interfaces.ts";

/**
 * Converts an arbitrary frame-like value into the nullable frame key used by
 * temporal memory records.
 */
export function normalizeMemoryFrameIndex(frameIndex: unknown): MemoryFrameIndex {
  return Number.isFinite(frameIndex) ? Number(frameIndex) : null;
}

/**
 * Creates a durable fact record from an observed payload.
 */
export function createTemporalRecord<TPayload extends object>(
  id: string,
  payload: TPayload,
  frameIndex: unknown = null,
): TemporalRecordBase & TPayload {
  const observedFrame = normalizeMemoryFrameIndex(frameIndex);
  return {
    id,
    firstObservedFrame: observedFrame,
    lastObservedFrame: observedFrame,
    observationCount: 1,
    ...payload,
  };
}

/**
 * Merges observed records into a durable record collection keyed by id.
 */
export function upsertTemporalRecords<TRecord extends TemporalRecordBase>(
  existingRecords: TRecord[] = [],
  observedRecords: TRecord[] = [],
  {
    frameIndex = null,
    mergeRecord,
  }: {
    frameIndex?: unknown;
    mergeRecord?: (existingRecord: TRecord | null, observedRecord: TRecord) => TRecord;
  } = {},
): TRecord[] {
  const observedFrame = normalizeMemoryFrameIndex(frameIndex);
  const recordsById = new Map(existingRecords.map((record) => [record.id, record]));

  for (const observedRecord of observedRecords) {
    const existingRecord = recordsById.get(observedRecord.id) ?? null;
    const defaultMergedRecord = {
      ...(existingRecord ?? {}),
      ...observedRecord,
      firstObservedFrame: existingRecord?.firstObservedFrame
        ?? observedRecord.firstObservedFrame
        ?? observedFrame,
      lastObservedFrame: observedFrame ?? observedRecord.lastObservedFrame,
      observationCount: (Number(existingRecord?.observationCount) || 0) + 1,
    } as TRecord;
    recordsById.set(
      observedRecord.id,
      mergeRecord ? mergeRecord(existingRecord, defaultMergedRecord) : defaultMergedRecord,
    );
  }

  return [...recordsById.values()];
}
