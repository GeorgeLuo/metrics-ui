import {
  CONTROL_CODES,
  FORWARD_CONTROL_CODES,
  LEFT_CONTROL_CODES,
  RIGHT_CONTROL_CODES,
} from "./constants.mjs";

export function isTextEditingTarget(target) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function hasPressedKey(pressedKeys, codes) {
  for (const code of codes) {
    if (pressedKeys.has(code)) {
      return true;
    }
  }
  return false;
}

export function isControlCode(code) {
  return CONTROL_CODES.has(code);
}

export function getHumanChaserInput(pressedKeys) {
  return {
    forward: hasPressedKey(pressedKeys, FORWARD_CONTROL_CODES),
    steering:
      (hasPressedKey(pressedKeys, LEFT_CONTROL_CODES) ? 1 : 0)
      - (hasPressedKey(pressedKeys, RIGHT_CONTROL_CODES) ? 1 : 0),
  };
}
