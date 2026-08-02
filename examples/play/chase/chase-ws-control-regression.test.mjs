import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilitiesPayload } from "../../../shared/protocol-utils.ts";
import { CHASER_CONTROL_SOURCES } from "./config/constants.mjs";
import { handleQueryCommand } from "../../../client/src/hooks/ws/handlers/query.ts";
import {
  CHASE_PLAY_COMMAND_IDS,
  handleChasePlayCommand,
} from "./ui/chase-play-commands.mjs";
import {
  CHASE_PLAY_QUERY_IDS,
  handleChasePlayQuery,
} from "./ui/chase-play-queries.mjs";
import { createChaseLoop } from "./ui/chase-loop.mjs";
import { buildChasePlayUsage } from "./ui/chase-play-usage.mjs";
import { createControlInputTracker } from "./ui/input-tracker.mjs";
import {
  buildChasePassiveObservationCapability,
} from "./evaluation/passive-observation.ts";

function createKeyboardWindowStub() {
  const listeners = new Map();
  return {
    innerWidth: 800,
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchKeyboardEvent(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({
          target: null,
          preventDefault() {},
          ...event,
        });
      }
    },
  };
}

function createAnimationFrameWindowStub() {
  return {
    closed: false,
    scheduled: [],
    canceled: [],
    requestAnimationFrame(callback) {
      const id = this.scheduled.length + 1;
      this.scheduled.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) {
      this.canceled.push(id);
    },
  };
}

test("chase play commands adapt generic host commands to chaser controls", () => {
  const calls = [];
  const handlers = {
    setChaserInput: (input) => calls.push(["input", input]),
    setChaserControlSource: (source) => calls.push(["source", source]),
  };

  assert.equal(handleChasePlayCommand({
    commandId: CHASE_PLAY_COMMAND_IDS.SET_CHASER_INPUT,
    payload: { motion: "forward", steering: -0.35 },
  }, handlers), true);
  assert.equal(handleChasePlayCommand({
    commandId: CHASE_PLAY_COMMAND_IDS.SET_CHASER_CONTROL_SOURCE,
    payload: { source: CHASER_CONTROL_SOURCES.WS },
  }, handlers), true);
  assert.equal(handleChasePlayCommand({
    commandId: CHASE_PLAY_COMMAND_IDS.SET_CHASER_CONTROL_SOURCE,
    payload: { source: "invalid" },
  }, handlers), false);
  assert.equal(handleChasePlayCommand({ commandId: "unknown" }, handlers), false);

  assert.deepEqual(calls, [
    ["input", { motion: "forward", steering: -0.35 }],
    ["source", CHASER_CONTROL_SOURCES.WS],
  ]);
});

test("chase play usage documents CLI flow and game command ids", () => {
  const usage = buildChasePlayUsage({
    passiveObservation: buildChasePassiveObservationCapability({
      evaderExists: false,
    }),
  });
  const commandIds = new Set((usage.wireCommands ?? []).map((command) => command.commandId));

  assert.equal(usage.game.id, "chase");
  assert.ok(commandIds.has(CHASE_PLAY_COMMAND_IDS.SET_CHASER_INPUT));
  assert.ok(commandIds.has(CHASE_PLAY_COMMAND_IDS.SET_CHASER_CONTROL_SOURCE));
  assert.ok(
    usage.setup.some((step) => step.command.includes("simeval ui subapp --app play")),
    "expected usage setup to explain switching to the Play sub-app",
  );
  assert.ok(
    usage.cli.some((group) => group.commands.some((command) => command.command.includes("play-chaser-control"))),
    "expected usage CLI examples to include chaser control",
  );
  assert.ok(
    usage.cli.some((group) => group.commands.some((command) => command.command.includes("rendering-seed"))),
    "expected usage CLI examples to include deterministic rendering variation",
  );
  assert.equal(
    usage.protocol.evaluationCaptureQueryId,
    CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
  );
  assert.ok(
    usage.cli.some((group) => group.commands.some((command) => command.command.includes("play-evaluation-capture"))),
    "expected usage CLI examples to include persisted evaluation capture",
  );
  assert.deepEqual(usage.protocol.passiveObservation.actors, ["chaser"]);
  assert.deepEqual(usage.protocol.passiveObservation.cameras, ["front_camera"]);
});

test("chase play queries adapt atomic capture requests without owning transport", () => {
  const calls = [];
  const capture = { captureId: "chase:evaluation:run-1:chaser:7" };

  assert.equal(handleChasePlayQuery({
    queryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
    payload: {
      actorId: "chaser",
      cameraId: "front_camera",
      width: 640,
      height: 480,
      ignored: true,
    },
  }, {
    getAtomicEvaluationCapture: (options) => {
      calls.push(options);
      return capture;
    },
  }), capture);
  assert.equal(handleChasePlayQuery({ queryId: "unknown" }, {}), undefined);
  assert.deepEqual(calls, [{
    actorId: "chaser",
    cameraId: "front_camera",
    width: 640,
    height: 480,
  }]);
});

test("chase play queries preserve malformed actor and camera types for capture validation", () => {
  const calls = [];
  handleChasePlayQuery({
    queryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
    payload: {
      actorId: 123,
      cameraId: null,
      width: 640,
    },
  }, {
    getAtomicEvaluationCapture: (options) => {
      calls.push(options);
      return { passiveObservation: { supported: false } };
    },
  });
  assert.deepEqual(calls, [{
    actorId: 123,
    cameraId: null,
    width: 640,
  }]);
});

test("generic Play query transport returns the active game result and an ack", () => {
  const sent = [];
  const acknowledgements = [];
  const errors = [];
  const result = { captureId: "chase:evaluation:run-1:chaser:7" };
  const context = {
    onPlayGameQuery(query) {
      assert.deepEqual(query, {
        queryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
        payload: { actorId: "chaser" },
      });
      return result;
    },
    sendMessage(message) {
      sent.push(message);
      return true;
    },
    sendAck(requestId, command) {
      acknowledgements.push({ requestId, command });
    },
    sendError(requestId, error, details) {
      errors.push({ requestId, error, details });
    },
  };

  assert.equal(handleQueryCommand({
    type: "play_game_query",
    request_id: "evaluation-1",
    queryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
    payload: { actorId: "chaser" },
  }, "evaluation-1", context), true);
  assert.deepEqual(sent, [{
    type: "play_game_query_result",
    request_id: "evaluation-1",
    payload: {
      queryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
      result,
    },
  }]);
  assert.deepEqual(acknowledgements, [{
    requestId: "evaluation-1",
    command: "play_game_query",
  }]);
  assert.deepEqual(errors, []);
});

test("generic Play query transport is discoverable through protocol capabilities", () => {
  const capabilities = buildCapabilitiesPayload();

  assert.equal(capabilities.protocolVersion, "1.3.0");
  assert.ok(capabilities.commands.includes("play_game_query"));
  assert.ok(capabilities.responses.includes("play_game_query_result"));
});

test("generic Play query transport rejects unsupported query ids visibly", () => {
  const errors = [];
  const context = {
    onPlayGameQuery() {
      return undefined;
    },
    sendMessage() {
      return true;
    },
    sendAck() {
      assert.fail("unsupported queries must not be acknowledged");
    },
    sendError(requestId, error, details) {
      errors.push({ requestId, error, details });
    },
  };

  assert.equal(handleQueryCommand({
    type: "play_game_query",
    queryId: "unknown",
  }, "query-unsupported", context), true);
  assert.deepEqual(errors, [{
    requestId: "query-unsupported",
    error: "Play game query is not supported: unknown",
    details: { queryId: "unknown" },
  }]);
});

test("keyboard chaser input can relay from a popout window", () => {
  const originalWindow = globalThis.window;
  const mainWindow = createKeyboardWindowStub();
  const popoutWindow = createKeyboardWindowStub();
  globalThis.window = mainWindow;
  try {
    const tracker = createControlInputTracker();
    tracker.setKeyboardRelayWindow(popoutWindow);

    popoutWindow.dispatchKeyboardEvent("keydown", { code: "KeyI" });
    popoutWindow.dispatchKeyboardEvent("keydown", { code: "KeyD" });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.KEYBOARD), {
      source: "human",
      forward: true,
      reverse: false,
      steering: -1,
    });

    mainWindow.dispatchKeyboardEvent("blur");
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.KEYBOARD), {
      source: "human",
      forward: true,
      reverse: false,
      steering: -1,
    });

    popoutWindow.dispatchKeyboardEvent("keyup", { code: "KeyI" });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.KEYBOARD), {
      source: "human",
      forward: false,
      reverse: false,
      steering: -1,
    });

    popoutWindow.dispatchKeyboardEvent("blur");
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.KEYBOARD), {
      source: "human",
      forward: false,
      reverse: false,
      steering: 0,
    });

    tracker.setKeyboardRelayWindow(null);
    popoutWindow.dispatchKeyboardEvent("keydown", { code: "KeyI" });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.KEYBOARD), {
      source: "human",
      forward: false,
      reverse: false,
      steering: 0,
    });
    tracker.dispose();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("chase loop can schedule from the actor-view popout window", () => {
  const originalWindow = globalThis.window;
  const mainWindow = createAnimationFrameWindowStub();
  const popoutWindow = createAnimationFrameWindowStub();
  globalThis.window = mainWindow;
  try {
    const loop = createChaseLoop({
      simulationState: {},
      simulationSettings: {},
      inputTracker: { getChaserInput: () => ({}) },
      sceneView: {
        getAnimationFrameWindow: () => popoutWindow,
        renderFrame: () => ({
          chaserSnapshot: null,
          actorSnapshots: {},
          timings: {},
          visibility: {},
        }),
      },
      performanceTracker: {
        getSnapshot: () => ({}),
        recordTick() {},
      },
      getPredictionDebugState: () => ({}),
      getProjectionSettings: () => ({}),
      getActionPathDebugSettings: () => ({}),
      getMapKnowledgeDebugSettings: () => ({}),
      getVisibility: () => ({}),
    });

    assert.equal(popoutWindow.scheduled.length, 1);
    assert.equal(mainWindow.scheduled.length, 0);
    loop.dispose();
    assert.deepEqual(popoutWindow.canceled, [1]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("chase loop can reschedule from a closed actor-view popout window", () => {
  const originalWindow = globalThis.window;
  const mainWindow = createAnimationFrameWindowStub();
  const popoutWindow = createAnimationFrameWindowStub();
  globalThis.window = mainWindow;
  try {
    const loop = createChaseLoop({
      simulationState: {},
      simulationSettings: {},
      inputTracker: { getChaserInput: () => ({}) },
      sceneView: {
        getAnimationFrameWindow: () => popoutWindow,
        renderFrame: () => ({
          chaserSnapshot: null,
          actorSnapshots: {},
          timings: {},
          visibility: {},
        }),
      },
      performanceTracker: {
        getSnapshot: () => ({}),
        recordTick() {},
      },
      getPredictionDebugState: () => ({}),
      getProjectionSettings: () => ({}),
      getActionPathDebugSettings: () => ({}),
      getMapKnowledgeDebugSettings: () => ({}),
      getVisibility: () => ({}),
    });

    assert.equal(popoutWindow.scheduled.length, 1);
    popoutWindow.closed = true;
    loop.rescheduleAnimationFrameSource();

    assert.deepEqual(popoutWindow.canceled, [1]);
    assert.equal(mainWindow.scheduled.length, 1);

    loop.dispose();
    assert.deepEqual(mainWindow.canceled, [1]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("chase loop falls back if a popout closes before its scheduled frame fires", async () => {
  const originalWindow = globalThis.window;
  const mainWindow = createAnimationFrameWindowStub();
  const popoutWindow = createAnimationFrameWindowStub();
  globalThis.window = mainWindow;
  try {
    const loop = createChaseLoop({
      simulationState: {},
      simulationSettings: {},
      inputTracker: { getChaserInput: () => ({}) },
      sceneView: {
        getAnimationFrameWindow: () => popoutWindow,
        renderFrame: () => ({
          chaserSnapshot: null,
          actorSnapshots: {},
          timings: {},
          visibility: {},
        }),
      },
      performanceTracker: {
        getSnapshot: () => ({}),
        recordTick() {},
      },
      getPredictionDebugState: () => ({}),
      getProjectionSettings: () => ({}),
      getActionPathDebugSettings: () => ({}),
      getMapKnowledgeDebugSettings: () => ({}),
      getVisibility: () => ({}),
      closedAnimationFrameWatchdogMs: 0,
    });

    assert.equal(popoutWindow.scheduled.length, 1);
    popoutWindow.closed = true;
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    assert.deepEqual(popoutWindow.canceled, [1]);
    assert.equal(mainWindow.scheduled.length, 1);

    loop.dispose();
    assert.deepEqual(mainWindow.canceled, [1]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("ws chaser input latches until changed", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    const tracker = createControlInputTracker();
    tracker.setWsInput({ motion: "forward", steering: 2 });
    const forwardInput = {
      source: "ws",
      forward: true,
      reverse: false,
      steering: 1,
    };
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), forwardInput);
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), forwardInput);
    tracker.setWsInput({ motion: "none", steering: -0.25 });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), {
      source: "ws",
      forward: false,
      reverse: false,
      steering: -0.25,
    });
    tracker.setWsInput({ steering: -0.75 });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), {
      source: "ws",
      forward: false,
      reverse: false,
      steering: -0.75,
    });
    tracker.setWsInput({ motion: "forward", steering: undefined });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), {
      source: "ws",
      forward: true,
      reverse: false,
      steering: -0.75,
    });
    tracker.setWsInput({
      motion: undefined,
      forward: undefined,
      reverse: undefined,
      steering: -0.5,
    });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), {
      source: "ws",
      forward: true,
      reverse: false,
      steering: -0.5,
    });
    tracker.setWsInput({ steering: 0 });
    assert.deepEqual(tracker.getChaserInput(CHASER_CONTROL_SOURCES.WS), {
      source: "ws",
      forward: true,
      reverse: false,
      steering: 0,
    });
    tracker.dispose();
  } finally {
    globalThis.window = originalWindow;
  }
});
