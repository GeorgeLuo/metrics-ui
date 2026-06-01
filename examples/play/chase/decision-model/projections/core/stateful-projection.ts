/**
 * Creates a stateful projection module with opaque internal state.
 *
 * Projection modules infer future state from memory and patterns. The wrapper
 * stores module state, derives one output per frame, and exposes small accessors
 * for consumers that should not inspect the internal bookkeeping.
 */
export function createStatefulProjection<TState, TOutput>({
  id,
  createState,
  createOutput,
  deriveOutput,
  getConfidence,
  isActionable,
}: {
  id: string;
  createState?: () => TState;
  createOutput?: () => TOutput;
  deriveOutput?: (state: TState | null, context: Record<string, unknown>) => TOutput;
  getConfidence?: (output: TOutput | null, state: TState | null) => number;
  isActionable?: (output: TOutput | null, state: TState | null) => boolean;
}) {
  const projection = {
    id,
    state: typeof createState === "function" ? createState() : null,
    output: typeof createOutput === "function" ? createOutput() : null,
    update(context: Record<string, unknown>) {
      if (typeof deriveOutput === "function") {
        projection.output = deriveOutput(projection.state, context);
      }
      return projection.output;
    },
    getOutput() {
      return projection.output;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(projection.output, projection.state)) || 0;
      }
      return 0;
    },
    isActionable() {
      if (typeof isActionable === "function") {
        return Boolean(isActionable(projection.output, projection.state));
      }
      return true;
    },
  };

  return projection;
}

/**
 * Advances a projection module if it exposes the stateful projection contract.
 */
export function updateProjection<TOutput>(
  projection: { update?: (context: Record<string, unknown>) => TOutput | null } | null | undefined,
  context: Record<string, unknown>,
): TOutput | null {
  if (!projection || typeof projection.update !== "function") {
    return null;
  }
  return projection.update(context);
}

/**
 * Reads projection-internal state for diagnostics.
 */
export function getProjectionState<TState>(
  projection: { state?: TState | null } | null | undefined,
): TState | null {
  return projection?.state ?? null;
}

/**
 * Reads the latest projection output.
 */
export function getProjectionOutput<TOutput>(
  projection: {
    output?: TOutput | null;
    getOutput?: () => TOutput | null;
  } | null | undefined,
): TOutput | null {
  if (!projection) {
    return null;
  }
  if (typeof projection.getOutput === "function") {
    return projection.getOutput();
  }
  return projection?.output ?? null;
}

/**
 * Reads projection confidence from a stateful module.
 */
export function getProjectionConfidence(
  projection: { getConfidence?: () => number } | null | undefined,
): number {
  if (!projection) {
    return 0;
  }
  if (typeof projection.getConfidence === "function") {
    return Number(projection.getConfidence()) || 0;
  }
  return 0;
}

/**
 * Reads whether a projection currently has actionable output.
 */
export function isProjectionActionable(
  projection: { isActionable?: () => boolean } | null | undefined,
): boolean {
  if (!projection) {
    return false;
  }
  if (typeof projection.isActionable === "function") {
    return Boolean(projection.isActionable());
  }
  return true;
}
