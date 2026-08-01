import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChasePassiveObservationCapability,
  buildChasePassiveObservationFingerprint,
  buildPassiveChaseEvaluationCapture,
} from "./evaluation/passive-observation.ts";

function buildFingerprint(overrides = {}) {
  return buildChasePassiveObservationFingerprint({
    scenarioId: "piracer-room-sketch",
    simulationEpoch: "chase-run:test",
    frameIndex: 42,
    pauseBeforeActions: true,
    pendingAction: true,
    controlSource: "ws",
    controlInput: {
      source: "ws",
      forward: true,
      reverse: false,
      steering: -0.25,
    },
    actorId: "chaser",
    ...overrides,
  });
}

function buildCapture(overrides = {}) {
  return {
    contractVersion: 1,
    captureId: "chase:evaluation:chase-run%3Atest:chaser:42",
    actorId: "chaser",
    frameIdentity: {
      gameId: "chase",
      simulationEpoch: "chase-run:test",
      frameIndex: 42,
    },
    playback: { advanced: false },
    sensor: {
      image: {
        contentType: "image/png",
        rendererId: "test-renderer",
        width: 640,
        height: 480,
        dataUrl: "data:image/png;base64,dGVzdA==",
      },
    },
    evaluator: {
      classification: "non-sensor",
      shadow: {
        kind: "visible-observation-summary",
        visibleActorCount: 1,
        visibleWallCount: 2,
        visibleAreaCellCount: 3,
        observationCount: 4,
      },
    },
    ...overrides,
  };
}

test("passive Chase capture proves paused session and control state were preserved", () => {
  const capability = buildChasePassiveObservationCapability();
  const fingerprint = buildFingerprint();
  const calls = [];
  const result = buildPassiveChaseEvaluationCapture({
    request: { actorId: "chaser", cameraId: "front_camera" },
    capability,
    getFingerprint(actorId, cameraId) {
      calls.push(["fingerprint", actorId, cameraId]);
      return fingerprint;
    },
    capture(actorId) {
      calls.push(["capture", actorId]);
      return buildCapture();
    },
  });

  assert.equal(result.passiveObservation.supported, true);
  assert.equal(result.playback.advanced, false);
  assert.equal(result.passiveObservation.preservation.preserved, true);
  assert.deepEqual(
    result.passiveObservation.preservation.before,
    result.passiveObservation.preservation.after,
  );
  assert.equal(
    result.passiveObservation.preservation.before.playback.phase,
    "paused-before-actions",
  );
  assert.equal(
    result.passiveObservation.preservation.before.controlSource,
    "ws",
  );
  assert.deepEqual(
    result.passiveObservation.preservation.before.controlInput,
    {
      source: "ws",
      forward: true,
      reverse: false,
      steering: -0.25,
    },
  );
  assert.deepEqual(calls, [
    ["fingerprint", "chaser", "front_camera"],
    ["capture", "chaser"],
    ["fingerprint", "chaser", "front_camera"],
  ]);
});

test("passive Chase capture fails closed when session state changes", () => {
  const before = buildFingerprint();
  const after = buildFingerprint({ controlSource: "keyboard", controlInput: null });
  let fingerprintCall = 0;
  const result = buildPassiveChaseEvaluationCapture({
    capability: buildChasePassiveObservationCapability(),
    getFingerprint() {
      fingerprintCall += 1;
      return fingerprintCall === 1 ? before : after;
    },
    capture: () => buildCapture(),
  });

  assert.deepEqual(result.passiveObservation.reason.changedFields, [
    "controlSource",
    "controlInput",
  ]);
  assert.equal(result.passiveObservation.reason.code, "session_changed");
  assert.equal("sensor" in result, false);
});

test("passive Chase capture returns structured unsupported actor and camera results", () => {
  const capability = buildChasePassiveObservationCapability({ evaderExists: false });
  let captureCalls = 0;
  const handlers = {
    capability,
    getFingerprint: () => buildFingerprint(),
    capture() {
      captureCalls += 1;
      return buildCapture();
    },
  };

  const actorResult = buildPassiveChaseEvaluationCapture({
    ...handlers,
    request: { actorId: "evader" },
  });
  const cameraResult = buildPassiveChaseEvaluationCapture({
    ...handlers,
    request: { cameraId: "rear_camera" },
  });

  assert.deepEqual(actorResult.passiveObservation.reason, {
    code: "actor_unavailable",
    message: "Requested actor is not available.",
    field: "actorId",
    requested: "evader",
    available: ["chaser"],
  });
  assert.deepEqual(cameraResult.passiveObservation.reason, {
    code: "camera_unavailable",
    message: "Requested camera is not available.",
    field: "cameraId",
    requested: "rear_camera",
    available: ["front_camera"],
  });
  assert.equal(captureCalls, 0);
});

test("passive Chase capture rejects malformed actor and camera target types", () => {
  const capability = buildChasePassiveObservationCapability({ evaderExists: true });
  let captureCalls = 0;
  let fingerprintCalls = 0;
  const handlers = {
    capability,
    getFingerprint() {
      fingerprintCalls += 1;
      return buildFingerprint();
    },
    capture() {
      captureCalls += 1;
      return buildCapture();
    },
  };

  for (const requested of [123, null, [], {}]) {
    const actorResult = buildPassiveChaseEvaluationCapture({
      ...handlers,
      request: { actorId: requested },
    });
    assert.equal(actorResult.passiveObservation.supported, false);
    assert.equal(actorResult.passiveObservation.reason.code, "actor_invalid");
    assert.equal(actorResult.passiveObservation.reason.field, "actorId");
    assert.deepEqual(actorResult.passiveObservation.reason.requested, requested);
    assert.equal("sensor" in actorResult, false);

    const cameraResult = buildPassiveChaseEvaluationCapture({
      ...handlers,
      request: { cameraId: requested },
    });
    assert.equal(cameraResult.passiveObservation.supported, false);
    assert.equal(cameraResult.passiveObservation.reason.code, "camera_invalid");
    assert.equal(cameraResult.passiveObservation.reason.field, "cameraId");
    assert.deepEqual(cameraResult.passiveObservation.reason.requested, requested);
    assert.equal("sensor" in cameraResult, false);
  }

  assert.equal(captureCalls, 0);
  assert.equal(fingerprintCalls, 0);
});

test("passive Chase capability declares the current actor and preserved fields", () => {
  const capability = buildChasePassiveObservationCapability({ evaderExists: false });

  assert.deepEqual(capability.actors, ["chaser"]);
  assert.deepEqual(capability.cameras, ["front_camera"]);
  assert.deepEqual(capability.preservedFields, [
    "gameId",
    "scenarioId",
    "simulationEpoch",
    "playback",
    "controlSource",
    "controlInput",
    "actorId",
    "cameraId",
  ]);
});
