import { CAR_BOUND_RADIUS } from "./constants.mjs";
import { createChaserIdae, stepChaserIdae } from "./chaser-idae.mjs";
import { createTargetIdae, stepTargetIdae } from "./target-idae.mjs";
import {
  angleToVector,
  vectorToAngle,
} from "./math.mjs";
import {
  constrainDirectionToBounds,
  steerDirectionToward,
} from "./target.mjs";
import {
  createTargetWallAvoidanceTruthState,
  updateTargetWallAvoidanceTruth,
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
    targetTouchActive: false,
  };
}

function updateRunMetrics(runMetrics, chaserPosition, targetPosition) {
  if (!runMetrics) {
    return;
  }

  runMetrics.elapsedFrames += 1;
  const touchesTarget = Math.hypot(
    chaserPosition.x - targetPosition.x,
    chaserPosition.z - targetPosition.z,
  ) <= CAR_BOUND_RADIUS * 2;

  if (touchesTarget && !runMetrics.targetTouchActive) {
    runMetrics.touchCount += 1;
  }
  runMetrics.targetTouchActive = touchesTarget;
  runMetrics.touchRatePerThousandFrames = runMetrics.elapsedFrames > 0
    ? (runMetrics.touchCount / runMetrics.elapsedFrames) * 1000
    : 0;
}

function updateChaserReasoningState(state) {
  const cycle = stepChaserIdae(state.chaserIdae, {
    chaserPosition: state.chaserPosition,
    targetPosition: state.targetPosition,
    chaserLookDirection: state.chaserLookDirection,
    fieldOfViewAngleRadians: state.vehicleSettings.fieldOfViewAngleRadians,
    obstacles: state.obstacles,
    columns: state.columns,
    rows: state.rows,
    projectionSettings: state.projectionSettings,
    humanInput: state.pendingHumanInput,
    programmaticChaserEnabled: state.programmaticChaserEnabled,
    chaserSpeedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
  });
  state.chaserKnowledgeBase = state.chaserIdae.state.knowledgeBase;
  state.chaserAutopilotState = state.chaserIdae.state.autopilotState;
  return cycle;
}

function applyChaserAction(state, chaserAction) {
  const isChaserMoving = chaserAction.forward;
  const steeringInput = chaserAction.steering;
  if (isChaserMoving && steeringInput !== 0) {
    const nextHeading = angleToVector(
      vectorToAngle(state.chaserLookDirection)
        + steeringInput * state.vehicleSettings.turnRateRadiansPerFrame,
    );
    state.chaserLookDirection.x = nextHeading.x;
    state.chaserLookDirection.z = nextHeading.z;
  }

  const nextChaser = resolveObstacleCollisions({
    x: state.chaserPosition.x
      + state.chaserLookDirection.x
        * state.vehicleSettings.chaserSpeedUnitsPerFrame
        * (isChaserMoving ? 1 : 0),
    z: state.chaserPosition.z
      + state.chaserLookDirection.z
        * state.vehicleSettings.chaserSpeedUnitsPerFrame
        * (isChaserMoving ? 1 : 0),
  }, state.chaserPosition, state.columns, state.rows, state.obstacles);
  state.chaserPosition.x = nextChaser.x;
  state.chaserPosition.z = nextChaser.z;
}

function advanceTargetState(state) {
  const targetReasoning = stepTargetIdae(state.targetIdae, {
    targetPosition: state.targetPosition,
    targetDirection: state.targetDirection,
    columns: state.columns,
    rows: state.rows,
    frameIndex: state.frameIndex,
    obstacles: state.obstacles,
  });
  const targetMovementDecision = {
    direction: targetReasoning?.action?.direction ?? state.targetDirection,
    debug: targetReasoning?.action?.debug ?? null,
  };
  const nextTargetDirection = constrainDirectionToBounds(
    state.targetPosition,
    steerDirectionToward(
      state.targetDirection,
      targetMovementDecision.direction,
      state.vehicleSettings.turnRateRadiansPerFrame,
    ),
    state.columns,
    state.rows,
  );
  updateTargetWallAvoidanceTruth(state.targetWallAvoidanceTruth, {
    decisionDebug: targetMovementDecision.debug,
  });
  state.targetDirection.x = nextTargetDirection.x;
  state.targetDirection.z = nextTargetDirection.z;

  const nextTarget = resolveObstacleCollisions({
    x: state.targetPosition.x
      + state.targetDirection.x * state.vehicleSettings.targetSpeedUnitsPerFrame,
    z: state.targetPosition.z
      + state.targetDirection.z * state.vehicleSettings.targetSpeedUnitsPerFrame,
  }, state.targetPosition, state.columns, state.rows, state.obstacles);
  state.targetPosition.x = nextTarget.x;
  state.targetPosition.z = nextTarget.z;

  return {
    targetMovementDecision,
    targetReasoning,
  };
}

export function createChaseSimulationState({
  scenario,
  columns,
  rows,
  traceRecorder,
} = {}) {
  const chaserIdae = createChaserIdae({ scenario });
  const targetIdae = createTargetIdae({ scenario });
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
    targetPosition: { ...(scenario?.actors?.target?.position ?? { x: 0, z: 0 }) },
    targetDirection: { ...(scenario?.actors?.target?.direction ?? { x: -1, z: 0 }) },
    chaserIdae,
    targetIdae,
    chaserKnowledgeBase: chaserIdae.state.knowledgeBase,
    chaserAutopilotState: chaserIdae.state.autopilotState,
    targetWallAvoidanceTruth: createTargetWallAvoidanceTruthState(),
    traceRecorder: resolvedTraceRecorder,
    runMetrics: createRunMetrics(),
    pendingHumanInput: { forward: false, steering: 0 },
    lastStep: {
      chaserKnowledge: null,
      chaserInput: { source: "human", forward: false, steering: 0 },
      chaserAction: { source: "human", forward: false, steering: 0 },
      targetReasoning: null,
      targetMovementDecision: null,
    },
  };
}

export function stepChaseSimulation(state, { humanInput } = {}) {
  if (!state?.scenario) {
    return state;
  }

  state.pendingHumanInput = {
    forward: Boolean(humanInput?.forward),
    steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
  };
  const chaserReasoning = updateChaserReasoningState(state);
  const chaserKnowledge = chaserReasoning?.snapshot?.knowledge ?? null;
  const chaserAction = chaserReasoning?.action ?? {
    source: "human",
    forward: false,
    steering: 0,
  };
  applyChaserAction(state, chaserAction);
  const {
    targetMovementDecision,
    targetReasoning,
  } = advanceTargetState(state);

  updateRunMetrics(state.runMetrics, state.chaserPosition, state.targetPosition);
  state.lastStep = {
    chaserKnowledge,
    chaserInput: chaserAction,
    chaserAction,
    chaserReasoning,
    targetReasoning,
    targetMovementDecision,
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
