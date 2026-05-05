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

function updateChaserReasoningState(state) {
  const cycle = stepChaserIdae(state.chaserIdae, {
    chaserPosition: state.chaserPosition,
    evaderPosition: state.evaderPosition,
    chaserLookDirection: state.chaserLookDirection,
    frameIndex: state.frameIndex,
    fieldOfViewAngleRadians: state.vehicleSettings.fieldOfViewAngleRadians,
    obstacles: state.obstacles,
    columns: state.columns,
    rows: state.rows,
    projectionSettings: state.projectionSettings,
    humanInput: state.pendingHumanInput,
    programmaticChaserEnabled: state.programmaticChaserEnabled,
    chaserSpeedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
  });
  return cycle;
}

function updateEvaderReasoningState(state) {
  return stepEvaderIdae(state.evaderIdae, {
    evaderPosition: state.evaderPosition,
    evaderDirection: state.evaderDirection,
    chaserPosition: state.chaserPosition,
    columns: state.columns,
    rows: state.rows,
    frameIndex: state.frameIndex,
    obstacles: state.obstacles,
    fieldOfViewAngleRadians: state.vehicleSettings.fieldOfViewAngleRadians,
    turnRateRadiansPerFrame: state.vehicleSettings.turnRateRadiansPerFrame,
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

function applyEvaderAction(state, evaderAction) {
  const evaderMovementDecision = {
    forward: evaderAction?.forward ?? true,
    steering: Number.isFinite(evaderAction?.steering)
      ? evaderAction.steering
      : 0,
    desiredDirection: evaderAction?.desiredDirection ?? null,
    nextDirection: evaderAction?.nextDirection ?? evaderAction?.direction ?? state.evaderDirection,
    direction: evaderAction?.direction ?? state.evaderDirection,
    debug: evaderAction?.debug ?? null,
  };
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

export function createChaseSimulationState({
  scenario,
  columns,
  rows,
  traceRecorder,
} = {}) {
  const chaserIdae = createChaserIdae({ scenario });
  const evaderIdae = createEvaderIdae({ scenario });
  const resolvedTraceRecorder = traceRecorder ?? createChaseTraceRecorder(scenario?.trace);

  return {
    scenario,
    columns,
    rows,
    frameIndex: 0,
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
    evaderPosition: { ...(scenario?.actors?.evader?.position ?? { x: 0, z: 0 }) },
    evaderDirection: { ...(scenario?.actors?.evader?.direction ?? { x: -1, z: 0 }) },
    chaserIdae,
    evaderIdae,
    evaderWallAvoidanceTruth: createEvaderWallAvoidanceTruthState(),
    traceRecorder: resolvedTraceRecorder,
    runMetrics: createRunMetrics(),
    pendingHumanInput: { forward: false, reverse: false, steering: 0 },
    lastStep: {
      chaserInput: { source: "human", forward: false, reverse: false, steering: 0 },
      chaserAction: { source: "human", forward: false, reverse: false, steering: 0 },
      chaserReasoning: null,
      evaderReasoning: null,
      evaderMovementDecision: null,
    },
  };
}

export function stepChaseSimulation(state, { humanInput } = {}) {
  if (!state?.scenario) {
    return state;
  }

  state.pendingHumanInput = {
    forward: Boolean(humanInput?.forward),
    reverse: Boolean(humanInput?.reverse),
    steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
  };
  const chaserReasoning = updateChaserReasoningState(state);
  const chaserAction = chaserReasoning?.action ?? {
    source: "human",
    forward: false,
    reverse: false,
    steering: 0,
  };
  applyChaserAction(state, chaserAction);
  const evaderReasoning = updateEvaderReasoningState(state);
  const evaderMovementDecision = applyEvaderAction(
    state,
    evaderReasoning?.action ?? null,
  );

  updateRunMetrics(state.runMetrics, state.chaserPosition, state.evaderPosition);
  state.lastStep = {
    chaserInput: chaserAction,
    chaserAction,
    chaserReasoning,
    evaderReasoning,
    evaderMovementDecision,
  };
  state.frameIndex += 1;
  recordChaseTraceFrame(state.traceRecorder, state);
  return state;
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
