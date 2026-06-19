import { CHASER_CONTROL_SOURCES } from "../config/constants.mjs";

const CONTROL_SOURCE_VALUES = new Set(Object.values(CHASER_CONTROL_SOURCES));

export function normalizeChaserControlSource(value, fallback = CHASER_CONTROL_SOURCES.PROGRAMMATIC) {
  const source = typeof value === "string" ? value.trim() : "";
  if (CONTROL_SOURCE_VALUES.has(source)) {
    return source;
  }
  return CONTROL_SOURCE_VALUES.has(fallback)
    ? fallback
    : CHASER_CONTROL_SOURCES.PROGRAMMATIC;
}

export function getInitialChaserControlSource(scenario) {
  const normalizedSource = normalizeChaserControlSource(
    scenario?.runtime?.chaserControlSource,
    scenario?.runtime?.programmaticChaserEnabled === false
      ? CHASER_CONTROL_SOURCES.KEYBOARD
      : CHASER_CONTROL_SOURCES.PROGRAMMATIC,
  );
  return scenario?.runtime?.programmaticChaserEnabled === false
    && normalizedSource === CHASER_CONTROL_SOURCES.PROGRAMMATIC
    ? CHASER_CONTROL_SOURCES.KEYBOARD
    : normalizedSource;
}

export function isProgrammaticChaserControlSource(source) {
  return normalizeChaserControlSource(source) === CHASER_CONTROL_SOURCES.PROGRAMMATIC;
}

export function setChaserControlSource(state, source) {
  if (!state) {
    return CHASER_CONTROL_SOURCES.PROGRAMMATIC;
  }
  const normalizedSource = normalizeChaserControlSource(source, state.chaserControlSource);
  state.chaserControlSource = normalizedSource;
  state.programmaticChaserEnabled = isProgrammaticChaserControlSource(normalizedSource);
  return normalizedSource;
}
