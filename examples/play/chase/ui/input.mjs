import {
  CONTROL_CODES,
  FORWARD_CONTROL_CODES,
  LEFT_CONTROL_CODES,
  REVERSE_CONTROL_CODES,
  RIGHT_CONTROL_CODES,
} from "../config/constants.mjs";

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
  const forwardPressed = hasPressedKey(pressedKeys, FORWARD_CONTROL_CODES);
  const reversePressed = hasPressedKey(pressedKeys, REVERSE_CONTROL_CODES);
  return {
    forward: forwardPressed && !reversePressed,
    reverse: reversePressed && !forwardPressed,
    steering:
      (hasPressedKey(pressedKeys, LEFT_CONTROL_CODES) ? 1 : 0)
      - (hasPressedKey(pressedKeys, RIGHT_CONTROL_CODES) ? 1 : 0),
  };
}
