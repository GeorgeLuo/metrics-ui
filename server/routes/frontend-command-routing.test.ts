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
