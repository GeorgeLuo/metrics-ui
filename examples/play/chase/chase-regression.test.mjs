import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  CAR_BOUND_RADIUS,
  CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  CHASER_ACTION_PATH_RATE_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_MAP_OVERLAY_ACTION_ID,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  EVADER_PROJECTION_VIEW_ACTION_ID,
  EVADER_PROJECTION_VIEW_MODES,
  SIMULATION_FPS_ACTION_ID,
  SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  SIMULATION_RESET_ACTION_ID,
} from "./config/constants.mjs";
import {
  CHASER_ACTION_PROPOSAL_IDS,
  EVADER_ACTION_PROPOSAL_IDS,
} from "./config/decision-ids.mjs";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "./scenarios/index.mjs";
import { compareChaseActionProposalCombinations } from "./simulation/chase-action-proposal-comparison.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import {
  createChaseSimulationState,
  getChaseSimulationTrace,
  stepChaseSimulation,
} from "./simulation/simulation.mjs";
import { createChasePerformanceTracker } from "./debug/performance-debug.mjs";
import { getPredictionPerformanceSnapshot } from "./debug/prediction-performance.mjs";
import { createNodeJsonlTraceRecorder } from "./simulation/trace-recorder-node.mjs";
import { getFieldBounds, getWallBounds } from "./world/world.mjs";
import {
  createActorActionProposalToggleActionId,
  publishSidebarSections,
} from "./ui/sidebar.mjs";
import { getChaserActionPathDebugEntries } from "./ui/rendering.mjs";
import {
  createMapShapeMemory,
  RECENT_VISITATION_MAX_AGE_FRAMES,
  updateMapShapeMemory,
} from "./decision-model/memory/chaser/map/memory.ts";

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

function buildManualChaserScenario(mutator) {
  return buildScenario((scenario) => {
    scenario.runtime.programmaticChaserEnabled = false;
    mutator?.(scenario);
  });
}

function idleInput() {
  return { forward: false, steering: 0 };
}

function forwardInput() {
  return { forward: true, steering: 0 };
}

function reverseInput() {
  return { forward: false, reverse: true, steering: 0 };
}

function reverseLeftInput() {
  return { forward: false, reverse: true, steering: 1 };
}

const REGRESSION_CASES = [
  {
    name: "idle_default_120",
    frameCount: 120,
    buildScenario: () => buildManualChaserScenario(),
    inputProvider: idleInput,
    expected: {
      frame: 120,
      chaser: { x: -3.42, z: 0, dx: 1, dz: 0 },
      evader: { x: 3.2882, z: 0.6381, dx: -0.9592, dz: -0.2829 },
      touches: 0,
      visible: false,
      prediction: {
        actionable: true,
        invalidReason: null,
        strategy: "continuance-default",
        pathLen: 6,
        firstAhead: 20,
        sourcePatternIds: ["continuance"],
      },
      inference: { speed: 0.0467, wallScore: 0 },
    },
  },
  {
    name: "straight_manual_120",
    frameCount: 120,
    buildScenario: () => buildManualChaserScenario(),
    inputProvider: forwardInput,
    expected: {
      frame: 120,
      chaser: { x: -1.0994, z: 0, dx: 1, dz: 0 },
      evader: { x: 3.2882, z: 0.6381, dx: -0.9592, dz: -0.2829 },
      touches: 0,
      visible: false,
      prediction: {
        actionable: false,
        invalidReason: "stale-evader-estimate",
        strategy: "pattern-predictions-unavailable",
        pathLen: 0,
        firstAhead: null,
        sourcePatternIds: [],
      },
      inference: { speed: 0.04, wallScore: 0 },
    },
  },
  {
    name: "autopilot_default_180",
    frameCount: 180,
    buildScenario: () => cloneScenario(),
    inputProvider: idleInput,
    expected: {
      frame: 180,
      chaser: { x: -1.5006, z: -1.0884, dx: -0.9141, dz: 0.4055 },
      evader: { x: 3.2705, z: 2.1467, dx: 0.9812, dz: -0.1929 },
      touches: 0,
      visible: false,
      prediction: {
        actionable: true,
        invalidReason: null,
        strategy: "continuance-default",
        pathLen: 6,
        firstAhead: 20,
        sourcePatternIds: ["continuance"],
      },
      inference: { speed: 0.0467, wallScore: 0 },
    },
  },
  {
    name: "action_path_projection_158",
    frameCount: 158,
    buildScenario: () => buildScenario((scenario) => {
      scenario.actors.chaser.position = { x: -3.7, z: -1.6 };
      scenario.actors.chaser.direction = { x: 1, z: 0 };
      scenario.actors.evader.position = { x: -1.5, z: -1.6 };
      scenario.actors.evader.direction = { x: 1, z: 0 };
      scenario.runtime.programmaticChaserEnabled = true;
    }),
    inputProvider: idleInput,
    expected: {
      frame: 158,
      chaser: { x: 1.6533, z: -0.5635, dx: 0.6006, dz: 0.7995 },
      evader: { x: 3.5442, z: 1.5626, dx: -0.6742, dz: 0.7385 },
      touches: 0,
      visible: true,
      prediction: {
        actionable: true,
        invalidReason: null,
        strategy: "rectified-evader-projection",
        pathLen: 6,
        firstAhead: 20,
        sourcePatternIds: ["continuance", "wallAvoidance"],
      },
      inference: { speed: 0.0467, wallScore: 1 },
    },
  },
];

function summarizeState(state) {
  const snapshot = state.lastStep.chaserReasoning?.snapshot;
  const evaderMotionProjection = snapshot?.projections?.evaderMotion;
  return {
    frame: state.frameIndex,
    chaser: {
      x: roundNumber(state.chaserPosition.x),
      z: roundNumber(state.chaserPosition.z),
      dx: roundNumber(state.chaserLookDirection.x),
      dz: roundNumber(state.chaserLookDirection.z),
    },
    evader: {
      x: roundNumber(state.evaderPosition.x),
      z: roundNumber(state.evaderPosition.z),
      dx: roundNumber(state.evaderDirection.x),
      dz: roundNumber(state.evaderDirection.z),
    },
    touches: state.runMetrics.touchCount,
    visible: Boolean(snapshot?.memory?.directObservation?.evaderLocation?.visible),
    prediction: {
      actionable: Boolean(evaderMotionProjection?.actionable),
      invalidReason: evaderMotionProjection?.invalidReason ?? null,
      strategy: evaderMotionProjection?.prediction?.strategy ?? null,
      pathLen: evaderMotionProjection?.path?.length ?? 0,
      firstAhead: evaderMotionProjection?.path?.[0]?.framesAhead ?? null,
      sourcePatternIds: evaderMotionProjection?.prediction?.sourcePatternIds ?? [],
    },
    inference: {
      speed: roundNumber(snapshot?.patterns?.evaderMotionModel?.speedEstimateUnitsPerFrame ?? 0),
      wallScore: roundNumber(snapshot?.patterns?.wallAvoidance?.wallAvoidanceScore ?? 0),
    },
  };
}

function buildTraceSignature(state) {
  const snapshot = state.lastStep.chaserReasoning?.snapshot;
  return {
    frame: state.frameIndex,
    chaserX: roundNumber(state.chaserPosition.x, 3),
    chaserZ: roundNumber(state.chaserPosition.z, 3),
    evaderX: roundNumber(state.evaderPosition.x, 3),
    evaderZ: roundNumber(state.evaderPosition.z, 3),
    touches: state.runMetrics.touchCount,
    visible: Boolean(snapshot?.memory?.directObservation?.evaderLocation?.visible),
    pathLen: snapshot?.projections?.evaderMotion?.path?.length ?? 0,
    invalidReason: snapshot?.projections?.evaderMotion?.invalidReason ?? null,
  };
}

function getChaserSuccessMetrics(state) {
  return state.chaserIdae?.state?.memory?.abstracted?.successMetrics ?? null;
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
      state.evaderPosition,
      state.obstacles,
      `${regressionCase.name} evader penetrated obstacle padding on frame ${state.frameIndex}`,
    );
    assertProjectionSamplesOutsideObstaclePadding(
      state.lastStep.chaserReasoning?.snapshot?.projections?.evaderMotion?.path,
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

function getChaserMapShapeMemory(state) {
  return state.lastStep.chaserReasoning?.snapshot?.memory?.abstracted?.mapShape ?? null;
}

test("chaser map memory records only obstacles visible through field of view", () => {
  const buildPassiveMapScenario = (chaserDirection) => buildScenario((scenario) => {
    scenario.actors.evader.exists = false;
    scenario.actors.evader.position = null;
    scenario.actors.evader.direction = null;
    scenario.actors.chaser.position = { x: -3.42, z: 0 };
    scenario.actors.chaser.direction = chaserDirection;
    scenario.runtime.programmaticChaserEnabled = false;
  });

  const unseenState = createChaseSimulationState({
    scenario: buildPassiveMapScenario({ x: -1, z: 0 }),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  stepChaseSimulation(unseenState, { humanInput: idleInput() });
  assert.deepEqual(getChaserMapShapeMemory(unseenState)?.observedWallIds, []);
  assert.equal(unseenState.lastStep.chaserReasoning?.observation?.map?.visibleWalls?.length, 0);
  const unseenKnownAreaCount = getChaserMapShapeMemory(unseenState)?.knownAreas?.length ?? 0;
  assert.ok(
    unseenKnownAreaCount > 0,
    "expected empty visible space to be recorded as known area",
  );
  stepChaseSimulation(unseenState, { humanInput: idleInput() });
  assert.equal(
    getChaserMapShapeMemory(unseenState)?.knownAreas?.length,
    unseenKnownAreaCount,
    "re-observing the same cells should not make map knowledge visually denser",
  );
  assert.ok(
    (getChaserMapShapeMemory(unseenState)?.recentlyObservedAreas?.length ?? 0) > 0,
    "expected recent visitation memory to be tracked separately from known map cells",
  );

  const seenState = createChaseSimulationState({
    scenario: buildPassiveMapScenario({ x: 1, z: 0 }),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  stepChaseSimulation(seenState, { humanInput: idleInput() });
  assert.deepEqual(getChaserMapShapeMemory(seenState)?.observedWallIds, ["center-square"]);
  assert.deepEqual(
    getChaserMapShapeMemory(seenState)?.obstacles?.walls?.map((wall) => wall.id),
    ["center-square"],
  );
  assert.ok(
    (getChaserMapShapeMemory(seenState)?.knownAreas?.[0]?.vertices?.length ?? 0) >= 3,
    "expected known area overlay geometry to come from map memory",
  );
});

test("chaser map recency ages out without deleting persistent map knowledge", () => {
  const memory = createMapShapeMemory();
  const visibleCell = {
    id: "0:0",
    cellX: 0,
    cellZ: 0,
    vertices: [
      { x: 0, z: 0 },
      { x: 0.3, z: 0 },
      { x: 0.3, z: 0.3 },
      { x: 0, z: 0.3 },
    ],
  };

  updateMapShapeMemory(memory, {
    visibleWalls: [],
    visibleArea: {
      cells: [visibleCell],
    },
  }, 1);
  assert.deepEqual(memory.knownAreaIds, ["0:0"]);
  assert.deepEqual(memory.recentlyObservedAreaIds, ["0:0"]);

  updateMapShapeMemory(memory, {
    visibleWalls: [],
    visibleArea: {
      cells: [],
    },
  }, RECENT_VISITATION_MAX_AGE_FRAMES + 2);

  assert.deepEqual(memory.knownAreaIds, ["0:0"]);
  assert.deepEqual(memory.recentlyObservedAreaIds, []);
});

test("chaser projections do not use obstacle meta knowledge before the map is observed", () => {
  const scenario = buildScenario((entry) => {
    entry.actors.chaser.position = { x: -4, z: 2.4 };
    entry.actors.chaser.direction = { x: 1, z: 0 };
    entry.actors.evader.position = { x: -3, z: 2.4 };
    entry.actors.evader.direction = { x: 0.7809, z: -0.6247 };
    entry.vehicleSettings.fieldOfViewAngleRadians = Math.PI / 9;
    entry.projectionSettings.horizonFrames = 120;
    entry.projectionSettings.sampleSpacingFrames = 10;
    entry.runtime.programmaticChaserEnabled = false;
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  stepChaseSimulation(state, { humanInput: idleInput() });

  const mapShapeMemory = getChaserMapShapeMemory(state);
  const predictionPath = state.lastStep.chaserReasoning
    ?.snapshot
    ?.projections
    ?.evaderMotion
    ?.path ?? [];
  const centerWallBounds = getWallBounds(state.obstacles.walls[0]);

  assert.deepEqual(mapShapeMemory?.observedWallIds, []);
  assert.ok((mapShapeMemory?.knownAreas?.length ?? 0) > 0);
  assert.ok(predictionPath.length > 0, "expected visible-evader prediction path");
  assert.ok(
    predictionPath.some((sample) => isPositionInsideBounds(sample.position, centerWallBounds)),
    "expected prediction to ignore the unseen center obstacle",
  );
});

for (const regressionCase of REGRESSION_CASES) {
  test(`chase regression snapshot: ${regressionCase.name}`, () => {
    const result = runRegressionCase(regressionCase);
    assert.deepEqual(result.summary, regressionCase.expected);
  });
}

test("chase regression is deterministic across repeated runs", () => {
  const regressionCase = REGRESSION_CASES.find(
    (entry) => entry.name === "action_path_projection_158",
  );
  assert.ok(regressionCase, "action_path_projection_158 regression case is missing");
  const first = runRegressionCase(regressionCase);
  const second = runRegressionCase(regressionCase);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.trace, second.trace);
});

test("chaser and evader IDAE snapshots follow the shared actor framework shape", () => {
  const state = createChaseSimulationState({
    scenario: cloneScenario(),
    columns: GRID.columns,
    rows: GRID.rows,
  });

  stepChaseSimulation(state, { humanInput: idleInput() });

  const chaserSnapshot = state.lastStep.chaserReasoning?.snapshot;
  const evaderSnapshot = state.lastStep.evaderReasoning?.snapshot;
  const expectedKeys = [
    "selfState",
    "memory",
    "patterns",
    "projections",
    "controllerState",
    "engines",
  ];

  for (const snapshot of [chaserSnapshot, evaderSnapshot]) {
    for (const key of expectedKeys) {
      assert.ok(snapshot && key in snapshot, `expected actor snapshot to include ${key}`);
    }
    assert.ok(snapshot?.memory && "directObservation" in snapshot.memory);
    assert.ok(snapshot?.memory && "abstracted" in snapshot.memory);
  }
});

test("pause-before-actions freezes a synced actor reasoning frame", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = false;
    draft.actors.chaser.position = { x: 1.7, z: 0 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: 2.25, z: 0 };
    draft.actors.evader.direction = { x: -1, z: 0 };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  const startChaserPosition = { ...state.chaserPosition };
  const startEvaderPosition = { ...state.evaderPosition };

  stepChaseSimulation(state, {
    humanInput: forwardInput(),
    pauseBeforeActions: true,
  });

  assert.equal(state.frameIndex, 0);
  assert.equal(state.runMetrics.elapsedFrames, 0);
  assert.equal(state.lastStep.phase, "before-actions");
  assert.equal(state.lastStep.actionApplicationPending, true);
  assert.ok(state.pendingActionFrame, "expected pause to retain a pending action frame");
  assert.deepEqual(state.chaserPosition, startChaserPosition);
  assert.deepEqual(state.evaderPosition, startEvaderPosition);
  assert.equal(state.lastStep.chaserAction?.forward, true);
  assert.deepEqual(state.lastStep.frozenFrame?.chaserPosition, startChaserPosition);
  assert.deepEqual(
    state.lastStep.chaserReasoning?.snapshot?.selfState?.position,
    startChaserPosition,
  );
  assert.deepEqual(
    state.lastStep.evaderReasoning?.snapshot?.selfState?.position,
    startEvaderPosition,
  );
  assert.deepEqual(
    {
      x: roundNumber(
        state.lastStep.evaderReasoning?.snapshot?.memory?.directObservation?.chaserLocation?.position?.x,
      ),
      z: roundNumber(
        state.lastStep.evaderReasoning?.snapshot?.memory?.directObservation?.chaserLocation?.position?.z,
      ),
    },
    startChaserPosition,
  );

  stepChaseSimulation(state, {
    humanInput: reverseInput(),
    pauseBeforeActions: true,
  });
  assert.equal(state.frameIndex, 0);
  assert.equal(state.lastStep.chaserAction?.forward, true);
  assert.equal(state.lastStep.chaserAction?.reverse, false);

  stepChaseSimulation(state, { pauseBeforeActions: false });
  assert.equal(state.frameIndex, 1);
  assert.equal(state.runMetrics.elapsedFrames, 1);
  assert.equal(state.lastStep.phase, "after-actions");
  assert.equal(state.lastStep.actionApplicationPending, false);
  assert.equal(state.pendingActionFrame, null);
  assert.ok(state.chaserPosition.x > startChaserPosition.x);
});

test("manual reverse moves the chaser backward and reverse steering turns the heading opposite forward drive", () => {
  const reverseState = createChaseSimulationState({
    scenario: buildManualChaserScenario(),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  stepChaseSimulation(reverseState, { humanInput: reverseInput() });
  assert.ok(
    reverseState.chaserPosition.x < cloneScenario().actors.chaser.position.x,
    "expected reverse input to move the chaser backward",
  );
  assert.equal(reverseState.chaserLookDirection.z, 0);

  const reverseSteerState = createChaseSimulationState({
    scenario: buildManualChaserScenario(),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  stepChaseSimulation(reverseSteerState, { humanInput: reverseLeftInput() });
  assert.ok(
    Math.abs(reverseSteerState.chaserLookDirection.z) > 0,
    "expected reverse-left input to change the chaser heading while backing up",
  );
  assert.ok(
    reverseSteerState.chaserPosition.z < 0,
    "expected reverse-left input to back the chaser toward negative z",
  );
});

test("chaser records success metrics in actor memory after committed frames", () => {
  const state = createChaseSimulationState({
    scenario: buildManualChaserScenario((scenario) => {
      scenario.actors.chaser.position = { x: -3, z: 0 };
      scenario.actors.chaser.direction = { x: 1, z: 0 };
      scenario.actors.evader.position = { x: -2.9, z: 0 };
      scenario.actors.evader.direction = { x: 0, z: 1 };
      scenario.vehicleSettings.evaderSpeedUnitsPerFrame = 0;
    }),
    columns: GRID.columns,
    rows: GRID.rows,
  });

  const initialMetrics = getChaserSuccessMetrics(state);
  assert.equal(initialMetrics.elapsedFrames, 0);
  assert.equal(initialMetrics.touchCount, 0);

  stepChaseSimulation(state, { humanInput: idleInput() });

  const metricsAfterFirstFrame = getChaserSuccessMetrics(state);
  assert.equal(metricsAfterFirstFrame.elapsedFrames, 1);
  assert.equal(metricsAfterFirstFrame.targetPresentFrames, 1);
  assert.equal(metricsAfterFirstFrame.touchCount, 1);
  assert.equal(metricsAfterFirstFrame.evaderTouchActive, true);
  assert.equal(metricsAfterFirstFrame.framesSinceLastTouch, 0);
  assert.equal(metricsAfterFirstFrame.lastTouchFrameIndex, 1);
  assert.equal(metricsAfterFirstFrame.touchRatePerThousandFrames, 1000);
  assert.equal(metricsAfterFirstFrame.rollingTouchCount, 1);
  assert.equal(metricsAfterFirstFrame.rollingTouchRatePerThousandFrames, 1000);

  stepChaseSimulation(state, { humanInput: idleInput() });

  const metricsAfterSecondFrame = getChaserSuccessMetrics(state);
  assert.equal(metricsAfterSecondFrame.elapsedFrames, 2);
  assert.equal(metricsAfterSecondFrame.touchCount, 1);
  assert.equal(metricsAfterSecondFrame.evaderTouchActive, true);
  assert.equal(metricsAfterSecondFrame.touchRatePerThousandFrames, 500);
  assert.equal(metricsAfterSecondFrame.rollingTouchCount, 1);
  assert.equal(state.runMetrics.touchCount, metricsAfterSecondFrame.touchCount);
});

test("chaser success metrics record elapsed frames without an evader target", () => {
  const state = createChaseSimulationState({
    scenario: buildScenario((scenario) => {
      scenario.actors.evader.exists = false;
    }),
    columns: GRID.columns,
    rows: GRID.rows,
  });

  stepChaseSimulation(state, { humanInput: idleInput() });

  const metrics = getChaserSuccessMetrics(state);
  assert.equal(metrics.elapsedFrames, 1);
  assert.equal(metrics.targetPresentFrames, 0);
  assert.equal(metrics.touchCount, 0);
  assert.equal(metrics.evaderTouchActive, false);
  assert.equal(metrics.framesSinceLastTouch, null);
  assert.equal(metrics.touchRatePerThousandFrames, 0);
  assert.equal(state.runMetrics.touchCount, 0);
});

test("chase sidebar combines score and settings into the game section", () => {
  const state = createChaseSimulationState({
    scenario: cloneScenario(),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  let sections = [];
  publishSidebarSections(
    (nextSections) => {
      sections = nextSections;
    },
    state.programmaticChaserEnabled,
    {
      chaserViewVisible: false,
      evaderViewVisible: false,
      idaeDebugVisible: false,
    },
    state.simulationSettings,
    state.vehicleSettings,
    state.projectionSettings,
    {},
    state.runMetrics,
    {},
    {
      visible: true,
      actorId: "chaser",
    },
  );

  const gameSection = sections.find((section) => section.id === "game");
  const gameRows = gameSection?.rows ?? [];
  const scoreHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Score",
  );
  const simulationHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Simulation",
  );
  const touchCountIndex = gameRows.findIndex(
    (row) => row.kind === "value" && row.label === "Touches",
  );
  const frameCountIndex = gameRows.findIndex(
    (row) => row.kind === "value" && row.label === "Frames",
  );
  const touchRateIndex = gameRows.findIndex(
    (row) => row.kind === "value" && row.label === "Touches / 1k frames",
  );
  const fpsIndex = gameRows.findIndex((row) => row.id === SIMULATION_FPS_ACTION_ID);
  const playbackIndex = gameRows.findIndex(
    (row) => row.id === SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  );
  const resetIndex = gameRows.findIndex((row) => row.id === SIMULATION_RESET_ACTION_ID);
  const greentextIndex = gameRows.findIndex(
    (row) => row.id === SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  );
  const gameControlsHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Controls",
  );
  const gameChaserAutopilotIndex = gameRows.findIndex(
    (row) => row.id === CHASER_AUTOPILOT_ACTION_ID,
  );
  const actionProposalRows = sections.find((section) => section.id === "actionProposals")?.rows ?? [];
  const vehicleRows = sections.find((section) => section.id === "vehicle")?.rows ?? [];
  const viewRows = sections.find((section) => section.id === "view")?.rows ?? [];
  const chaserAutopilotIndex = actionProposalRows.findIndex(
    (row) => row.id === CHASER_AUTOPILOT_ACTION_ID,
  );
  const vehicleControlsHeaderIndex = vehicleRows.findIndex(
    (row) => row.kind === "header" && row.label === "Controls",
  );
  const forwardControlIndex = vehicleRows.findIndex(
    (row) => row.kind === "value" && row.label === "Forward",
  );
  const reverseControlIndex = vehicleRows.findIndex(
    (row) => row.kind === "value" && row.label === "Reverse",
  );
  const steerControlIndex = vehicleRows.findIndex(
    (row) => row.kind === "value" && row.label === "Steer",
  );
  const windowsHeaderIndex = viewRows.findIndex(
    (row) => row.kind === "header" && row.label === "Windows",
  );
  const projectionHeaderIndex = viewRows.findIndex(
    (row) => row.kind === "header" && row.label === "Path visualizations",
  );
  const projectionSelectIndex = viewRows.findIndex(
    (row) => row.id === EVADER_PROJECTION_VIEW_ACTION_ID,
  );
  const chaserPathSelectIndex = viewRows.findIndex(
    (row) => row.id === CHASER_ACTION_PATH_VIEW_ACTION_ID,
  );
  const chaserPathHorizonIndex = viewRows.findIndex(
    (row) => row.id === CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  );
  const chaserPathRateIndex = viewRows.findIndex(
    (row) => row.id === CHASER_ACTION_PATH_RATE_ACTION_ID,
  );
  const mapOverlayIndex = viewRows.findIndex(
    (row) => row.id === CHASER_MAP_OVERLAY_ACTION_ID,
  );
  const debugHeaderIndex = viewRows.findIndex(
    (row) => row.kind === "header" && row.label === "Debug",
  );
  const viewGreentextIndex = viewRows.findIndex(
    (row) => row.id === SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  );

  assert.equal(sections[0]?.id, "game");
  assert.equal(gameSection?.title, "Game");
  assert.equal(sections.some((section) => section.id === "score"), false);
  assert.equal(sections.some((section) => section.id === "settings"), false);
  assert.equal(sections.some((section) => section.id === "scenario"), false);
  assert.equal(sections.some((section) => section.id === "simulation"), false);
  assert.equal(sections.some((section) => section.id === "controls"), false);
  assert.equal(sections.some((section) => section.id === "windows"), false);
  assert.equal(sections.some((section) => section.id === "projection"), false);
  assert.equal(scoreHeaderIndex, 0);
  assert.equal(touchCountIndex, scoreHeaderIndex + 1);
  assert.equal(frameCountIndex, touchCountIndex + 1);
  assert.equal(touchRateIndex, frameCountIndex + 1);
  assert.equal(simulationHeaderIndex, touchRateIndex + 1);
  assert.equal(fpsIndex, simulationHeaderIndex + 1);
  assert.equal(playbackIndex, fpsIndex + 1);
  assert.equal(resetIndex, playbackIndex + 1);
  assert.equal(greentextIndex, -1);
  assert.equal(gameControlsHeaderIndex, -1);
  assert.equal(gameChaserAutopilotIndex, -1);
  assert.equal(chaserAutopilotIndex, 0);
  assert.equal(actionProposalRows[chaserAutopilotIndex]?.enabled, true);
  assert.equal(vehicleControlsHeaderIndex > -1, true);
  assert.equal(forwardControlIndex, vehicleControlsHeaderIndex + 1);
  assert.equal(reverseControlIndex, forwardControlIndex + 1);
  assert.equal(steerControlIndex, reverseControlIndex + 1);
  assert.equal(projectionHeaderIndex, 0);
  assert.equal(projectionSelectIndex, projectionHeaderIndex + 1);
  assert.equal(chaserPathSelectIndex > projectionSelectIndex, true);
  assert.equal(chaserPathHorizonIndex, chaserPathSelectIndex + 1);
  assert.equal(chaserPathRateIndex, chaserPathHorizonIndex + 1);
  assert.equal(mapOverlayIndex, chaserPathRateIndex + 1);
  assert.equal(debugHeaderIndex > mapOverlayIndex, true);
  assert.deepEqual(
    {
      kind: viewRows[projectionSelectIndex]?.kind,
      label: viewRows[projectionSelectIndex]?.label,
      value: viewRows[projectionSelectIndex]?.value,
      options: viewRows[projectionSelectIndex]?.options?.map((option) => option.value),
    },
    {
      kind: "select",
      label: "Evader projection",
      value: EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS,
      options: [
        EVADER_PROJECTION_VIEW_MODES.HIDDEN,
        EVADER_PROJECTION_VIEW_MODES.ESTIMATE,
        EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS,
      ],
    },
  );
  assert.deepEqual(
    {
      kind: viewRows[chaserPathSelectIndex]?.kind,
      label: viewRows[chaserPathSelectIndex]?.label,
      value: viewRows[chaserPathSelectIndex]?.value,
      options: viewRows[chaserPathSelectIndex]?.options?.map((option) => option.value),
    },
    {
      kind: "select",
      label: "Chaser paths",
      value: CHASER_ACTION_PATH_VIEW_MODES.HIDDEN,
      options: [
        CHASER_ACTION_PATH_VIEW_MODES.HIDDEN,
        CHASER_ACTION_PATH_VIEW_MODES.ALL,
        CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS,
        CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT,
        CHASER_ACTION_PATH_VIEW_MODES.LINE_OF_SIGHT_PURSUIT,
        CHASER_ACTION_PATH_VIEW_MODES.MAP_DISCOVERY,
        CHASER_ACTION_PATH_VIEW_MODES.MAP_RECENCY_REFRESH,
        CHASER_ACTION_PATH_VIEW_MODES.SPIN,
      ],
    },
  );
  assert.deepEqual(
    {
      kind: viewRows[chaserPathHorizonIndex]?.kind,
      label: viewRows[chaserPathHorizonIndex]?.label,
      value: viewRows[chaserPathHorizonIndex]?.value,
      suffix: viewRows[chaserPathHorizonIndex]?.suffix,
    },
    {
      kind: "editableValue",
      label: "Chaser horizon",
      value: "36",
      suffix: "frames",
    },
  );
  assert.deepEqual(
    {
      kind: viewRows[chaserPathRateIndex]?.kind,
      label: viewRows[chaserPathRateIndex]?.label,
      value: viewRows[chaserPathRateIndex]?.value,
      suffix: viewRows[chaserPathRateIndex]?.suffix,
    },
    {
      kind: "editableValue",
      label: "Chaser spacing",
      value: "6",
      suffix: "frames",
    },
  );
  assert.deepEqual(
    {
      kind: viewRows[mapOverlayIndex]?.kind,
      label: viewRows[mapOverlayIndex]?.label,
      value: viewRows[mapOverlayIndex]?.value,
      options: viewRows[mapOverlayIndex]?.options?.map((option) => option.value),
    },
    {
      kind: "select",
      label: "Map overlay",
      value: CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN,
      options: [
        CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN,
        CHASER_MAP_OVERLAY_VIEW_MODES.KNOWLEDGE,
        CHASER_MAP_OVERLAY_VIEW_MODES.RECENCY,
        CHASER_MAP_OVERLAY_VIEW_MODES.ALL,
      ],
    },
  );
  assert.equal(viewGreentextIndex, debugHeaderIndex + 1);
  assert.equal(windowsHeaderIndex > viewGreentextIndex, true);
  assert.equal(
    viewRows.filter((row) => row.kind === "header").at(-1)?.label,
    "Windows",
  );
  assert.deepEqual(
    {
      kind: gameRows[resetIndex]?.kind,
      label: gameRows[resetIndex]?.label,
    },
    {
      kind: "action",
      label: "Reset",
    },
  );
  assert.deepEqual(
    {
      kind: viewRows[viewGreentextIndex]?.kind,
      label: viewRows[viewGreentextIndex]?.label,
      enabled: viewRows[viewGreentextIndex]?.enabled,
    },
    {
      kind: "toggle",
      label: "Debug overlay",
      enabled: true,
    },
  );
});

test("chase sidebar projection dropdown syncs prediction path debug mode", () => {
  const state = createChaseSimulationState({
    scenario: cloneScenario(),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  let sections = [];
  publishSidebarSections(
    (nextSections) => {
      sections = nextSections;
    },
    state.programmaticChaserEnabled,
    {
      chaserViewVisible: false,
      evaderViewVisible: false,
      idaeDebugVisible: false,
    },
    state.simulationSettings,
    state.vehicleSettings,
    state.projectionSettings,
    {},
    state.runMetrics,
    {
      activeScenarioId: DEFAULT_CHASE_SCENARIO_ID,
      options: getChaseScenarioOptions(),
      evaderExists: true,
    },
    {
      visible: true,
      actorId: "chaser",
    },
    {
      viewMode: CHASER_ACTION_PATH_VIEW_MODES.ALL,
      horizonFrames: 18,
      sampleSpacingFrames: 3,
    },
    {
      viewMode: CHASER_MAP_OVERLAY_VIEW_MODES.ALL,
    },
  );

  const projectionSelect = sections
    .find((section) => section.id === "view")
    ?.rows
    ?.find((row) => row.id === EVADER_PROJECTION_VIEW_ACTION_ID);
  const chaserPathSelect = sections
    .find((section) => section.id === "view")
    ?.rows
    ?.find((row) => row.id === CHASER_ACTION_PATH_VIEW_ACTION_ID);
  const chaserPathHorizon = sections
    .find((section) => section.id === "view")
    ?.rows
    ?.find((row) => row.id === CHASER_ACTION_PATH_HORIZON_ACTION_ID);
  const chaserPathRate = sections
    .find((section) => section.id === "view")
    ?.rows
    ?.find((row) => row.id === CHASER_ACTION_PATH_RATE_ACTION_ID);
  const mapOverlaySelect = sections
    .find((section) => section.id === "view")
    ?.rows
    ?.find((row) => row.id === CHASER_MAP_OVERLAY_ACTION_ID);

  assert.equal(projectionSelect?.kind, "select");
  assert.equal(projectionSelect?.value, EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS);
  assert.equal(chaserPathSelect?.kind, "select");
  assert.equal(chaserPathSelect?.value, CHASER_ACTION_PATH_VIEW_MODES.ALL);
  assert.equal(chaserPathHorizon?.value, "18");
  assert.equal(chaserPathRate?.value, "3");
  assert.equal(mapOverlaySelect?.kind, "select");
  assert.equal(mapOverlaySelect?.value, CHASER_MAP_OVERLAY_VIEW_MODES.ALL);
});

test("chase sidebar groups action proposal toggles by chaser motive", () => {
  const state = createChaseSimulationState({
    scenario: cloneScenario(),
    columns: GRID.columns,
    rows: GRID.rows,
  });
  let sections = [];
  publishSidebarSections(
    (nextSections) => {
      sections = nextSections;
    },
    state.programmaticChaserEnabled,
    {
      chaserViewVisible: false,
      evaderViewVisible: false,
      idaeDebugVisible: false,
    },
    state.simulationSettings,
    state.vehicleSettings,
    state.projectionSettings,
    {
      chaser: {
        [CHASER_ACTION_PROPOSAL_IDS.EVADER_PREDICTION_PURSUIT]: true,
        [CHASER_ACTION_PROPOSAL_IDS.LINE_OF_SIGHT_PURSUIT]: false,
        [CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY]: true,
        [CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH]: true,
        [CHASER_ACTION_PROPOSAL_IDS.SPIN]: false,
      },
      evader: {
        [EVADER_ACTION_PROPOSAL_IDS.DEFAULT_ROAM]: true,
        [EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT]: false,
      },
    },
    state.runMetrics,
  );

  const actionProposalRows = sections.find((section) => section.id === "actionProposals")?.rows ?? [];
  const rowSummary = actionProposalRows.map((row) => {
    if (row.kind === "header") {
      return `header:${row.label}`;
    }
    if (row.kind === "toggle") {
      return `toggle:${row.id}:${row.label}:${row.enabled}`;
    }
    return row.kind;
  });

  assert.deepEqual(rowSummary, [
    `toggle:${CHASER_AUTOPILOT_ACTION_ID}:Programmatic chaser:true`,
    "header:Chaser motive: Chase",
    `toggle:${createActorActionProposalToggleActionId("chaser", CHASER_ACTION_PROPOSAL_IDS.EVADER_PREDICTION_PURSUIT)}:Evader Prediction Pursuit:true`,
    `toggle:${createActorActionProposalToggleActionId("chaser", CHASER_ACTION_PROPOSAL_IDS.LINE_OF_SIGHT_PURSUIT)}:Line Of Sight Pursuit:false`,
    "header:Chaser motive: Knowledge acquisition",
    `toggle:${createActorActionProposalToggleActionId("chaser", CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY)}:Map Discovery:true`,
    `toggle:${createActorActionProposalToggleActionId("chaser", CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH)}:Map Recency Refresh:true`,
    `toggle:${createActorActionProposalToggleActionId("chaser", CHASER_ACTION_PROPOSAL_IDS.SPIN)}:Spin:false`,
    "header:Evader action proposals",
    `toggle:${createActorActionProposalToggleActionId("evader", EVADER_ACTION_PROPOSAL_IDS.DEFAULT_ROAM)}:Default Roam:true`,
    `toggle:${createActorActionProposalToggleActionId("evader", EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT)}:Evade On Sight:false`,
  ]);
});

test("chase regression predictions stay frame-indexed and ordered", () => {
  const regressionCase = REGRESSION_CASES.find((entry) => entry.name === "action_path_projection_158");
  assert.ok(regressionCase, "action_path_projection_158 regression case is missing");
  const { state } = runRegressionCase(regressionCase);
  const path = state.lastStep.chaserReasoning?.snapshot?.projections?.evaderMotion?.path ?? [];
  assert.ok(path.length > 0, "expected a non-empty prediction path");
  let previousFramesAhead = 0;
  for (const sample of path) {
    assert.ok(Number.isInteger(sample.framesAhead), "framesAhead must be an integer");
    assert.ok(sample.framesAhead > previousFramesAhead, "framesAhead must be strictly increasing");
    previousFramesAhead = sample.framesAhead;
  }
});

test("chaser action peers expose feasible paths with local wall safety disabled", () => {
  const regressionCase = REGRESSION_CASES.find((entry) => entry.name === "action_path_projection_158");
  assert.ok(regressionCase, "action_path_projection_158 regression case is missing");
  const { state } = runRegressionCase(regressionCase);
  const actionProposals = state.lastStep.chaserAction?.actionProposals ?? {};
  const predictionPath = actionProposals.evaderPredictionPursuit?.actionPath ?? [];
  const lineOfSightPath = actionProposals.lineOfSightPursuit?.actionPath ?? [];
  const consensusPath = actionProposals.actionPathConsensus?.path ?? [];
  const firstAction = consensusPath[0] ?? null;

  assert.equal(actionProposals.evaderPredictionPursuit?.active, true);
  assert.equal(actionProposals.lineOfSightPursuit?.active, true);
  assert.ok(predictionPath.length > 0, "expected prediction pursuit to propose a path");
  assert.ok(lineOfSightPath.length > 0, "expected line-of-sight pursuit to propose a path");
  assert.ok(consensusPath.length > 0, "expected action path consensus to produce a path");
  assert.equal(Number.isFinite(firstAction?.steer), true);
  assert.equal(firstAction?.forward, true);
  assert.equal(actionProposals.localNavigation?.active, false);
  assert.equal(actionProposals.localNavigation?.movement?.wallPressure, null);
  assert.equal(String(state.lastStep.chaserAction?.selectedActionProposalId).includes("wallSafety"), false);

  const allDebugEntries = getChaserActionPathDebugEntries(
    state.lastStep.chaserAction,
    CHASER_ACTION_PATH_VIEW_MODES.ALL,
    {
      horizonFrames: 18,
      sampleSpacingFrames: 6,
    },
  );
  const predictionDebugEntries = getChaserActionPathDebugEntries(
    state.lastStep.chaserAction,
    CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT,
    {
      horizonFrames: 18,
      sampleSpacingFrames: 6,
    },
  );
  assert.equal(
    getChaserActionPathDebugEntries(
      state.lastStep.chaserAction,
      CHASER_ACTION_PATH_VIEW_MODES.HIDDEN,
    ).length,
    0,
  );
  assert.ok(
    allDebugEntries.some((entry) =>
      entry.sourceId === CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS),
    "expected all mode to include the consensus path",
  );
  assert.ok(
    allDebugEntries.some((entry) =>
      entry.sourceId === CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT),
    "expected all mode to include the prediction pursuit path",
  );
  assert.deepEqual(
    predictionDebugEntries.map((entry) => entry.sourceId),
    [CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT],
  );
  assert.ok(
    allDebugEntries.every((entry) =>
      entry.samples.every((sample) =>
        Number.isFinite(sample.position.x) && Number.isFinite(sample.position.z))),
    "debug entries should expose normalized positions for rendering",
  );
  assert.ok(
    allDebugEntries.every((entry) =>
      entry.samples.every((sample) =>
        sample.framesAhead <= 18
        && (sample.framesAhead % 6 === 0 || sample.framesAhead === entry.samples.at(-1)?.framesAhead))),
    "debug entries should honor chaser path horizon and spacing",
  );
});

test("wall-avoidance pattern predictions expose the pattern strategy name", () => {
  const regressionCase = REGRESSION_CASES.find(
    (entry) => entry.name === "action_path_projection_158",
  );
  assert.ok(regressionCase, "action_path_projection_158 regression case is missing");
  const scenario = regressionCase.buildScenario();
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  state.projectionSettings.visible = true;
  let predictions = [];

  for (let frame = 0; frame < 800; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: regressionCase.inputProvider({
        frameIndex: state.frameIndex,
        state,
      }),
    });
    predictions = state.lastStep.chaserReasoning?.snapshot
      ?.patternUnits
      ?.wallAvoidance
      ?.predictions ?? [];
    if (predictions.length > 0) {
      break;
    }
  }

  assert.ok(predictions.length > 0, "expected wall-avoidance predictions");
  for (const prediction of predictions) {
    assert.equal(prediction.sourcePatternId, "wallAvoidance");
    assert.equal(prediction.prediction?.strategy, "wall-avoidance-intercept");
    assert.equal(prediction.prediction?.actionable, true);
    assert.equal(prediction.metadata?.strategy, "wall-avoidance-intercept");
    assert.notEqual(prediction.prediction?.strategy, "wall-avoidance-pattern-inactive");
    assert.notEqual(prediction.metadata?.strategy, "wall-avoidance-pattern-inactive");
  }
});

test("chaser pattern config filters prediction sources without disabling support state", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.actionProposals.mapDiscovery = false;
    draft.actors.chaser.actionProposals.mapRecencyRefresh = false;
    draft.actors.chaser.patterns = {
      continuance: false,
      wallAvoidance: true,
    };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  let wallOnlySnapshot = null;

  for (let frame = 0; frame < 500; frame += 1) {
    stepChaseSimulation(state, { humanInput: idleInput() });
    const snapshot = state.lastStep.chaserReasoning?.snapshot;
    const sourcePatternIds = snapshot?.projections?.evaderMotion?.prediction?.sourcePatternIds ?? [];
    if (sourcePatternIds.includes("wallAvoidance")) {
      wallOnlySnapshot = snapshot;
      break;
    }
  }

  assert.ok(wallOnlySnapshot, "expected a wall-only prediction window");
  assert.equal(wallOnlySnapshot?.patternStatus?.continuance?.enabled, false);
  assert.equal(wallOnlySnapshot?.patternStatus?.wallAvoidance?.enabled, true);
  assert.ok(
    (wallOnlySnapshot?.patternStatus?.continuance?.predictionCount ?? 0) > 0,
    "continuance should still update as support state for the motion estimate",
  );
  assert.deepEqual(
    wallOnlySnapshot?.projections?.evaderMotion?.prediction?.sourcePatternIds,
    ["wallAvoidance"],
  );
});

test("global prediction performance validates source-agnostic predictions", () => {
  const regressionCase = REGRESSION_CASES.find(
    (entry) => entry.name === "action_path_projection_158",
  );
  assert.ok(regressionCase, "action_path_projection_158 regression case is missing");
  const { state } = runRegressionCase(regressionCase);
  const snapshot = getPredictionPerformanceSnapshot(state.predictionPerformance);
  const sourceRows = snapshot?.bySourceHorizon ?? [];

  assert.ok(snapshot?.validatedCount > 0, "expected validated predictions");
  assert.ok(snapshot?.pendingCount > 0, "expected pending future predictions");
  assert.ok(
    sourceRows.some((row) => row.sourceId === "consensus"),
    "expected consensus predictions to be tracked",
  );
  assert.ok(
    sourceRows.some((row) => row.sourceId !== "consensus"),
    "expected non-consensus prediction sources to be tracked generically",
  );
  assert.ok(
    sourceRows.every((row) => row.targetId === "evader"),
    "expected prediction performance rows to identify the predicted target",
  );
  assert.ok(
    sourceRows.every((row) => Number.isFinite(row.meanPositionError)),
    "expected every tracked source to report mean position error",
  );
  assert.deepEqual(
    snapshot?.thresholdSuccessRates?.map((row) => row.threshold),
    [1],
  );
  assert.ok(
    snapshot?.thresholdSuccessRates?.every((row) =>
      Number.isFinite(row.successRate) && row.count === snapshot.validatedCount),
    "expected prediction performance to expose the 1.0-unit debug success rate",
  );
  assert.ok(
    snapshot?.thresholdSuccessRatesByFrameOffset?.length > 0,
    "expected prediction performance to expose 1.0-unit success rates by horizon",
  );
  assert.ok(
    snapshot?.thresholdSuccessRatesByFrameOffset?.every((row) =>
      row.threshold === 1
      && Number.isFinite(row.frameOffset)
      && Number.isFinite(row.successRate)
      && row.count > 0),
    "expected every horizon success-rate row to identify a validated prediction horizon",
  );
});

test("continuance is a structured default velocity prediction unit", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.position = { x: -3.7, z: -1.6 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: -1.5, z: -1.6 };
    draft.actors.evader.direction = { x: 1, z: 0 };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  for (let frame = 0; frame < 5; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  const continuanceUnit = state.lastStep.chaserReasoning?.snapshot?.patternUnits?.continuance;
  const firstPrediction = continuanceUnit?.predictions?.[0] ?? null;

  assert.deepEqual(continuanceUnit?.unit, {
    id: "linear-motion-continuation",
    type: "component-velocity-continuance",
    role: "default-prediction",
    assumption: "observed velocity components continue until replaced by newer observation",
    coordinatePlane: "x/z",
    components: {
      x: { quantity: "velocity", axis: "x", relation: "continues" },
      z: { quantity: "velocity", axis: "z", relation: "continues" },
    },
  });
  assert.equal(firstPrediction?.confidenceParts?.model, "default-prior-decay");
  assert.equal(firstPrediction?.confidenceParts?.confirmedCount, 0);
  assert.equal(firstPrediction?.confidenceParts?.opportunityCount, 0);
});

test("chaser knowledge acquisition supersedes actionable prediction after losing sight", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.position = { x: -3.7, z: -1.6 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: -1.5, z: -1.6 };
    draft.actors.evader.direction = { x: 1, z: 0 };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  let lostSightPursuitFrame = null;
  for (let frame = 0; frame < 800; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
    const snapshot = state.lastStep.chaserReasoning?.snapshot;
    const plan = snapshot?.projections?.evaderMotion;
    if (!snapshot?.memory?.directObservation?.evaderLocation?.visible && plan?.actionable) {
      const wallPrediction = snapshot?.patternUnits?.wallAvoidance?.predictions?.[0] ?? null;
      lostSightPursuitFrame = {
        frame: state.frameIndex,
        strategy: plan.prediction.strategy,
        persisted: Boolean(plan.prediction.persisted),
        pathLen: plan.path?.length ?? 0,
        firstAhead: plan.path?.[0]?.framesAhead ?? null,
        selectedActionProposalId: state.lastStep.chaserAction?.selectedActionProposalId ?? null,
        motiveId: state.lastStep.chaserAction?.actionProposals?.motiveSignal?.id ?? null,
        discoveryComplete: Boolean(
          state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition?.discoveryComplete,
        ),
        hasDiscoveryCandidates:
          (state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition
            ?.discoveryCandidateCount ?? 0) > 0,
        hasRecencyCandidates:
          (state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition
            ?.recencyCandidateCount ?? 0) > 0,
        predictionPursuitActive: Boolean(
          state.lastStep.chaserAction?.actionProposals?.evaderPredictionPursuit?.active,
        ),
        mapDiscoveryActive: Boolean(
          state.lastStep.chaserAction?.actionProposals?.mapDiscovery?.active,
        ),
        mapRecencyRefreshActive: Boolean(
          state.lastStep.chaserAction?.actionProposals?.mapRecencyRefresh?.active,
        ),
        mapRecencyRefreshInactiveReason:
          state.lastStep.chaserAction?.actionProposals?.mapRecencyRefresh?.inactiveReason ?? null,
        spinActive: Boolean(state.lastStep.chaserAction?.actionProposals?.spin?.active),
        actionPathLen: state.lastStep.chaserAction?.actionPath?.length ?? 0,
        spinPathLen: state.lastStep.chaserAction
          ?.actionProposals
          ?.spin
          ?.actionPath
          ?.length ?? 0,
        localNavigationActive: Boolean(
          state.lastStep.chaserAction?.actionProposals?.localNavigation?.active,
        ),
        wallPressure: state.lastStep.chaserAction
          ?.actionProposals
          ?.localNavigation
          ?.movement
          ?.wallPressure ?? null,
        wallProbability: roundNumber(wallPrediction?.confidenceParts?.probability ?? 0, 4),
        wallCredibleLowerBound: roundNumber(
          wallPrediction?.confidenceParts?.credibleLowerBound ?? 0,
          4,
        ),
      };
      break;
    }
  }

  assert.deepEqual(lostSightPursuitFrame, {
    frame: 233,
    strategy: "rectified-evader-projection",
    persisted: false,
    pathLen: 6,
    firstAhead: 20,
    selectedActionProposalId: "mapDiscovery+spin",
    motiveId: "knowledgeAcquisition",
    discoveryComplete: false,
    hasDiscoveryCandidates: true,
    hasRecencyCandidates: true,
    predictionPursuitActive: false,
    mapDiscoveryActive: true,
    mapRecencyRefreshActive: false,
    mapRecencyRefreshInactiveReason: "discovery-frontier-available",
    spinActive: true,
    actionPathLen: 36,
    spinPathLen: 36,
    localNavigationActive: false,
    wallPressure: null,
    wallProbability: 0.9167,
    wallCredibleLowerBound: 0.7828,
  });
});

test("evader IDAE evades when the chaser is in evader FOV", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = false;
    draft.actors.chaser.position = { x: 1.7, z: 0 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: 2.25, z: 0 };
    draft.actors.evader.direction = { x: -1, z: 0 };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  const actionProposalTimeline = [];

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
    actionProposalTimeline.push({
      frame: state.frameIndex,
      actionProposalId: state.lastStep.evaderReasoning?.action?.actionProposalId ?? null,
      chaserVisible: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.memory?.directObservation?.chaserLocation?.visible,
      ),
      evadeActionable: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.actionStatus?.evadeOnSight?.actionable,
      ),
      baselineActionable: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.actionStatus?.defaultRoam?.actionable,
      ),
    });
  }

  assert.deepEqual(
    actionProposalTimeline.slice(0, 15),
    [
      {
        frame: 1, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 2, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 3, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 4, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 5, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 6, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 7, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 8, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 9, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 10, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 11, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 12, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 13, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 14, actionProposalId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 15, actionProposalId: "evader-consensus", chaserVisible: false, evadeActionable: false, baselineActionable: true,
      },
    ],
  );
  assert.deepEqual(
    {
      evader: {
        x: roundNumber(state.evaderPosition.x),
        z: roundNumber(state.evaderPosition.z),
        dx: roundNumber(state.evaderDirection.x),
        dz: roundNumber(state.evaderDirection.z),
      },
      lastActionProposal: state.lastStep.evaderReasoning?.action?.actionProposalId ?? null,
      lastDebug: state.lastStep.evaderReasoning?.action?.debug ?? null,
    },
    {
      evader: {
        x: 1.5417,
        z: 0.5189,
        dx: -0.3584,
        dz: 0.9336,
      },
      lastActionProposal: "evader-consensus",
      lastDebug: {
        policyId: "evader-consensus-baseline",
        wallAvoidanceActive: true,
        nearestWall: "center-square",
        nearestDistance: 0.7183746928487549,
        chaserVisible: false,
        evadeActive: false,
        activeActionProposalIds: ["defaultRoam"],
        consensusOrder: 1,
      },
    },
  );
  assert.deepEqual(
    state.lastStep.evaderReasoning?.snapshot?.actionStatus?.evadeOnSight?.state,
    {
      visibleFrameCount: 14,
      actionableFrameCount: 14,
      executedFrameCount: 14,
      visibilityEpisodeCount: 1,
      actionableEpisodeCount: 1,
      executionEpisodeCount: 1,
      lastSeenDistance: 0.24217397247254568,
      lastSeenBearingRadians: 0,
    },
  );
  assert.ok(
    !("selfObservation" in (state.lastStep.evaderReasoning?.snapshot?.memory ?? {})),
    "evader self state should not be stored under memory",
  );
  assert.deepEqual(
    {
      hasPosition: Boolean(state.lastStep.evaderReasoning?.snapshot?.selfState?.position),
      hasDirection: Boolean(state.lastStep.evaderReasoning?.snapshot?.selfState?.direction),
      hasFrameIndex: Number.isFinite(state.lastStep.evaderReasoning?.snapshot?.selfState?.frameIndex),
    },
    {
      hasPosition: true,
      hasDirection: true,
      hasFrameIndex: true,
    },
  );
});

test("scenario action proposal toggles can disable evader evade-on-sight", () => {
  const scenario = buildScenario((draft) => {
    draft.actors.chaser.position = { x: 1.7, z: 0 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: 2.25, z: 0 };
    draft.actors.evader.direction = { x: -1, z: 0 };
    draft.actors.evader.actionProposals.evadeOnSight = false;
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  const timeline = [];

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
    timeline.push({
      frame: state.frameIndex,
      chaserVisible: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.memory?.directObservation?.chaserLocation?.visible,
      ),
      evadeActionable: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.actionStatus?.evadeOnSight?.actionable,
      ),
      activeActionProposalIds: [
        ...(state.lastStep.evaderReasoning?.action?.debug?.activeActionProposalIds ?? []),
      ],
    });
  }

  assert.equal(
    state.lastStep.evaderReasoning?.snapshot?.engines?.evadeOnSight,
    false,
  );
  assert.ok(
    timeline.some((entry) => entry.chaserVisible),
    "test setup should place the chaser in evader FOV for at least one frame",
  );
  assert.equal(
    timeline.some((entry) => entry.evadeActionable),
    false,
  );
  assert.ok(
    timeline.every((entry) => !entry.activeActionProposalIds.includes("evadeOnSight")),
    "evade action proposal should never participate in consensus when disabled",
  );
  assert.deepEqual(
    state.lastStep.evaderReasoning?.snapshot?.actionStatus?.evadeOnSight?.state,
    {
      visibleFrameCount: 0,
      actionableFrameCount: 0,
      executedFrameCount: 0,
      visibilityEpisodeCount: 0,
      actionableEpisodeCount: 0,
      executionEpisodeCount: 0,
      lastSeenDistance: null,
      lastSeenBearingRadians: null,
    },
  );
});

test("action proposal comparison runner is deterministic and respects scenario action proposal combinations", () => {
  const comparisonScenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.position = { x: -3.7, z: -1.6 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: -1.5, z: -1.6 };
    draft.actors.evader.direction = { x: 1, z: 0 };
  });
  const comparisonConfig = {
    baseScenarioDefinition: comparisonScenario,
    columns: GRID.columns,
    rows: GRID.rows,
    totalFrames: 335,
    warmupFrames: 0,
    combinations: [
      {
        id: "baseline",
      },
      {
        id: "prediction-pursuit-off",
        chaserActionProposals: {
          evaderPredictionPursuit: false,
        },
      },
    ],
  };

  const first = compareChaseActionProposalCombinations(comparisonConfig);
  const second = compareChaseActionProposalCombinations(comparisonConfig);

  assert.deepEqual(first, second);
  assert.equal(first[0].measurementFrames, 335);
  assert.equal(first[0].chaserActionProposals.evaderPredictionPursuit, true);
  assert.equal(first[1].chaserActionProposals.evaderPredictionPursuit, false);
  assert.notDeepEqual(first[0].finalState.chaserPosition, first[1].finalState.chaserPosition);
  first.forEach((result) => {
    assert.ok(Number.isFinite(result.touchesPerThousandFrames));
    assert.equal(result.evaderActionProposals.evadeOnSight, true);
  });
});

test("programmatic chaser uses structured knowledge acquisition when sweep spin is disabled", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.actionProposals.spin = false;
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  const startPosition = { ...state.chaserPosition };

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  assert.equal(state.lastStep.chaserReasoning?.snapshot?.memory?.directObservation?.evaderLocation?.visible, false);
  assert.equal(state.lastStep.chaserAction?.selectedActionProposalId, "mapDiscovery");
  assert.equal(state.lastStep.chaserAction?.actionProposals?.spin?.active, false);
  assert.equal(state.lastStep.chaserAction?.actionProposals?.mapDiscovery?.active, true);
  assert.equal(state.lastStep.chaserAction?.forward, true);
  assert.notDeepEqual(state.chaserPosition, startPosition);
});

test("map discovery remains active if visible-evader chase action proposals are disabled", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.actionProposals.evaderPredictionPursuit = false;
    draft.actors.chaser.actionProposals.lineOfSightPursuit = false;
    draft.actors.chaser.actionProposals.mapDiscovery = true;
    draft.actors.chaser.actionProposals.mapRecencyRefresh = false;
    draft.actors.chaser.actionProposals.spin = false;
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  let visibleEvaderFrame = null;
  for (let frame = 0; frame < 180; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
    if (state.lastStep.chaserAction?.actionProposals?.motiveSignal?.evaderInLineOfSight) {
      visibleEvaderFrame = state.frameIndex;
      break;
    }
  }

  assert.ok(visibleEvaderFrame !== null);
  assert.equal(
    state.lastStep.chaserAction?.actionProposals?.motiveSignal?.id,
    "knowledgeAcquisition",
  );
  assert.equal(
    state.lastStep.chaserAction?.actionProposals?.motiveSignal?.reason,
    "evader-visible-chase-disabled",
  );
  assert.equal(state.lastStep.chaserAction?.selectedActionProposalId, "mapDiscovery");
  assert.equal(state.lastStep.chaserAction?.actionProposals?.mapDiscovery?.active, true);
  assert.equal(state.lastStep.chaserAction?.forward, true);
  assert.equal(
    state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition?.discoveryComplete,
    false,
  );
});

test("map discovery-only chaser stops after remembered traversable map is covered", () => {
  const scenarioDefinition = structuredClone(getChaseScenarioDefinition("no-evader"));
  scenarioDefinition.actors.chaser.actionProposals.evaderPredictionPursuit = false;
  scenarioDefinition.actors.chaser.actionProposals.lineOfSightPursuit = false;
  scenarioDefinition.actors.chaser.actionProposals.mapDiscovery = true;
  scenarioDefinition.actors.chaser.actionProposals.mapRecencyRefresh = false;
  scenarioDefinition.actors.chaser.actionProposals.spin = false;
  const scenario = resolveChaseScenario(scenarioDefinition, GRID);
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  let completionFrame = null;
  for (let frame = 0; frame < 1100; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
    const knowledgeSignal = state.lastStep.chaserAction
      ?.actionProposals
      ?.knowledgeAcquisition;
    if (
      knowledgeSignal?.discoveryComplete
      && !state.lastStep.chaserAction?.actionProposals?.mapDiscovery?.active
    ) {
      completionFrame = state.frameIndex;
      break;
    }
  }

  const completedPosition = { ...state.chaserPosition };
  const completedDirection = { ...state.chaserLookDirection };
  const knownAreas = state.lastStep.chaserReasoning
    ?.snapshot
    ?.memory
    ?.abstracted
    ?.mapShape
    ?.knownAreas ?? [];
  const knownVertices = knownAreas.flatMap((area) => area.vertices ?? []);
  const fieldBounds = getFieldBounds(GRID.columns, GRID.rows);

  assert.equal(completionFrame, 728);
  assert.equal(state.lastStep.chaserAction?.selectedActionProposalId, "none");
  assert.equal(state.lastStep.chaserAction?.forward, false);
  assert.equal(
    state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition?.discoveryComplete,
    true,
  );
  assert.equal(
    state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition?.knownAreaCount,
    564,
  );
  assert.deepEqual(
    {
      minX: roundNumber(Math.min(...knownVertices.map((vertex) => vertex.x))),
      maxX: roundNumber(Math.max(...knownVertices.map((vertex) => vertex.x))),
      minZ: roundNumber(Math.min(...knownVertices.map((vertex) => vertex.z))),
      maxZ: roundNumber(Math.max(...knownVertices.map((vertex) => vertex.z))),
    },
    {
      minX: roundNumber(fieldBounds.minX),
      maxX: roundNumber(fieldBounds.maxX),
      minZ: roundNumber(fieldBounds.minZ),
      maxZ: roundNumber(fieldBounds.maxZ),
    },
  );

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  assert.equal(state.lastStep.chaserAction?.selectedActionProposalId, "none");
  assert.equal(state.lastStep.chaserAction?.forward, false);
  assert.deepEqual(state.chaserPosition, completedPosition);
  assert.deepEqual(state.chaserLookDirection, completedDirection);
});

test("programmatic chaser holds position when all chaser action proposals are disabled", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.actionProposals.evaderPredictionPursuit = false;
    draft.actors.chaser.actionProposals.lineOfSightPursuit = false;
    draft.actors.chaser.actionProposals.mapDiscovery = false;
    draft.actors.chaser.actionProposals.mapRecencyRefresh = false;
    draft.actors.chaser.actionProposals.spin = false;
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  const startPosition = { ...state.chaserPosition };
  const startDirection = { ...state.chaserLookDirection };

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  assert.equal(state.lastStep.chaserAction?.selectedActionProposalId, "none");
  assert.equal(state.lastStep.chaserAction?.forward, false);
  assert.equal(state.lastStep.chaserAction?.steering, 0);
  assert.deepEqual(state.chaserPosition, startPosition);
  assert.deepEqual(state.chaserLookDirection, startDirection);
});

test("chase trace recorder stores deterministic memory snapshots", () => {
  const scenario = buildScenario((draft) => {
    draft.trace = {
      enabled: true,
      sink: "memory",
      everyNFrames: 15,
    };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  for (let frame = 0; frame < 45; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  const trace = getChaseSimulationTrace(state);
  assert.equal(trace.effectiveSink, "memory");
  assert.equal(trace.recordedFrameCount, 3);
  assert.deepEqual(
    trace.frames.map((frame) => frame.frameIndex),
    [15, 30, 45],
  );
  assert.equal(
    trace.frames.at(-1)?.chaserReasoning?.snapshot?.projections?.evaderMotion?.sampleSpacingFrames,
    20,
  );
  assert.ok(
    typeof trace.frames.at(-1)?.chaserReasoning?.snapshot?.memory?.directObservation?.evaderLocation?.visible === "boolean",
    "trace frame should include evader visibility state",
  );
});

test("chase trace recorder can write jsonl traces to file", () => {
  const filePath = path.join(
    os.tmpdir(),
    `play-chase-trace-${process.pid}-${Date.now()}.jsonl`,
  );
  const scenario = buildScenario((draft) => {
    draft.trace = {
      enabled: true,
      sink: "file",
      filePath,
      everyNFrames: 20,
    };
  });
  const traceRecorder = createNodeJsonlTraceRecorder(scenario.trace);
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
    traceRecorder,
  });

  for (let frame = 0; frame < 40; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  const trace = getChaseSimulationTrace(state);
  assert.equal(trace.effectiveSink, "file");
  assert.equal(trace.recordedFrameCount, 2);

  const lines = readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(lines.length, 2);
  const firstFrame = JSON.parse(lines[0]);
  const secondFrame = JSON.parse(lines[1]);
  assert.equal(firstFrame.frameIndex, 20);
  assert.equal(secondFrame.frameIndex, 40);
});

test("chase performance tracker summarizes catch-up and segment timings", () => {
  const tracker = createChasePerformanceTracker({
    sampleLimit: 4,
    slowFrameThresholdMs: 20,
  });
  tracker.recordTick({
    frameIndex: 1,
    timestampMs: 100,
    elapsedMs: 16.7,
    totalTickMs: 4,
    stepMs: 1,
    stepsThisTick: 1,
    frameDurationMs: 16.7,
    accumulatedMsAfterStep: 0,
    overVisualBudget: false,
    overSimulationBudget: false,
    segments: {
      projectionDisplayMs: 0.2,
      idaeDebugMs: 0.3,
      sidebarMs: 0.4,
      sceneSyncMs: 0.1,
      mainRenderMs: 2,
      chaserViewRenderMs: 0,
      evaderViewRenderMs: 0,
    },
  });
  const snapshot = tracker.recordTick({
    frameIndex: 2,
    timestampMs: 140,
    elapsedMs: 40,
    totalTickMs: 24,
    stepMs: 3,
    stepsThisTick: 2,
    frameDurationMs: 16.7,
    accumulatedMsAfterStep: 0,
    overVisualBudget: true,
    overSimulationBudget: true,
    segments: {
      projectionDisplayMs: 1,
      idaeDebugMs: 2,
      sidebarMs: 3,
      sceneSyncMs: 0.5,
      mainRenderMs: 12,
      chaserViewRenderMs: 4,
      evaderViewRenderMs: 1,
    },
  });

  assert.equal(snapshot.sampleCount, 2);
  assert.equal(snapshot.summary.catchupTickCount, 1);
  assert.equal(snapshot.summary.overVisualBudgetCount, 1);
  assert.equal(snapshot.suspectedCauses.catchup, 1);
  assert.equal(snapshot.slowSamples.at(-1)?.topSegment.name, "mainRenderMs");
});
