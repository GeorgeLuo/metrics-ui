import test from "node:test";
import assert from "node:assert/strict";
import { sendControlSocketMessage } from "./socket-send.ts";

function buildSocket(readyState = WebSocket.OPEN) {
  const messages: string[] = [];
  return {
    socket: {
      readyState,
      send(message: string) {
        messages.push(message);
      },
    },
    messages,
  };
}

test("frontend response uses the socket that received the command", () => {
  const active = buildSocket();
  const receiver = buildSocket();

  assert.equal(sendControlSocketMessage({
    activeSocket: active.socket,
    responseSocket: receiver.socket,
    isRegistered: false,
    isResponse: true,
    serializedMessage: "{\"type\":\"play_game_usage\"}",
  }), true);
  assert.deepEqual(active.messages, []);
  assert.deepEqual(receiver.messages, ["{\"type\":\"play_game_usage\"}"]);
});

test("unregistered command output remains blocked", () => {
  const active = buildSocket();

  assert.equal(sendControlSocketMessage({
    activeSocket: active.socket,
    isRegistered: false,
    isResponse: false,
    serializedMessage: "{\"type\":\"play_game_action\"}",
  }), false);
  assert.deepEqual(active.messages, []);
});
