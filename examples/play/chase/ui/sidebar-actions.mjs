import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  CHASER_ACTION_PATH_RATE_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_MAP_OVERLAY_ACTION_ID,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  CHASER_SPEED_ACTION_ID,
  CHASER_VIEW_ACTION_ID,
  SCENARIO_SELECT_ACTION_ID,
  EVADER_VIEW_ACTION_ID,
  IDAE_DEBUG_ACTION_ID,
  MAX_CHASER_ACTION_PATH_HORIZON_FRAMES,
  MAX_CHASER_ACTION_PATH_SPACING_FRAMES,
  MAX_SIMULATION_FRAMES_PER_SECOND,
  MAX_EVADER_PROJECTION_HORIZON_FRAMES,
  MAX_EVADER_PROJECTION_SPACING_FRAMES,
  MIN_SIMULATION_FRAMES_PER_SECOND,
  SIMULATION_FPS_ACTION_ID,
  SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  SIMULATION_RESET_ACTION_ID,
  EVADER_PROJECTION_DEBUG_ACTION_ID,
  EVADER_PROJECTION_HORIZON_ACTION_ID,
  EVADER_PROJECTION_RATE_ACTION_ID,
  EVADER_PROJECTION_VIEW_ACTION_ID,
  EVADER_PROJECTION_VIEW_MODES,
  EVADER_SPEED_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_TURN_RATE_ACTION_ID,
} from "../config/constants.mjs";
import {
  clampNumber,
  degreesToRadians,
  parseEditableNumber,
} from "../decision-model/math.mjs";
import { createActorStrategyToggleActionId } from "./sidebar.mjs";
import {
  isMapKnowledgeOverlayVisible,
  isMapRecencyOverlayVisible,
  writeStoredActionPathDebugSettings,
  writeStoredMapKnowledgeDebugSettings,
  writeStoredProjectionSettings,
} from "./settings.mjs";

export function registerSidebarActions({
  setSidebarActionHandler,
  getProgrammaticChaserEnabled,
  setProgrammaticChaserEnabled,
  refreshSidebarSections,
  getChaserViewVisible,
  openChaserView,
  closeChaserView,
  getEvaderViewVisible,
  openEvaderView,
  closeEvaderView,
  getIdaeDebugVisible,
  openIdaeDebug,
  closeIdaeDebug,
  updateFieldOfView,
  updateGreentextDebugOverlay,
  simulationSettings,
  vehicleSettings,
  projectionSettings,
  actionPathDebugSettings,
  mapKnowledgeDebugSettings,
  resetSimulation,
  loadScenario,
  getActorStrategyCollections,
  setActorStrategyEnabled,
  getPredictionDebugState,
  setPredictionDebugState,
}) {
  if (typeof setSidebarActionHandler !== "function") {
    return;
  }

  setSidebarActionHandler(CHASER_AUTOPILOT_ACTION_ID, (value) => {
    setProgrammaticChaserEnabled(
      typeof value === "boolean" ? value : !getProgrammaticChaserEnabled(),
    );
    refreshSidebarSections();
  });
  setSidebarActionHandler(CHASER_VIEW_ACTION_ID, (value) => {
    const nextVisible = typeof value === "boolean" ? value : !getChaserViewVisible();
    if (nextVisible) {
      openChaserView();
    } else {
      closeChaserView();
    }
  });
  setSidebarActionHandler(EVADER_VIEW_ACTION_ID, (value) => {
    const nextVisible = typeof value === "boolean" ? value : !getEvaderViewVisible();
    if (nextVisible) {
      openEvaderView();
    } else {
      closeEvaderView();
    }
  });
  setSidebarActionHandler(IDAE_DEBUG_ACTION_ID, (value) => {
    const nextVisible = typeof value === "boolean" ? value : !getIdaeDebugVisible();
    if (nextVisible) {
      openIdaeDebug();
    } else {
      closeIdaeDebug();
    }
  });
  setSidebarActionHandler(SIMULATION_FPS_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      simulationSettings.framesPerSecond = Math.round(clampNumber(
        parsed,
        MIN_SIMULATION_FRAMES_PER_SECOND,
        MAX_SIMULATION_FRAMES_PER_SECOND,
      ));
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(SIMULATION_PAUSE_BEFORE_ACTIONS_ID, (value) => {
    simulationSettings.pauseBeforeActions = typeof value === "boolean"
      ? !value
      : !simulationSettings.pauseBeforeActions;
    refreshSidebarSections();
  });
  setSidebarActionHandler(SIMULATION_GREENTEXT_DEBUG_ACTION_ID, (value) => {
    simulationSettings.greentextDebugVisible = typeof value === "boolean"
      ? value
      : !simulationSettings.greentextDebugVisible;
    updateGreentextDebugOverlay?.();
    refreshSidebarSections();
  });
  setSidebarActionHandler(SIMULATION_RESET_ACTION_ID, () => {
    resetSimulation?.();
  });
  setSidebarActionHandler(SCENARIO_SELECT_ACTION_ID, (value) => {
    if (typeof value === "string" && value.trim()) {
      loadScenario?.(value.trim());
    }
  });
  setSidebarActionHandler(CHASER_SPEED_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.chaserSpeedUnitsPerFrame = clampNumber(
        parsed,
        0.2 / ASSUMED_GAME_FRAMES_PER_SECOND,
        12 / ASSUMED_GAME_FRAMES_PER_SECOND,
      );
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(EVADER_SPEED_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.evaderSpeedUnitsPerFrame = clampNumber(
        parsed,
        0.2 / ASSUMED_GAME_FRAMES_PER_SECOND,
        12 / ASSUMED_GAME_FRAMES_PER_SECOND,
      );
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(VEHICLE_TURN_RATE_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.turnRateRadiansPerFrame = degreesToRadians(clampNumber(
        parsed,
        10 / ASSUMED_GAME_FRAMES_PER_SECOND,
        720 / ASSUMED_GAME_FRAMES_PER_SECOND,
      ));
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(VEHICLE_FOV_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.fieldOfViewAngleRadians = degreesToRadians(clampNumber(parsed, 20, 140));
      updateFieldOfView();
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(EVADER_PROJECTION_DEBUG_ACTION_ID, (value) => {
    projectionSettings.visible = typeof value === "boolean" ? value : !projectionSettings.visible;
    writeStoredProjectionSettings(projectionSettings);
    refreshSidebarSections();
  });
  setSidebarActionHandler(EVADER_PROJECTION_VIEW_ACTION_ID, (value) => {
    const mode = Object.values(EVADER_PROJECTION_VIEW_MODES).includes(value)
      ? value
      : EVADER_PROJECTION_VIEW_MODES.HIDDEN;
    if (mode === EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS) {
      setPredictionDebugState?.({
        visible: true,
        actorId: getPredictionDebugState?.()?.actorId ?? "chaser",
      }, { syncDebugFrame: true });
    } else {
      setPredictionDebugState?.({
        visible: false,
        actorId: getPredictionDebugState?.()?.actorId ?? "chaser",
      }, { syncDebugFrame: true });
      projectionSettings.visible = mode === EVADER_PROJECTION_VIEW_MODES.ESTIMATE;
      writeStoredProjectionSettings(projectionSettings);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(EVADER_PROJECTION_HORIZON_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      projectionSettings.horizonFrames = Math.round(
        clampNumber(parsed, 1, MAX_EVADER_PROJECTION_HORIZON_FRAMES),
      );
      writeStoredProjectionSettings(projectionSettings);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(EVADER_PROJECTION_RATE_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      projectionSettings.sampleSpacingFrames = Math.round(clampNumber(
        parsed,
        1,
        MAX_EVADER_PROJECTION_SPACING_FRAMES,
      ));
      writeStoredProjectionSettings(projectionSettings);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(CHASER_ACTION_PATH_VIEW_ACTION_ID, (value) => {
    actionPathDebugSettings.viewMode = Object.values(CHASER_ACTION_PATH_VIEW_MODES).includes(value)
      ? value
      : CHASER_ACTION_PATH_VIEW_MODES.HIDDEN;
    writeStoredActionPathDebugSettings(actionPathDebugSettings);
    refreshSidebarSections();
  });
  setSidebarActionHandler(CHASER_ACTION_PATH_HORIZON_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      actionPathDebugSettings.horizonFrames = Math.round(
        clampNumber(parsed, 1, MAX_CHASER_ACTION_PATH_HORIZON_FRAMES),
      );
      writeStoredActionPathDebugSettings(actionPathDebugSettings);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(CHASER_ACTION_PATH_RATE_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      actionPathDebugSettings.sampleSpacingFrames = Math.round(clampNumber(
        parsed,
        1,
        MAX_CHASER_ACTION_PATH_SPACING_FRAMES,
      ));
      writeStoredActionPathDebugSettings(actionPathDebugSettings);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(CHASER_MAP_OVERLAY_ACTION_ID, (value) => {
    mapKnowledgeDebugSettings.viewMode = Object.values(CHASER_MAP_OVERLAY_VIEW_MODES).includes(value)
      ? value
      : CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN;
    mapKnowledgeDebugSettings.visible = isMapKnowledgeOverlayVisible(mapKnowledgeDebugSettings);
    mapKnowledgeDebugSettings.recencyVisible = isMapRecencyOverlayVisible(mapKnowledgeDebugSettings);
    writeStoredMapKnowledgeDebugSettings(mapKnowledgeDebugSettings);
    refreshSidebarSections();
  });

  Object.entries(getActorStrategyCollections?.() ?? {}).forEach(([actorId, strategies]) => {
    Object.keys(strategies ?? {}).forEach((strategyId) => {
      setSidebarActionHandler(createActorStrategyToggleActionId(actorId, strategyId), (value) => {
        const currentEnabled = Boolean(getActorStrategyCollections?.()?.[actorId]?.[strategyId]);
        const nextEnabled = typeof value === "boolean" ? value : !currentEnabled;
        setActorStrategyEnabled?.(actorId, strategyId, nextEnabled);
        refreshSidebarSections();
      });
    });
  });
}

export function clearSidebarActions(setSidebarActionHandler, actorStrategyCollections = {}) {
  setSidebarActionHandler?.(CHASER_AUTOPILOT_ACTION_ID, null);
  setSidebarActionHandler?.(SCENARIO_SELECT_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_VIEW_ACTION_ID, null);
  setSidebarActionHandler?.(EVADER_VIEW_ACTION_ID, null);
  setSidebarActionHandler?.(IDAE_DEBUG_ACTION_ID, null);
  setSidebarActionHandler?.(SIMULATION_FPS_ACTION_ID, null);
  setSidebarActionHandler?.(SIMULATION_GREENTEXT_DEBUG_ACTION_ID, null);
  setSidebarActionHandler?.(SIMULATION_PAUSE_BEFORE_ACTIONS_ID, null);
  setSidebarActionHandler?.(SIMULATION_RESET_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_SPEED_ACTION_ID, null);
  setSidebarActionHandler?.(EVADER_SPEED_ACTION_ID, null);
  setSidebarActionHandler?.(VEHICLE_TURN_RATE_ACTION_ID, null);
  setSidebarActionHandler?.(VEHICLE_FOV_ACTION_ID, null);
  setSidebarActionHandler?.(EVADER_PROJECTION_DEBUG_ACTION_ID, null);
  setSidebarActionHandler?.(EVADER_PROJECTION_VIEW_ACTION_ID, null);
  setSidebarActionHandler?.(EVADER_PROJECTION_HORIZON_ACTION_ID, null);
  setSidebarActionHandler?.(EVADER_PROJECTION_RATE_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_ACTION_PATH_VIEW_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_ACTION_PATH_HORIZON_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_ACTION_PATH_RATE_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_MAP_OVERLAY_ACTION_ID, null);
  Object.entries(actorStrategyCollections).forEach(([actorId, strategies]) => {
    Object.keys(strategies ?? {}).forEach((strategyId) => {
      setSidebarActionHandler?.(createActorStrategyToggleActionId(actorId, strategyId), null);
    });
  });
}
