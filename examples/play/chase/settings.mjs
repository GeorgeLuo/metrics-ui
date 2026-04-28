import {
  CHASE_RUNTIME_SETTINGS_KEY,
  CHASE_SETTINGS_STORAGE_KEY,
  DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
  DEFAULT_TARGET_PROJECTION_SPACING_FRAMES,
  MAX_TARGET_PROJECTION_HORIZON_FRAMES,
  MAX_TARGET_PROJECTION_SPACING_FRAMES,
} from "./constants.mjs";
import { clampNumber } from "./math.mjs";

function getRuntimeChaseSettings() {
  if (!globalThis[CHASE_RUNTIME_SETTINGS_KEY] || typeof globalThis[CHASE_RUNTIME_SETTINGS_KEY] !== "object") {
    globalThis[CHASE_RUNTIME_SETTINGS_KEY] = {};
  }
  return globalThis[CHASE_RUNTIME_SETTINGS_KEY];
}

export function readStoredChaseSettings() {
  const runtimeSettings = getRuntimeChaseSettings();
  let storedSettings = {};
  if (typeof localStorage === "undefined") {
    return runtimeSettings;
  }

  try {
    const raw = localStorage.getItem(CHASE_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      storedSettings = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
  } catch {
    storedSettings = {};
  }

  const mergedSettings = {
    ...storedSettings,
    ...runtimeSettings,
  };
  Object.assign(runtimeSettings, mergedSettings);
  return mergedSettings;
}

export function writeStoredChaseSettings(settings) {
  Object.assign(getRuntimeChaseSettings(), settings);
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(CHASE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in restrictive browser contexts; gameplay should continue.
  }
}

export function readStoredProjectionSettings() {
  const stored = readStoredChaseSettings();
  const projection = stored.projection && typeof stored.projection === "object"
    ? stored.projection
    : {};
  const horizonFrames = Number(projection.horizonFrames);
  const sampleSpacingFrames = Number(projection.sampleSpacingFrames);
  return {
    visible: projection.visible === true,
    horizonFrames: Number.isFinite(horizonFrames)
      ? Math.round(clampNumber(horizonFrames, 1, MAX_TARGET_PROJECTION_HORIZON_FRAMES))
      : DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES,
    sampleSpacingFrames: Math.round(clampNumber(
      Number.isFinite(sampleSpacingFrames)
        ? sampleSpacingFrames
        : DEFAULT_TARGET_PROJECTION_SPACING_FRAMES,
      1,
      MAX_TARGET_PROJECTION_SPACING_FRAMES,
    )),
  };
}

export function writeStoredProjectionSettings(projectionSettings) {
  const stored = readStoredChaseSettings();
  writeStoredChaseSettings({
    ...stored,
    projection: {
      visible: projectionSettings.visible,
      horizonFrames: projectionSettings.horizonFrames,
      sampleSpacingFrames: projectionSettings.sampleSpacingFrames,
    },
  });
}
