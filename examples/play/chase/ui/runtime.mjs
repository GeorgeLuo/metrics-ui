import { publishSidebarSections } from "./sidebar.mjs";
import {
  readStoredActionPathDebugSettings,
  readStoredMapKnowledgeDebugSettings,
  readStoredProjectionSettings,
} from "./settings.mjs";
import { createChaseSimulationState } from "../simulation/simulation.mjs";
import { createChasePerformanceTracker } from "../debug/performance-debug.mjs";
import { buildChaseDebugSnapshot } from "../debug/debug-snapshot.mjs";
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
import { createChaseLoop } from "./chase-loop.mjs";
import { createControlInputTracker } from "./input-tracker.mjs";
import { createChaseScenarioSession } from "./scenario-session.mjs";
import {
  applyActorStrategyOverrides,
  cloneActorStrategyCollections,
  getActorStrategyCollections,
  setActorStrategyOverride,
} from "./strategy-overrides.mjs";

function copyInto(target, source) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, source);
}

function normalizeSimulationSettings(simulationSettings) {
  simulationSettings.pauseBeforeActions = Boolean(simulationSettings.pauseBeforeActions);
  simulationSettings.greentextDebugVisible = Boolean(simulationSettings.greentextDebugVisible);
}

function shouldCloseEvaderView(simulationState, evaderViewVisible) {
  return simulationState.evaderExists === false && evaderViewVisible;
}

export { createScenarioDefinitionWithEvaderOverride } from "./scenario-session.mjs";

export function createPlayGame({
  container,
  columns,
  rows,
  createFloatingFrame,
  setSidebarSections,
  setSidebarActionHandler,
  setDebugSnapshot,
  setViewportSpec,
}) {
  const scenarioSession = createChaseScenarioSession({ columns, rows });
  let scenario = scenarioSession.buildScenario();
  const simulationState = createChaseSimulationState({ scenario, columns, rows });
  let actorStrategyOverrides = cloneActorStrategyCollections(
    getActorStrategyCollections(simulationState),
  );
  const performanceTracker = createChasePerformanceTracker();
  const inputTracker = createControlInputTracker();
  let chaserViewVisible = false;
  let evaderViewVisible = false;
  let idaeDebugVisible = false;
  let idaePredictionDebug = {
    visible: true,
    actorId: "chaser",
  };
  let runtimeLoop = null;

  const simulationSettings = simulationState.simulationSettings;
  normalizeSimulationSettings(simulationSettings);
  const vehicleSettings = simulationState.vehicleSettings;
  const projectionSettings = {
    ...simulationState.projectionSettings,
    ...readStoredProjectionSettings(),
  };
  const actionPathDebugSettings = readStoredActionPathDebugSettings();
  const mapKnowledgeDebugSettings = readStoredMapKnowledgeDebugSettings();
  simulationState.projectionSettings = projectionSettings;
  setViewportSpec?.(scenarioSession.getViewportSpec(scenario));

  const publishDebugSnapshot = () => {
    setDebugSnapshot?.(buildChaseDebugSnapshot(simulationState, {
      performance: performanceTracker.getSnapshot(),
      predictionDebug: idaePredictionDebug,
    }));
  };

  const refreshSidebarSections = () => {
    publishSidebarSections(
      setSidebarSections,
      simulationState.programmaticChaserEnabled,
      { chaserViewVisible, evaderViewVisible, idaeDebugVisible },
      simulationSettings,
      vehicleSettings,
      projectionSettings,
      getActorStrategyCollections(simulationState),
      simulationState.runMetrics,
      scenarioSession.getSidebarControls(simulationState),
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
    onPredictionDebugChange: (nextState = {}) => applyPredictionDebugState(nextState),
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

  const replaceSimulationState = (nextScenario, { preserveSidebarSettings = false } = {}) => {
    const preservedSettings = preserveSidebarSettings ? {
      programmaticChaserEnabled: simulationState.programmaticChaserEnabled,
      simulationSettings: { ...simulationSettings },
      vehicleSettings: { ...vehicleSettings },
      projectionSettings: { ...projectionSettings },
    } : null;
    const freshState = createChaseSimulationState({ scenario: nextScenario, columns, rows });
    const nextSimulationSettings = preservedSettings?.simulationSettings
      ?? { ...freshState.simulationSettings };
    const nextVehicleSettings = preservedSettings?.vehicleSettings
      ?? { ...freshState.vehicleSettings };
    const nextProjectionSettings = preservedSettings?.projectionSettings
      ?? { ...freshState.projectionSettings, ...readStoredProjectionSettings() };

    copyInto(simulationState, freshState);
    if (preservedSettings) {
      simulationState.programmaticChaserEnabled = preservedSettings.programmaticChaserEnabled;
    }
    copyInto(simulationSettings, nextSimulationSettings);
    normalizeSimulationSettings(simulationSettings);
    copyInto(vehicleSettings, nextVehicleSettings);
    copyInto(projectionSettings, nextProjectionSettings);
    simulationState.simulationSettings = simulationSettings;
    simulationState.vehicleSettings = vehicleSettings;
    simulationState.projectionSettings = projectionSettings;
    applyActorStrategyOverrides(simulationState, actorStrategyOverrides);

    inputTracker.clear();
    runtimeLoop?.resetTiming();
    performanceTracker.reset();
    sceneView.updateFieldOfView();
    sceneView.resize();
    setViewportSpec?.(scenarioSession.getViewportSpec(nextScenario));
    updateGreentextDebugOverlay();
    refreshSidebarSections();
    publishDebugSnapshot();
  };

  const resetSimulation = () => {
    scenario = scenarioSession.buildScenario();
    replaceSimulationState(scenario, { preserveSidebarSettings: true });
  };
  const loadScenario = (scenarioId) => {
    scenario = scenarioSession.loadScenario(scenarioId);
    replaceSimulationState(scenario, { preserveSidebarSettings: true });
    if (shouldCloseEvaderView(simulationState, evaderViewVisible)) {
      evaderView.close();
    }
  };
  const setEvaderExists = (evaderExists) => {
    scenario = scenarioSession.setEvaderExists(evaderExists);
    replaceSimulationState(scenario, { preserveSidebarSettings: true });
    if (shouldCloseEvaderView(simulationState, evaderViewVisible)) {
      evaderView.close();
    }
  };

  updateGreentextDebugOverlay();
  refreshSidebarSections();
  const registeredSidebarActionIds = registerSidebarActions({
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
    getEvaderExists: () => simulationState.evaderExists !== false,
    setEvaderExists,
    getActorStrategyCollections: () => getActorStrategyCollections(simulationState),
    setActorStrategyEnabled: (actorId, strategyId, enabled) => {
      actorStrategyOverrides = setActorStrategyOverride({
        simulationState,
        actorStrategyOverrides,
        actorId,
        strategyId,
        enabled,
      });
    },
    getPredictionDebugState: () => idaePredictionDebug,
    setPredictionDebugState: applyPredictionDebugState,
  });

  runtimeLoop = createChaseLoop({
    simulationState,
    simulationSettings,
    inputTracker,
    sceneView,
    idaeDebugFrame,
    performanceTracker,
    getPredictionDebugState: () => idaePredictionDebug,
    getProjectionSettings: () => projectionSettings,
    getActionPathDebugSettings: () => actionPathDebugSettings,
    getMapKnowledgeDebugSettings: () => mapKnowledgeDebugSettings,
    getVisibility: () => ({ idaeDebug: idaeDebugVisible, chaserView: chaserViewVisible, evaderView: evaderViewVisible }),
    refreshSidebarSections,
    updateGreentextDebugOverlay,
    publishDebugSnapshot,
  });

  return {
    dispose() {
      runtimeLoop?.dispose();
      clearSidebarActions(
        setSidebarActionHandler,
        getActorStrategyCollections(simulationState),
        registeredSidebarActionIds,
      );
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
