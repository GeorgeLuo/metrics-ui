import { getHumanChaserInput, isControlCode, isTextEditingTarget } from "./input.mjs";
import { CHASER_CONTROL_SOURCES } from "../config/constants.mjs";

function clampUnit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, numericValue));
}

function createIdleInput(source) {
  return {
    source,
    forward: false,
    reverse: false,
    steering: 0,
  };
}

function hasBoolean(record, key) {
  return typeof record?.[key] === "boolean";
}

function normalizeWsMotionInput(input = {}, fallback = createIdleInput("ws")) {
  const motion = typeof input.motion === "string" ? input.motion.trim() : "";
  if (motion === "forward") {
    return { forward: true, reverse: false };
  }
  if (motion === "reverse" || motion === "backward" || motion === "backwards") {
    return { forward: false, reverse: true };
  }
  if (motion === "idle" || motion === "none" || motion === "stop" || motion === "stopped") {
    return { forward: false, reverse: false };
  }

  if (!hasBoolean(input, "forward") && !hasBoolean(input, "reverse")) {
    return {
      forward: Boolean(fallback.forward),
      reverse: Boolean(fallback.reverse),
    };
  }

  const forward = hasBoolean(input, "forward") ? input.forward : Boolean(fallback.forward);
  const reverse = hasBoolean(input, "reverse") ? input.reverse : Boolean(fallback.reverse);
  return {
    forward: forward && !reverse,
    reverse: reverse && !forward,
  };
}

function normalizeWsInput(input = {}, fallback = createIdleInput("ws")) {
  return {
    source: "ws",
    ...normalizeWsMotionInput(input, fallback),
    steering: Number.isFinite(input.steering)
      ? clampUnit(input.steering)
      : clampUnit(fallback.steering),
  };
}

export function createControlInputTracker() {
  const pressedKeys = new Set();
  let wsInput = createIdleInput("ws");
  const handleKeyDown = (event) => {
    if (!isControlCode(event.code) || isTextEditingTarget(event.target)) {
      return;
    }
    pressedKeys.add(event.code);
    event.preventDefault();
  };
  const handleKeyUp = (event) => {
    if (!isControlCode(event.code)) {
      return;
    }
    pressedKeys.delete(event.code);
    event.preventDefault();
  };
  const clearKeyboard = () => pressedKeys.clear();
  const clear = () => {
    clearKeyboard();
    wsInput = createIdleInput("ws");
  };

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clearKeyboard);

  return {
    getHumanInput: () => ({
      source: "human",
      ...getHumanChaserInput(pressedKeys),
    }),
    getWsInput: () => ({ ...wsInput }),
    getChaserInput(controlSource) {
      return controlSource === CHASER_CONTROL_SOURCES.WS
        ? { ...wsInput }
        : {
          source: "human",
          ...getHumanChaserInput(pressedKeys),
        };
    },
    setWsInput(input) {
      wsInput = normalizeWsInput(input, wsInput);
      return { ...wsInput };
    },
    clearKeyboard,
    clear,
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeyboard);
      clear();
    },
  };
}
