export const CHASE_TRACE_SINKS = Object.freeze({
  NONE: "none",
  MEMORY: "memory",
  FILE: "file",
});

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return structuredClone(value);
}

function normalizeSink(value) {
  return Object.values(CHASE_TRACE_SINKS).includes(value)
    ? value
    : CHASE_TRACE_SINKS.NONE;
}

function asPositiveInteger(value, fallback = 1) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function cloneVector(vector) {
  return vector
    ? {
      x: Number(vector.x) || 0,
      z: Number(vector.z) || 0,
    }
    : null;
}

function clonePosition(position) {
  return position
    ? {
      x: Number(position.x) || 0,
      z: Number(position.z) || 0,
    }
    : null;
}

function clonePredictionPath(path) {
  if (!Array.isArray(path)) {
    return [];
  }
  return path
    .filter((sample) => sample?.position)
    .map((sample) => ({
      framesAhead: Number(sample.framesAhead) || 0,
      position: clonePosition(sample.position),
      direction: cloneVector(sample.direction),
    }));
}

function cloneChaserKnowledge(knowledge) {
  const targetLocation = knowledge?.targetLocation ?? knowledge?.memory?.targetLocation ?? null;
  const observedTargetMotion = knowledge?.observedTargetMotion
    ?? knowledge?.memory?.observedTargetMotion
    ?? null;
  const targetMotionHypothesis = knowledge?.targetMotionHypothesis
    ?? knowledge?.patterns?.targetMotionHypothesis
    ?? null;
  const wallAvoidancePattern = knowledge?.wallAvoidancePattern
    ?? knowledge?.wallAvoidanceEvidence
    ?? knowledge?.patterns?.wallAvoidance
    ?? null;
  const predictionPlan = knowledge?.predictionPlan ?? null;
  const prediction = predictionPlan?.prediction ?? null;

  return {
    targetLocation: targetLocation
      ? {
        visible: Boolean(targetLocation.visible),
        position: clonePosition(targetLocation.position),
        bearingRadians: targetLocation.bearingRadians ?? null,
        distance: targetLocation.distance ?? null,
        observationCount: Number(targetLocation.observationCount) || 0,
        framesSinceObservation: Number(targetLocation.framesSinceObservation) || 0,
        observationGapFrames: Number(targetLocation.observationGapFrames) || 0,
      }
      : null,
    observedTargetMotion: observedTargetMotion
      ? {
        speedEstimateUnitsPerFrame: Number(observedTargetMotion.speedEstimateUnitsPerFrame) || 0,
        speedObservationCount: Number(observedTargetMotion.speedObservationCount) || 0,
        lastObservedDirection: cloneVector(observedTargetMotion.lastObservedDirection),
        previousObservedDirection: cloneVector(observedTargetMotion.previousObservedDirection),
        observedTurnRadiansPerFrame: Number(observedTargetMotion.observedTurnRadiansPerFrame) || 0,
        lastObservedPosition: clonePosition(observedTargetMotion.lastObservedPosition),
        observationCount: Number(observedTargetMotion.observationCount) || 0,
        motionObservationCount: Number(observedTargetMotion.motionObservationCount) || 0,
      }
      : null,
    patternStatus: cloneValue(knowledge?.patternStatus ?? null),
    strategyStatus: cloneValue(knowledge?.strategyStatus ?? null),
    patterns: {
      targetMotionHypothesis: targetMotionHypothesis
        ? {
          position: clonePosition(targetMotionHypothesis.position),
          direction: cloneVector(targetMotionHypothesis.direction),
          framesSinceObservation: Number(targetMotionHypothesis.framesSinceObservation) || 0,
        }
        : null,
      wallAvoidance: wallAvoidancePattern
        ? {
          observedSampleCount: Number(wallAvoidancePattern.observedSampleCount) || 0,
          approachEpisodeCount: Number(wallAvoidancePattern.approachEpisodeCount) || 0,
          avoidedApproachCount: Number(wallAvoidancePattern.avoidedApproachCount) || 0,
          hitApproachCount: Number(wallAvoidancePattern.hitApproachCount) || 0,
          pendingApproach: cloneValue(wallAvoidancePattern.pendingApproach),
          cooldownWall: wallAvoidancePattern.cooldownWall ?? null,
          wallAvoidanceScore: Number(wallAvoidancePattern.wallAvoidanceScore) || 0,
          latest: cloneValue(wallAvoidancePattern.latest),
        }
        : null,
    },
    targetMotionModel: cloneValue(knowledge?.targetMotionModel ?? knowledge?.targetEstimate ?? null),
    strategy: {
      targetPrediction: predictionPlan
        ? {
          actionable: Boolean(predictionPlan.actionable),
          invalidReason: predictionPlan.invalidReason ?? null,
          sampleCount: Number(predictionPlan.sampleCount) || 0,
          sampleSpacingFrames: Number(predictionPlan.sampleSpacingFrames) || 0,
          horizonFrames: Number(predictionPlan.horizonFrames) || 0,
          validationErrorDistance: Number(predictionPlan.validationErrorDistance) || 0,
          prediction: prediction
            ? {
              strategy: prediction.strategy ?? null,
              direction: cloneVector(prediction.direction),
              consensus: Number(prediction.consensus) || 0,
              oscillators: cloneValue(prediction.oscillators ?? []),
            }
            : null,
          path: clonePredictionPath(predictionPlan.path),
        }
        : null,
    },
    assumedBehavior: cloneValue(knowledge?.assumedBehavior ?? null),
  };
}

export function resolveChaseTraceConfig(config = {}) {
  return {
    enabled: Boolean(config?.enabled),
    sink: normalizeSink(config?.sink),
    filePath: typeof config?.filePath === "string" && config.filePath.trim()
      ? config.filePath.trim()
      : null,
    everyNFrames: asPositiveInteger(config?.everyNFrames, 1),
  };
}

export function buildChaseTraceFrame(state) {
  const knowledge = state?.lastStep?.chaserKnowledge ?? null;
  const chaserInput = state?.lastStep?.chaserInput ?? null;
  const chaserAction = state?.lastStep?.chaserAction ?? chaserInput ?? null;
  const targetReasoning = state?.lastStep?.targetReasoning ?? null;
  const targetMovementDecision = state?.lastStep?.targetMovementDecision ?? null;

  return {
    frameIndex: Number(state?.frameIndex) || 0,
    actors: {
      chaser: {
        position: clonePosition(state?.chaserPosition),
        direction: cloneVector(state?.chaserLookDirection),
      },
      target: {
        position: clonePosition(state?.targetPosition),
        direction: cloneVector(state?.targetDirection),
      },
    },
    metrics: cloneValue(state?.runMetrics ?? null),
    action: {
      programmaticChaserEnabled: Boolean(state?.programmaticChaserEnabled),
      chaserAction: cloneValue(chaserAction),
      chaserInput: cloneValue(chaserInput),
      autopilot: state?.chaserAutopilotState
        ? {
          searchSteering: Number(state.chaserAutopilotState.searchSteering) || 0,
          lastPursuitSource: state.chaserAutopilotState.lastPursuitSource ?? null,
          wallFollowSign: Number(state.chaserAutopilotState.wallFollowSign) || 0,
          actionEngines: cloneValue(state.chaserAutopilotState.actionEngines ?? {}),
        }
        : null,
    },
    knowledge: cloneChaserKnowledge(knowledge),
    targetDecision: targetMovementDecision
      ? {
        direction: cloneVector(targetMovementDecision.direction),
        debug: cloneValue(targetMovementDecision.debug),
      }
      : null,
    targetReasoning: targetReasoning
      ? {
        action: cloneValue(targetReasoning.action),
        snapshot: cloneValue(targetReasoning.snapshot),
      }
      : null,
    targetTruth: cloneValue(state?.targetWallAvoidanceTruth ?? null),
  };
}

export function createChaseTraceRecorder(
  config = {},
  {
    appendLine,
    resetSink,
    fallbackSink = CHASE_TRACE_SINKS.MEMORY,
  } = {},
) {
  const resolvedConfig = resolveChaseTraceConfig(config);
  const warnings = [];
  let effectiveSink = resolvedConfig.enabled
    ? resolvedConfig.sink
    : CHASE_TRACE_SINKS.NONE;

  if (effectiveSink === CHASE_TRACE_SINKS.FILE && typeof appendLine !== "function") {
    const normalizedFallbackSink = normalizeSink(fallbackSink);
    effectiveSink = normalizedFallbackSink === CHASE_TRACE_SINKS.FILE
      ? CHASE_TRACE_SINKS.NONE
      : normalizedFallbackSink;
    warnings.push("file-sink-unavailable");
  }

  const recorder = {
    config: resolvedConfig,
    effectiveSink,
    warnings,
    frames: [],
    recordedFrameCount: 0,
    appendLine,
    resetSink,
  };

  if (resolvedConfig.enabled && effectiveSink === CHASE_TRACE_SINKS.FILE) {
    recorder.resetSink?.();
  }

  return recorder;
}

export function recordChaseTraceFrame(recorder, state) {
  if (!recorder?.config?.enabled || recorder.effectiveSink === CHASE_TRACE_SINKS.NONE) {
    return null;
  }

  const frameIndex = Number(state?.frameIndex) || 0;
  const everyNFrames = asPositiveInteger(recorder.config.everyNFrames, 1);
  if (frameIndex % everyNFrames !== 0) {
    return null;
  }

  const frame = buildChaseTraceFrame(state);
  if (recorder.effectiveSink === CHASE_TRACE_SINKS.MEMORY) {
    recorder.frames.push(frame);
  } else if (recorder.effectiveSink === CHASE_TRACE_SINKS.FILE) {
    recorder.appendLine?.(`${JSON.stringify(frame)}\n`);
  }

  recorder.recordedFrameCount += 1;
  return frame;
}

export function getChaseTraceRecorderSnapshot(recorder) {
  if (!recorder) {
    return null;
  }

  return {
    config: cloneValue(recorder.config),
    effectiveSink: recorder.effectiveSink,
    warnings: [...(recorder.warnings ?? [])],
    recordedFrameCount: Number(recorder.recordedFrameCount) || 0,
    frames: recorder.effectiveSink === CHASE_TRACE_SINKS.MEMORY
      ? cloneValue(recorder.frames)
      : [],
  };
}
