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

function cloneChaserSnapshot(snapshot) {
  const continuance = snapshot?.patterns?.continuance ?? null;
  const wallAvoidancePattern = snapshot?.patterns?.wallAvoidance ?? null;
  const evaderMotionModel = snapshot?.patterns?.evaderMotionModel ?? null;
  const evaderMotionProjection = snapshot?.projections?.evaderMotion ?? null;
  const prediction = evaderMotionProjection?.prediction ?? null;

  return {
    selfState: cloneValue(snapshot?.selfState ?? null),
    controllerState: cloneValue(snapshot?.controllerState ?? null),
    engines: cloneValue(snapshot?.engines ?? null),
    memory: cloneValue(snapshot?.memory ?? {}),
    patternStatus: cloneValue(snapshot?.patternStatus ?? null),
    projectionStatus: cloneValue(snapshot?.projectionStatus ?? null),
    patterns: {
      evaderMotionModel: cloneValue(evaderMotionModel),
      continuance: continuance
        ? {
          position: clonePosition(continuance.position),
          direction: cloneVector(continuance.direction),
          framesSinceObservation: Number(continuance.framesSinceObservation) || 0,
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
    projections: {
      evaderMotion: evaderMotionProjection
        ? {
          actionable: Boolean(evaderMotionProjection.actionable),
          invalidReason: evaderMotionProjection.invalidReason ?? null,
          sampleCount: Number(evaderMotionProjection.sampleCount) || 0,
          sampleSpacingFrames: Number(evaderMotionProjection.sampleSpacingFrames) || 0,
          horizonFrames: Number(evaderMotionProjection.horizonFrames) || 0,
          validationErrorDistance: Number(evaderMotionProjection.validationErrorDistance) || 0,
          prediction: prediction
            ? {
              strategy: prediction.strategy ?? null,
              direction: cloneVector(prediction.direction),
              consensus: Number(prediction.consensus) || 0,
              oscillators: cloneValue(prediction.oscillators ?? []),
            }
            : null,
          path: clonePredictionPath(evaderMotionProjection.path),
        }
        : null,
    },
    assumedBehavior: cloneValue(snapshot?.assumedBehavior ?? null),
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
  const chaserReasoning = state?.lastStep?.chaserReasoning ?? null;
  const chaserInput = state?.lastStep?.chaserInput ?? null;
  const chaserAction = state?.lastStep?.chaserAction ?? chaserInput ?? null;
  const evaderReasoning = state?.lastStep?.evaderReasoning ?? null;
  const evaderMovementDecision = state?.lastStep?.evaderMovementDecision ?? null;

  return {
    frameIndex: Number(state?.frameIndex) || 0,
    actors: {
      chaser: {
        position: clonePosition(state?.chaserPosition),
        direction: cloneVector(state?.chaserLookDirection),
      },
      evader: {
        exists: state?.evaderExists !== false,
        position: clonePosition(state?.evaderPosition),
        direction: cloneVector(state?.evaderDirection),
      },
    },
    metrics: cloneValue(state?.runMetrics ?? null),
    action: {
      programmaticChaserEnabled: Boolean(state?.programmaticChaserEnabled),
      chaserAction: cloneValue(chaserAction),
      chaserInput: cloneValue(chaserInput),
    },
    chaserReasoning: chaserReasoning
      ? {
        action: cloneValue(chaserReasoning.action),
        snapshot: cloneChaserSnapshot(chaserReasoning.snapshot),
      }
      : null,
    evaderDecision: evaderMovementDecision
      ? {
        forward: Boolean(evaderMovementDecision.forward),
        steering: Number(evaderMovementDecision.steering) || 0,
        direction: cloneVector(evaderMovementDecision.direction),
        desiredDirection: cloneVector(evaderMovementDecision.desiredDirection),
        nextDirection: cloneVector(evaderMovementDecision.nextDirection),
        debug: cloneValue(evaderMovementDecision.debug),
      }
      : null,
    evaderReasoning: evaderReasoning
      ? {
        action: cloneValue(evaderReasoning.action),
        snapshot: cloneValue(evaderReasoning.snapshot),
      }
      : null,
    evaderTruth: cloneValue(state?.evaderWallAvoidanceTruth ?? null),
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
