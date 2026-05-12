import { CAR_BOUND_RADIUS } from "./constants.mjs";
import { createChaserIdae, stepChaserIdae } from "./chaser-idae.mjs";
import { createEvaderIdae, stepEvaderIdae } from "./evader-idae.mjs";
import {
  angleToVector,
  vectorToAngle,
} from "./math.mjs";
import {
  createEvaderWallAvoidanceTruthState,
  updateEvaderWallAvoidanceTruth,
} from "./wall-avoidance-detection.mjs";
import {
  createChaseTraceRecorder,
  getChaseTraceRecorderSnapshot,
  recordChaseTraceFrame,
} from "./trace-recorder.mjs";
import {
  createPredictionPerformanceTracker,
  recordPredictionPerformanceSet,
  validatePredictionPerformance,
} from "./prediction-performance.mjs";
import { resolveObstacleCollisions } from "./world.mjs";

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
  return {
    forward: Boolean(humanInput?.forward),
    reverse: Boolean(humanInput?.reverse),
    steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
  };
}

function applyVehicleAction({
  position,
  direction,
  action,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  columns,
  rows,
  obstacles,
} = {}) {
  const isMovingForward = Boolean(action?.forward);
  const isMovingReverse = Boolean(action?.reverse);
  const movementSign = isMovingForward ? 1 : isMovingReverse ? -1 : 0;
  const isMoving = movementSign !== 0;
  const steeringInput = Number.isFinite(action?.steering) ? action.steering : 0;
  const actionNextDirection = action?.nextDirection;
  let nextDirection = actionNextDirection
    ? {
      x: Number(actionNextDirection.x) || 0,
      z: Number(actionNextDirection.z) || 0,
    }
    : {
      x: Number(direction?.x) || 0,
      z: Number(direction?.z) || 0,
    };

  if (!isMoving && !actionNextDirection) {
    return {
      direction: nextDirection,
      position: {
        x: Number(position?.x) || 0,
        z: Number(position?.z) || 0,
      },
    };
  }

  if (!actionNextDirection && isMoving && steeringInput !== 0) {
    nextDirection = angleToVector(
      vectorToAngle(nextDirection)
        + steeringInput * turnRateRadiansPerFrame * (isMovingReverse ? -1 : 1),
    );
  }

  const nextPosition = resolveObstacleCollisions({
    x: (Number(position?.x) || 0)
      + nextDirection.x * speedUnitsPerFrame * movementSign,
    z: (Number(position?.z) || 0)
      + nextDirection.z * speedUnitsPerFrame * movementSign,
  }, position, columns, rows, obstacles);

  return {
    direction: nextDirection,
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
    programmaticChaserEnabled: state.programmaticChaserEnabled,
    chaserSpeedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
    turnRateRadiansPerFrame: state.vehicleSettings.turnRateRadiansPerFrame,
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
    turnRateRadiansPerFrame: frameContext.turnRateRadiansPerFrame,
  });
}

function applyChaserAction(state, chaserAction) {
  const nextChaser = applyVehicleAction({
    position: state.chaserPosition,
    direction: state.chaserLookDirection,
    action: chaserAction,
    speedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
    turnRateRadiansPerFrame: state.vehicleSettings.turnRateRadiansPerFrame,
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
    turnRateRadiansPerFrame: state.vehicleSettings.turnRateRadiansPerFrame,
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
      producerId: "chaser.evaderPrediction",
      path: chaserReasoning?.snapshot?.strategies?.evaderPrediction?.path ?? [],
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
  if (state.evaderExists !== false) {
    validatePredictionPerformance(state.predictionPerformance, {
      frameIndex: state.frameIndex + 1,
      targetId: "evader",
      actualPosition: state.evaderPosition,
      actualDirection: state.evaderDirection,
    });
  }
  updateRunMetrics(state.runMetrics, state.chaserPosition, state.evaderPosition);
  state.lastStep = {
    ...actionFrame,
    phase: "after-actions",
    actionApplicationPending: false,
    evaderMovementDecision,
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
  const evaderExists = scenario?.actors?.evader?.exists !== false;
  const chaserIdae = createChaserIdae({ scenario });
  const evaderIdae = evaderExists ? createEvaderIdae({ scenario }) : null;
  const resolvedTraceRecorder = traceRecorder ?? createChaseTraceRecorder(scenario?.trace);

  return {
    scenario,
    columns,
    rows,
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
    programmaticChaserEnabled: Boolean(scenario?.runtime?.programmaticChaserEnabled),
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
      chaserInput: { source: "human", forward: false, reverse: false, steering: 0 },
      chaserAction: { source: "human", forward: false, reverse: false, steering: 0 },
      chaserReasoning: null,
      evaderReasoning: null,
      evaderMovementDecision: null,
    },
  };
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
