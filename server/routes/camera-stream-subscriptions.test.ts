import test from "node:test";
import assert from "node:assert/strict";
import type { ControlCommand, ControlResponse } from "@shared/schema";
import {
  CameraStreamSubscriptionRegistry,
  type CameraStreamSocket,
} from "./camera-stream-subscriptions";

type FakeSocket = CameraStreamSocket & {
  id: string;
  sent: ControlResponse[];
  readyState: number;
};

function createSocket(id: string): FakeSocket {
  return {
    id,
    readyState: 1,
    sent: [],
    send() {},
  };
}

function createRegistry() {
  const frontendMessages: ControlCommand[] = [];
  const agentMessages: Array<{ agent: FakeSocket; message: ControlResponse }> = [];
  const registry = new CameraStreamSubscriptionRegistry<FakeSocket>({
    sendToFrontend(command) {
      frontendMessages.push(command);
      return true;
    },
    isOpen: (socket) => socket.readyState === 1,
    sendToAgent(agent, message) {
      agent.sent.push(message);
      agentMessages.push({ agent, message });
      return true;
    },
  });
  return { registry, frontendMessages, agentMessages };
}

function subscribeCommand(requestId: string): ControlCommand {
  return {
    type: "play_camera_stream_subscribe",
    request_id: requestId,
  };
}

function subscribedResponse(requestId: string, subscriptionId: string): ControlResponse {
  return {
    type: "play_camera_stream_result",
    request_id: requestId,
    payload: {
      event: "subscribed",
      subscriptionId,
      cameraStream: { supported: true },
      playback: { advanced: false },
      preservation: { preserved: true, before: {}, after: {} },
      frame: {},
    },
  };
}

function establishSubscription(
  registry: CameraStreamSubscriptionRegistry<FakeSocket>,
  agent: FakeSocket,
  requestId = `${agent.id}-subscribe`,
  subscriptionId = `chase-cam:${agent.id}`,
): string {
  const reservation = registry.handleAgentCommand(subscribeCommand(requestId), agent);
  assert.equal(reservation.forward, true);
  registry.handleFrontendMessage(subscribedResponse(requestId, subscriptionId));
  assert.equal(registry.getSubscriptionForAgent(agent), subscriptionId);
  return subscriptionId;
}

test("second subscribe on the same agent is rejected as already_subscribed without forwarding", () => {
  const { registry } = createRegistry();
  const agent = createSocket("agent-1");
  establishSubscription(registry, agent);

  const second = registry.handleAgentCommand({
    type: "play_camera_stream_subscribe",
    request_id: "second-subscribe",
  }, agent);

  assert.equal(second.forward, false);
  assert.equal(second.response?.payload && "event" in second.response.payload
    ? (second.response.payload as { event: string }).event
    : undefined, "unsupported");
  assert.equal(
    (second.response?.payload as { cameraStream: { reason: { code: string } } }).cameraStream.reason.code,
    "already_subscribed",
  );
  assert.equal(registry.getSubscriptionForAgent(agent), "chase-cam:agent-1");
});

test("unknown camera stream unsubscribe is rejected with subscription_not_found", () => {
  const { registry } = createRegistry();
  const agent = createSocket("agent-1");
  establishSubscription(registry, agent);

  const response = registry.handleAgentCommand({
    type: "play_camera_stream_unsubscribe",
    request_id: "bad-unsubscribe",
    subscriptionId: "chase-cam:other-agent",
  }, agent).response;

  assert.equal(response?.type, "play_camera_stream_result");
  assert.equal(
    (response?.payload as { cameraStream: { reason: { code: string } } }).cameraStream.reason.code,
    "subscription_not_found",
  );
  assert.equal(registry.getSubscriptionForAgent(agent), "chase-cam:agent-1");
});

test("registry forwards a camera frame only to the mapped agent, never to a second agent", () => {
  const { registry, agentMessages } = createRegistry();
  const subscriber = createSocket("subscriber");
  const secondAgent = createSocket("second");
  const subscriptionId = establishSubscription(registry, subscriber);
  agentMessages.length = 0;

  const handled = registry.handleFrontendMessage({
    type: "play_camera_stream_frame",
    payload: {
      subscriptionId,
      actorId: "chaser",
      cameraId: "front_camera",
      frameIdentity: { gameId: "chase", simulationEpoch: "run-1", frameIndex: 3 },
      sourceTimestampUs: 123_000,
      publishedAtUs: 124_000,
      playback: { advanced: false },
      droppedFrameCount: 0,
      sensor: { image: { contentType: "image/jpeg" } },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(agentMessages.map(({ agent, message }) => [agent.id, message.type]), [
    ["subscriber", "play_camera_stream_frame"],
  ]);
  assert.equal(secondAgent.sent.length, 0);
  assert.equal(registry.getAgentForSubscription(subscriptionId), subscriber);
  assert.equal(agentMessages[0]?.message.payload && "sourceTimestampUs" in agentMessages[0].message.payload
    ? (agentMessages[0].message.payload as { sourceTimestampUs: number }).sourceTimestampUs
    : undefined, 123_000);
  assert.equal(agentMessages[0]?.message.payload && "publishedAtUs" in agentMessages[0].message.payload
    ? (agentMessages[0].message.payload as { publishedAtUs: number }).publishedAtUs
    : undefined, 124_000);
});

test("agent disconnect removes the camera stream mapping and asks the frontend to unsubscribe", () => {
  const { registry, frontendMessages } = createRegistry();
  const agent = createSocket("agent-1");
  const subscriptionId = establishSubscription(registry, agent);

  registry.handleAgentDisconnect(agent);

  assert.equal(registry.getSubscriptionForAgent(agent), undefined);
  assert.equal(registry.getAgentForSubscription(subscriptionId), undefined);
  assert.deepEqual(frontendMessages.at(-1), {
    type: "play_camera_stream_unsubscribe",
    subscriptionId,
  });
});

test("frontend disconnect emits ended/frontend_disconnected to the camera stream subscriber", () => {
  const { registry, agentMessages } = createRegistry();
  const agent = createSocket("agent-1");
  const subscriptionId = establishSubscription(registry, agent);
  agentMessages.length = 0;

  registry.handleFrontendDisconnect();

  assert.deepEqual(agentMessages, [{
    agent,
    message: {
      type: "play_camera_stream_result",
      payload: {
        event: "ended",
        subscriptionId,
        reason: {
          code: "frontend_disconnected",
          message: "Frontend disconnected before the camera stream ended.",
        },
      },
    },
  }]);
  assert.equal(registry.size, 0);
});


test("frontend errors release a pending reservation and late success is stopped", () => {
  const { registry, frontendMessages } = createRegistry();
  const agent = createSocket("agent");
  registry.handleAgentCommand(subscribeCommand("failed"), agent);
  assert.equal(registry.handleFrontendMessage({ type: "error", request_id: "failed", error: "capture failed" }), true);
  assert.equal(registry.handleAgentCommand(subscribeCommand("retry"), agent).forward, true);
  registry.handleFrontendMessage(subscribedResponse("failed", "late"));
  assert.equal(frontendMessages.at(-1)?.type, "play_camera_stream_unsubscribe");
  assert.equal((frontendMessages.at(-1) as { subscriptionId: string }).subscriptionId, "late");
  registry.handleFrontendMessage(subscribedResponse("retry", "new"));
  assert.equal(registry.getSubscriptionForAgent(agent), "new");
});

test("timeout cleanup allows retry and does not cancel a newer reservation", async () => {
  const { FrontendRequestTracker } = await import("./frontend-request-tracker.ts");
  const { registry, frontendMessages } = createRegistry();
  const agent = createSocket("agent"), frontend = {};
  const command = subscribeCommand("timed-out");
  const tracker = new FrontendRequestTracker<object, FakeSocket>(5);
  registry.handleAgentCommand(command, agent);
  tracker.track({ command, frontend, agent, respond: () => registry.cancelAgentCommand(command, agent) });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(registry.handleAgentCommand(subscribeCommand("retry"), agent).forward, true);
  registry.cancelAgentCommand(command, agent);
  registry.handleFrontendMessage(subscribedResponse("timed-out", "late"));
  assert.equal((frontendMessages.at(-1) as { subscriptionId: string }).subscriptionId, "late");
  registry.handleFrontendMessage(subscribedResponse("retry", "new"));
  assert.equal(registry.getSubscriptionForAgent(agent), "new");
});

function cameraFrame(subscriptionId: string, frameIndex: number, image = "jpeg"): ControlResponse {
  return { type: "play_camera_stream_frame", payload: { subscriptionId, frameIdentity: { frameIndex }, droppedFrameCount: 0, sensor: { image } } };
}

test("agent socket buffering replaces pending latest frames and accounts for the dropped frames", async () => {
  const sent: ControlResponse[] = [], frontend: ControlCommand[] = [];
  const agent = { readyState: 1, bufferedAmount: 0, send(data: string) { sent.push(JSON.parse(data)); } };
  const registry = new CameraStreamSubscriptionRegistry({ sendToFrontend: (message) => { frontend.push(message); return true; } });
  registry.handleAgentCommand(subscribeCommand("sub"), agent);
  registry.handleFrontendMessage(subscribedResponse("sub", "stream"));
  agent.bufferedAmount = 500;
  for (let frame = 1; frame <= 10; frame++) registry.handleFrontendMessage(cameraFrame("stream", frame));
  assert.equal(sent.length, 1);
  agent.bufferedAmount = 0;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 2);
  assert.equal((sent[1].payload as any).frameIdentity.frameIndex, 10);
  assert.equal((sent[1].payload as any).droppedFrameCount, 9);
  assert.equal(frontend.length, 0);
  registry.handleAgentDisconnect(agent);
});

test("none agent transport overflows after eight pending frames and releases its mapping", () => {
  const sent: ControlResponse[] = [], frontend: ControlCommand[] = [];
  const agent = { readyState: 1, bufferedAmount: 0, send(data: string) { sent.push(JSON.parse(data)); } };
  const registry = new CameraStreamSubscriptionRegistry({ sendToFrontend: (message) => { frontend.push(message); return true; } });
  registry.handleAgentCommand({ ...subscribeCommand("sub"), dropPolicy: "none" } as ControlCommand, agent);
  registry.handleFrontendMessage(subscribedResponse("sub", "stream"));
  agent.bufferedAmount = 500;
  for (let frame = 1; frame <= 9; frame++) registry.handleFrontendMessage(cameraFrame("stream", frame));
  assert.equal((sent.at(-1)?.payload as any).reason.code, "backpressure_overflow");
  assert.equal(registry.size, 0);
  assert.equal((frontend.at(-1) as any).subscriptionId, "stream");
  assert.equal(registry.handleAgentCommand(subscribeCommand("retry"), agent).forward, true);
  registry.handleAgentDisconnect(agent);
});

test("a non-reading real WebSocket peer cannot grow camera transport buffering without a bound", async () => {
  const { WebSocket, WebSocketServer } = await import("ws");
  const { once } = await import("node:events");
  const { CAMERA_STREAM_MAX_MESSAGE_BYTES } = await import("../../shared/camera-stream-transport.ts");
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1", perMessageDeflate: false });
  await once(server, "listening");
  const connected = once(server, "connection");
  const peer = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  const [agent] = await connected;
  await once(peer, "open");
  peer.pause();
  const cleanup: ControlCommand[] = [];
  const registry = new CameraStreamSubscriptionRegistry({ sendToFrontend: (message) => { cleanup.push(message); return true; } });
  try {
    registry.handleAgentCommand({ ...subscribeCommand("sub"), dropPolicy: "none" } as ControlCommand, agent);
    registry.handleFrontendMessage(subscribedResponse("sub", "stream"));
    let maximumBuffered = 0;
    const image = "x".repeat(512 * 1024);
    for (let i = 0; i < 100; i++) {
      registry.handleFrontendMessage(cameraFrame("stream", i, image));
      maximumBuffered = Math.max(maximumBuffered, agent.bufferedAmount);
      if (registry.size === 0) break;
    }
    assert.ok(maximumBuffered <= CAMERA_STREAM_MAX_MESSAGE_BYTES + 4096);
    assert.equal(registry.size, 0);
    assert.equal((cleanup.at(-1) as any).subscriptionId, "stream");
  } finally {
    registry.handleAgentDisconnect(agent);
    peer.terminate(); agent.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("failed first-image transport returns the original request identity and releases the reservation", () => {
  const sent: ControlResponse[] = [];
  const agent = { readyState: 1, bufferedAmount: 0, send(data: string) { sent.push(JSON.parse(data)); } };
  const registry = new CameraStreamSubscriptionRegistry({ sendToFrontend: () => true });
  registry.handleAgentCommand(subscribeCommand("first-image"), agent);
  const result = subscribedResponse("first-image", "stream");
  (result.payload as any).frame = { image: "x".repeat(1024 * 1024) };
  registry.handleFrontendMessage(result);
  assert.equal(registry.size, 0);
  assert.equal(sent[0].request_id, "first-image");
  assert.equal((sent[0].payload as any).event, "unsupported");
  assert.equal(registry.handleAgentCommand(subscribeCommand("retry"), agent).forward, true);
  registry.handleAgentDisconnect(agent);
});

test("unsubscribe errors release both the pending request and its active mapping", () => {
  const { registry, frontendMessages } = createRegistry();
  const agent = createSocket("agent");
  const subscriptionId = establishSubscription(registry, agent);
  registry.handleAgentCommand({ type: "play_camera_stream_unsubscribe", request_id: "unsub", subscriptionId }, agent);
  registry.handleFrontendMessage({ type: "ui_error", request_id: "unsub", error: "unavailable" });
  assert.equal(registry.size, 0);
  assert.equal((frontendMessages.at(-1) as { subscriptionId: string }).subscriptionId, subscriptionId);
  assert.equal(registry.handleAgentCommand(subscribeCommand("retry"), agent).forward, true);
});
