import type {
  BoundedEvaluatorControlAction,
  BoundedEvaluatorControlInput,
  BoundedEvaluatorControlReference,
} from "./atomic-capture.ts";

type RuntimeRecord = Record<string, any>;

function normalizeSource(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeSteering(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(-1, Math.min(1, numeric)) : 0;
}

function normalizeInput(value: RuntimeRecord | null, fallbackSource: string): BoundedEvaluatorControlInput {
  return {
    source: normalizeSource(value?.source, fallbackSource),
    forward: value?.forward === true,
    reverse: value?.reverse === true,
    steering: normalizeSteering(value?.steering),
  };
}

function normalizeAction(
  value: RuntimeRecord | null,
  fallbackSource: string,
): BoundedEvaluatorControlAction {
  return {
    ...normalizeInput(value, fallbackSource),
    selectedActionProposalId: typeof value?.selectedActionProposalId === "string"
      && value.selectedActionProposalId.trim()
      ? value.selectedActionProposalId.trim()
      : null,
  };
}

/**
 * Projects live simulation control state into a small evaluator-only contract.
 * Positions, map geometry, reasoning snapshots, and proposal collections are
 * intentionally not copied.
 */
export function buildActorControlReference(
  simulationState: RuntimeRecord,
  actorId: string,
): BoundedEvaluatorControlReference {
  const lastStep = simulationState?.lastStep ?? {};
  const isEvader = actorId === "evader";
  const controlSource = isEvader
    ? "programmatic"
    : normalizeSource(simulationState?.chaserControlSource, "programmatic");
  const fallbackSource = controlSource === "programmatic" ? "programmatic" : "human";
  const input = isEvader
    ? lastStep.evaderMovementDecision ?? null
    : lastStep.chaserInput ?? null;
  const action = isEvader
    ? lastStep.evaderMovementDecision ?? null
    : lastStep.chaserAction ?? null;
  const actionFrameIndex = Number.isInteger(lastStep.frameIndex)
    && Number(lastStep.frameIndex) >= 0
    ? Number(lastStep.frameIndex)
    : Math.max(0, Number(simulationState?.frameIndex) || 0);

  return {
    kind: "actor-control-reference",
    scenarioId: normalizeSource(simulationState?.scenario?.id, "unknown-scenario"),
    controlSource,
    phase: normalizeSource(lastStep.phase, "unknown"),
    actionFrameIndex,
    input: normalizeInput(input, fallbackSource),
    action: normalizeAction(action, fallbackSource),
  };
}
