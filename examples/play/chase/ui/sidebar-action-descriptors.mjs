import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  CHASER_ACTION_PATH_RATE_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_ACTION_ID,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_MAP_OVERLAY_ACTION_ID,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  CHASER_SPEED_ACTION_ID,
  CHASER_VIEW_ACTION_ID,
  EVADER_EXISTS_ACTION_ID,
  EVADER_PROJECTION_HORIZON_ACTION_ID,
  EVADER_PROJECTION_RATE_ACTION_ID,
  EVADER_PROJECTION_VIEW_ACTION_ID,
  EVADER_PROJECTION_VIEW_MODES,
  EVADER_SPEED_ACTION_ID,
  EVADER_VIEW_ACTION_ID,
  IDAE_DEBUG_ACTION_ID,
  MAX_CHASER_ACTION_PATH_HORIZON_FRAMES,
  MAX_CHASER_ACTION_PATH_SPACING_FRAMES,
  MAX_EVADER_PROJECTION_HORIZON_FRAMES,
  MAX_EVADER_PROJECTION_SPACING_FRAMES,
  MAX_SIMULATION_FRAMES_PER_SECOND,
  MIN_SIMULATION_FRAMES_PER_SECOND,
  SCENARIO_SELECT_ACTION_ID,
  SIMULATION_FPS_ACTION_ID,
  SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  SIMULATION_RESET_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_TURN_RATE_ACTION_ID,
} from "../config/constants.mjs";
import {
  clampNumber,
  degreesToRadians,
  parseEditableNumber,
} from "../decision-model/core/math.ts";
import { createActorActionProposalToggleActionId } from "./sidebar.mjs";
import {
  isMapKnowledgeOverlayVisible,
  isMapRecencyOverlayVisible,
  normalizeActionPathViewMode,
  writeStoredActionPathDebugSettings,
  writeStoredMapKnowledgeDebugSettings,
  writeStoredProjectionSettings,
} from "./settings.mjs";

function toggleFrame(value, getVisible, open, close) {
  const nextVisible = typeof value === "boolean" ? value : !getVisible();
  if (nextVisible) {
    open();
  } else {
    close();
  }
}

function parseClampedInteger(value, min, max) {
  const parsed = parseEditableNumber(value);
  return parsed === null ? null : Math.round(clampNumber(parsed, min, max));
}

function createSimulationActionDescriptors(context) {
  const {
    simulationSettings,
    refreshSidebarSections,
    updateGreentextDebugOverlay,
    resetSimulation,
    loadScenario,
    getEvaderExists,
    setEvaderExists,
  } = context;
  return [
    {
      id: SIMULATION_FPS_ACTION_ID,
      handler(value) {
        const parsed = parseClampedInteger(value, MIN_SIMULATION_FRAMES_PER_SECOND, MAX_SIMULATION_FRAMES_PER_SECOND);
        if (parsed !== null) {
          simulationSettings.framesPerSecond = parsed;
        }
        refreshSidebarSections();
      },
    },
    {
      id: SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
      handler(value) {
        simulationSettings.pauseBeforeActions = typeof value === "boolean"
          ? !value
          : !simulationSettings.pauseBeforeActions;
        refreshSidebarSections();
      },
    },
    {
      id: SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
      handler(value) {
        simulationSettings.greentextDebugVisible = typeof value === "boolean"
          ? value
          : !simulationSettings.greentextDebugVisible;
        updateGreentextDebugOverlay?.();
        refreshSidebarSections();
      },
    },
    { id: SIMULATION_RESET_ACTION_ID, handler: () => resetSimulation?.() },
    {
      id: SCENARIO_SELECT_ACTION_ID,
      handler(value) {
        if (typeof value === "string" && value.trim()) {
          loadScenario?.(value.trim());
        }
      },
    },
    {
      id: EVADER_EXISTS_ACTION_ID,
      handler(value) {
        const nextExists = typeof value === "boolean" ? value : !getEvaderExists?.();
        setEvaderExists?.(nextExists);
      },
    },
  ];
}

function createWindowActionDescriptors(context) {
  return [
    {
      id: CHASER_VIEW_ACTION_ID,
      handler: (value) => toggleFrame(
        value,
        context.getChaserViewVisible,
        context.openChaserView,
        context.closeChaserView,
      ),
    },
    {
      id: EVADER_VIEW_ACTION_ID,
      handler: (value) => toggleFrame(
        value,
        context.getEvaderViewVisible,
        context.openEvaderView,
        context.closeEvaderView,
      ),
    },
    {
      id: IDAE_DEBUG_ACTION_ID,
      handler: (value) => toggleFrame(
        value,
        context.getIdaeDebugVisible,
        context.openIdaeDebug,
        context.closeIdaeDebug,
      ),
    },
  ];
}

function createVehicleActionDescriptors({
  vehicleSettings,
  refreshSidebarSections,
  updateFieldOfView,
}) {
  return [
    {
      id: CHASER_SPEED_ACTION_ID,
      handler(value) {
        const parsed = parseEditableNumber(value);
        if (parsed !== null) {
          vehicleSettings.chaserSpeedUnitsPerFrame = clampNumber(
            parsed,
            0.2 / ASSUMED_GAME_FRAMES_PER_SECOND,
            12 / ASSUMED_GAME_FRAMES_PER_SECOND,
          );
        }
        refreshSidebarSections();
      },
    },
    {
      id: EVADER_SPEED_ACTION_ID,
      handler(value) {
        const parsed = parseEditableNumber(value);
        if (parsed !== null) {
          vehicleSettings.evaderSpeedUnitsPerFrame = clampNumber(
            parsed,
            0.2 / ASSUMED_GAME_FRAMES_PER_SECOND,
            12 / ASSUMED_GAME_FRAMES_PER_SECOND,
          );
        }
        refreshSidebarSections();
      },
    },
    {
      id: VEHICLE_TURN_RATE_ACTION_ID,
      handler(value) {
        const parsed = parseEditableNumber(value);
        if (parsed !== null) {
          vehicleSettings.turnRateRadiansPerFrame = degreesToRadians(clampNumber(
            parsed,
            10 / ASSUMED_GAME_FRAMES_PER_SECOND,
            720 / ASSUMED_GAME_FRAMES_PER_SECOND,
          ));
        }
        refreshSidebarSections();
      },
    },
    {
      id: VEHICLE_FOV_ACTION_ID,
      handler(value) {
        const parsed = parseEditableNumber(value);
        if (parsed !== null) {
          vehicleSettings.fieldOfViewAngleRadians = degreesToRadians(clampNumber(parsed, 20, 140));
          updateFieldOfView();
        }
        refreshSidebarSections();
      },
    },
  ];
}

function createDebugActionDescriptors(context) {
  const {
    projectionSettings,
    actionPathDebugSettings,
    mapKnowledgeDebugSettings,
    refreshSidebarSections,
    getPredictionDebugState,
    setPredictionDebugState,
  } = context;
  return [
    {
      id: EVADER_PROJECTION_VIEW_ACTION_ID,
      handler(value) {
        const mode = Object.values(EVADER_PROJECTION_VIEW_MODES).includes(value)
          ? value
          : EVADER_PROJECTION_VIEW_MODES.HIDDEN;
        if (mode === EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS) {
          setPredictionDebugState?.({
            visible: true,
            actorId: getPredictionDebugState?.()?.actorId ?? "chaser",
          }, { syncDebugFrame: true });
          refreshSidebarSections();
          return;
        }
        setPredictionDebugState?.({
          visible: false,
          actorId: getPredictionDebugState?.()?.actorId ?? "chaser",
        }, { syncDebugFrame: true });
        projectionSettings.visible = mode === EVADER_PROJECTION_VIEW_MODES.ESTIMATE;
        writeStoredProjectionSettings(projectionSettings);
        refreshSidebarSections();
      },
    },
    {
      id: EVADER_PROJECTION_HORIZON_ACTION_ID,
      handler(value) {
        const parsed = parseClampedInteger(value, 1, MAX_EVADER_PROJECTION_HORIZON_FRAMES);
        if (parsed !== null) {
          projectionSettings.horizonFrames = parsed;
          writeStoredProjectionSettings(projectionSettings);
        }
        refreshSidebarSections();
      },
    },
    {
      id: EVADER_PROJECTION_RATE_ACTION_ID,
      handler(value) {
        const parsed = parseClampedInteger(value, 1, MAX_EVADER_PROJECTION_SPACING_FRAMES);
        if (parsed !== null) {
          projectionSettings.sampleSpacingFrames = parsed;
          writeStoredProjectionSettings(projectionSettings);
        }
        refreshSidebarSections();
      },
    },
    {
      id: CHASER_ACTION_PATH_VIEW_ACTION_ID,
      handler(value) {
        actionPathDebugSettings.viewMode = normalizeActionPathViewMode(value);
        writeStoredActionPathDebugSettings(actionPathDebugSettings);
        refreshSidebarSections();
      },
    },
    {
      id: CHASER_ACTION_PATH_HORIZON_ACTION_ID,
      handler(value) {
        const parsed = parseClampedInteger(value, 1, MAX_CHASER_ACTION_PATH_HORIZON_FRAMES);
        if (parsed !== null) {
          actionPathDebugSettings.horizonFrames = parsed;
          writeStoredActionPathDebugSettings(actionPathDebugSettings);
        }
        refreshSidebarSections();
      },
    },
    {
      id: CHASER_ACTION_PATH_RATE_ACTION_ID,
      handler(value) {
        const parsed = parseClampedInteger(value, 1, MAX_CHASER_ACTION_PATH_SPACING_FRAMES);
        if (parsed !== null) {
          actionPathDebugSettings.sampleSpacingFrames = parsed;
          writeStoredActionPathDebugSettings(actionPathDebugSettings);
        }
        refreshSidebarSections();
      },
    },
    {
      id: CHASER_MAP_OVERLAY_ACTION_ID,
      handler(value) {
        mapKnowledgeDebugSettings.viewMode = Object.values(CHASER_MAP_OVERLAY_VIEW_MODES).includes(value)
          ? value
          : CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN;
        mapKnowledgeDebugSettings.visible = isMapKnowledgeOverlayVisible(mapKnowledgeDebugSettings);
        mapKnowledgeDebugSettings.recencyVisible = isMapRecencyOverlayVisible(mapKnowledgeDebugSettings);
        writeStoredMapKnowledgeDebugSettings(mapKnowledgeDebugSettings);
        refreshSidebarSections();
      },
    },
  ];
}

function createActionProposalActionDescriptors({
  getActorActionProposalCollections,
  setActorActionProposalEnabled,
  refreshSidebarSections,
}) {
  return Object.entries(getActorActionProposalCollections?.() ?? {}).flatMap(([actorId, actionProposals]) =>
    Object.keys(actionProposals ?? {}).map((actionProposalId) => ({
      id: createActorActionProposalToggleActionId(actorId, actionProposalId),
      handler(value) {
        const currentEnabled = Boolean(getActorActionProposalCollections?.()?.[actorId]?.[actionProposalId]);
        const nextEnabled = typeof value === "boolean" ? value : !currentEnabled;
        setActorActionProposalEnabled?.(actorId, actionProposalId, nextEnabled);
        refreshSidebarSections();
      },
    })));
}

export function createSidebarActionDescriptors(context) {
  return [
    {
      id: CHASER_AUTOPILOT_ACTION_ID,
      handler(value) {
        context.setProgrammaticChaserEnabled(
          typeof value === "boolean" ? value : !context.getProgrammaticChaserEnabled(),
        );
        context.refreshSidebarSections();
      },
    },
    ...createWindowActionDescriptors(context),
    ...createSimulationActionDescriptors(context),
    ...createVehicleActionDescriptors(context),
    ...createDebugActionDescriptors(context),
    ...createActionProposalActionDescriptors(context),
  ];
}
