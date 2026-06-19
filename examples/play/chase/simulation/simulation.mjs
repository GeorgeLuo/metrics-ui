import { CAR_BOUND_RADIUS } from "../config/constants.mjs";
import {
  createChaserIdae,
  recordChaserSuccessMetrics,
  stepChaserIdae,
} from "../actors/chaser/chaser-decision-model-adapter.ts";
import { createEvaderIdae, stepEvaderIdae } from "../actors/evader/evader-decision-model.mjs";
import { stepVehicleBicycleFrame } from "../decision-model/actions/vehicle/kinematics.ts";
import {
  createEvaderWallAvoidanceTruthState,
  updateEvaderWallAvoidanceTruth,
} from "../decision-model/patterns/chaser/evader-motion/wall-avoidance/evidence.ts";
import {
  recordFrameFrontViewCaptures,
} from "./front-view-captures.ts";
import {
  getInitialChaserControlSource,
  isProgrammaticChaserControlSource,
  setChaserControlSource,
} from "./chaser-control-source.mjs";
import {
  createChaseTraceRecorder,
  getChaseTraceRecorderSnapshot,
  recordChaseTraceFrame,
} from "./trace-recorder.mjs";
import {
  createPredictionPerformanceTracker,
  recordPredictionPerformanceSet,
  validatePredictionPerformance,
} from "../debug/prediction-performance.mjs";
import { resolveObstacleCollisions } from "../world/world.mjs";

function createRunMetrics() {
  return {
    elapsedFrames: 0,
    touchCount: 0,
    touchRatePerThousandFrames: 0,
    evaderTouchActive: false,
  };
}

function updateRunMetrics(runMetrics, chaserPosition, evaderPosition) {
  if (!runMetrics) {
    return;
  }

  runMetrics.elapsedFrames += 1;
  if (!chaserPosition || !evaderPosition) {
    runMetrics.evaderTouchActive = false;
    runMetrics.touchRatePerThousandFrames = runMetrics.elapsedFrames > 0
      ? (runMetrics.touchCount / runMetrics.elapsedFrames) * 1000
      : 0;
    return;
  }

  const touchesTarget = Math.hypot(
    chaserPosition.x - evaderPosition.x,
    chaserPosition.z - evaderPosition.z,
  ) <= CAR_BOUND_RADIUS * 2;

  if (touchesTarget && !runMetrics.evaderTouchActive) {
    runMetrics.touchCount += 1;
  }
  runMetrics.evaderTouchActive = touchesTarget;
  runMetrics.touchRatePerThousandFrames = runMetrics.elapsedFrames > 0
    ? (runMetrics.touchCount / runMetrics.elapsedFrames) * 1000
    : 0;
}

function cloneVector(vector, fallback = { x: 0, z: 0 }) {
  if (vector) {
    return {
      x: Number(vector.x) || 0,
      z: Number(vector.z) || 0,
    };
  }

  return fallback ? { ...fallback } : null;
}

function cloneHumanInput(humanInput) {
  const frontViewCapture = humanInput?.frontViewCapture?.requested
    ? {
      requested: true,
      rendererId: typeof humanInput.frontViewCapture.rendererId === "string"
        ? humanInput.frontViewCapture.rendererId
        : undefined,
    }
    : humanInput?.captureFrontView
      ? { requested: true }
      : null;
  return {
    source: humanInput?.source === "ws" ? "ws" : "human",
    forward: Boolean(humanInput?.forward),
    reverse: Boolean(humanInput?.reverse),
    steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
    frontViewCapture,
  };
}

function clampUnit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, numericValue));
}

function applyVehicleAction({
  position,
  direction,
  action,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
  columns,
  rows,
  obstacles,
} = {}) {
  const isMovingForward = Boolean(action?.forward);
  const isMovingReverse = Boolean(action?.reverse);
  const movementSign = isMovingForward ? 1 : isMovingReverse ? -1 : 0;
  const speed = Math.max(0, Number(speedUnitsPerFrame) || 0);
  const isMoving = movementSign !== 0 && speed > 0;
  const steeringInput = clampUnit(action?.steering);
  const currentDirection = cloneVector(direction, { x: 1, z: 0 });

  if (!isMoving) {
    return {
      direction: currentDirection,
      position: {
        x: Number(position?.x) || 0,
        z: Number(position?.z) || 0,
      },
    };
  }

  const nextFrame = stepVehicleBicycleFrame({
    position,
    direction: currentDirection,
    speedUnitsPerFrame: speed,
    throttle: movementSign,
    steering: steeringInput,
    maxSteeringAngleRadians,
  });

  const nextPosition = resolveObstacleCollisions(
    nextFrame.position,
    position,
    columns,
    rows,
    obstacles,
  );

  return {
    direction: nextFrame.direction,
    position: nextPosition,
  };
}

function createSynchronizedFrameContext(state, humanInput) {
  const evaderExists = state.evaderExists !== false;
  return {
    chaserPosition: cloneVector(state.chaserPosition),
    evaderPosition: evaderExists ? cloneVector(state.evaderPosition) : null,
    chaserLookDirection: cloneVector(state.chaserLookDirection, { x: 1, z: 0 }),
    evaderDirection: evaderExists ? cloneVector(state.evaderDirection, { x: -1, z: 0 }) : null,
    evaderExists,
    frameIndex: state.frameIndex,
    fieldOfViewAngleRadians: state.vehicleSettings.fieldOfViewAngleRadians,
    obstacles: state.obstacles,
    columns: state.columns,
    rows: state.rows,
    projectionSettings: state.projectionSettings,
    humanInput,
    programmaticChaserEnabled: isProgrammaticChaserControlSource(state.chaserControlSource),
    chaserSpeedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
    maxSteeringAngleRadians: state.vehicleSettings.maxSteeringAngleRadians,
  };
}

function updateChaserReasoningState(state, frameContext) {
  const cycle = stepChaserIdae(state.chaserIdae, {
    chaserPosition: cloneVector(frameContext.chaserPosition),
    evaderPosition: frameContext.evaderExists === false
      ? null
      : cloneVector(frameContext.evaderPosition),
    chaserLookDirection: cloneVector(frameContext.chaserLookDirection, { x: 1, z: 0 }),
    evaderExists: frameContext.evaderExists !== false,
    frameIndex: frameContext.frameIndex,
    fieldOfViewAngleRadians: frameContext.fieldOfViewAngleRadians,
    obstacles: frameContext.obstacles,
    columns: frameContext.columns,
    rows: frameContext.rows,
    projectionSettings: frameContext.projectionSettings,
    humanInput: frameContext.humanInput,
    programmaticChaserEnabled: frameContext.programmaticChaserEnabled,
    chaserSpeedUnitsPerFrame: frameContext.chaserSpeedUnitsPerFrame,
    maxSteeringAngleRadians: frameContext.maxSteeringAngleRadians,
  });
  return cycle;
}

function updateEvaderReasoningState(state, frameContext) {
  if (state.evaderExists === false || !state.evaderIdae) {
    return null;
  }

  return stepEvaderIdae(state.evaderIdae, {
    evaderPosition: cloneVector(frameContext.evaderPosition),
    evaderDirection: cloneVector(frameContext.evaderDirection, { x: -1, z: 0 }),
    chaserPosition: cloneVector(frameContext.chaserPosition),
    columns: frameContext.columns,
    rows: frameContext.rows,
    frameIndex: frameContext.frameIndex,
    obstacles: frameContext.obstacles,
    fieldOfViewAngleRadians: frameContext.fieldOfViewAngleRadians,
    maxSteeringAngleRadians: frameContext.maxSteeringAngleRadians,
  });
}

function applyChaserAction(state, chaserAction) {
  const nextChaser = applyVehicleAction({
    position: state.chaserPosition,
    direction: state.chaserLookDirection,
    action: chaserAction,
    speedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
    maxSteeringAngleRadians: state.vehicleSettings.maxSteeringAngleRadians,
    columns: state.columns,
    rows: state.rows,
    obstacles: state.obstacles,
  });
  state.chaserLookDirection.x = nextChaser.direction.x;
  state.chaserLookDirection.z = nextChaser.direction.z;
  state.chaserPosition.x = nextChaser.position.x;
  state.chaserPosition.z = nextChaser.position.z;
}

function buildEvaderMovementDecision(state, evaderAction) {
  if (state.evaderExists === false) {
    return null;
  }

  return {
    forward: evaderAction?.forward ?? true,
    steering: Number.isFinite(evaderAction?.steering)
      ? evaderAction.steering
      : 0,
    frontViewCapture: evaderAction?.frontViewCapture ?? null,
    desiredDirection: evaderAction?.desiredDirection ?? null,
    nextDirection: evaderAction?.nextDirection ?? evaderAction?.direction ?? state.evaderDirection,
    direction: evaderAction?.direction ?? state.evaderDirection,
    debug: evaderAction?.debug ?? null,
  };
}

function applyEvaderMovementDecision(state, evaderMovementDecision) {
  if (state.evaderExists === false || !evaderMovementDecision) {
    return null;
  }

  const nextEvader = applyVehicleAction({
    position: state.evaderPosition,
    direction: state.evaderDirection,
    action: evaderMovementDecision,
    speedUnitsPerFrame: state.vehicleSettings.evaderSpeedUnitsPerFrame,
    maxSteeringAngleRadians: state.vehicleSettings.maxSteeringAngleRadians,
    columns: state.columns,
    rows: state.rows,
    obstacles: state.obstacles,
  });
  updateEvaderWallAvoidanceTruth(state.evaderWallAvoidanceTruth, {
    decisionDebug: evaderMovementDecision.debug,
  });
  state.evaderDirection.x = nextEvader.direction.x;
  state.evaderDirection.z = nextEvader.direction.z;
  state.evaderPosition.x = nextEvader.position.x;
  state.evaderPosition.z = nextEvader.position.z;
  return evaderMovementDecision;
}

function buildReasonedActionFrame(state, { humanInput } = {}) {
  state.pendingHumanInput = cloneHumanInput(humanInput);
  const frameContext = createSynchronizedFrameContext(state, state.pendingHumanInput);
  const chaserReasoning = updateChaserReasoningState(state, frameContext);
  const chaserAction = chaserReasoning?.action ?? {
    source: "human",
    forward: false,
    reverse: false,
    steering: 0,
    frontViewCapture: null,
  };
  const evaderReasoning = updateEvaderReasoningState(state, frameContext);
  const evaderMovementDecision = buildEvaderMovementDecision(
    state,
    evaderReasoning?.action ?? null,
  );
  if (state.evaderExists !== false) {
    recordPredictionPerformanceSet(state.predictionPerformance, {
      frameIndex: state.frameIndex,
      targetId: "evader",
      producerId: "chaser.evaderMotionProjection",
      path: chaserReasoning?.snapshot?.projections?.evaderMotion?.path ?? [],
    });
  }

  return {
    phase: "before-actions",
    frameIndex: state.frameIndex,
    actionApplicationPending: true,
    frozenFrame: {
      chaserPosition: cloneVector(frameContext.chaserPosition),
      chaserLookDirection: cloneVector(frameContext.chaserLookDirection, { x: 1, z: 0 }),
      evaderPosition: frameContext.evaderExists === false
        ? null
        : cloneVector(frameContext.evaderPosition),
      evaderDirection: frameContext.evaderExists === false
        ? null
        : cloneVector(frameContext.evaderDirection, { x: -1, z: 0 }),
    },
    chaserInput: chaserAction,
    chaserAction,
    chaserReasoning,
    evaderReasoning,
    evaderMovementDecision,
  };
}

function commitReasonedActionFrame(state, actionFrame) {
  if (!actionFrame) {
    return state;
  }

  applyChaserAction(state, actionFrame.chaserAction);
  const evaderMovementDecision = applyEvaderMovementDecision(
    state,
    actionFrame.evaderMovementDecision,
  );
  const frontViewCaptures = recordFrameFrontViewCaptures(state, actionFrame);
  if (state.evaderExists !== false) {
    validatePredictionPerformance(state.predictionPerformance, {
      frameIndex: state.frameIndex + 1,
      targetId: "evader",
      actualPosition: state.evaderPosition,
      actualDirection: state.evaderDirection,
    });
  }
  recordChaserSuccessMetrics(state.chaserIdae, {
    chaserPosition: state.chaserPosition,
    evaderPosition: state.evaderPosition,
    evaderExists: state.evaderExists !== false,
    frameIndex: state.frameIndex + 1,
  });
  updateRunMetrics(state.runMetrics, state.chaserPosition, state.evaderPosition);
  state.lastStep = {
    ...actionFrame,
    phase: "after-actions",
    actionApplicationPending: false,
    evaderMovementDecision,
    frontViewCaptures,
  };
  state.pendingActionFrame = null;
  state.frameIndex += 1;
  recordChaseTraceFrame(state.traceRecorder, state);
  return state;
}

export function createChaseSimulationState({
  scenario,
  columns,
  rows,
  traceRecorder,
} = {}) {
  const resolvedColumns = Number.isFinite(scenario?.map?.columns)
    ? scenario.map.columns
    : columns;
  const resolvedRows = Number.isFinite(scenario?.map?.rows)
    ? scenario.map.rows
    : rows;
  const evaderExists = scenario?.actors?.evader?.exists !== false;
  const chaserIdae = createChaserIdae({ scenario });
  const evaderIdae = evaderExists ? createEvaderIdae({ scenario }) : null;
  const resolvedTraceRecorder = traceRecorder ?? createChaseTraceRecorder(scenario?.trace);
  const chaserControlSource = getInitialChaserControlSource(scenario);

  const state = {
    scenario,
    columns: resolvedColumns,
    rows: resolvedRows,
    frameIndex: 0,
    evaderExists,
    simulationSettings: {
      ...(scenario?.simulation ?? {}),
    },
    obstacles: scenario?.map?.obstacles ?? { walls: [] },
    vehicleSettings: {
      ...(scenario?.vehicleSettings ?? {}),
    },
    projectionSettings: {
      ...(scenario?.projectionSettings ?? {}),
    },
    chaserControlSource,
    programmaticChaserEnabled: isProgrammaticChaserControlSource(chaserControlSource),
    chaserPosition: { ...(scenario?.actors?.chaser?.position ?? { x: 0, z: 0 }) },
    chaserLookDirection: { ...(scenario?.actors?.chaser?.direction ?? { x: 1, z: 0 }) },
    evaderPosition: evaderExists
      ? { ...(scenario?.actors?.evader?.position ?? { x: 0, z: 0 }) }
      : null,
    evaderDirection: evaderExists
      ? { ...(scenario?.actors?.evader?.direction ?? { x: -1, z: 0 }) }
      : null,
    chaserIdae,
    evaderIdae,
    evaderWallAvoidanceTruth: evaderExists ? createEvaderWallAvoidanceTruthState() : null,
    predictionPerformance: createPredictionPerformanceTracker(),
    traceRecorder: resolvedTraceRecorder,
    runMetrics: createRunMetrics(),
    pendingHumanInput: { forward: false, reverse: false, steering: 0 },
    pendingActionFrame: null,
    lastStep: {
      phase: "initial",
      frameIndex: 0,
      actionApplicationPending: false,
      chaserInput: {
        source: isProgrammaticChaserControlSource(chaserControlSource) ? "programmatic" : "human",
        forward: false,
        reverse: false,
        steering: 0,
        frontViewCapture: null,
      },
      chaserAction: {
        source: isProgrammaticChaserControlSource(chaserControlSource) ? "programmatic" : "human",
        forward: false,
        reverse: false,
        steering: 0,
        frontViewCapture: null,
      },
      chaserReasoning: null,
      evaderReasoning: null,
      evaderMovementDecision: null,
      frontViewCaptures: { chaser: null, evader: null },
    },
  };
  setChaserControlSource(state, chaserControlSource);
  return state;
}

export function stepChaseSimulation(state, {
  humanInput,
  pauseBeforeActions = false,
} = {}) {
  if (!state?.scenario) {
    return state;
  }

  if (state.pendingActionFrame) {
    return pauseBeforeActions
      ? state
      : commitReasonedActionFrame(state, state.pendingActionFrame);
  }

  const actionFrame = buildReasonedActionFrame(state, { humanInput });
  state.lastStep = actionFrame;
  state.pendingActionFrame = actionFrame;
  return pauseBeforeActions
    ? state
    : commitReasonedActionFrame(state, actionFrame);
}

export function runChaseScenarioFrames({
  scenario,
  columns,
  rows,
  frameCount = 0,
  inputProvider,
  state,
  traceRecorder,
} = {}) {
  const simulationState = state ?? createChaseSimulationState({
    scenario,
    columns,
    rows,
    traceRecorder,
  });
  const safeFrameCount = Math.max(0, Math.floor(Number(frameCount) || 0));

  for (let index = 0; index < safeFrameCount; index += 1) {
    const humanInput = typeof inputProvider === "function"
      ? inputProvider({
        frameIndex: simulationState.frameIndex,
        state: simulationState,
      })
      : null;
    stepChaseSimulation(simulationState, { humanInput });
  }

  return simulationState;
}

export function getChaseSimulationTrace(state) {
  return getChaseTraceRecorderSnapshot(state?.traceRecorder);
}
