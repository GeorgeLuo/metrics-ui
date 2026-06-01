import type { VectorXZ } from "../../core/math.ts";

/**
 * Directional signal used by projection predictors before they are mixed.
 *
 * A projection signal is intentionally smaller than a full projection plan: it
 * carries a candidate direction, confidence, and weighted influence for a
 * consensus or selection method.
 */
export type ProjectionPredictionSignal = {
  id: string;
  direction: VectorXZ | null | undefined;
  confidence: number;
  weight: number;
  [key: string]: unknown;
};

/**
 * One projected future sample for an observed entity or world state.
 *
 * Projection samples are intentionally generic: the projection stage owns how a
 * sample is produced, while the action stage can consume the position, timing,
 * confidence, and metadata without understanding the underlying predictor.
 */
export type ProjectionSample = {
  index?: number;
  framesAhead: number;
  frameOffset?: number;
  position: VectorXZ | null;
  direction?: VectorXZ | null;
  confidence?: number;
  confidenceParts?: Record<string, unknown> | null;
  sourcePatternId?: string | null;
  sourcePatternIds?: string[];
  metadata?: Record<string, unknown>;
  prediction?: ProjectionPrediction | null;
};

/**
 * Direction-level summary produced by a projection.
 *
 * This is the compact signal actions can mix when they do not need the full
 * path. Projection-specific details remain in optional records so core
 * projection consumers do not become scenario-specific.
 */
export type ProjectionPrediction = {
  strategy: string;
  direction: VectorXZ;
  consensus: number;
  oscillators?: Array<Record<string, unknown>>;
  sourcePatternIds?: string[];
  actionable?: boolean;
  persisted?: boolean;
  wallAvoidance?: Record<string, unknown> | null;
  rectification?: Record<string, unknown> | null;
};

/**
 * Full future-state projection consumed by downstream action proposal builders.
 */
export type ProjectionPlan = {
  actionable: boolean;
  invalidReason: string | null;
  prediction: ProjectionPrediction;
  path: ProjectionSample[];
  sampleCount: number;
  sampleSpacingFrames: number;
  horizonFrames: number;
  validationErrorDistance: number;
  persisted?: boolean;
};

/**
 * Debug/status envelope for a stateful projection module.
 */
export type ProjectionStatus = {
  id: string;
  confidence: number;
  actionable: boolean;
};

/**
 * Stateful projection module contract.
 *
 * The state payload stays opaque because each projection owns its own predictor
 * and validation bookkeeping. Callers should use the output/status accessors
 * rather than reaching into `state`.
 */
export type StatefulProjection<TOutput = ProjectionPlan> = {
  id: string;
  state: unknown;
  output: TOutput | null;
  update: (context: Record<string, unknown>) => TOutput | null;
  getOutput: () => TOutput | null;
  getConfidence: () => number;
  isActionable: () => boolean;
};
