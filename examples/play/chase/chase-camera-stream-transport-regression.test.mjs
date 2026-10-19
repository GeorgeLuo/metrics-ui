import { createChaseScenarioSession } from "./ui/scenario-session.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createChaseCameraStreamRuntime } from "./ui/camera-stream-runtime.mjs";
import { createChaseSimulationState, stepChaseSimulation } from "./simulation/simulation.mjs";
import { buildChaseCameraStreamCapability, buildChasePassiveObservationFingerprint } from "./evaluation/camera-stream.ts";
import { createCameraStreamSocketSession } from "../../../client/src/hooks/ws/camera-stream-socket.ts";
import { handleCameraStreamCommand } from "../../../client/src/hooks/ws/handlers/camera-stream.ts";
import { CAMERA_STREAM_MAX_MESSAGE_BYTES } from "../../../shared/camera-stream-transport.ts";

const delay = () => new Promise((resolve) => setTimeout(resolve, 35));
function fixture() {
  const state = createChaseSimulationState({ columns: 9, rows: 6, scenario: createChaseScenarioSession({ columns: 9, rows: 6 }).buildScenario() });
  const socket = { readyState: 1, bufferedAmount: 0, sent: [], block: false,
    send(data) { this.sent.push(JSON.parse(data)); if (this.block) this.bufferedAmount += Buffer.byteLength(data); } };
  let now = 0, id = 0;
  const capturedAt = [];
  const runtime = createChaseCameraStreamRuntime({
    getCapability: () => buildChaseCameraStreamCapability(),
    getFingerprint: () => buildChasePassiveObservationFingerprint({ scenarioId: "test-scenario", simulationEpoch: "epoch", frameIndex: state.frameIndex,
      pauseBeforeActions: state.simulationSettings.pauseBeforeActions, pendingAction: Boolean(state.pendingActionFrame), controlSource: state.chaserControlSource,
      controlInput: null, actorId: "chaser" }),
    capture: () => {
      capturedAt.push(now);
      return { contentType: "image/jpeg", rendererId: "test", width: 320, height: 240, dataUrl: "data:image/jpeg;base64,dGVzdA==" };
    },
    now: () => now,
    sourceNow: () => performance.now(), publishNow: () => performance.now(),
    createSubscriptionId: () => `stream:${++id}`,
  });
  const context = {
    cameraStreamSession: createCameraStreamSocketSession(socket, runtime.handleUnsubscribe),
    onPlayCameraStreamSubscribe: runtime.handleSubscribe,
    onPlayCameraStreamUnsubscribe: runtime.handleUnsubscribe,
    sendMessage(message) { socket.send(JSON.stringify(message)); return true; },
    sendError(...args) { assert.fail(JSON.stringify(args)); },
  };
  return { state, socket, runtime, context, capturedAt,
    subscribe(dropPolicy = "latest-frame", maxRateHz = 30) { handleCameraStreamCommand({ type: "play_camera_stream_subscribe", dropPolicy, maxRateHz }, "subscribe", context); },
    step(time = now + 100) { stepChaseSimulation(state); now = time; runtime.handleSimulationFrame({ frameIndex: state.frameIndex, simulationEpoch: "epoch" }); },
    close() { context.cameraStreamSession.close(); },
  };
}

test("real subscription command preserves simulation state and reconnect permits a fresh subscription", async () => {
  const f = fixture();
  try {
    const before = JSON.stringify(f.state);
    f.subscribe();
    assert.equal(f.socket.sent[0].payload.event, "subscribed");
    assert.equal(JSON.stringify(f.state), before);
    f.socket.block = true;
    f.step(); f.step();
    const previous = f.context.cameraStreamSession;
    f.close();
    const reconnected = { readyState: 1, bufferedAmount: 0, sent: [], send(data) { this.sent.push(JSON.parse(data)); } };
    f.context.cameraStreamSession = createCameraStreamSocketSession(reconnected, f.runtime.handleUnsubscribe);
    f.subscribe();
    assert.equal(reconnected.sent[0].payload.event, "subscribed");
    assert.notEqual(reconnected.sent[0].payload.subscriptionId, f.socket.sent[0].payload.subscriptionId);
    f.socket.bufferedAmount = 0;
    await delay();
    assert.equal(reconnected.sent.length, 1);
    assert.equal(await previous.send({ type: "play_camera_stream_frame", payload: {} }), false);
  } finally { f.close(); }
});

test("browser bufferedAmount gates production sends and latest-frame retains the newest sampled frame", async () => {
  const f = fixture();
  try {
    f.subscribe(); f.socket.block = true;
    for (let i = 0; i < 5; i++) f.step();
    assert.equal(f.socket.sent.length, 2);
    assert.ok(f.socket.bufferedAmount <= CAMERA_STREAM_MAX_MESSAGE_BYTES);
    f.socket.block = false; f.socket.bufferedAmount = 0;
    await delay();
    assert.deepEqual(f.socket.sent.slice(1).map((message) => message.payload.frameIdentity.frameIndex), [1, 5]);
    assert.equal(f.socket.sent.at(-1).payload.droppedFrameCount, 3);
    assert.ok(f.socket.sent.at(-1).payload.publishedAtUs >= f.socket.sent.at(-1).payload.sourceTimestampUs);
  } finally { f.close(); }
});

test("browser none policy drains in order and overflow ends the stream with a bounded socket buffer", async () => {
  const f = fixture();
  try {
    f.subscribe("none"); f.socket.block = true;
    f.step(); f.step(); f.step();
    assert.equal(f.socket.sent.length, 2);
    f.socket.block = false; f.socket.bufferedAmount = 0;
    await delay();
    assert.deepEqual(f.socket.sent.slice(1).map((message) => message.payload.frameIdentity.frameIndex), [1, 2, 3]);
    f.socket.block = true;
    for (let i = 0; i < 10; i++) f.step();
    const ended = f.socket.sent.at(-1);
    assert.equal(ended.payload.event, "ended");
    assert.equal(ended.payload.reason.code, "backpressure_overflow");
    assert.ok(f.socket.bufferedAmount <= CAMERA_STREAM_MAX_MESSAGE_BYTES + 4096);
    f.socket.block = false; f.socket.bufferedAmount = 0;
    f.subscribe("none");
    await delay();
    assert.equal(f.socket.sent.at(-1).payload.event, "subscribed", JSON.stringify(f.socket.sent.map((m) => [m.type, m.payload.event, m.payload.reason, m.payload.cameraStream])));
  } finally { f.close(); }
});

test("first subscribe image waits for existing socket data and is timestamped at its actual send", async () => {
  const f = fixture();
  try {
    f.socket.bufferedAmount = 50;
    f.subscribe();
    assert.equal(f.socket.sent.length, 0);
    const drainedAtUs = Math.round(performance.now() * 1000);
    f.socket.bufferedAmount = 0;
    await delay();
    assert.equal(f.socket.sent[0].payload.event, "subscribed");
    assert.ok(f.socket.sent[0].payload.frame.publishedAtUs >= drainedAtUs);
  } finally { f.close(); }
});

test("a failed first image returns a correlated failure and releases the runtime subscription", async () => {
  const f = fixture();
  try {
    // A healthy but busy socket has a bounded waiting time even while paused.
    f.socket.bufferedAmount = 10;
    const originalNow = Date.now;
    let elapsed = 0;
    Date.now = () => elapsed;
    try {
      f.subscribe();
      elapsed = 5001;
      await delay();
    } finally { Date.now = originalNow; }
    assert.equal(f.socket.sent[0].request_id, "subscribe");
    assert.equal(f.socket.sent[0].payload.event, "unsupported");
    assert.equal(f.socket.sent[0].payload.cameraStream.reason.code, "backpressure_overflow");
    f.socket.bufferedAmount = 0;
    f.subscribe();
    assert.equal(f.socket.sent.at(-1).payload.event, "subscribed");
  } finally { f.close(); }
});


for (const policy of ["latest-frame", "none"]) {
  test(`1 Hz ${policy} capture cadence survives a buffered socket and queued-frame drainage`, async () => {
    const f = fixture();
    try {
      f.subscribe(policy, 1);
      f.socket.block = true;
      f.step(1000);
      f.step(2000);
      for (let time = 2100; time <= 2900; time += 100) f.step(time);
      assert.deepEqual(f.capturedAt, [0, 1000, 2000]);
      assert.equal(f.socket.sent.some((message) => message.payload.event === "ended"), false);
      f.socket.block = false;
      f.socket.bufferedAmount = 0;
      await delay();
      f.step(3000);
      assert.deepEqual(f.capturedAt, [0, 1000, 2000, 3000]);
      assert.equal(f.socket.sent.at(-1).type, "play_camera_stream_frame");
    } finally { f.close(); }
  });
}
