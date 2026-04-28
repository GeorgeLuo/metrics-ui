import { CAR_BOUND_RADIUS } from "./constants.mjs";
import {
  createChaserKnowledgeBase,
  getChaserKnowledgeSnapshot,
  setChaserKnowledgeEngineEnabled,
  updateChaserKnowledgeBase,
} from "./chaser-knowledge.mjs";
import {
  createChaserAutopilotState,
  getProgrammaticChaserInput,
  setChaserActionEngineEnabled,
} from "./chaser-controller.mjs";
import {
  angleToVector,
  vectorToAngle,
} from "./math.mjs";
import {
  constrainDirectionToBounds,
  getTargetMovementDecision,
  steerDirectionToward,
} from "./target.mjs";
import {
  createTargetWallAvoidanceTruthState,
  updateTargetWallAvoidanceTruth,
} from "./wall-avoidance-detection.mjs";
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

function applyScenarioEngineToggles(scenario, chaserKnowledgeBase, chaserAutopilotState) {
  Object.entries(scenario?.engines?.knowledge ?? {}).forEach(([engineId, enabled]) => {
    setChaserKnowledgeEngineEnabled(chaserKnowledgeBase, engineId, enabled);
  });
  Object.entries(scenario?.engines?.action ?? {}).forEach(([engineId, enabled]) => {
    setChaserActionEngineEnabled(chaserAutopilotState, engineId, enabled);
  });
}

export function createChaseSimulationState({
  scenario,
  columns,
  rows,
} = {}) {
  const chaserKnowledgeBase = createChaserKnowledgeBase();
  const chaserAutopilotState = createChaserAutopilotState();
  applyScenarioEngineToggles(scenario, chaserKnowledgeBase, chaserAutopilotState);

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
    chaserKnowledgeBase,
    chaserAutopilotState,
    targetWallAvoidanceTruth: createTargetWallAvoidanceTruthState(),
    runMetrics: createRunMetrics(),
    lastStep: {
      chaserKnowledge: getChaserKnowledgeSnapshot(chaserKnowledgeBase),
      chaserInput: { forward: false, steering: 0 },
      targetMovementDecision: null,
    },
  };
}

export function stepChaseSimulation(state, { humanInput } = {}) {
  if (!state?.scenario) {
    return state;
  }

  updateChaserKnowledgeBase(state.chaserKnowledgeBase, {
    chaserPosition: state.chaserPosition,
    targetPosition: state.targetPosition,
    chaserLookDirection: state.chaserLookDirection,
    fieldOfViewAngleRadians: state.vehicleSettings.fieldOfViewAngleRadians,
    obstacles: state.obstacles,
    columns: state.columns,
    rows: state.rows,
    projectionSettings: state.projectionSettings,
  });
  const chaserKnowledge = getChaserKnowledgeSnapshot(state.chaserKnowledgeBase);

  const chaserInput = state.programmaticChaserEnabled
    ? getProgrammaticChaserInput({
      knowledgeBase: chaserKnowledge,
      chaserPosition: state.chaserPosition,
      chaserLookDirection: state.chaserLookDirection,
      autopilotState: state.chaserAutopilotState,
      chaserSpeedUnitsPerFrame: state.vehicleSettings.chaserSpeedUnitsPerFrame,
      columns: state.columns,
      rows: state.rows,
      obstacles: state.obstacles,
    })
    : {
      forward: Boolean(humanInput?.forward),
      steering: Number.isFinite(humanInput?.steering) ? humanInput.steering : 0,
    };

  const isChaserMoving = chaserInput.forward;
  const steeringInput = chaserInput.steering;
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

  const targetMovementDecision = getTargetMovementDecision(
    state.targetPosition,
    state.targetDirection,
    state.columns,
    state.rows,
    state.frameIndex,
    state.obstacles,
    state.scenario.policies?.target,
  );
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

  updateRunMetrics(state.runMetrics, state.chaserPosition, state.targetPosition);
  state.lastStep = {
    chaserKnowledge,
    chaserInput,
    targetMovementDecision,
  };
  state.frameIndex += 1;
  return state;
}

export function runChaseScenarioFrames({
  scenario,
  columns,
  rows,
  frameCount = 0,
  inputProvider,
  state,
} = {}) {
  const simulationState = state ?? createChaseSimulationState({
    scenario,
    columns,
    rows,
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
