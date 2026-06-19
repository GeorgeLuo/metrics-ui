import test from "node:test";
import assert from "node:assert/strict";
import { CHASER_CONTROL_SOURCES } from "./config/constants.mjs";
import { createControlInputTracker } from "./ui/input-tracker.mjs";

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
