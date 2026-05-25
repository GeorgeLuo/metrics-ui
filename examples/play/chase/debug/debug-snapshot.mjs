import { getPredictionPerformanceSnapshot } from "./prediction-performance.mjs";

function cloneSerializable(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cloneSerializable(item, seen))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const output = {};
    Object.entries(value).forEach(([key, entry]) => {
      const cloned = cloneSerializable(entry, seen);
      if (cloned !== undefined) {
        output[key] = cloned;
      }
    });
    seen.delete(value);
    return output;
  }
  return null;
}

function cloneVector(vector) {
  return vector
    ? {
      x: Number(vector.x) || 0,
      z: Number(vector.z) || 0,
    }
    : null;
}

function cloneReasoningStage(reasoning, key) {
  return cloneSerializable(reasoning?.[key] ?? null);
}

function buildActorDebug(reasoning) {
  const snapshot = reasoning?.snapshot ?? null;
  return {
    action: cloneSerializable(reasoning?.action ?? null),
    stages: {
      observation: cloneReasoningStage(reasoning, "observation"),
      memory: cloneReasoningStage(reasoning, "memory"),
      patterns: cloneReasoningStage(reasoning, "patterns"),
      strategies: cloneReasoningStage(reasoning, "strategies"),
    },
    snapshot: cloneSerializable(snapshot),
    memory: cloneSerializable(snapshot?.memory ?? null),
    patternUnits: cloneSerializable(snapshot?.patternUnits ?? {}),
    patternStatus: cloneSerializable(snapshot?.patternStatus ?? {}),
    strategies: cloneSerializable(snapshot?.strategies ?? {}),
    strategyStatus: cloneSerializable(snapshot?.strategyStatus ?? {}),
  };
}

function buildPredictionConsensusDebug(chaserSnapshot) {
  const predictionPlan = chaserSnapshot?.strategies?.evaderPrediction ?? null;
  const patternUnits = chaserSnapshot?.patternUnits ?? {};
  const prediction = predictionPlan?.prediction ?? null;
  const path = Array.isArray(predictionPlan?.path) ? predictionPlan.path : [];

  return {
    actorId: "chaser",
    strategyId: "evaderPrediction",
    actionable: predictionPlan?.actionable ?? false,
    invalidReason: predictionPlan?.invalidReason ?? null,
    prediction: cloneSerializable(prediction),
    path: cloneSerializable(path),
    firstConsensusFrame: cloneSerializable(path[0] ?? null),
    patternUnits: cloneSerializable(patternUnits),
    sourcePatternIds: Array.isArray(prediction?.sourcePatternIds)
      ? [...prediction.sourcePatternIds]
      : [],
    consensus: Number.isFinite(prediction?.consensus) ? prediction.consensus : 0,
  };
}

export function buildChaseDebugSnapshot(simulationState, {
  performance = null,
  predictionDebug = null,
} = {}) {
  const lastStep = simulationState?.lastStep ?? {};
  const chaserSnapshot = lastStep.chaserReasoning?.snapshot ?? null;

  return {
    schemaVersion: 1,
    gameId: "chase",
    generatedAt: new Date().toISOString(),
    frameIndex: Number.isFinite(lastStep.frameIndex)
      ? lastStep.frameIndex
      : Number(simulationState?.frameIndex) || 0,
    phase: lastStep.phase ?? "unknown",
    actionApplicationPending: Boolean(lastStep.actionApplicationPending),
    pendingActionFrame: Boolean(simulationState?.pendingActionFrame),
    frozenFrame: cloneSerializable(lastStep.frozenFrame ?? null),
    world: {
      columns: Number(simulationState?.columns) || 0,
      rows: Number(simulationState?.rows) || 0,
      evaderExists: simulationState?.evaderExists !== false,
      chaserPosition: cloneVector(simulationState?.chaserPosition),
      chaserLookDirection: cloneVector(simulationState?.chaserLookDirection),
      evaderPosition: cloneVector(simulationState?.evaderPosition),
      evaderDirection: cloneVector(simulationState?.evaderDirection),
      obstacles: cloneSerializable(simulationState?.obstacles ?? null),
      simulationSettings: cloneSerializable(simulationState?.simulationSettings ?? {}),
      vehicleSettings: cloneSerializable(simulationState?.vehicleSettings ?? {}),
      projectionSettings: cloneSerializable(simulationState?.projectionSettings ?? {}),
      runMetrics: cloneSerializable(simulationState?.runMetrics ?? {}),
    },
    actions: {
      chaserInput: cloneSerializable(lastStep.chaserInput ?? null),
      chaserAction: cloneSerializable(lastStep.chaserAction ?? null),
      evaderMovementDecision: cloneSerializable(lastStep.evaderMovementDecision ?? null),
    },
    actors: {
      chaser: buildActorDebug(lastStep.chaserReasoning),
      evader: buildActorDebug(lastStep.evaderReasoning),
    },
    predictionConsensus: buildPredictionConsensusDebug(chaserSnapshot),
    predictionPerformance: getPredictionPerformanceSnapshot(
      simulationState?.predictionPerformance,
    ),
    ui: {
      predictionDebug: cloneSerializable(predictionDebug),
      performance: cloneSerializable(performance),
    },
  };
}
