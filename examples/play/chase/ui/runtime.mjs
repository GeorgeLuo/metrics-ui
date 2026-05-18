import * as THREE from "three";
import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  CAR_HEIGHT,
  CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  CHASER_ACTION_PATH_RATE_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_MAP_OVERLAY_ACTION_ID,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  CHASER_SPEED_ACTION_ID,
  CHASER_VIEW_ACTION_ID,
  CHASER_VIEW_MAX_DISTANCE,
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
  vectorToAngle,
} from "../decision-model/math.mjs";
import { getHumanChaserInput, isControlCode, isTextEditingTarget } from "./input.mjs";
import {
  configureCamera,
  configureChaserViewCamera,
  createCar,
  createEvaderFieldOfViewCone,
  createFieldOfViewCone,
  createFieldOfViewConeGeometry,
  createMapKnowledgeOverlayDisplayState,
  createMapRecencyOverlayDisplayState,
  createWall,
  disposeMapKnowledgeOverlayDisplayState,
  disposeMapRecencyOverlayDisplayState,
  createPredictionDebugDisplayState,
  disposePredictionDebugDisplayState,
  syncProjectionFrames,
  updateChaserActionPathDebugDisplay,
  updateMapKnowledgeOverlayDisplay,
  updateMapRecencyOverlayDisplay,
  updatePredictionDebugDisplay,
  updateEvaderProjectionDisplay,
} from "./rendering.mjs";
import { publishSidebarSections, createActorStrategyToggleActionId } from "./sidebar.mjs";
import {
  readStoredActionPathDebugSettings,
  readStoredMapKnowledgeDebugSettings,
  readStoredProjectionSettings,
  writeStoredActionPathDebugSettings,
  writeStoredMapKnowledgeDebugSettings,
  writeStoredProjectionSettings,
} from "./settings.mjs";
import { resolveChaseScenario } from "../simulation/scenario.mjs";
import {
  createChaseSimulationState,
  stepChaseSimulation,
} from "../simulation/simulation.mjs";
import { mountIdaeDebugFrame } from "../debug/decision-debug.mjs";
import { createChasePerformanceTracker } from "../debug/performance-debug.mjs";
import { buildChaseDebugSnapshot } from "../debug/debug-snapshot.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "../scenarios/index.mjs";
import { setChaserActionEngineEnabled } from "../actors/chaser/chaser-controller.mjs";
import { setEvaderStrategyEngineEnabled } from "../actors/evader/evader-decision-model.mjs";

function createActorViewController({
  createFloatingFrame,
  vehicleSettings,
  onVisibilityChange,
  frameId,
  title,
  lostLabelText,
}) {
  const chaserViewWidth = 280;
  let mountedView = null;
  let suppressNextCloseNotification = false;
  let resizeFrame = 0;

  const resizeMountedView = () => {
    resizeFrame = 0;
    if (!mountedView) {
      return;
    }
    const viewWidth = Math.max(1, mountedView.frame.mount.clientWidth);
    const viewHeight = Math.max(1, mountedView.frame.mount.clientHeight);
    mountedView.renderer.setSize(viewWidth, viewHeight, false);
    mountedView.camera.aspect = viewWidth / viewHeight;
    mountedView.camera.updateProjectionMatrix();
  };
  const scheduleMountedViewResize = () => {
    if (resizeFrame !== 0) {
      return;
    }
    resizeFrame = requestAnimationFrame(resizeMountedView);
  };

  const disposeMountedView = (notifyVisibilityChange) => {
    if (!mountedView) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    if (resizeFrame !== 0) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
    mountedView.resizeObserver.disconnect();
    mountedView.renderer.dispose();
    mountedView = null;
    if (notifyVisibilityChange) {
      onVisibilityChange?.(false);
    }
  };

  const handleFrameClose = () => {
    const notifyVisibilityChange = !suppressNextCloseNotification;
    suppressNextCloseNotification = false;
    disposeMountedView(notifyVisibilityChange);
  };

  const open = () => {
    if (mountedView || typeof createFloatingFrame !== "function") {
      return;
    }
    const frame = createFloatingFrame({
      id: frameId,
      title,
      bounds: "viewport",
      defaultPosition: {
        x: Math.max(16, window.innerWidth - chaserViewWidth - 24),
        y: 72,
      },
      defaultSize: { width: chaserViewWidth, height: 210 },
      minSize: { width: 180, height: 140 },
      minimizable: true,
      resizable: true,
      popoutable: true,
      closeable: true,
      onClose: handleFrameClose,
    });
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const lostTargetLabel = document.createElement("div");
    const camera = new THREE.PerspectiveCamera(
      vehicleSettings.fieldOfViewAngleRadians * 180 / Math.PI,
      4 / 3,
      0.04,
      CHASER_VIEW_MAX_DISTANCE,
    );
    const resizeObserver = new ResizeObserver(scheduleMountedViewResize);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    frame.mount.appendChild(renderer.domElement);

    Object.assign(lostTargetLabel.style, {
      position: "absolute",
      top: "10px",
      left: "50%",
      transform: "translateX(-50%)",
      color: "rgb(239, 68, 68)",
      font: "600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      pointerEvents: "none",
      display: "none",
    });
    lostTargetLabel.textContent = lostLabelText;
    frame.mount.appendChild(lostTargetLabel);

    mountedView = {
      frame,
      renderer,
      lostTargetLabel,
      camera,
      resizeObserver,
    };
    resizeObserver.observe(frame.mount);
    resizeMountedView();
    onVisibilityChange?.(true);
  };

  const close = ({ notifyVisibilityChange = true } = {}) => {
    if (!mountedView) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    suppressNextCloseNotification = !notifyVisibilityChange;
    mountedView.frame.close();
  };

  const setFieldOfViewAngleRadians = (fieldOfViewAngleRadians) => {
    if (!mountedView) {
      return;
    }
    mountedView.camera.fov = fieldOfViewAngleRadians * 180 / Math.PI;
    mountedView.camera.updateProjectionMatrix();
  };

  const setTrackedActorVisible = (visible) => {
    if (!mountedView) {
      return;
    }
    mountedView.lostTargetLabel.style.display = visible ? "none" : "block";
  };

  const render = ({
    scene,
    actorMesh,
    actorFieldOfView,
    otherActorFieldOfView,
    actorPosition,
    actorLookDirection,
  }) => {
    if (!mountedView) {
      return;
    }
    configureChaserViewCamera(mountedView.camera, actorPosition, actorLookDirection);
    const actorMeshVisible = actorMesh.visible;
    const actorFieldOfViewVisible = actorFieldOfView.visible;
    const otherActorFieldOfViewVisible = otherActorFieldOfView?.visible ?? false;
    actorMesh.visible = false;
    actorFieldOfView.visible = false;
    if (otherActorFieldOfView) {
      otherActorFieldOfView.visible = false;
    }
    mountedView.renderer.render(scene, mountedView.camera);
    actorMesh.visible = actorMeshVisible;
    actorFieldOfView.visible = actorFieldOfViewVisible;
    if (otherActorFieldOfView) {
      otherActorFieldOfView.visible = otherActorFieldOfViewVisible;
    }
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    resize: resizeMountedView,
    setFieldOfViewAngleRadians,
    setTrackedActorVisible,
    render,
    isOpen: () => mountedView !== null,
  };
}

function createGreentextDebugOverlay(container) {
  const element = document.createElement("pre");
  Object.assign(element.style, {
    position: "absolute",
    right: "12px",
    bottom: "12px",
    zIndex: "30",
    display: "none",
    margin: "0",
    padding: "0",
    maxWidth: "min(360px, calc(100% - 24px))",
    color: "rgb(34, 197, 94)",
    background: "transparent",
    border: "0",
    borderRadius: "0",
    font: "600 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    letterSpacing: "0.02em",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
  });
  container.appendChild(element);

  return {
    update({ visible, text } = {}) {
      element.style.display = visible ? "block" : "none";
      element.textContent = text ?? "";
    },
    dispose() {
      element.remove();
    },
  };
}

function buildGreentextDebugText(simulationState) {
  const motiveId = simulationState?.lastStep?.chaserAction
    ?.actionStrategies
    ?.motiveSignal
    ?.id ?? "none";
  return [
    `frame: ${Number(simulationState?.frameIndex) || 0}`,
    `chaser motive: ${motiveId}`,
  ].join("\n");
}

function createChaserViewController({ createFloatingFrame, vehicleSettings, onVisibilityChange }) {
  return createActorViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange,
    frameId: "chaser-view",
    title: "Chaser View",
    lostLabelText: "Evader out of sight",
  });
}

function createEvaderViewController({ createFloatingFrame, vehicleSettings, onVisibilityChange }) {
  return createActorViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange,
    frameId: "evader-view",
    title: "Evader View",
    lostLabelText: "Chaser out of sight",
  });
}

function createIdaeDebugController({
  createFloatingFrame,
  onVisibilityChange,
  onPredictionDebugChange,
  getPredictionDebugState,
}) {
  let mountedDebugFrame = null;
  let suppressNextCloseNotification = false;

  const handleFrameClose = () => {
    const notifyVisibilityChange = !suppressNextCloseNotification;
    suppressNextCloseNotification = false;
    mountedDebugFrame = null;
    if (notifyVisibilityChange) {
      onVisibilityChange?.(false);
    }
  };

  const open = () => {
    if (mountedDebugFrame) {
      return;
    }
    const requestedPredictionDebug = getPredictionDebugState?.() ?? null;
    mountedDebugFrame = mountIdaeDebugFrame(createFloatingFrame, {
      onClose: handleFrameClose,
      onPredictionDebugChange,
    });
    if (requestedPredictionDebug?.visible) {
      mountedDebugFrame?.setPredictionDebug?.(requestedPredictionDebug);
    }
    if (mountedDebugFrame) {
      onVisibilityChange?.(true);
    }
  };

  const close = ({ notifyVisibilityChange = true } = {}) => {
    if (!mountedDebugFrame) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    suppressNextCloseNotification = !notifyVisibilityChange;
    mountedDebugFrame.close();
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    setPredictionDebug: (nextState) => mountedDebugFrame?.setPredictionDebug?.(nextState),
    update: (payload) => mountedDebugFrame?.update(payload),
    isOpen: () => mountedDebugFrame !== null,
  };
}

function getActorStrategyCollections(simulationState) {
  return {
    chaser: {
      ...(simulationState?.chaserIdae?.state?.controllerState?.actionEngines ?? {}),
    },
    evader: {
      ...(simulationState?.evaderIdae?.state?.engines ?? {}),
    },
  };
}

function isMapKnowledgeOverlayVisible(settings = {}) {
  return settings.viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.KNOWLEDGE
    || settings.viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.ALL
    || (
      !Object.values(CHASER_MAP_OVERLAY_VIEW_MODES).includes(settings.viewMode)
      && settings.visible === true
    );
}

function isMapRecencyOverlayVisible(settings = {}) {
  return settings.viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.RECENCY
    || settings.viewMode === CHASER_MAP_OVERLAY_VIEW_MODES.ALL
    || (
      !Object.values(CHASER_MAP_OVERLAY_VIEW_MODES).includes(settings.viewMode)
      && settings.recencyVisible === true
    );
}

function registerSidebarActions({
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

function clearSidebarActions(setSidebarActionHandler, actorStrategyCollections = {}) {
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

export function createPlayGame({
  container,
  columns,
  rows,
  createFloatingFrame,
  setSidebarSections,
  setSidebarActionHandler,
  setDebugSnapshot,
}) {
  const scenarioOptions = getChaseScenarioOptions();
  let activeScenarioId = DEFAULT_CHASE_SCENARIO_ID;
  let scenario = resolveChaseScenario(
    getChaseScenarioDefinition(activeScenarioId),
    { columns, rows },
  );
  const simulationState = createChaseSimulationState({ scenario, columns, rows });
  const performanceTracker = createChasePerformanceTracker();
  const pressedKeys = new Set();
  let chaserViewVisible = false;
  let evaderViewVisible = false;
  let idaeDebugVisible = false;
  let idaePredictionDebug = {
    visible: true,
    actorId: "chaser",
  };
  const publishDebugSnapshot = () => {
    setDebugSnapshot?.(buildChaseDebugSnapshot(simulationState, {
      performance: performanceTracker.getSnapshot(),
      predictionDebug: idaePredictionDebug,
    }));
  };
  const simulationSettings = simulationState.simulationSettings;
  simulationSettings.pauseBeforeActions = Boolean(simulationSettings.pauseBeforeActions);
  simulationSettings.greentextDebugVisible = Boolean(simulationSettings.greentextDebugVisible);
  const vehicleSettings = simulationState.vehicleSettings;
  const projectionSettings = {
    ...simulationState.projectionSettings,
    ...readStoredProjectionSettings(),
  };
  const actionPathDebugSettings = readStoredActionPathDebugSettings();
  const mapKnowledgeDebugSettings = readStoredMapKnowledgeDebugSettings();
  simulationState.projectionSettings = projectionSettings;
  let chaserFieldOfView = null;
  let evaderFieldOfView = null;
  let greentextDebugOverlay = null;
  let animationFrame = 0;
  let previousTimestamp = null;
  let accumulatedMs = 0;
  const updateGreentextDebugOverlay = () => {
    greentextDebugOverlay?.update({
      visible: Boolean(simulationSettings.greentextDebugVisible),
      text: buildGreentextDebugText(simulationState),
    });
  };

  const refreshSidebarSections = () => {
    publishSidebarSections(
      setSidebarSections,
      simulationState.programmaticChaserEnabled,
      {
        chaserViewVisible,
        evaderViewVisible,
        idaeDebugVisible,
      },
      simulationSettings,
      vehicleSettings,
      projectionSettings,
      getActorStrategyCollections(simulationState),
      simulationState.runMetrics,
      {
        activeScenarioId,
        options: scenarioOptions,
        evaderExists: simulationState.evaderExists !== false,
      },
      idaePredictionDebug,
      actionPathDebugSettings,
      mapKnowledgeDebugSettings,
    );
  };

  const chaserView = createChaserViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange: (visible) => {
      chaserViewVisible = visible;
      refreshSidebarSections();
    },
  });
  const evaderView = createEvaderViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange: (visible) => {
      evaderViewVisible = visible;
      refreshSidebarSections();
    },
  });
  let idaeDebugFrame = null;
  const applyPredictionDebugState = (nextState = {}, { syncDebugFrame = false } = {}) => {
    idaePredictionDebug = {
      visible: Boolean(nextState.visible),
      actorId: typeof nextState.actorId === "string" ? nextState.actorId : "chaser",
    };
    if (syncDebugFrame) {
      idaeDebugFrame?.setPredictionDebug?.(idaePredictionDebug);
    }
    refreshSidebarSections();
    publishDebugSnapshot();
  };
  idaeDebugFrame = createIdaeDebugController({
    createFloatingFrame,
    onVisibilityChange: (visible) => {
      idaeDebugVisible = visible;
      refreshSidebarSections();
    },
    onPredictionDebugChange: (nextState = {}) => {
      applyPredictionDebugState(nextState);
    },
    getPredictionDebugState: () => idaePredictionDebug,
  });
  const updateFieldOfView = () => {
    if (chaserFieldOfView) {
      const nextGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
      chaserFieldOfView.geometry.dispose();
      chaserFieldOfView.geometry = nextGeometry;
    }
    if (evaderFieldOfView) {
      const nextGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
      evaderFieldOfView.geometry.dispose();
      evaderFieldOfView.geometry = nextGeometry;
    }
    chaserView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
    evaderView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
  };
  const replaceSimulationState = (nextScenario) => {
    const greentextDebugVisible = Boolean(simulationSettings.greentextDebugVisible);
    const freshState = createChaseSimulationState({ scenario: nextScenario, columns, rows });
    const nextSimulationSettings = { ...freshState.simulationSettings };
    const nextVehicleSettings = { ...freshState.vehicleSettings };
    const nextProjectionSettings = {
      ...freshState.projectionSettings,
      ...readStoredProjectionSettings(),
    };

    Object.keys(simulationState).forEach((key) => {
      delete simulationState[key];
    });
    Object.assign(simulationState, freshState);

    Object.keys(simulationSettings).forEach((key) => {
      delete simulationSettings[key];
    });
    Object.assign(simulationSettings, nextSimulationSettings);
    simulationSettings.pauseBeforeActions = Boolean(simulationSettings.pauseBeforeActions);
    simulationSettings.greentextDebugVisible = greentextDebugVisible;

    Object.keys(vehicleSettings).forEach((key) => {
      delete vehicleSettings[key];
    });
    Object.assign(vehicleSettings, nextVehicleSettings);

    Object.keys(projectionSettings).forEach((key) => {
      delete projectionSettings[key];
    });
    Object.assign(projectionSettings, nextProjectionSettings);

    simulationState.simulationSettings = simulationSettings;
    simulationState.vehicleSettings = vehicleSettings;
    simulationState.projectionSettings = projectionSettings;

    pressedKeys.clear();
    previousTimestamp = null;
    accumulatedMs = 0;
    performanceTracker.reset();
    updateFieldOfView();
    updateGreentextDebugOverlay();
    refreshSidebarSections();
    publishDebugSnapshot();
  };
  const resetSimulation = () => {
    replaceSimulationState(scenario);
  };
  const loadScenario = (scenarioId) => {
    const scenarioDefinition = getChaseScenarioDefinition(scenarioId);
    activeScenarioId = scenarioDefinition.id ?? DEFAULT_CHASE_SCENARIO_ID;
    scenario = resolveChaseScenario(scenarioDefinition, { columns, rows });
    replaceSimulationState(scenario);
    if (simulationState.evaderExists === false && evaderViewVisible) {
      evaderView.close();
    }
  };

  refreshSidebarSections();
  registerSidebarActions({
    setSidebarActionHandler,
    getProgrammaticChaserEnabled: () => simulationState.programmaticChaserEnabled,
    setProgrammaticChaserEnabled: (value) => {
      simulationState.programmaticChaserEnabled = value;
    },
    refreshSidebarSections,
    getChaserViewVisible: () => chaserViewVisible,
    openChaserView: () => chaserView.open(),
    closeChaserView: () => chaserView.close(),
    getEvaderViewVisible: () => evaderViewVisible,
    openEvaderView: () => evaderView.open(),
    closeEvaderView: () => evaderView.close(),
    getIdaeDebugVisible: () => idaeDebugVisible,
    openIdaeDebug: () => idaeDebugFrame.open(),
    closeIdaeDebug: () => idaeDebugFrame.close(),
    updateFieldOfView,
    updateGreentextDebugOverlay,
    simulationSettings,
    vehicleSettings,
    projectionSettings,
    actionPathDebugSettings,
    mapKnowledgeDebugSettings,
    resetSimulation,
    loadScenario,
    getActorStrategyCollections: () => getActorStrategyCollections(simulationState),
    setActorStrategyEnabled: (actorId, strategyId, enabled) => {
      if (actorId === "chaser") {
        setChaserActionEngineEnabled(
          simulationState.chaserIdae?.state?.controllerState,
          strategyId,
          enabled,
        );
        return;
      }
      if (actorId === "evader") {
        setEvaderStrategyEngineEnabled(
          simulationState.evaderIdae?.state,
          strategyId,
          enabled,
        );
      }
    },
    getPredictionDebugState: () => idaePredictionDebug,
    setPredictionDebugState: applyPredictionDebugState,
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "block h-full w-full";
  container.appendChild(renderer.domElement);
  greentextDebugOverlay = createGreentextDebugOverlay(container);
  updateGreentextDebugOverlay();

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-columns / 2, columns / 2, rows / 2, -rows / 2, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(3, 8, 4);
  scene.add(ambientLight, keyLight);

  chaserFieldOfView = createFieldOfViewCone(vehicleSettings.fieldOfViewAngleRadians);
  evaderFieldOfView = createEvaderFieldOfViewCone(vehicleSettings.fieldOfViewAngleRadians);
  const chaser = createCar(0x38bdf8);
  const evader = createCar(0xf43f5e);
  const evaderProjectionGroup = new THREE.Group();
  const evaderProjectionFrames = [];
  const idaePredictionDebugGroup = new THREE.Group();
  const idaePredictionDebugDisplayState = createPredictionDebugDisplayState();
  const chaserActionPathDebugGroup = new THREE.Group();
  const chaserActionPathDebugDisplayState = createPredictionDebugDisplayState();
  const mapKnowledgeOverlayGroup = new THREE.Group();
  const mapKnowledgeOverlayDisplayState = createMapKnowledgeOverlayDisplayState();
  const mapRecencyOverlayGroup = new THREE.Group();
  const mapRecencyOverlayDisplayState = createMapRecencyOverlayDisplayState();
  evaderProjectionGroup.visible = false;
  idaePredictionDebugGroup.visible = false;
  chaserActionPathDebugGroup.visible = false;
  mapKnowledgeOverlayGroup.visible = false;
  mapRecencyOverlayGroup.visible = false;
  const obstacles = simulationState.obstacles;
  const obstacleMeshes = obstacles.walls.map(createWall);
  scene.add(
    mapKnowledgeOverlayGroup,
    mapRecencyOverlayGroup,
    chaserFieldOfView,
    evaderFieldOfView,
    evaderProjectionGroup,
    idaePredictionDebugGroup,
    chaserActionPathDebugGroup,
    chaser,
    evader,
    ...obstacleMeshes,
  );

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
  const clearControls = () => pressedKeys.clear();

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clearControls);

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    configureCamera(camera, columns, rows, width, height);
    chaserView.resize();
    evaderView.resize();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const MAX_STEPS_PER_TICK = 8;
  const tick = (timestamp) => {
    const tickStartMs = performance.now();
    if (previousTimestamp === null) {
      previousTimestamp = timestamp;
    }
    const elapsedMs = Math.max(0, Math.min(250, timestamp - previousTimestamp));
    previousTimestamp = timestamp;
    const frameDurationMs = 1000 / Math.max(
      MIN_SIMULATION_FRAMES_PER_SECOND,
      Number(simulationSettings.framesPerSecond) || ASSUMED_GAME_FRAMES_PER_SECOND,
    );
    const pauseBeforeActions = Boolean(simulationSettings.pauseBeforeActions);
    accumulatedMs = pauseBeforeActions && simulationState.pendingActionFrame
      ? 0
      : Math.min(accumulatedMs + elapsedMs, frameDurationMs * MAX_STEPS_PER_TICK);
    const humanInput = getHumanChaserInput(pressedKeys);
    let stepsThisTick = 0;
    const stepStartMs = performance.now();
    while (accumulatedMs >= frameDurationMs && stepsThisTick < MAX_STEPS_PER_TICK) {
      if (pauseBeforeActions && simulationState.pendingActionFrame) {
        accumulatedMs = 0;
        break;
      }
      stepChaseSimulation(simulationState, { humanInput, pauseBeforeActions });
      accumulatedMs -= frameDurationMs;
      stepsThisTick += 1;
      if (pauseBeforeActions && simulationState.pendingActionFrame) {
        accumulatedMs = 0;
        break;
      }
    }
    const stepMs = performance.now() - stepStartMs;

    const {
      chaserPosition,
      chaserLookDirection,
      evaderExists,
      evaderPosition,
      evaderDirection,
      evaderWallAvoidanceTruth,
      lastStep,
    } = simulationState;
    const chaserSnapshot = lastStep.chaserReasoning?.snapshot ?? null;
    const evaderLocationMemory = chaserSnapshot?.memory?.directObservation?.evaderLocation ?? null;
    const evaderPredictionPlan = chaserSnapshot?.strategies?.evaderPrediction ?? null;
    const evaderMotionModel = chaserSnapshot?.patterns?.evaderMotionModel ?? null;
    const chaserVisibleFromEvader = Boolean(
      lastStep.evaderReasoning?.snapshot?.memory?.directObservation?.chaserLocation?.visible,
    );
    chaserView.setTrackedActorVisible(Boolean(evaderLocationMemory?.visible));
    evaderView.setTrackedActorVisible(Boolean(evaderExists && chaserVisibleFromEvader));
    const projectionDisplayStartMs = performance.now();
    updateEvaderProjectionDisplay(
      evaderProjectionGroup,
      evaderProjectionFrames,
      evaderMotionModel,
      evaderPredictionPlan?.prediction ?? null,
      projectionSettings,
      evaderMotionModel?.speedEstimateUnitsPerFrame,
      evaderPredictionPlan?.path ?? null,
    );
    const projectionDisplayMs = performance.now() - projectionDisplayStartMs;
    const predictionDebugDisplayStartMs = performance.now();
    const actorSnapshots = {
      chaser: chaserSnapshot,
      evader: lastStep.evaderReasoning?.snapshot ?? null,
    };
    updatePredictionDebugDisplay(
      idaePredictionDebugGroup,
      idaePredictionDebugDisplayState,
      actorSnapshots[idaePredictionDebug.actorId] ?? null,
      { visible: idaePredictionDebug.visible },
    );
    updateChaserActionPathDebugDisplay(
      chaserActionPathDebugGroup,
      chaserActionPathDebugDisplayState,
      lastStep.chaserAction ?? null,
      actionPathDebugSettings,
    );
    const predictionDebugDisplayMs = performance.now() - predictionDebugDisplayStartMs;
    const mapKnowledgeDisplayStartMs = performance.now();
    updateMapKnowledgeOverlayDisplay(
      mapKnowledgeOverlayGroup,
      mapKnowledgeOverlayDisplayState,
      chaserSnapshot?.memory?.abstracted?.mapShape ?? null,
      {
        visible: isMapKnowledgeOverlayVisible(mapKnowledgeDebugSettings),
      },
    );
    updateMapRecencyOverlayDisplay(
      mapRecencyOverlayGroup,
      mapRecencyOverlayDisplayState,
      chaserSnapshot?.memory?.abstracted?.mapShape ?? null,
      {
        visible: isMapRecencyOverlayVisible(mapKnowledgeDebugSettings),
        currentFrame: simulationState.frameIndex,
      },
    );
    const mapKnowledgeDisplayMs = performance.now() - mapKnowledgeDisplayStartMs;
    const idaeDebugStartMs = performance.now();
    idaeDebugFrame?.update({
      chaserSnapshot,
      chaserAction: lastStep.chaserAction ?? null,
      evaderWallTruth: evaderWallAvoidanceTruth,
      evaderReasoning: lastStep.evaderReasoning ?? null,
      evaderMovementDecision: lastStep.evaderMovementDecision ?? null,
      performance: performanceTracker.getSnapshot(),
    });
    const idaeDebugMs = performance.now() - idaeDebugStartMs;
    const sidebarStartMs = performance.now();
    refreshSidebarSections();
    const sidebarMs = performance.now() - sidebarStartMs;
    updateGreentextDebugOverlay();

    const sceneSyncStartMs = performance.now();
    chaser.position.set(chaserPosition.x, CAR_HEIGHT / 2, chaserPosition.z);
    chaser.rotation.y = vectorToAngle(chaserLookDirection);
    chaserFieldOfView.position.set(chaserPosition.x, 0, chaserPosition.z);
    chaserFieldOfView.rotation.y = vectorToAngle(chaserLookDirection);
    evader.visible = Boolean(evaderExists && evaderPosition && evaderDirection);
    evaderFieldOfView.visible = Boolean(evaderExists && evaderPosition && evaderDirection);
    if (evader.visible) {
      evader.position.set(evaderPosition.x, CAR_HEIGHT / 2, evaderPosition.z);
      evader.rotation.y = vectorToAngle(evaderDirection);
      evaderFieldOfView.position.set(evaderPosition.x, 0, evaderPosition.z);
      evaderFieldOfView.rotation.y = vectorToAngle(evaderDirection);
    }
    const sceneSyncMs = performance.now() - sceneSyncStartMs;

    const mainRenderStartMs = performance.now();
    renderer.render(scene, camera);
    const mainRenderMs = performance.now() - mainRenderStartMs;
    const chaserViewRenderStartMs = performance.now();
    chaserView.render({
      scene,
      actorMesh: chaser,
      actorFieldOfView: chaserFieldOfView,
      otherActorFieldOfView: evaderFieldOfView,
      actorPosition: chaserPosition,
      actorLookDirection: chaserLookDirection,
    });
    const chaserViewRenderMs = performance.now() - chaserViewRenderStartMs;
    const evaderViewRenderStartMs = performance.now();
    if (evaderExists && evaderPosition && evaderDirection) {
      evaderView.render({
        scene,
        actorMesh: evader,
        actorFieldOfView: evaderFieldOfView,
        otherActorFieldOfView: chaserFieldOfView,
        actorPosition: evaderPosition,
        actorLookDirection: evaderDirection,
      });
    }
    const evaderViewRenderMs = performance.now() - evaderViewRenderStartMs;
    const totalTickMs = performance.now() - tickStartMs;
    performanceTracker.recordTick({
      frameIndex: simulationState.frameIndex,
      timestampMs: timestamp,
      elapsedMs,
      frameDurationMs,
      accumulatedMsAfterStep: accumulatedMs,
      stepsThisTick,
      stepMs,
      totalTickMs,
      overVisualBudget: totalTickMs > (1000 / ASSUMED_GAME_FRAMES_PER_SECOND),
      overSimulationBudget: totalTickMs > frameDurationMs,
      visible: {
        idaeDebug: idaeDebugVisible,
        idaePredictionDebug: idaePredictionDebug.visible,
        mapKnowledgeDebug: isMapKnowledgeOverlayVisible(mapKnowledgeDebugSettings),
        mapRecencyDebug: isMapRecencyOverlayVisible(mapKnowledgeDebugSettings),
        chaserView: chaserViewVisible,
        evaderView: evaderViewVisible,
      },
      segments: {
        projectionDisplayMs,
        predictionDebugDisplayMs,
        mapKnowledgeDisplayMs,
        idaeDebugMs,
        sidebarMs,
        sceneSyncMs,
        mainRenderMs,
        chaserViewRenderMs,
        evaderViewRenderMs,
      },
    });
    publishDebugSnapshot();
    animationFrame = window.requestAnimationFrame(tick);
  };
  animationFrame = window.requestAnimationFrame(tick);

  return {
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearControls);
      clearSidebarActions(setSidebarActionHandler, getActorStrategyCollections(simulationState));
      pressedKeys.clear();

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      chaser.geometry.dispose();
      chaser.material.dispose();
      chaserFieldOfView.geometry.dispose();
      chaserFieldOfView.material.dispose();
      evaderFieldOfView.geometry.dispose();
      evaderFieldOfView.material.dispose();
      greentextDebugOverlay?.dispose();
      evader.geometry.dispose();
      evader.material.dispose();
      syncProjectionFrames(evaderProjectionGroup, evaderProjectionFrames, 0);
      disposePredictionDebugDisplayState(idaePredictionDebugGroup, idaePredictionDebugDisplayState);
      disposePredictionDebugDisplayState(chaserActionPathDebugGroup, chaserActionPathDebugDisplayState);
      disposeMapKnowledgeOverlayDisplayState(mapKnowledgeOverlayGroup, mapKnowledgeOverlayDisplayState);
      disposeMapRecencyOverlayDisplayState(mapRecencyOverlayGroup, mapRecencyOverlayDisplayState);
      obstacleMeshes.forEach((obstacle) => {
        obstacle.geometry.dispose();
        obstacle.material.dispose();
      });
      renderer.dispose();
      chaserView.dispose();
      evaderView.dispose();
      idaeDebugFrame.dispose();
      performanceTracker.reset();
      setDebugSnapshot?.(null);
    },
  };
}
