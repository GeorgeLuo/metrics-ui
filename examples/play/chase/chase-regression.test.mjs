import test from "node:test";
import assert from "node:assert/strict";
import { CAR_BOUND_RADIUS } from "./constants.mjs";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import { resolveChaseScenario } from "./scenario.mjs";
import {
  createChaseSimulationState,
  stepChaseSimulation,
} from "./simulation.mjs";
import { getWallBounds } from "./world.mjs";

const GRID = Object.freeze({ columns: 9, rows: 6 });
const BASE_SCENARIO = Object.freeze(resolveChaseScenario(defaultScenarioDefinition, GRID));

function roundNumber(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function cloneScenario() {
  return structuredClone(BASE_SCENARIO);
}

function buildScenario(mutator) {
  const scenario = cloneScenario();
  mutator?.(scenario);
  return scenario;
}

function idleInput() {
  return { forward: false, steering: 0 };
}

function forwardInput() {
  return { forward: true, steering: 0 };
}

const REGRESSION_CASES = [
  {
    name: "idle_default_120",
    frameCount: 120,
    buildScenario: () => cloneScenario(),
    inputProvider: idleInput,
    expected: {
      frame: 120,
      chaser: { x: -3.42, z: 0, dx: 1, dz: 0 },
      target: { x: 3.2882, z: 0.6381, dx: -0.9592, dz: -0.2829 },
      touches: 0,
      visible: false,
      prediction: { actionable: true, invalidReason: null, pathLen: 6, firstAhead: 20 },
      inference: { speed: 0.0467, wallScore: 0 },
    },
  },
  {
    name: "straight_manual_120",
    frameCount: 120,
    buildScenario: () => cloneScenario(),
    inputProvider: forwardInput,
    expected: {
      frame: 120,
      chaser: { x: -1.0994, z: 0, dx: 1, dz: 0 },
      target: { x: 3.2882, z: 0.6381, dx: -0.9592, dz: -0.2829 },
      touches: 0,
      visible: false,
      prediction: {
        actionable: false,
        invalidReason: "stale-target-estimate",
        pathLen: 0,
        firstAhead: null,
      },
      inference: { speed: 0.04, wallScore: 0 },
    },
  },
  {
    name: "autopilot_default_180",
    frameCount: 180,
    buildScenario: () => buildScenario((scenario) => {
      scenario.runtime.programmaticChaserEnabled = true;
    }),
    inputProvider: idleInput,
    expected: {
      frame: 180,
      chaser: { x: -4.0425, z: -0.6859, dx: -0.1564, dz: 0.9877 },
      target: { x: 3.2564, z: 2.1452, dx: 0.983, dz: -0.1834 },
      touches: 0,
      visible: false,
      prediction: {
        actionable: false,
        invalidReason: "stale-target-estimate",
        pathLen: 0,
        firstAhead: null,
      },
      inference: { speed: 0.04, wallScore: 0 },
    },
  },
  {
    name: "wall_autopilot_120",
    frameCount: 120,
    buildScenario: () => buildScenario((scenario) => {
      scenario.actors.chaser.position = { x: -2.5, z: -1.6 };
      scenario.actors.chaser.direction = { x: 1, z: 0 };
      scenario.actors.target.position = { x: -0.4, z: -1.6 };
      scenario.actors.target.direction = { x: 1, z: 0 };
      scenario.runtime.programmaticChaserEnabled = true;
    }),
    inputProvider: idleInput,
    expected: {
      frame: 120,
      chaser: { x: 1.6493, z: -1.1055, dx: 0.6191, dz: 0.7853 },
      target: { x: 3.7916, z: 1.3163, dx: 0.1037, dz: 0.9946 },
      touches: 0,
      visible: true,
      prediction: { actionable: true, invalidReason: null, pathLen: 6, firstAhead: 20 },
      inference: { speed: 0.0467, wallScore: 1 },
    },
  },
];

function summarizeState(state) {
  const knowledge = state.lastStep.chaserKnowledge;
  const prediction = knowledge?.predictionPlan;
  return {
    frame: state.frameIndex,
    chaser: {
      x: roundNumber(state.chaserPosition.x),
      z: roundNumber(state.chaserPosition.z),
      dx: roundNumber(state.chaserLookDirection.x),
      dz: roundNumber(state.chaserLookDirection.z),
    },
    target: {
      x: roundNumber(state.targetPosition.x),
      z: roundNumber(state.targetPosition.z),
      dx: roundNumber(state.targetDirection.x),
      dz: roundNumber(state.targetDirection.z),
    },
    touches: state.runMetrics.touchCount,
    visible: Boolean(knowledge?.targetLocation?.visible),
    prediction: {
      actionable: Boolean(prediction?.actionable),
      invalidReason: prediction?.invalidReason ?? null,
      pathLen: prediction?.path?.length ?? 0,
      firstAhead: prediction?.path?.[0]?.framesAhead ?? null,
    },
    inference: {
      speed: roundNumber(knowledge?.targetMotionModel?.speedEstimateUnitsPerFrame ?? 0),
      wallScore: roundNumber(knowledge?.wallAvoidancePattern?.wallAvoidanceScore ?? 0),
    },
  };
}

function buildTraceSignature(state) {
  const knowledge = state.lastStep.chaserKnowledge;
  return {
    frame: state.frameIndex,
    chaserX: roundNumber(state.chaserPosition.x, 3),
    chaserZ: roundNumber(state.chaserPosition.z, 3),
    targetX: roundNumber(state.targetPosition.x, 3),
    targetZ: roundNumber(state.targetPosition.z, 3),
    touches: state.runMetrics.touchCount,
    visible: Boolean(knowledge?.targetLocation?.visible),
    pathLen: knowledge?.predictionPlan?.path?.length ?? 0,
    invalidReason: knowledge?.predictionPlan?.invalidReason ?? null,
  };
}

function isPositionInsideBounds(position, bounds, epsilon = 1e-6) {
  return position.x > bounds.minX + epsilon
    && position.x < bounds.maxX - epsilon
    && position.z > bounds.minZ + epsilon
    && position.z < bounds.maxZ - epsilon;
}

function assertPositionOutsideObstaclePadding(position, obstacles, message) {
  for (const wall of obstacles.walls) {
    const paddedBounds = getWallBounds(wall, CAR_BOUND_RADIUS);
    assert.equal(
      isPositionInsideBounds(position, paddedBounds),
      false,
      `${message}: ${wall.id}`,
    );
  }
}

function assertProjectionSamplesOutsideObstaclePadding(path, obstacles, message) {
  for (const sample of path ?? []) {
    assertPositionOutsideObstaclePadding(sample.position, obstacles, message);
  }
}

function runRegressionCase(regressionCase) {
  const scenario = regressionCase.buildScenario();
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  state.projectionSettings.visible = true;
  const trace = [];

  for (let frame = 0; frame < regressionCase.frameCount; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: regressionCase.inputProvider({
        frameIndex: state.frameIndex,
        state,
      }),
    });
    trace.push(buildTraceSignature(state));
    assertPositionOutsideObstaclePadding(
      state.chaserPosition,
      state.obstacles,
      `${regressionCase.name} chaser penetrated obstacle padding on frame ${state.frameIndex}`,
    );
    assertPositionOutsideObstaclePadding(
      state.targetPosition,
      state.obstacles,
      `${regressionCase.name} target penetrated obstacle padding on frame ${state.frameIndex}`,
    );
    assertProjectionSamplesOutsideObstaclePadding(
      state.lastStep.chaserKnowledge?.predictionPlan?.path,
      state.obstacles,
      `${regressionCase.name} projection penetrated obstacle padding on frame ${state.frameIndex}`,
    );
  }

  return {
    scenario,
    state,
    trace,
    summary: summarizeState(state),
  };
}

for (const regressionCase of REGRESSION_CASES) {
  test(`chase regression snapshot: ${regressionCase.name}`, () => {
    const result = runRegressionCase(regressionCase);
    assert.deepEqual(result.summary, regressionCase.expected);
  });
}

test("chase regression is deterministic across repeated runs", () => {
  const regressionCase = REGRESSION_CASES.find((entry) => entry.name === "wall_autopilot_120");
  assert.ok(regressionCase, "wall_autopilot_120 regression case is missing");
  const first = runRegressionCase(regressionCase);
  const second = runRegressionCase(regressionCase);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.trace, second.trace);
});

test("chase regression predictions stay frame-indexed and ordered", () => {
  const regressionCase = REGRESSION_CASES.find((entry) => entry.name === "wall_autopilot_120");
  assert.ok(regressionCase, "wall_autopilot_120 regression case is missing");
  const { state } = runRegressionCase(regressionCase);
  const path = state.lastStep.chaserKnowledge?.predictionPlan?.path ?? [];
  assert.ok(path.length > 0, "expected a non-empty prediction path");
  let previousFramesAhead = 0;
  for (const sample of path) {
    assert.ok(Number.isInteger(sample.framesAhead), "framesAhead must be an integer");
    assert.ok(sample.framesAhead > previousFramesAhead, "framesAhead must be strictly increasing");
    previousFramesAhead = sample.framesAhead;
  }
});
