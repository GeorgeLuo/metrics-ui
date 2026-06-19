import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  MIN_SIMULATION_FRAMES_PER_SECOND,
} from "../config/constants.mjs";
import { stepChaseSimulation } from "../simulation/simulation.mjs";

const MAX_STEPS_PER_TICK = 8;
const PERIODIC_UI_PUBLISH_INTERVAL_MS = 250;

function shouldPublishPeriodicUi(timestamp, lastPublishMs) {
  return timestamp - lastPublishMs >= PERIODIC_UI_PUBLISH_INTERVAL_MS;
}

export function createChaseLoop({
  simulationState,
  simulationSettings,
  inputTracker,
  sceneView,
  idaeDebugFrame,
  performanceTracker,
  getPredictionDebugState,
  getProjectionSettings,
  getActionPathDebugSettings,
  getMapKnowledgeDebugSettings,
  getVisibility,
  refreshSidebarSections,
  updateGreentextDebugOverlay,
  publishDebugSnapshot,
}) {
  let animationFrame = 0;
  let previousTimestamp = null;
  let accumulatedMs = 0;
  let lastSidebarPublishMs = 0;
  let lastDebugSnapshotPublishMs = 0;

  const resetTiming = () => {
    previousTimestamp = null;
    accumulatedMs = 0;
  };

  const publishDebugSnapshotFromLoop = () => {
    lastDebugSnapshotPublishMs = performance.now();
    publishDebugSnapshot?.();
  };

  const refreshSidebarFromLoop = () => {
    lastSidebarPublishMs = performance.now();
    refreshSidebarSections?.();
  };

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
    const chaserInput = inputTracker.getChaserInput(simulationState.chaserControlSource);
    let stepsThisTick = 0;
    const stepStartMs = performance.now();
    while (accumulatedMs >= frameDurationMs && stepsThisTick < MAX_STEPS_PER_TICK) {
      if (pauseBeforeActions && simulationState.pendingActionFrame) {
        accumulatedMs = 0;
        break;
      }
      stepChaseSimulation(simulationState, { humanInput: chaserInput, pauseBeforeActions });
      accumulatedMs -= frameDurationMs;
      stepsThisTick += 1;
      if (pauseBeforeActions && simulationState.pendingActionFrame) {
        accumulatedMs = 0;
        break;
      }
    }
    const stepMs = performance.now() - stepStartMs;
    const frameRender = sceneView.renderFrame({
      projectionSettings: getProjectionSettings(),
      predictionDebugState: getPredictionDebugState(),
      actionPathDebugSettings: getActionPathDebugSettings(),
      mapKnowledgeDebugSettings: getMapKnowledgeDebugSettings(),
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
    let sidebarMs = 0;
    if (shouldPublishPeriodicUi(timestamp, lastSidebarPublishMs)) {
      const sidebarStartMs = performance.now();
      refreshSidebarFromLoop();
      sidebarMs = performance.now() - sidebarStartMs;
      updateGreentextDebugOverlay?.();
    }
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
        ...getVisibility(),
        ...frameRender.visibility,
      },
      segments: {
        ...frameRender.timings,
        idaeDebugMs,
        sidebarMs,
      },
    });
    if (shouldPublishPeriodicUi(timestamp, lastDebugSnapshotPublishMs)) {
      publishDebugSnapshotFromLoop();
    }
    animationFrame = window.requestAnimationFrame(tick);
  };

  animationFrame = window.requestAnimationFrame(tick);
  return {
    resetTiming,
    dispose() {
      window.cancelAnimationFrame(animationFrame);
    },
  };
}
