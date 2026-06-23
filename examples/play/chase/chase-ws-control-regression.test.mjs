import test from "node:test";
import assert from "node:assert/strict";
import { CHASER_CONTROL_SOURCES } from "./config/constants.mjs";
import {
  CHASE_PLAY_COMMAND_IDS,
  handleChasePlayCommand,
} from "./ui/chase-play-commands.mjs";
import { createChaseLoop } from "./ui/chase-loop.mjs";
import { buildChasePlayUsage } from "./ui/chase-play-usage.mjs";
import { createControlInputTracker } from "./ui/input-tracker.mjs";

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
  const usage = buildChasePlayUsage();
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
