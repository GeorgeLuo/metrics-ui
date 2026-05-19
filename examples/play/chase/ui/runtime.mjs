import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  MIN_SIMULATION_FRAMES_PER_SECOND,
} from "../config/constants.mjs";
import { getHumanChaserInput, isControlCode, isTextEditingTarget } from "./input.mjs";
import { publishSidebarSections } from "./sidebar.mjs";
import {
  readStoredActionPathDebugSettings,
  readStoredMapKnowledgeDebugSettings,
  readStoredProjectionSettings,
} from "./settings.mjs";
import { resolveChaseScenario } from "../simulation/scenario.mjs";
import {
  createChaseSimulationState,
  stepChaseSimulation,
} from "../simulation/simulation.mjs";
import { createChasePerformanceTracker } from "../debug/performance-debug.mjs";
import { buildChaseDebugSnapshot } from "../debug/debug-snapshot.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "../scenarios/index.mjs";
import { setChaserActionEngineEnabled } from "../actors/chaser/chaser-controller.mjs";
import { setEvaderStrategyEngineEnabled } from "../actors/evader/evader-decision-model.mjs";
import {
  createChaserViewController,
  createEvaderViewController,
} from "./actor-view-controller.mjs";
import { createIdaeDebugController } from "./decision-debug-controller.mjs";
import {
  buildGreentextDebugText,
  createGreentextDebugOverlay,
} from "./greentext-debug-overlay.mjs";
import { createChaseSceneView } from "./scene-view.mjs";
import {
  clearSidebarActions,
  registerSidebarActions,
} from "./sidebar-actions.mjs";

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

function createControlInputTracker() {
  const pressedKeys = new Set();
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
  const clear = () => pressedKeys.clear();

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clear);

  return {
    getHumanInput: () => getHumanChaserInput(pressedKeys),
    clear,
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clear);
      clear();
    },
  };
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
  const inputTracker = createControlInputTracker();
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

  const sceneView = createChaseSceneView({
    container,
    columns,
    rows,
    simulationState,
    vehicleSettings,
    chaserView,
    evaderView,
  });
  const greentextDebugOverlay = createGreentextDebugOverlay(container);
  const updateGreentextDebugOverlay = () => {
    greentextDebugOverlay.update({
      visible: Boolean(simulationSettings.greentextDebugVisible),
      text: buildGreentextDebugText(simulationState),
    });
  };
  updateGreentextDebugOverlay();

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

    inputTracker.clear();
    previousTimestamp = null;
    accumulatedMs = 0;
    performanceTracker.reset();
    sceneView.updateFieldOfView();
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
    updateFieldOfView: sceneView.updateFieldOfView,
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

  let animationFrame = 0;
  let previousTimestamp = null;
  let accumulatedMs = 0;
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
    const humanInput = inputTracker.getHumanInput();
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

    const frameRender = sceneView.renderFrame({
      projectionSettings,
      predictionDebugState: idaePredictionDebug,
      actionPathDebugSettings,
      mapKnowledgeDebugSettings,
    });

    const idaeDebugStartMs = performance.now();
    idaeDebugFrame?.update({
      chaserSnapshot: frameRender.chaserSnapshot,
      chaserAction: simulationState.lastStep.chaserAction ?? null,
      evaderWallTruth: simulationState.evaderWallAvoidanceTruth,
      evaderReasoning: simulationState.lastStep.evaderReasoning ?? null,
      evaderMovementDecision: simulationState.lastStep.evaderMovementDecision ?? null,
      performance: performanceTracker.getSnapshot(),
    });
    const idaeDebugMs = performance.now() - idaeDebugStartMs;
    const sidebarStartMs = performance.now();
    refreshSidebarSections();
    const sidebarMs = performance.now() - sidebarStartMs;
    updateGreentextDebugOverlay();

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
        ...frameRender.visibility,
        chaserView: chaserViewVisible,
        evaderView: evaderViewVisible,
      },
      segments: {
        ...frameRender.timings,
        idaeDebugMs,
        sidebarMs,
      },
    });
    publishDebugSnapshot();
    animationFrame = window.requestAnimationFrame(tick);
  };
  animationFrame = window.requestAnimationFrame(tick);

  return {
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      clearSidebarActions(setSidebarActionHandler, getActorStrategyCollections(simulationState));
      inputTracker.dispose();
      sceneView.dispose();
      greentextDebugOverlay.dispose();
      chaserView.dispose();
      evaderView.dispose();
      idaeDebugFrame.dispose();
      performanceTracker.reset();
      setDebugSnapshot?.(null);
    },
  };
}
