import { createChaseTraceRecorder, recordChaseTraceFrame } from "../simulation/trace-recorder.mjs";

export const CHASE_EVALUATION_TRACE_SCHEMA = "chase_evaluation_trace_v1";
export const MAX_EVALUATION_TRACE_FRAMES = 20_001;
export const EVALUATION_TRACE_CLOCK = "performance.now-microseconds-at-committed-frame";

function epoch(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactFrame(state, simulationEpoch, committedAtUs = null, phase = "baseline") {
  const metrics = state.runMetrics ?? {};
  const input = state.lastStep?.chaserInput ?? {};
  return {
    simulationEpoch,
    frameIndex: state.frameIndex,
    phase,
    committedAtUs,
    scenarioId: state.scenario?.id ?? null,
    evaderExists: state.evaderExists !== false,
    controlSource: state.chaserControlSource ?? null,
    chaserPosition: state.chaserPosition ? { ...state.chaserPosition } : null,
    chaserInput: {
      source: input.source ?? null,
      forward: Boolean(input.forward),
      reverse: Boolean(input.reverse),
      steering: input.steering ?? 0,
    },
    elapsedFrames: metrics.elapsedFrames,
    touchCount: metrics.touchCount,
    wallTouchActive: metrics.wallTouchActive,
    wallTouchCount: metrics.wallTouchCount,
    wallTouchFrames: metrics.wallTouchFrames,
    wallTouchRatePerThousandFrames: metrics.wallTouchRatePerThousandFrames,
  };
}

function validFrame(frame) {
  return Number.isInteger(frame.frameIndex) && frame.frameIndex >= 0
    && frame.elapsedFrames === frame.frameIndex
    && Number.isFinite(frame.chaserPosition?.x) && Number.isFinite(frame.chaserPosition?.z)
    && typeof frame.wallTouchActive === "boolean"
    && [frame.touchCount, frame.wallTouchCount, frame.wallTouchFrames]
      .every((value) => Number.isInteger(value) && value >= 0)
    && Number.isFinite(frame.wallTouchRatePerThousandFrames)
    && frame.wallTouchRatePerThousandFrames >= 0
    && (frame.phase === "baseline" || Number.isFinite(frame.committedAtUs));
}

/** Evaluator-only recorder: never used by observation, memory, or action selection. */
export function createChaseEvaluationTrace({
  getState,
  getSimulationEpoch,
  nowUs = () => Math.round(globalThis.performance?.now?.() * 1000),
}) {
  let enabled = false;
  let maxFrames = null;
  let captureEpoch = null;
  let captureStartFrameIndex = null;
  let recorder = null;

  const beginRun = () => {
    const state = getState();
    captureEpoch = epoch(getSimulationEpoch());
    captureStartFrameIndex = enabled ? state.frameIndex : null;
    recorder = enabled ? createChaseTraceRecorder(
      { enabled: true, sink: "memory", everyNFrames: 1 },
      {
        maxFrames,
        buildFrame: (current) => compactFrame(current, epoch(getSimulationEpoch()), nowUs(), "after-actions"),
      },
    ) : null;
    state.evaluationTraceRecorder = recorder;
    // Baseline is explicitly not a committed action. A frame-zero baseline is
    // required for a complete-from-reset export.
    if (recorder) {
      recorder.frames.push(compactFrame(state, captureEpoch));
      recorder.recordedFrameCount = 1;
    }
  };

  const configure = (payload) => {
    if (!payload || typeof payload.enabled !== "boolean") {
      throw new Error("Evaluation trace configuration requires enabled:boolean.");
    }
    if (payload.enabled && (!Number.isInteger(payload.maxFrames)
      || payload.maxFrames < 2 || payload.maxFrames > MAX_EVALUATION_TRACE_FRAMES)) {
      throw new Error(`Evaluation trace maxFrames must be an integer from 2 to ${MAX_EVALUATION_TRACE_FRAMES}, including the baseline.`);
    }
    enabled = payload.enabled;
    maxFrames = enabled ? payload.maxFrames : null;
    beginRun();
  };

  const snapshot = (payload = {}) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Evaluation trace query payload must be an object.");
    }
    if (payload.expectedSimulationEpoch !== undefined && !epoch(payload.expectedSimulationEpoch)) {
      throw new Error("expectedSimulationEpoch must be a nonempty string when supplied.");
    }
    const state = getState();
    const simulationEpoch = epoch(getSimulationEpoch());
    const frames = structuredClone(recorder?.frames ?? []);
    const issues = [];
    if (!enabled) issues.push("trace-disabled");
    if (!simulationEpoch || (enabled && !captureEpoch)) issues.push("missing-simulation-epoch");
    if (enabled && simulationEpoch !== captureEpoch) issues.push("epoch-changed-without-reset");
    const expectedSimulationEpoch = epoch(payload.expectedSimulationEpoch);
    if (expectedSimulationEpoch && expectedSimulationEpoch !== simulationEpoch) issues.push("expected-epoch-mismatch");
    if (enabled && captureStartFrameIndex !== 0) issues.push("capture-started-after-reset");
    const droppedFrameCount = recorder?.droppedFrameCount ?? 0;
    if (droppedFrameCount > 0) issues.push("trace-truncated");
    if (frames.some((frame) => !validFrame(frame) || !frame.simulationEpoch
      || frame.simulationEpoch !== simulationEpoch)) issues.push("invalid-frame-record");
    if (frames.some((frame, index) => index > 0 && frame.frameIndex <= frames[index - 1].frameIndex)) {
      issues.push("non-advancing-frame-index");
    }
    const indices = [...new Set(frames.map((frame) => frame.frameIndex)
      .filter((index) => Number.isInteger(index) && index >= 0 && index <= state.frameIndex))]
      .sort((a, b) => a - b);
    const gaps = [];
    let next = 0;
    for (const index of indices) {
      if (index > next) gaps.push({ fromFrameIndex: next, toFrameIndex: index - 1 });
      next = index + 1;
    }
    if (next <= state.frameIndex) gaps.push({ fromFrameIndex: next, toFrameIndex: state.frameIndex });
    if (gaps.length) issues.push("frame-gaps");
    if (frames.some((frame) => frame.frameIndex > state.frameIndex)) issues.push("frame-after-current-index");
    return {
      schema: CHASE_EVALUATION_TRACE_SCHEMA,
      classification: "non-sensor",
      gameId: "chase",
      simulationEpoch,
      expectedSimulationEpoch,
      scenarioId: state.scenario?.id ?? null,
      evaderExists: state.evaderExists !== false,
      controlSource: state.chaserControlSource ?? null,
      enabled,
      maxFrames,
      everyNFrames: 1,
      committedAtClock: EVALUATION_TRACE_CLOCK,
      captureStartFrameIndex,
      currentFrameIndex: state.frameIndex,
      expectedFrameCount: state.frameIndex + 1,
      retainedFrameCount: frames.length,
      recordedFrameCount: recorder?.recordedFrameCount ?? 0,
      droppedFrameCount,
      firstRetainedFrameIndex: frames[0]?.frameIndex ?? null,
      lastRetainedFrameIndex: frames.at(-1)?.frameIndex ?? null,
      complete: issues.length === 0,
      truncated: droppedFrameCount > 0,
      gaps,
      issues,
      endpoint: compactFrame(state, simulationEpoch, null, "snapshot"),
      frames,
    };
  };

  return Object.freeze({ configure, beginRun, snapshot });
}
