import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChaseCameraStreamCapability,
  buildChaseCameraStreamSubscribeResult,
  buildChasePassiveObservationFingerprint,
  getChaseCameraStreamSessionIdentityChanges,
  resolveChaseCameraStreamRequest,
  selectLatestCameraStreamFrame,
} from "./evaluation/camera-stream.ts";
import {
  CHASE_PLAY_QUERY_IDS,
  handleChasePlayQuery,
} from "./ui/chase-play-queries.mjs";
import { createActorViewImageCapture } from "./ui/actor-view-controller.mjs";
import { createChaseCameraStreamRuntime } from "./ui/camera-stream-runtime.mjs";

function buildFingerprint(overrides = {}) {
  const fingerprint = buildChasePassiveObservationFingerprint({
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
  assert.ok(fingerprint);
  return fingerprint;
}

function buildImage(overrides = {}) {
  return {
    contentType: "image/jpeg",
    rendererId: "test-camera-renderer",
    width: 320,
    height: 240,
    dataUrl: "data:image/jpeg;base64,dGVzdA==",
    ...overrides,
  };
}

function buildSubscribeResult({
  request = {},
  before = buildFingerprint(),
  after = before,
  capture = () => buildImage(),
} = {}) {
  let fingerprintCall = 0;
  return buildChaseCameraStreamSubscribeResult({
    subscriptionId: "chase-cam:test",
    request,
    capability: buildChaseCameraStreamCapability(),
    getFingerprint() {
      fingerprintCall += 1;
      return fingerprintCall === 1 ? before : after;
    },
    capture,
  });
}

test("camera stream capability advertises stream types, JPEG defaults/bounds, and the one-shot query", () => {
  const capability = buildChaseCameraStreamCapability();

  assert.deepEqual(capability, {
    supported: true,
    subscribeType: "play_camera_stream_subscribe",
    unsubscribeType: "play_camera_stream_unsubscribe",
    frameType: "play_camera_stream_frame",
    resultType: "play_camera_stream_result",
    actors: ["chaser", "evader"],
    cameras: ["front_camera"],
    imageFormat: "image/jpeg",
    defaults: { width: 320, height: 240, quality: 0.6, maxRateHz: 15 },
    bounds: {
      width: [80, 640],
      height: [60, 480],
      quality: [0.4, 0.9],
      maxRateHz: [1, 30],
    },
    backpressure: "latest-frame",
    oneShotQueryId: "atomic-evaluation-capture",
    identityFields: ["gameId", "simulationEpoch", "frameIndex"],
    sessionIdentityFields: ["gameId", "scenarioId", "simulationEpoch", "actorId", "cameraId"],
  });
  assert.deepEqual(buildChaseCameraStreamCapability({ evaderExists: false }).actors, ["chaser"]);
});

test("camera stream subscribe defaults actor/camera and preserves a JPEG receipt without evaluator data", () => {
  const result = buildSubscribeResult();

  assert.equal(result.event, "subscribed");
  assert.equal(result.subscriptionId, "chase-cam:test");
  assert.equal(result.playback.advanced, false);
  assert.equal(result.preservation.preserved, true);
  assert.deepEqual(result.preservation.before, result.preservation.after);
  assert.equal(result.frame.actorId, "chaser");
  assert.equal(result.frame.cameraId, "front_camera");
  assert.equal(result.frame.sensor.image.contentType, "image/jpeg");
  assert.match(result.frame.sensor.image.dataUrl, /^data:image\/jpeg/);
  assert.equal("evaluator" in result.frame, false);
  assert.equal("request_id" in result.frame, false);
});

test("camera stream subscribe does not call play, pause, reset, or control mutators", () => {
  const calls = [];
  const mutators = {
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    reset: () => calls.push("reset"),
    control: () => calls.push("control"),
  };
  const result = buildChaseCameraStreamSubscribeResult({
    subscriptionId: "chase-cam:test",
    capability: buildChaseCameraStreamCapability(),
    getFingerprint: () => buildFingerprint(),
    capture: () => buildImage(),
    ...mutators,
  });

  assert.equal(result.event, "subscribed");
  assert.deepEqual(calls, []);
});

test("malformed camera stream actor/camera types fail closed with no frame", () => {
  let captureCalls = 0;
  for (const requested of [123, null, [], {}]) {
    const actorResult = buildSubscribeResult({ request: { actorId: requested }, capture: () => {
      captureCalls += 1;
      return buildImage();
    } });
    assert.equal(actorResult.event, "unsupported");
    assert.equal(actorResult.cameraStream.reason.code, "actor_invalid");
    assert.equal("frame" in actorResult, false);

    const cameraResult = buildSubscribeResult({ request: { cameraId: requested }, capture: () => {
      captureCalls += 1;
      return buildImage();
    } });
    assert.equal(cameraResult.event, "unsupported");
    assert.equal(cameraResult.cameraStream.reason.code, "camera_invalid");
    assert.equal("frame" in cameraResult, false);
  }
  assert.equal(captureCalls, 0);
});

test("unknown camera stream actor/camera fail closed without a capture call", () => {
  const capability = buildChaseCameraStreamCapability({ evaderExists: false });
  let captureCalls = 0;
  const buildResult = (request) => buildChaseCameraStreamSubscribeResult({
    subscriptionId: "chase-cam:test",
    request,
    capability,
    getFingerprint: () => buildFingerprint(),
    capture: () => {
      captureCalls += 1;
      return buildImage();
    },
  });

  const actorResult = buildResult({ actorId: "evader" });
  const cameraResult = buildResult({ cameraId: "rear_camera" });
  assert.equal(actorResult.event, "unsupported");
  assert.equal(actorResult.cameraStream.reason.code, "actor_unavailable");
  assert.equal(cameraResult.event, "unsupported");
  assert.equal(cameraResult.cameraStream.reason.code, "camera_unavailable");
  assert.equal("frame" in actorResult, false);
  assert.equal("frame" in cameraResult, false);
  assert.equal(captureCalls, 0);
});

test("image/png camera stream requests fail closed without a frame", () => {
  let captureCalls = 0;
  const result = buildSubscribeResult({
    request: { imageFormat: "image/png" },
    capture: () => {
      captureCalls += 1;
      return buildImage();
    },
  });

  assert.equal(result.event, "unsupported");
  assert.equal(result.cameraStream.reason.code, "image_format_unsupported");
  assert.equal("frame" in result, false);
  assert.equal(captureCalls, 0);
});

test("camera stream subscribe fails closed when the first capture changes the full preserved fingerprint", () => {
  const result = buildSubscribeResult({
    before: buildFingerprint({ frameIndex: 42 }),
    after: buildFingerprint({ frameIndex: 43 }),
  });

  assert.equal(result.event, "unsupported");
  assert.equal(result.cameraStream.reason.code, "capture_identity_mismatch");
  assert.deepEqual(result.cameraStream.reason.changedFields, ["playback"]);
  assert.equal("frame" in result, false);
});

test("camera stream request normalization clamps finite dimensions, quality, and rate", () => {
  const resolved = resolveChaseCameraStreamRequest({
    width: 10_000,
    height: 1,
    quality: 0,
    maxRateHz: 0.2,
  });

  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.value, {
    actorId: "chaser",
    cameraId: "front_camera",
    width: 640,
    height: 60,
    imageFormat: "image/jpeg",
    quality: 0.4,
    maxRateHz: 1,
  });
});

function createRuntimeHarness({ emit = () => true } = {}) {
  let now = 0;
  let fingerprint = buildFingerprint();
  const runtime = createChaseCameraStreamRuntime({
    getCapability: () => buildChaseCameraStreamCapability(),
    getFingerprint: () => fingerprint,
    capture: () => buildImage(),
    now: () => now,
    createSubscriptionId: () => "chase-cam:test",
  });
  return {
    runtime,
    emit,
    setNow(value) {
      now = value;
    },
    setFingerprint(value) {
      fingerprint = value;
    },
  };
}

test("second camera stream subscribe is rejected as already subscribed and preserves the first subscription", () => {
  const harness = createRuntimeHarness();
  const first = harness.runtime.handleSubscribe({}, harness.emit);
  const second = harness.runtime.handleSubscribe({}, harness.emit);

  assert.equal(first.event, "subscribed");
  assert.equal(second.event, "unsupported");
  assert.equal(second.cameraStream.reason.code, "already_subscribed");
  assert.equal(harness.runtime.handleUnsubscribe({ subscriptionId: "chase-cam:test" }).event, "unsubscribed");
});

test("unknown camera stream unsubscribe is rejected with subscription_not_found", () => {
  const harness = createRuntimeHarness();
  harness.runtime.handleSubscribe({}, harness.emit);
  const result = harness.runtime.handleUnsubscribe({ subscriptionId: "missing" });

  assert.equal(result.event, "unsupported");
  assert.equal(result.cameraStream.reason.code, "subscription_not_found");
  assert.equal(result.cameraStream.reason.requested, "missing");
  assert.equal(harness.runtime.handleUnsubscribe({ subscriptionId: "chase-cam:test" }).event, "unsubscribed");
});

test("camera stream frame identity changes emit the new frame index with the same simulation epoch", () => {
  const emitted = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return true;
  } });
  harness.setNow(1_000);
  const first = harness.runtime.handleSubscribe({ maxRateHz: 1 }, harness.emit);
  harness.setFingerprint(buildFingerprint({ frameIndex: 43 }));
  harness.setNow(2_001);
  harness.runtime.handleSimulationFrame({ frameIndex: 43, simulationEpoch: "chase-run:test" });

  assert.equal(first.event, "subscribed");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "play_camera_stream_frame");
  assert.equal(emitted[0].payload.frameIdentity.frameIndex, 43);
  assert.equal(emitted[0].payload.frameIdentity.simulationEpoch, "chase-run:test");
  assert.equal(emitted[0].payload.playback.advanced, false);
});

test("stable camera stream frame index while paused emits no additional frame and no drop", () => {
  const emitted = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return true;
  } });
  harness.runtime.handleSubscribe({ maxRateHz: 1 }, harness.emit);
  harness.setNow(1_000);
  harness.runtime.handleSimulationFrame({ frameIndex: 42, simulationEpoch: "chase-run:test" });

  assert.equal(emitted.length, 0);
});

test("camera stream rate limiting increments droppedFrameCount and latest-frame selection keeps one newest frame", () => {
  const emitted = [];
  const deliveryResolvers = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return {
      then(resolve) {
        deliveryResolvers.push(resolve);
      },
    };
  } });
  harness.runtime.handleSubscribe({ maxRateHz: 1 }, harness.emit);

  harness.setFingerprint(buildFingerprint({ frameIndex: 43 }));
  harness.setNow(1_000);
  harness.runtime.handleSimulationFrame({ frameIndex: 43, simulationEpoch: "chase-run:test" });
  harness.setFingerprint(buildFingerprint({ frameIndex: 44 }));
  harness.setNow(1_050);
  harness.runtime.handleSimulationFrame({ frameIndex: 44, simulationEpoch: "chase-run:test" });
  harness.setFingerprint(buildFingerprint({ frameIndex: 45 }));
  harness.setNow(2_000);
  harness.runtime.handleSimulationFrame({ frameIndex: 45, simulationEpoch: "chase-run:test" });
  harness.setFingerprint(buildFingerprint({ frameIndex: 46 }));
  harness.setNow(3_000);
  harness.runtime.handleSimulationFrame({ frameIndex: 46, simulationEpoch: "chase-run:test" });

  assert.equal(emitted.length, 1);
  assert.equal(deliveryResolvers.length, 1);
  deliveryResolvers[0]();
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].payload.frameIdentity.frameIndex, 46);
  assert.equal(emitted[1].payload.droppedFrameCount, 3);
  assert.equal(selectLatestCameraStreamFrame([
    emitted[0].payload,
    emitted[1].payload,
  ]), emitted[1].payload);
});

test("camera stream epoch change ends the stream with session_identity_changed and no image", () => {
  const before = buildFingerprint({ simulationEpoch: "chase-run:before" });
  const after = buildFingerprint({ simulationEpoch: "chase-run:after" });
  const emitted = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return true;
  } });
  harness.setFingerprint(before);
  harness.runtime.handleSubscribe({}, harness.emit);
  harness.setFingerprint(after);
  harness.runtime.handleSimulationFrame({ frameIndex: 42, simulationEpoch: after.simulationEpoch });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "play_camera_stream_result");
  assert.equal(emitted[0].payload.event, "ended");
  assert.equal(emitted[0].payload.reason.code, "session_identity_changed");
  assert.deepEqual(emitted[0].payload.reason.changedFields, ["simulationEpoch"]);
  assert.equal("sensor" in emitted[0].payload, false);
  assert.equal("frame" in emitted[0].payload, false);
});

test("camera stream control input and pause-phase changes do not end the stream", () => {
  const emitted = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return true;
  } });
  harness.setNow(1_000);
  harness.runtime.handleSubscribe({ maxRateHz: 1 }, harness.emit);
  harness.setFingerprint(buildFingerprint({
    pauseBeforeActions: false,
    pendingAction: false,
    controlSource: "keyboard",
    controlInput: null,
    frameIndex: 43,
  }));
  harness.setNow(2_001);
  harness.runtime.handleSimulationFrame({ frameIndex: 43, simulationEpoch: "chase-run:test" });

  assert.equal(getChaseCameraStreamSessionIdentityChanges(
    buildFingerprint(),
    buildFingerprint({
      pauseBeforeActions: false,
      pendingAction: false,
      controlSource: "keyboard",
      controlInput: null,
      frameIndex: 43,
    }),
  ).length, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "play_camera_stream_frame");
});

test("disposing the Chase camera stream runtime ends the active subscription without an image", () => {
  const emitted = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return true;
  } });
  harness.runtime.handleSubscribe({}, harness.emit);
  harness.runtime.dispose();

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "play_camera_stream_result");
  assert.equal(emitted[0].payload.event, "ended");
  assert.equal(emitted[0].payload.reason.code, "frontend_disconnected");
  assert.equal("frame" in emitted[0].payload, false);
});

test("atomic-evaluation-capture remains the evaluator-bearing one-shot query", () => {
  const oneShot = {
    sensor: { image: buildImage({ contentType: "image/png", dataUrl: "data:image/png;base64,dGVzdA==" }) },
    evaluator: { classification: "non-sensor" },
    passiveObservation: { supported: true },
  };
  const result = handleChasePlayQuery({
    queryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
    payload: { actorId: "chaser" },
  }, {
    getAtomicEvaluationCapture: () => oneShot,
  });

  assert.equal(result, oneShot);
  assert.equal("evaluator" in result, true);
  assert.equal(result.passiveObservation.supported, true);
});

test("actor-view PNG capture without quality remains the unchanged one-argument toDataURL call while JPEG receives quality", () => {
  const toDataURLCalls = [];
  const captureSession = createActorViewImageCapture({
    createRenderer: () => ({
      domElement: {
        toDataURL(...args) {
          toDataURLCalls.push(args);
          return args[0] === "image/jpeg"
            ? "data:image/jpeg;base64,dGVzdA=="
            : "data:image/png;base64,dGVzdA==";
        },
      },
      dispose() {},
      forceContextLoss() {},
      getContext: () => ({ isContextLost: () => false }),
      render() {},
      setClearColor() {},
      setPixelRatio() {},
      setSize() {},
    }),
    createCamera: () => ({
      position: { set() {} },
      lookAt() {},
      updateProjectionMatrix() {},
    }),
  });
  const options = {
    scene: {},
    actorMesh: { visible: true },
    actorFieldOfView: { visible: true },
    actorPosition: { x: 0, z: 0 },
    actorLookDirection: { x: 1, z: 0 },
    fieldOfViewAngleRadians: Math.PI / 3,
  };

  captureSession.capture(options);
  captureSession.capture({ ...options, contentType: "image/jpeg", quality: 0.72 });
  captureSession.dispose();

  assert.deepEqual(toDataURLCalls, [["image/png"], ["image/jpeg", 0.72]]);
});
