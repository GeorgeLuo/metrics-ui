import {
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../core/math.ts";
import { createEvidenceRecord } from "./evidence-record.ts";
import type {
  EvidenceRecord,
  SampledVector,
} from "./interfaces.ts";

type SampledVectorEvidencePayload = {
  observedPosition: SampledVector;
  moved: boolean;
  moveDistance: number;
  moveDirection: SampledVector | null;
};

/**
 * Generic sampled vector memory for deriving motion from repeated observations.
 */
export type SampledVectorSignalMemory = {
  observationCount: number;
  motionObservationCount: number;
  lastObservedPosition: SampledVector | null;
  lastObservedDirection: SampledVector;
  previousObservedDirection: SampledVector | null;
  observedTurnRadiansPerFrame: number;
};

/**
 * Creates sampled vector state with an optional initial direction.
 */
export function createSampledVectorSignalMemory(
  initialDirection: SampledVector = { x: 0, z: 0 },
): SampledVectorSignalMemory {
  return {
    observationCount: 0,
    motionObservationCount: 0,
    lastObservedPosition: null,
    lastObservedDirection: initialDirection ? { ...initialDirection } : { x: 0, z: 0 },
    previousObservedDirection: null,
    observedTurnRadiansPerFrame: 0,
  };
}

/**
 * Updates vector-signal state from a newly observed position.
 */
export function updateSampledVectorSignalMemory(
  memory: SampledVectorSignalMemory | null | undefined,
  {
    observedPosition,
    observationGapFrames = 1,
    minMoveDistance = 0,
  }: {
    observedPosition?: SampledVector | null;
    observationGapFrames?: number;
    minMoveDistance?: number;
  } = {},
): {
  moved: boolean;
  moveDistance: number;
  moveDirection: SampledVector | null;
  observationGapFrames: number;
  evidence: EvidenceRecord<SampledVectorEvidencePayload>;
} | null {
  if (!memory || !observedPosition) {
    return null;
  }

  memory.observationCount += 1;
  const gapFrames = Math.max(1, Number(observationGapFrames) || 1);
  let moved = false;
  let moveDistance = 0;
  let moveDirection: SampledVector | null = null;

  if (memory.lastObservedPosition) {
    const deltaX = observedPosition.x - memory.lastObservedPosition.x;
    const deltaZ = observedPosition.z - memory.lastObservedPosition.z;
    moveDistance = Math.hypot(deltaX, deltaZ);
    if (moveDistance >= Math.max(0, Number(minMoveDistance) || 0)) {
      moved = true;
      moveDirection = normalizeVector(deltaX, deltaZ);
      const previousObservedDirection = memory.lastObservedDirection
        ? { ...memory.lastObservedDirection }
        : null;
      memory.previousObservedDirection = previousObservedDirection;
      memory.lastObservedDirection = moveDirection;
      memory.observedTurnRadiansPerFrame = previousObservedDirection
        ? normalizeAngleDelta(
          vectorToAngle(moveDirection) - vectorToAngle(previousObservedDirection),
        ) / gapFrames
        : 0;
      memory.motionObservationCount += 1;
    }
  }

  memory.lastObservedPosition = { ...observedPosition };

  return {
    moved,
    moveDistance,
    moveDirection,
    observationGapFrames: gapFrames,
    evidence: createEvidenceRecord(
      "sampled-vector",
      {
        observedPosition: { ...observedPosition },
        moved,
        moveDistance,
        moveDirection,
      },
      {
        confidence: moved ? 1 : 0.5,
      },
    ),
  };
}
