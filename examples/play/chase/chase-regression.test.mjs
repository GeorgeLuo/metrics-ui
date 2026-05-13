import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  CAR_BOUND_RADIUS,
  CHASER_AUTOPILOT_ACTION_ID,
  EVADER_PROJECTION_VIEW_ACTION_ID,
  EVADER_PROJECTION_VIEW_MODES,
  SCENARIO_SELECT_ACTION_ID,
  SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  SIMULATION_RESET_ACTION_ID,
} from "./constants.mjs";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "./scenarios/index.mjs";
import { compareChaseStrategyCombinations } from "./chase-strategy-comparison.mjs";
import { resolveChaseScenario } from "./scenario.mjs";
import {
  createChaseSimulationState,
  getChaseSimulationTrace,
  stepChaseSimulation,
} from "./simulation.mjs";
import { createChasePerformanceTracker } from "./performance-debug.mjs";
import { getPredictionPerformanceSnapshot } from "./prediction-performance.mjs";
import { createNodeJsonlTraceRecorder } from "./trace-recorder-node.mjs";
import { getWallBounds } from "./world.mjs";
import { publishSidebarSections } from "./sidebar.mjs";

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
      chaser: { x: -4.0425, z: -0.6859, dx: -0.1564, dz: 0.9877 },
      evader: { x: 3.2564, z: 2.1452, dx: 0.983, dz: -0.1834 },
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
  const evaderPredictionPlan = snapshot?.strategies?.evaderPrediction;
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
      actionable: Boolean(evaderPredictionPlan?.actionable),
      invalidReason: evaderPredictionPlan?.invalidReason ?? null,
      strategy: evaderPredictionPlan?.prediction?.strategy ?? null,
      pathLen: evaderPredictionPlan?.path?.length ?? 0,
      firstAhead: evaderPredictionPlan?.path?.[0]?.framesAhead ?? null,
      sourcePatternIds: evaderPredictionPlan?.prediction?.sourcePatternIds ?? [],
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
    pathLen: snapshot?.strategies?.evaderPrediction?.path?.length ?? 0,
    invalidReason: snapshot?.strategies?.evaderPrediction?.invalidReason ?? null,
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
      state.evaderPosition,
      state.obstacles,
      `${regressionCase.name} evader penetrated obstacle padding on frame ${state.frameIndex}`,
    );
    assertProjectionSamplesOutsideObstaclePadding(
      state.lastStep.chaserReasoning?.snapshot?.strategies?.evaderPrediction?.path,
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
    "strategies",
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

test("scenario config can omit the evader without debug hardcoding", () => {
  const scenarioDefinition = getChaseScenarioDefinition("no-evader");
  const scenario = resolveChaseScenario(scenarioDefinition, GRID);
  assert.equal(scenario.actors.evader.exists, false);
  assert.equal(scenario.actors.evader.position, null);
  assert.equal(scenario.actors.evader.direction, null);

  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  assert.equal(state.evaderExists, false);
  assert.equal(state.evaderPosition, null);
  assert.equal(state.evaderDirection, null);
  assert.equal(state.evaderIdae, null);

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
  }

  const predictionPlan = state.lastStep.chaserReasoning?.snapshot?.strategies?.evaderPrediction;
  assert.equal(state.frameIndex, 20);
  assert.equal(state.lastStep.evaderReasoning, null);
  assert.equal(state.lastStep.evaderMovementDecision, null);
  assert.equal(state.runMetrics.touchCount, 0);
  assert.equal(state.lastStep.chaserReasoning?.observation?.absent, true);
  assert.equal(predictionPlan?.actionable, false);
  assert.equal(predictionPlan?.invalidReason, "target-absent");
  assert.equal(state.lastStep.chaserReasoning?.snapshot?.patterns?.evaderMotionModel, null);
  assert.equal(state.lastStep.chaserReasoning?.snapshot?.patterns?.continuance, null);
  assert.equal(state.lastStep.chaserReasoning?.snapshot?.patterns?.wallAvoidance, null);
  assert.deepEqual(state.lastStep.chaserReasoning?.snapshot?.patternUnits, {});
  assert.equal(state.lastStep.chaserAction?.chosenStrategy, "search");
  assert.equal(state.lastStep.chaserAction?.forward, true);
});

test("chase sidebar exposes scenario selector from settings", () => {
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
  );

  const settingsSection = sections.find((section) => section.id === "settings");
  const settingsRows = settingsSection?.rows ?? [];
  const scenarioSelect = settingsRows.find((row) => row.id === SCENARIO_SELECT_ACTION_ID);
  const scenarioHeaderIndex = settingsRows.findIndex(
    (row) => row.kind === "header" && row.label === "Scenario",
  );
  const simulationHeaderIndex = settingsRows.findIndex(
    (row) => row.kind === "header" && row.label === "Simulation",
  );
  const controlsHeaderIndex = settingsRows.findIndex(
    (row) => row.kind === "header" && row.label === "Controls",
  );
  assert.equal(scenarioHeaderIndex, 0);
  assert.equal(simulationHeaderIndex > scenarioHeaderIndex, true);
  assert.equal(controlsHeaderIndex, -1);
  assert.equal(
    settingsRows.filter((row) => row.kind === "header").at(-1)?.label,
    "Simulation",
  );
  assert.equal(settingsSection?.defaultOpen, false);
  assert.equal(sections[sections.length - 1]?.id, "settings");
  assert.equal(scenarioSelect?.kind, "select");
  assert.equal(scenarioSelect?.value, DEFAULT_CHASE_SCENARIO_ID);
  assert.ok(
    scenarioSelect?.options?.some((option) => option.value === "no-evader"),
    "expected sidebar scenario selector to include the no-evader scenario",
  );
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

test("chase sidebar exposes reset directly below playback", () => {
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

  const settingsRows = sections.find((section) => section.id === "settings")?.rows ?? [];
  const playbackIndex = settingsRows.findIndex(
    (row) => row.id === SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  );
  const resetIndex = settingsRows.findIndex((row) => row.id === SIMULATION_RESET_ACTION_ID);
  const greentextIndex = settingsRows.findIndex(
    (row) => row.id === SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  );
  const settingsControlsHeaderIndex = settingsRows.findIndex(
    (row) => row.kind === "header" && row.label === "Controls",
  );
  const settingsChaserAutopilotIndex = settingsRows.findIndex(
    (row) => row.id === CHASER_AUTOPILOT_ACTION_ID,
  );
  const strategiesRows = sections.find((section) => section.id === "strategies")?.rows ?? [];
  const vehicleRows = sections.find((section) => section.id === "vehicle")?.rows ?? [];
  const viewRows = sections.find((section) => section.id === "view")?.rows ?? [];
  const chaserAutopilotIndex = strategiesRows.findIndex(
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
    (row) => row.kind === "header" && row.label === "Evader projection",
  );
  const projectionSelectIndex = viewRows.findIndex(
    (row) => row.id === EVADER_PROJECTION_VIEW_ACTION_ID,
  );
  const debugHeaderIndex = viewRows.findIndex(
    (row) => row.kind === "header" && row.label === "Debug",
  );
  const viewGreentextIndex = viewRows.findIndex(
    (row) => row.id === SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  );

  assert.equal(sections.some((section) => section.id === "scenario"), false);
  assert.equal(sections.some((section) => section.id === "simulation"), false);
  assert.equal(sections.some((section) => section.id === "controls"), false);
  assert.equal(sections.some((section) => section.id === "windows"), false);
  assert.equal(sections.some((section) => section.id === "projection"), false);
  assert.notEqual(playbackIndex, -1);
  assert.equal(resetIndex, playbackIndex + 1);
  assert.equal(greentextIndex, -1);
  assert.equal(settingsControlsHeaderIndex, -1);
  assert.equal(settingsChaserAutopilotIndex, -1);
  assert.equal(chaserAutopilotIndex, 0);
  assert.equal(strategiesRows[chaserAutopilotIndex]?.enabled, true);
  assert.equal(vehicleControlsHeaderIndex > -1, true);
  assert.equal(forwardControlIndex, vehicleControlsHeaderIndex + 1);
  assert.equal(reverseControlIndex, forwardControlIndex + 1);
  assert.equal(steerControlIndex, reverseControlIndex + 1);
  assert.equal(projectionHeaderIndex, 0);
  assert.equal(projectionSelectIndex, projectionHeaderIndex + 1);
  assert.equal(debugHeaderIndex > projectionSelectIndex, true);
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
  assert.equal(viewGreentextIndex, debugHeaderIndex + 1);
  assert.equal(windowsHeaderIndex > viewGreentextIndex, true);
  assert.equal(
    viewRows.filter((row) => row.kind === "header").at(-1)?.label,
    "Windows",
  );
  assert.deepEqual(
    {
      kind: settingsRows[resetIndex]?.kind,
      label: settingsRows[resetIndex]?.label,
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
  );

  const projectionSelect = sections
    .find((section) => section.id === "view")
    ?.rows
    ?.find((row) => row.id === EVADER_PROJECTION_VIEW_ACTION_ID);

  assert.equal(projectionSelect?.kind, "select");
  assert.equal(projectionSelect?.value, EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS);
});

test("chase regression predictions stay frame-indexed and ordered", () => {
  const regressionCase = REGRESSION_CASES.find((entry) => entry.name === "action_path_projection_158");
  assert.ok(regressionCase, "action_path_projection_158 regression case is missing");
  const { state } = runRegressionCase(regressionCase);
  const path = state.lastStep.chaserReasoning?.snapshot?.strategies?.evaderPrediction?.path ?? [];
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
  const actionStrategies = state.lastStep.chaserAction?.actionStrategies ?? {};
  const predictionPath = actionStrategies.evaderPredictionPursuit?.actionPath ?? [];
  const lineOfSightPath = actionStrategies.lineOfSightPursuit?.actionPath ?? [];
  const consensusPath = actionStrategies.actionPathConsensus?.path ?? [];
  const firstAction = consensusPath[0] ?? null;

  assert.equal(actionStrategies.evaderPredictionPursuit?.active, true);
  assert.equal(actionStrategies.lineOfSightPursuit?.active, true);
  assert.ok(predictionPath.length > 0, "expected prediction pursuit to propose a path");
  assert.ok(lineOfSightPath.length > 0, "expected line-of-sight pursuit to propose a path");
  assert.ok(consensusPath.length > 0, "expected action path consensus to produce a path");
  assert.equal(Number.isFinite(firstAction?.steer), true);
  assert.equal(firstAction?.forward, true);
  assert.equal(actionStrategies.localNavigation?.active, false);
  assert.equal(actionStrategies.localNavigation?.movement?.wallPressure, null);
  assert.equal(String(state.lastStep.chaserAction?.chosenStrategy).includes("wallSafety"), false);
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
    const sourcePatternIds = snapshot?.strategies?.evaderPrediction?.prediction?.sourcePatternIds ?? [];
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
    wallOnlySnapshot?.strategies?.evaderPrediction?.prediction?.sourcePatternIds,
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

test("chaser search motive supersedes actionable prediction after losing sight", () => {
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
    const plan = snapshot?.strategies?.evaderPrediction;
    if (!snapshot?.memory?.directObservation?.evaderLocation?.visible && plan?.actionable) {
      const wallPrediction = snapshot?.patternUnits?.wallAvoidance?.predictions?.[0] ?? null;
      lostSightPursuitFrame = {
        frame: state.frameIndex,
        strategy: plan.prediction.strategy,
        persisted: Boolean(plan.prediction.persisted),
        pathLen: plan.path?.length ?? 0,
        firstAhead: plan.path?.[0]?.framesAhead ?? null,
        chosenStrategy: state.lastStep.chaserAction?.chosenStrategy ?? null,
        motiveId: state.lastStep.chaserAction?.actionStrategies?.motiveSignal?.id ?? null,
        predictionPursuitActive: Boolean(
          state.lastStep.chaserAction?.actionStrategies?.evaderPredictionPursuit?.active,
        ),
        searchActive: Boolean(state.lastStep.chaserAction?.actionStrategies?.search?.active),
        actionPathLen: state.lastStep.chaserAction?.actionPath?.length ?? 0,
        searchPathLen: state.lastStep.chaserAction
          ?.actionStrategies
          ?.search
          ?.actionPath
          ?.length ?? 0,
        localNavigationActive: Boolean(
          state.lastStep.chaserAction?.actionStrategies?.localNavigation?.active,
        ),
        wallPressure: state.lastStep.chaserAction
          ?.actionStrategies
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
    chosenStrategy: "search",
    motiveId: "search",
    predictionPursuitActive: false,
    searchActive: true,
    actionPathLen: 36,
    searchPathLen: 36,
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
  const strategyTimeline = [];

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: idleInput(),
    });
    strategyTimeline.push({
      frame: state.frameIndex,
      strategyId: state.lastStep.evaderReasoning?.action?.strategyId ?? null,
      chaserVisible: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.memory?.directObservation?.chaserLocation?.visible,
      ),
      evadeActionable: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.strategyStatus?.evadeOnSight?.actionable,
      ),
      baselineActionable: Boolean(
        state.lastStep.evaderReasoning?.snapshot?.strategyStatus?.defaultRoam?.actionable,
      ),
    });
  }

  assert.deepEqual(
    strategyTimeline.slice(0, 15),
    [
      {
        frame: 1, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 2, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 3, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 4, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 5, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 6, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 7, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 8, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 9, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 10, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 11, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 12, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 13, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 14, strategyId: "evader-consensus", chaserVisible: true, evadeActionable: true, baselineActionable: true,
      },
      {
        frame: 15, strategyId: "evader-consensus", chaserVisible: false, evadeActionable: false, baselineActionable: true,
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
      lastStrategy: state.lastStep.evaderReasoning?.action?.strategyId ?? null,
      lastDebug: state.lastStep.evaderReasoning?.action?.debug ?? null,
    },
    {
      evader: {
        x: 1.5417,
        z: 0.5189,
        dx: -0.3584,
        dz: 0.9336,
      },
      lastStrategy: "evader-consensus",
      lastDebug: {
        policyId: "evader-consensus-baseline",
        wallAvoidanceActive: true,
        nearestWall: "center-square",
        nearestDistance: 0.7183746928487549,
        chaserVisible: false,
        evadeActive: false,
        activeStrategyIds: ["defaultRoam"],
        consensusOrder: 1,
      },
    },
  );
  assert.deepEqual(
    state.lastStep.evaderReasoning?.snapshot?.strategyStatus?.evadeOnSight?.state,
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

test("scenario strategy toggles can disable evader evade-on-sight", () => {
  const scenario = buildScenario((draft) => {
    draft.actors.chaser.position = { x: 1.7, z: 0 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: 2.25, z: 0 };
    draft.actors.evader.direction = { x: -1, z: 0 };
    draft.actors.evader.strategies.evadeOnSight = false;
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
        state.lastStep.evaderReasoning?.snapshot?.strategyStatus?.evadeOnSight?.actionable,
      ),
      activeStrategyIds: [
        ...(state.lastStep.evaderReasoning?.action?.debug?.activeStrategyIds ?? []),
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
    timeline.every((entry) => !entry.activeStrategyIds.includes("evadeOnSight")),
    "evade strategy should never participate in consensus when disabled",
  );
  assert.deepEqual(
    state.lastStep.evaderReasoning?.snapshot?.strategyStatus?.evadeOnSight?.state,
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

test("strategy comparison runner is deterministic and respects scenario strategy combinations", () => {
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
        chaserStrategies: {
          evaderPredictionPursuit: false,
        },
      },
    ],
  };

  const first = compareChaseStrategyCombinations(comparisonConfig);
  const second = compareChaseStrategyCombinations(comparisonConfig);

  assert.deepEqual(first, second);
  assert.equal(first[0].measurementFrames, 335);
  assert.equal(first[0].chaserStrategies.evaderPredictionPursuit, true);
  assert.equal(first[1].chaserStrategies.evaderPredictionPursuit, false);
  assert.notDeepEqual(first[0].finalState.chaserPosition, first[1].finalState.chaserPosition);
  first.forEach((result) => {
    assert.ok(Number.isFinite(result.touchesPerThousandFrames));
    assert.equal(result.evaderStrategies.evadeOnSight, true);
  });
});

test("programmatic chaser holds position when search is disabled and no informed strategy is active", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.strategies.search = false;
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
  assert.equal(state.lastStep.chaserAction?.chosenStrategy, "none");
  assert.equal(state.lastStep.chaserAction?.forward, false);
  assert.equal(state.lastStep.chaserAction?.steering, 0);
  assert.deepEqual(state.chaserPosition, startPosition);
});

test("programmatic chaser holds position when all chaser peer strategies are disabled", () => {
  const scenario = buildScenario((draft) => {
    draft.runtime.programmaticChaserEnabled = true;
    draft.actors.chaser.strategies.evaderPredictionPursuit = false;
    draft.actors.chaser.strategies.lineOfSightPursuit = false;
    draft.actors.chaser.strategies.search = false;
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

  assert.equal(state.lastStep.chaserAction?.chosenStrategy, "none");
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
    trace.frames.at(-1)?.chaserReasoning?.snapshot?.strategies?.evaderPrediction?.sampleSpacingFrames,
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
