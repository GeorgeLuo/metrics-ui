import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChaseCameraStreamCapability,
  buildChaseCameraStreamFrame,
  buildChaseCameraStreamSubscribeResult,
  buildChasePassiveObservationFingerprint,
  resolveChaseCameraStreamRequest,
  stampCameraStreamFramePublished,
} from "./evaluation/camera-stream.ts";
import { createChaseCameraStreamRuntime } from "./ui/camera-stream-runtime.mjs";
import { stampCameraStreamResultPublished } from "../../../shared/play-camera-stream.ts";
import { handleCameraStreamCommand } from "../../../client/src/hooks/ws/handlers/camera-stream.ts";

function buildFingerprint(overrides = {}) {
  const fingerprint = buildChasePassiveObservationFingerprint({
    scenarioId: "piracer-room-sketch",
    simulationEpoch: "chase-run:test",
    frameIndex: 42,
    pauseBeforeActions: true,
    pendingAction: true,
    controlSource: "ws",
    controlInput: { source: "ws", forward: true, reverse: false, steering: -0.25 },
    actorId: "chaser",
    ...overrides,
  });
  assert.ok(fingerprint);
  return fingerprint;
}

function buildImage() {
  return {
    contentType: "image/jpeg",
    rendererId: "test-camera-renderer",
    width: 320,
    height: 240,
    dataUrl: "data:image/jpeg;base64,dGVzdA==",
  };
}

function buildSubscribeResult(options = {}) {
  const {
    request = {},
    before = buildFingerprint(),
    after = before,
    capture = buildImage,
  } = options;
  const sourceTimestampUs = Object.prototype.hasOwnProperty.call(options, "sourceTimestampUs")
    ? options.sourceTimestampUs
    : 1_000;
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
    sourceTimestampUs,
  });
}

test("camera stream source timestamps are required and publication stamps are validated", () => {
  const result = buildSubscribeResult();
  assert.equal(result.event, "subscribed");
  assert.equal(result.frame.sourceTimestampUs, 1_000);
  const stampedFrame = stampCameraStreamFramePublished(result.frame, 1_500);
  assert.ok(stampedFrame);
  assert.equal(stampedFrame.publishedAtUs, 1_500);
  assert.equal(stampCameraStreamFramePublished(result.frame, 999), null);
  assert.equal(stampCameraStreamFramePublished(result.frame, 1.5), null);
  const stampedResult = stampCameraStreamResultPublished(result, 1_500);
  assert.ok(stampedResult);
  assert.equal(stampedResult.event, "subscribed");
  assert.equal(stampedResult.frame.publishedAtUs, 1_500);

  for (const sourceTimestampUs of [undefined, 1.5, -1, "now"]) {
    const frame = buildChaseCameraStreamFrame({
      subscriptionId: "chase-cam:test",
      actorId: "chaser",
      cameraId: "front_camera",
      fingerprint: buildFingerprint(),
      image: buildImage(),
      sourceTimestampUs,
    });
    assert.equal(frame, null);
    const invalid = buildSubscribeResult({ sourceTimestampUs });
    assert.equal(invalid.event, "unsupported");
    assert.equal(invalid.cameraStream.reason.code, "source_timestamp_invalid");
    assert.equal("frame" in invalid, false);
  }
});

test("camera stream dropPolicy defaults to latest-frame and rejects unknown values", () => {
  const defaultPolicy = resolveChaseCameraStreamRequest({});
  assert.equal(defaultPolicy.ok, true);
  assert.equal(defaultPolicy.value.dropPolicy, "latest-frame");
  for (const dropPolicy of ["lossy", 123, null, {}]) {
    const result = buildSubscribeResult({ request: { dropPolicy } });
    assert.equal(result.event, "unsupported");
    assert.equal(result.cameraStream.reason.code, "drop_policy_invalid");
    assert.equal("frame" in result, false);
  }
});

test("camera stream subscribe handler stamps the first result immediately before sending", () => {
  const sent = [];
  const handled = handleCameraStreamCommand(
    { type: "play_camera_stream_subscribe", request_id: "stream-sub-1" },
    "stream-sub-1",
    {
      sendMessage(message) {
        sent.push(message);
        return true;
      },
      sendError() {},
      onPlayCameraStreamSubscribe: () => buildSubscribeResult(),
      onPlayCameraStreamUnsubscribe: () => ({
        event: "unsubscribed",
        subscriptionId: "chase-cam:test",
      }),
    },
  );
  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.event, "subscribed");
  assert.equal(Number.isInteger(sent[0].payload.frame.sourceTimestampUs), true);
  assert.equal(Number.isInteger(sent[0].payload.frame.publishedAtUs), true);
  assert.ok(sent[0].payload.frame.publishedAtUs >= sent[0].payload.frame.sourceTimestampUs);
});

function createRuntimeHarness({ emit = () => true } = {}) {
  let now = 0;
  let fingerprint = buildFingerprint();
  const runtime = createChaseCameraStreamRuntime({
    getCapability: () => buildChaseCameraStreamCapability(),
    getFingerprint: () => fingerprint,
    capture: buildImage,
    now: () => now,
    sourceNow: () => now,
    publishNow: () => now,
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

test("camera stream none policy queues sampled frames in order without counting queueing as drops", () => {
  const emitted = [];
  const deliveryResolvers = [];
  const harness = createRuntimeHarness({
    emit: (message) => {
      emitted.push(message);
      return { then(resolve) { deliveryResolvers.push(resolve); } };
    },
  });
  harness.runtime.handleSubscribe({ maxRateHz: 1, dropPolicy: "none" }, harness.emit);
  for (const [frameIndex, time] of [[43, 1_000], [44, 2_000], [45, 3_000]]) {
    harness.setFingerprint(buildFingerprint({ frameIndex }));
    harness.setNow(time);
    harness.runtime.handleSimulationFrame({ frameIndex, simulationEpoch: "chase-run:test" });
  }
  assert.equal(emitted.length, 1);
  deliveryResolvers[0]();
  assert.equal(emitted[1].payload.frameIdentity.frameIndex, 44);
  assert.equal(emitted[1].payload.droppedFrameCount, 0);
  assert.equal(emitted[1].payload.sourceTimestampUs, 2_000_000);
  assert.equal(emitted[1].payload.publishedAtUs, 3_000_000);
  deliveryResolvers[1]();
  assert.equal(emitted[2].payload.frameIdentity.frameIndex, 45);
  assert.ok(emitted[2].payload.sourceTimestampUs >= emitted[1].payload.sourceTimestampUs);
});

test("camera stream none policy ends at the bounded pending queue", () => {
  const emitted = [];
  const harness = createRuntimeHarness({
    emit: (message) => {
      emitted.push(message);
      return { then() {} };
    },
  });
  harness.runtime.handleSubscribe({ maxRateHz: 1, dropPolicy: "none" }, harness.emit);
  for (let frameIndex = 43; frameIndex <= 52; frameIndex += 1) {
    harness.setFingerprint(buildFingerprint({ frameIndex }));
    harness.setNow((frameIndex - 42) * 1_000);
    harness.runtime.handleSimulationFrame({ frameIndex, simulationEpoch: "chase-run:test" });
  }
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].payload.event, "ended");
  assert.equal(emitted[1].payload.reason.code, "backpressure_overflow");
  assert.equal("frame" in emitted[1].payload, false);
});

test("camera stream maxRateHz sampling still increments droppedFrameCount with none policy", () => {
  const emitted = [];
  const harness = createRuntimeHarness({ emit: (message) => {
    emitted.push(message);
    return true;
  } });
  harness.runtime.handleSubscribe({ maxRateHz: 1, dropPolicy: "none" }, harness.emit);
  for (const [frameIndex, time] of [[43, 1_000], [44, 1_050], [45, 2_000]]) {
    harness.setFingerprint(buildFingerprint({ frameIndex }));
    harness.setNow(time);
    harness.runtime.handleSimulationFrame({ frameIndex, simulationEpoch: "chase-run:test" });
  }
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].payload.frameIdentity.frameIndex, 45);
  assert.equal(emitted[1].payload.droppedFrameCount, 1);
});
