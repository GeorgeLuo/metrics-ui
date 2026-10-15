const clone = (value) => value == null ? null : structuredClone(value);

/** Owns commit budgets. Queries never advance; the existing loop performs commits. */
export function createExperimentSession({ state, settings, inputTracker, getEpoch, buildIdentity, frontendInstanceId, trace, resetTiming }) {
  let advancement = null, completedExport = null;
  const identity = () => ({ frontendInstanceId, build: buildIdentity ? {
    schema: buildIdentity.schema, digest: buildIdentity.digest, scope: buildIdentity.scope,
  } : null, simulationEpoch: getEpoch() });
  const controls = (value) => value ? { source: value.source ?? null, forward: Boolean(value.forward),
    reverse: Boolean(value.reverse), steering: value.steering ?? 0, selectedActionProposalId: value.selectedActionProposalId ?? null } : null;
  const input = (frame) => frame ? { actionFrameIndex: frame.frameIndex, phase: frame.phase,
    committedFrameIndex: frame.phase === "after-actions" ? frame.frameIndex + 1 : null,
    input: controls(frame.chaserInput), action: controls(frame.chaserAction) } : null;
  const snapshot = () => ({ schema: "chase_experiment_state_v1", classification: "non-sensor",
    identity: identity(), buildManifest: clone(buildIdentity?.modules ?? null), scenarioId: state.scenario.id, evaderExists: state.evaderExists,
    frameIndex: state.frameIndex, paused: Boolean(settings.pauseBeforeActions),
    controlSource: state.chaserControlSource,
    currentInput: state.chaserControlSource === "programmatic" ? null : inputTracker.getChaserInput(state.chaserControlSource),
    pendingAction: input(state.pendingActionFrame), lastCommittedAction: input(state.lastCommittedActionFrame),
    metrics: clone(state.runMetrics), advancement: clone(advancement) });
  const requireIdentity = (payload) => {
    if (!payload || payload.expectedSimulationEpoch !== getEpoch()
      || payload.expectedFrameIndex !== state.frameIndex) throw new Error("Experiment epoch/start frame mismatch");
    if (payload.expectedFrontendInstanceId !== frontendInstanceId) throw new Error("Experiment frontend mismatch");
  };
  return {
    identity, snapshot,
    result: () => clone(completedExport),
    beginRun() { this.cancel("state-replaced"); advancement = null; completedExport = null; },
    observePause() { if (settings.pauseBeforeActions) this.cancel("paused-externally"); },
    advance(payload) {
      requireIdentity(payload);
      if (!settings.pauseBeforeActions || advancement?.status === "running") throw new Error("Advance requires an idle paused game");
      if (!Number.isInteger(payload.frames) || payload.frames < 1 || payload.frames > 20000) throw new Error("frames must be 1..20000");
      const capture = trace.snapshot();
      if (!capture.enabled || capture.maxFrames < state.frameIndex + payload.frames + 1 || !capture.complete) throw new Error("Complete trace with sufficient retention is required");
      completedExport = null;
      advancement = { status: "running", simulationEpoch: getEpoch(), startFrame: state.frameIndex,
        requestedFrames: payload.frames, targetFrame: state.frameIndex + payload.frames, actualFrame: state.frameIndex };
      settings.pauseBeforeActions = false;
      resetTiming();
    },
    afterCommit() {
      if (advancement?.status !== "running") return;
      advancement.actualFrame = state.frameIndex;
      if (getEpoch() !== advancement.simulationEpoch) { this.cancel("epoch-changed"); return; }
      if (state.frameIndex >= advancement.targetFrame) {
        settings.pauseBeforeActions = true;
        advancement.status = state.frameIndex === advancement.targetFrame ? "complete" : "failed";
        resetTiming();
        if (advancement.status === "complete") completedExport = { identity: identity(), advancement: clone(advancement), state: snapshot(), trace: trace.snapshot() };
      }
    },
    cancel(reason = "interrupted") {
      if (advancement?.status === "running") {
        advancement.status = "interrupted";
        advancement.reason = reason;
        advancement.actualFrame = state.frameIndex;
        settings.pauseBeforeActions = true;
      }
    },
  };
}
