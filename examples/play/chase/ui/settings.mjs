import {
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  CHASE_RUNTIME_SETTINGS_KEY,
  CHASE_SETTINGS_STORAGE_KEY,
  DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  MAX_CHASER_ACTION_PATH_HORIZON_FRAMES,
  MAX_CHASER_ACTION_PATH_SPACING_FRAMES,
  MAX_EVADER_PROJECTION_HORIZON_FRAMES,
  MAX_EVADER_PROJECTION_SPACING_FRAMES,
} from "../config/constants.mjs";
import { clampNumber } from "../decision-model/core/math.ts";

function normalizeMapOverlayViewMode(settings = {}) {
  if (Object.values(CHASER_MAP_OVERLAY_VIEW_MODES).includes(settings.viewMode)) {
    return settings.viewMode;
  }
  if (settings.visible === true && settings.recencyVisible === true) {
    return CHASER_MAP_OVERLAY_VIEW_MODES.ALL;
  }
  if (settings.recencyVisible === true) {
    return CHASER_MAP_OVERLAY_VIEW_MODES.RECENCY;
  }
  return settings.visible === true
    ? CHASER_MAP_OVERLAY_VIEW_MODES.KNOWLEDGE
    : CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN;
}

export function normalizeActionPathViewMode(viewMode) {
  if (viewMode === "search") {
    return CHASER_ACTION_PATH_VIEW_MODES.SPIN;
  }
  return Object.values(CHASER_ACTION_PATH_VIEW_MODES).includes(viewMode)
    ? viewMode
    : CHASER_ACTION_PATH_VIEW_MODES.HIDDEN;
}

export function isMapKnowledgeOverlayVisible(settings = {}) {
  const viewMode = normalizeMapOverlayViewMode(settings);
  return viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.KNOWLEDGE
    || viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.ALL;
}

export function isMapRecencyOverlayVisible(settings = {}) {
  const viewMode = normalizeMapOverlayViewMode(settings);
  return viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.RECENCY
    || viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.ALL;
}

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
      ? Math.round(clampNumber(horizonFrames, 1, MAX_EVADER_PROJECTION_HORIZON_FRAMES))
      : DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
    sampleSpacingFrames: Math.round(clampNumber(
      Number.isFinite(sampleSpacingFrames)
        ? sampleSpacingFrames
        : DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
      1,
      MAX_EVADER_PROJECTION_SPACING_FRAMES,
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

export function readStoredActionPathDebugSettings() {
  const stored = readStoredChaseSettings();
  const actionPaths = stored.actionPaths && typeof stored.actionPaths === "object"
    ? stored.actionPaths
    : {};
  const viewMode = normalizeActionPathViewMode(actionPaths.viewMode);
  const horizonFrames = Number(actionPaths.horizonFrames);
  const sampleSpacingFrames = Number(actionPaths.sampleSpacingFrames);
  return {
    viewMode,
    horizonFrames: Number.isFinite(horizonFrames)
      ? Math.round(clampNumber(horizonFrames, 1, MAX_CHASER_ACTION_PATH_HORIZON_FRAMES))
      : DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
    sampleSpacingFrames: Math.round(clampNumber(
      Number.isFinite(sampleSpacingFrames)
        ? sampleSpacingFrames
        : DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
      1,
      MAX_CHASER_ACTION_PATH_SPACING_FRAMES,
    )),
  };
}

export function writeStoredActionPathDebugSettings(actionPathSettings) {
  const stored = readStoredChaseSettings();
  const viewMode = normalizeActionPathViewMode(actionPathSettings?.viewMode);
  const horizonFrames = Number(actionPathSettings?.horizonFrames);
  const sampleSpacingFrames = Number(actionPathSettings?.sampleSpacingFrames);
  writeStoredChaseSettings({
    ...stored,
    actionPaths: {
      viewMode,
      horizonFrames: Number.isFinite(horizonFrames)
        ? Math.round(clampNumber(horizonFrames, 1, MAX_CHASER_ACTION_PATH_HORIZON_FRAMES))
        : DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
      sampleSpacingFrames: Math.round(clampNumber(
        Number.isFinite(sampleSpacingFrames)
          ? sampleSpacingFrames
          : DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
        1,
        MAX_CHASER_ACTION_PATH_SPACING_FRAMES,
      )),
    },
  });
}

export function readStoredMapKnowledgeDebugSettings() {
  const stored = readStoredChaseSettings();
  const mapKnowledge = stored.mapKnowledge && typeof stored.mapKnowledge === "object"
    ? stored.mapKnowledge
    : {};
  const viewMode = normalizeMapOverlayViewMode(mapKnowledge);
  return {
    viewMode,
    visible: isMapKnowledgeOverlayVisible({ viewMode }),
    recencyVisible: isMapRecencyOverlayVisible({ viewMode }),
  };
}

export function writeStoredMapKnowledgeDebugSettings(mapKnowledgeSettings) {
  const stored = readStoredChaseSettings();
  const viewMode = normalizeMapOverlayViewMode(mapKnowledgeSettings);
  writeStoredChaseSettings({
    ...stored,
    mapKnowledge: {
      viewMode,
      visible: isMapKnowledgeOverlayVisible({ viewMode }),
      recencyVisible: isMapRecencyOverlayVisible({ viewMode }),
    },
  });
}
