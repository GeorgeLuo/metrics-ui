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
