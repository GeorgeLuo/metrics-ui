import { CHASER_CONTROL_SOURCES } from "../config/constants.mjs";

export const CHASE_PLAY_COMMAND_IDS = Object.freeze({
  SET_CHASER_INPUT: "set-chaser-input",
  SET_CHASER_CONTROL_SOURCE: "set-chaser-control-source",
});

const CHASER_CONTROL_SOURCE_VALUES = new Set(Object.values(CHASER_CONTROL_SOURCES));

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readChaserInputPayload(payload) {
  return isRecord(payload) ? payload : {};
}

function readChaserControlSourcePayload(payload) {
  if (typeof payload === "string") {
    return payload.trim();
  }
  if (isRecord(payload) && typeof payload.source === "string") {
    return payload.source.trim();
  }
  return "";
}

export function handleChasePlayCommand(command = {}, handlers = {}) {
  const commandId = typeof command.commandId === "string" ? command.commandId.trim() : "";
  switch (commandId) {
    case CHASE_PLAY_COMMAND_IDS.SET_CHASER_INPUT: {
      handlers.setChaserInput?.(readChaserInputPayload(command.payload));
      return true;
    }
    case CHASE_PLAY_COMMAND_IDS.SET_CHASER_CONTROL_SOURCE: {
      const source = readChaserControlSourcePayload(command.payload);
      if (!CHASER_CONTROL_SOURCE_VALUES.has(source)) {
        return false;
      }
      handlers.setChaserControlSource?.(source);
      return true;
    }
    default:
      return false;
  }
}
