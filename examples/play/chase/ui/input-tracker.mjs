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
  const keyboardTargetCleanups = new Map();
  let activeKeyboardWindow = null;
  let wsInput = createIdleInput("ws");
  let relayKeyboardWindow = null;
  let relayKeyboardCleanup = null;

  const handleKeyDown = (event, targetWindow) => {
    if (!isControlCode(event.code) || isTextEditingTarget(event.target)) {
      return;
    }
    activeKeyboardWindow = targetWindow;
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

  const clearKeyboard = () => {
    activeKeyboardWindow = null;
    pressedKeys.clear();
  };

  const clearKeyboardForWindow = (targetWindow) => {
    if (activeKeyboardWindow === null || activeKeyboardWindow === targetWindow) {
      clearKeyboard();
    }
  };

  const clear = () => {
    clearKeyboard();
    wsInput = createIdleInput("ws");
  };

  const normalizeKeyboardWindow = (targetWindow) =>
    targetWindow
      && typeof targetWindow.addEventListener === "function"
      && typeof targetWindow.removeEventListener === "function"
      ? targetWindow
      : null;

  const registerKeyboardWindow = (targetWindow) => {
    const target = normalizeKeyboardWindow(targetWindow);
    if (!target) {
      return () => {};
    }
    const existingCleanup = keyboardTargetCleanups.get(target);
    if (existingCleanup) {
      return existingCleanup;
    }
    const handleTargetKeyDown = (event) => handleKeyDown(event, target);
    const handleTargetKeyUp = (event) => handleKeyUp(event);
    const handleTargetBlur = () => clearKeyboardForWindow(target);
    const cleanup = () => {
      target.removeEventListener("keydown", handleTargetKeyDown);
      target.removeEventListener("keyup", handleTargetKeyUp);
      target.removeEventListener("blur", handleTargetBlur);
      keyboardTargetCleanups.delete(target);
    };
    target.addEventListener("keydown", handleTargetKeyDown);
    target.addEventListener("keyup", handleTargetKeyUp);
    target.addEventListener("blur", handleTargetBlur);
    keyboardTargetCleanups.set(target, cleanup);
    return cleanup;
  };

  const setKeyboardRelayWindow = (targetWindow) => {
    const normalizedWindow = normalizeKeyboardWindow(targetWindow);
    const mainWindow = normalizeKeyboardWindow(window);
    const nextRelayWindow = normalizedWindow && normalizedWindow !== mainWindow
      ? normalizedWindow
      : null;
    if (nextRelayWindow === relayKeyboardWindow) {
      return;
    }
    relayKeyboardCleanup?.();
    relayKeyboardWindow = nextRelayWindow;
    relayKeyboardCleanup = nextRelayWindow ? registerKeyboardWindow(nextRelayWindow) : null;
    clearKeyboard();
  };

  registerKeyboardWindow(window);

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
    setKeyboardRelayWindow,
    clearKeyboard,
    clear,
    dispose() {
      relayKeyboardCleanup?.();
      relayKeyboardCleanup = null;
      relayKeyboardWindow = null;
      Array.from(keyboardTargetCleanups.values()).forEach((cleanup) => cleanup());
      clear();
    },
  };
}
