import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFrontendDisconnectedResponse,
  buildFrontendUnavailableResponse,
  buildFrontendUnresponsiveResponse,
  requiresFrontendResponse,
} from "./frontend-command-routing.ts";

test("read-only Play probes require a connected frontend response", () => {
  assert.equal(requiresFrontendResponse({
    type: "play_game_query",
    queryId: "atomic-evaluation-capture",
  }), true);
  assert.equal(requiresFrontendResponse({
    type: "get_play_game_usage",
  }), true);
  assert.equal(requiresFrontendResponse({
    type: "play_game_command",
    commandId: "set-chaser-input",
  }), false);
});

test("camera stream subscribe and unsubscribe require a connected frontend", () => {
  const subscribe = {
    type: "play_camera_stream_subscribe" as const,
    request_id: "stream-sub-1",
  };
  const unsubscribe = {
    type: "play_camera_stream_unsubscribe" as const,
    request_id: "stream-unsub-1",
    subscriptionId: "chase-cam:test",
  };

  assert.equal(requiresFrontendResponse(subscribe), true);
  assert.equal(requiresFrontendResponse(unsubscribe), true);
  assert.equal(
    (buildFrontendUnavailableResponse(subscribe).payload as { command: string }).command,
    "play_camera_stream_subscribe",
  );
  assert.equal(
    (buildFrontendUnavailableResponse(unsubscribe).payload as { command: string }).command,
    "play_camera_stream_unsubscribe",
  );
});

test("missing frontend returns structured unsupported query details", () => {
  assert.deepEqual(buildFrontendUnavailableResponse({
    type: "play_game_query",
    request_id: "passive-1",
    queryId: "atomic-evaluation-capture",
    payload: { actorId: "chaser" },
  }), {
    type: "error",
    error: "Frontend not connected",
    request_id: "passive-1",
    payload: {
      supported: false,
      code: "frontend_not_connected",
      missing: "frontend_registration",
      command: "play_game_query",
      queryId: "atomic-evaluation-capture",
    },
  });
});

test("registered but unresponsive frontend has a distinct structured failure", () => {
  const command = {
    type: "play_game_query" as const,
    request_id: "passive-2",
    queryId: "atomic-evaluation-capture",
  };
  assert.equal(
    (buildFrontendUnresponsiveResponse(command, 3_000).payload as { code: string }).code,
    "frontend_unresponsive",
  );
  assert.equal(
    (buildFrontendDisconnectedResponse(command).payload as { code: string }).code,
    "frontend_disconnected",
  );
});
