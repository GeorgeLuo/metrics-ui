import test from "node:test";
import assert from "node:assert/strict";
import { FrontendRequestTracker } from "./frontend-request-tracker.ts";

test("registered frontend timeout is distinct from missing registration", async () => {
  const tracker = new FrontendRequestTracker<object, object>(5);
  const responses: unknown[] = [];
  tracker.track({
    command: {
      type: "play_game_query",
      queryId: "atomic-evaluation-capture",
      request_id: "passive-timeout",
    },
    frontend: {},
    agent: {},
    respond: (response) => responses.push(response),
  });

  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(responses, [{
    type: "error",
    error: "Registered frontend did not respond",
    request_id: "passive-timeout",
    payload: {
      supported: false,
      code: "frontend_unresponsive",
      missing: "frontend_response",
      command: "play_game_query",
      queryId: "atomic-evaluation-capture",
      timeoutMs: 5,
    },
  }]);
});

test("frontend response cancels the unresponsive timeout", async () => {
  const tracker = new FrontendRequestTracker<object, object>(5);
  const frontend = {};
  const responses: unknown[] = [];
  tracker.track({
    command: {
      type: "get_play_game_usage",
      request_id: "usage-ok",
    },
    frontend,
    agent: {},
    respond: (response) => responses.push(response),
  });
  tracker.resolve(frontend, {
    type: "play_game_usage",
    request_id: "usage-ok",
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(responses, []);
});

test("frontend disconnect fails its pending request immediately", () => {
  const tracker = new FrontendRequestTracker<object, object>(1_000);
  const frontend = {};
  const responses: unknown[] = [];
  tracker.track({
    command: {
      type: "get_play_debug",
      request_id: "debug-disconnect",
    },
    frontend,
    agent: {},
    respond: (response) => responses.push(response),
  });
  tracker.failFrontend(frontend);

  assert.equal(
    (responses[0] as { payload: { code: string } }).payload.code,
    "frontend_disconnected",
  );
});
