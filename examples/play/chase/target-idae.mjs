import { createIdaeEngine, stepIdaeEngine } from "./idae.mjs";
import { getTargetMovementDecision } from "./target.mjs";

function createTargetIdaeState({ scenario } = {}) {
  return {
    policy: { ...(scenario?.policies?.target ?? {}) },
    memory: {
      lastObservation: null,
    },
    strategies: {
      baselineMovement: null,
    },
  };
}

function observeTargetEnvironment(_state, frameContext = {}) {
  return {
    position: frameContext.targetPosition,
    direction: frameContext.targetDirection,
    columns: frameContext.columns,
    rows: frameContext.rows,
    frameIndex: frameContext.frameIndex,
    obstacles: frameContext.obstacles,
  };
}

function updateTargetMemory(state, _frameContext, cycle) {
  state.memory.lastObservation = cycle.observation
    ? {
      position: cycle.observation.position
        ? {
          x: Number(cycle.observation.position.x) || 0,
          z: Number(cycle.observation.position.z) || 0,
        }
        : null,
      direction: cycle.observation.direction
        ? {
          x: Number(cycle.observation.direction.x) || 0,
          z: Number(cycle.observation.direction.z) || 0,
        }
        : null,
      frameIndex: Number(cycle.observation.frameIndex) || 0,
    }
    : null;
  return state.memory;
}

function updateTargetStrategies(state, _frameContext, cycle) {
  const observation = cycle.observation;
  const decision = getTargetMovementDecision(
    observation?.position,
    observation?.direction,
    observation?.columns,
    observation?.rows,
    observation?.frameIndex,
    observation?.obstacles,
    state.policy,
  );

  state.strategies.baselineMovement = {
    id: decision?.debug?.policyId ?? "baseline-drift-wall-avoid",
    actionable: true,
    confidence: 1,
    output: decision,
  };
  return state.strategies;
}

function chooseTargetAction(state) {
  const strategy = state.strategies.baselineMovement;
  return {
    source: "idae",
    strategyId: strategy?.id ?? "baseline-drift-wall-avoid",
    direction: strategy?.output?.direction ?? { x: 0, z: 0 },
    debug: strategy?.output?.debug ?? null,
  };
}

function getTargetIdaeSnapshot(state) {
  return {
    memory: {
      lastObservation: state.memory.lastObservation,
    },
    strategyStatus: {
      baselineMovement: state.strategies.baselineMovement
        ? {
          id: state.strategies.baselineMovement.id,
          actionable: Boolean(state.strategies.baselineMovement.actionable),
          confidence: Number(state.strategies.baselineMovement.confidence) || 0,
        }
        : null,
    },
  };
}

export function createTargetIdae({ scenario } = {}) {
  return createIdaeEngine({
    id: "target-idae",
    createState: () => createTargetIdaeState({ scenario }),
    observe: observeTargetEnvironment,
    updateMemory: updateTargetMemory,
    updatePatterns: () => null,
    updateStrategies: updateTargetStrategies,
    chooseAction: chooseTargetAction,
    getSnapshot: getTargetIdaeSnapshot,
  });
}

export function stepTargetIdae(targetIdae, frameContext = {}) {
  return stepIdaeEngine(targetIdae, frameContext);
}
