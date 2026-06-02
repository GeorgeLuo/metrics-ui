import test from "node:test";
import assert from "node:assert/strict";
import {
  CHASER_ACTION_PATH_VIEW_MODES,
  EVADER_EXISTS_ACTION_ID,
  SCENARIO_SELECT_ACTION_ID,
} from "./config/constants.mjs";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "./scenarios/index.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import {
  createChaseSimulationState,
  stepChaseSimulation,
} from "./simulation/simulation.mjs";
import { getWallBounds } from "./world/world.mjs";
import { publishSidebarSections } from "./ui/sidebar.mjs";
import { getChaserActionPathDebugEntries } from "./ui/rendering.mjs";
import { createScenarioDefinitionWithEvaderOverride } from "./ui/runtime.mjs";

const GRID = Object.freeze({ columns: 9, rows: 6 });

function roundNumber(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function idleInput() {
  return { forward: false, steering: 0 };
}

test("scenario config can omit the evader without debug hardcoding", () => {
  const scenario = resolveChaseScenario(getChaseScenarioDefinition("no-evader"), GRID);
  assert.equal(scenario.actors.evader.exists, false);
  assert.equal(scenario.actors.evader.position, null);
  assert.equal(scenario.actors.evader.direction, null);

  const state = createChaseSimulationState({ scenario, columns: GRID.columns, rows: GRID.rows });
  assert.equal(state.evaderExists, false);
  assert.equal(state.evaderPosition, null);
  assert.equal(state.evaderDirection, null);
  assert.equal(state.evaderIdae, null);

  for (let frame = 0; frame < 20; frame += 1) {
    stepChaseSimulation(state, { humanInput: idleInput() });
  }

  const chaserSnapshot = state.lastStep.chaserReasoning?.snapshot;
  const evaderMotionProjection = chaserSnapshot?.projections?.evaderMotion;
  assert.equal(state.frameIndex, 20);
  assert.equal(state.lastStep.evaderReasoning, null);
  assert.equal(state.lastStep.evaderMovementDecision, null);
  assert.equal(state.runMetrics.touchCount, 0);
  assert.equal(state.lastStep.chaserReasoning?.observation?.absent, true);
  assert.equal(evaderMotionProjection?.actionable, false);
  assert.equal(evaderMotionProjection?.invalidReason, "target-absent");
  assert.equal(chaserSnapshot?.projectionStatus?.evaderMotion?.actionable, false);
  assert.equal(chaserSnapshot?.patterns?.evaderMotionModel, null);
  assert.equal(chaserSnapshot?.patterns?.continuance, null);
  assert.equal(chaserSnapshot?.patterns?.wallAvoidance, null);
  assert.deepEqual(chaserSnapshot?.patternUnits, {});
  assert.equal(state.lastStep.chaserAction?.selectedActionProposalId, "mapDiscovery+spin");
  assert.equal(
    state.lastStep.chaserAction?.actionProposals?.motiveSignal?.id,
    "knowledgeAcquisition",
  );
  assert.equal(state.lastStep.chaserAction?.actionProposals?.mapDiscovery?.active, true);
  assert.notEqual(
    state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition?.selectedCandidateId,
    null,
  );
  assert.ok(
    (state.lastStep.chaserAction?.actionProposals?.knowledgeAcquisition?.candidates?.length ?? 0) > 0,
    "expected knowledge acquisition to expose scored map-memory candidates",
  );
  assert.deepEqual(
    getChaserActionPathDebugEntries(
      state.lastStep.chaserAction,
      CHASER_ACTION_PATH_VIEW_MODES.MAP_DISCOVERY,
      { horizonFrames: 18, sampleSpacingFrames: 6 },
    ).map((entry) => entry.sourceId),
    [CHASER_ACTION_PATH_VIEW_MODES.MAP_DISCOVERY],
  );
  assert.equal(state.lastStep.chaserAction?.forward, true);
});

test("runtime evader existence override supersedes scenario config", () => {
  const forcedAbsent = resolveChaseScenario(
    createScenarioDefinitionWithEvaderOverride(defaultScenarioDefinition, false),
    GRID,
  );
  assert.equal(forcedAbsent.actors.evader.exists, false);
  assert.equal(forcedAbsent.actors.evader.position, null);
  assert.equal(forcedAbsent.actors.evader.direction, null);

  const forcedPresent = resolveChaseScenario(
    createScenarioDefinitionWithEvaderOverride(getChaseScenarioDefinition("no-evader"), true),
    GRID,
  );
  assert.equal(forcedPresent.actors.evader.exists, true);
  assert.deepEqual(forcedPresent.actors.evader.position, { x: GRID.columns / 4, z: 0 });
  assert.equal(roundNumber(forcedPresent.actors.evader.direction.x), -0.9285);
  assert.equal(roundNumber(forcedPresent.actors.evader.direction.z), 0.3714);
});

test("chase sidebar exposes scenario selector and evader existence override", () => {
  const scenario = resolveChaseScenario(defaultScenarioDefinition, GRID);
  const state = createChaseSimulationState({ scenario, columns: GRID.columns, rows: GRID.rows });
  let sections = [];
  publishSidebarSections(
    (nextSections) => {
      sections = nextSections;
    },
    state.programmaticChaserEnabled,
    { chaserViewVisible: false, evaderViewVisible: false, idaeDebugVisible: false },
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

  const gameSection = sections.find((section) => section.id === "game");
  const gameRows = gameSection?.rows ?? [];
  const scenarioSelect = gameRows.find((row) => row.id === SCENARIO_SELECT_ACTION_ID);
  const evaderExistsToggle = gameRows.find((row) => row.id === EVADER_EXISTS_ACTION_ID);
  const scoreHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Score",
  );
  const scenarioHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Scenario",
  );
  const simulationHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Simulation",
  );
  const controlsHeaderIndex = gameRows.findIndex(
    (row) => row.kind === "header" && row.label === "Controls",
  );
  assert.equal(scoreHeaderIndex, 0);
  assert.equal(scenarioHeaderIndex > scoreHeaderIndex, true);
  assert.equal(simulationHeaderIndex > scenarioHeaderIndex, true);
  assert.equal(controlsHeaderIndex, -1);
  assert.equal(
    gameRows.filter((row) => row.kind === "header").at(-1)?.label,
    "Simulation",
  );
  assert.equal(gameSection?.title, "Game");
  assert.equal(sections[0]?.id, "game");
  assert.equal(sections.some((section) => section.id === "settings"), false);
  assert.equal(sections.some((section) => section.id === "score"), false);
  assert.equal(scenarioSelect?.kind, "select");
  assert.equal(scenarioSelect?.value, DEFAULT_CHASE_SCENARIO_ID);
  assert.equal(evaderExistsToggle?.kind, "toggle");
  assert.equal(evaderExistsToggle?.enabled, true);
  assert.equal(evaderExistsToggle?.enabledLabel, "present");
  assert.equal(evaderExistsToggle?.disabledLabel, "absent");
  assert.ok(
    scenarioSelect?.options?.some((option) => option.value === "no-evader"),
    "expected sidebar scenario selector to include the no-evader scenario",
  );
  assert.ok(
    scenarioSelect?.options?.some((option) => option.value === "open-room"),
    "expected sidebar scenario selector to include the open-room scenario",
  );
  assert.ok(
    scenarioSelect?.options?.some((option) => option.value === "large-open-room"),
    "expected sidebar scenario selector to include the large-open-room scenario",
  );
  assert.ok(
    scenarioSelect?.options?.some((option) => option.value === "two-rooms"),
    "expected sidebar scenario selector to include the two-rooms scenario",
  );
});

test("open-room scenario resolves to an empty obstacle list", () => {
  const scenario = resolveChaseScenario(getChaseScenarioDefinition("open-room"), GRID);
  assert.equal(scenario.id, "open-room");
  assert.equal(scenario.map.layout, "open-room");
  assert.deepEqual(scenario.map.obstacles, { walls: [] });
  assert.deepEqual(scenario.actors.chaser.position, defaultScenarioDefinition.actors.chaser.position);
  assert.deepEqual(scenario.actors.evader.position, defaultScenarioDefinition.actors.evader.position);
});

test("large-open-room scenario resolves to a larger empty obstacle list", () => {
  const scenario = resolveChaseScenario(getChaseScenarioDefinition("large-open-room"), GRID);
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  assert.equal(scenario.id, "large-open-room");
  assert.equal(scenario.map.layout, "large-open-room");
  assert.equal(scenario.map.columns, 13.5);
  assert.equal(scenario.map.rows, 9);
  assert.deepEqual(scenario.map.obstacles, { walls: [] });
  assert.equal(state.columns, 13.5);
  assert.equal(state.rows, 9);
  assert.equal(scenario.actors.chaser.position.x, -5.13);
  assert.equal(scenario.actors.evader.position.x, 3.375);
});

test("two-rooms scenario resolves to a vertical divider with a doorway gap", () => {
  const scenario = resolveChaseScenario(getChaseScenarioDefinition("two-rooms"), GRID);
  const bottomDivider = scenario.map.obstacles.walls.find(
    (wall) => wall.id === "center-divider-bottom",
  );
  const topDivider = scenario.map.obstacles.walls.find(
    (wall) => wall.id === "center-divider-top",
  );
  assert.equal(scenario.id, "two-rooms");
  assert.equal(scenario.map.layout, "two-rooms-vertical-divider-gap");
  assert.ok(bottomDivider, "expected bottom divider obstacle");
  assert.ok(topDivider, "expected top divider obstacle");
  assert.equal(bottomDivider.x, 0);
  assert.equal(topDivider.x, 0);
  assert.equal(bottomDivider.width, 0.35);
  assert.equal(topDivider.width, 0.35);

  const bottomBounds = getWallBounds(bottomDivider);
  const topBounds = getWallBounds(topDivider);
  assert.equal(bottomBounds.minZ, -GRID.rows / 2);
  assert.equal(topBounds.maxZ, GRID.rows / 2);
  assert.equal(bottomBounds.maxZ, -0.75);
  assert.equal(topBounds.minZ, 0.75);
  assert.equal(topBounds.minZ - bottomBounds.maxZ, 1.5);
  assert.equal(scenario.actors.chaser.position.x < bottomBounds.minX, true);
  assert.equal(scenario.actors.evader.position.x > bottomBounds.maxX, true);
});
