import test from "node:test";
import assert from "node:assert/strict";
import { CAR_BOUND_RADIUS } from "./config/constants.mjs";
import { getChaseScenarioDefinition, getChaseScenarioOptions } from "./scenarios/index.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import { createChaseSimulationState, stepChaseSimulation } from "./simulation/simulation.mjs";
import { buildGameRows } from "./ui/sidebar/game-section.mjs";
import { getGroundBounds } from "./world/world.mjs";

const GRID = { columns: 9, rows: 6 };
const idle = { forward: false, reverse: false, steering: 0 };
function freshState() {
  return createChaseSimulationState({
    scenario: resolveChaseScenario(getChaseScenarioDefinition("wall-escape"), GRID),
    ...GRID,
  });
}
function step(state, humanInput = idle) {
  stepChaseSimulation(state, { humanInput });
}

test("wall escape is a fresh WS-controlled walled environment without an evader", () => {
  assert.ok(getChaseScenarioOptions().some(({ value }) => value === "wall-escape"));
  const state = freshState();
  assert.equal(state.chaserControlSource, "ws");
  assert.equal(state.evaderExists, false);
  assert.equal(state.evaderPosition, null);
  assert.equal(state.evaderIdae, null);
  assert.equal(state.obstacles.walls.filter((wall) => wall.boundary).length, 4);
  assert.ok(state.obstacles.walls.some((wall) => wall.id === "center-square"));
  step(state);
  assert.equal(state.runMetrics.wallTouchCount, 0);
  assert.equal(state.runMetrics.wallTouchFrames, 0);
  assert.equal(state.runMetrics.touchCount, 0);
  assert.equal(state.lastStep.evaderMovementDecision, null);
});

test("perimeter contact counts an episode, dwell frames, clearance and recontact separately", () => {
  const state = freshState();
  const bounds = getGroundBounds(state.columns, state.rows);
  state.chaserPosition = { x: bounds.minX + 0.001, z: 0 };
  state.chaserLookDirection = { x: -1, z: 0 };
  step(state, { ...idle, source: "ws", forward: true });
  assert.equal(state.chaserPosition.x, bounds.minX);
  assert.equal(state.runMetrics.wallTouchCount, 1);
  assert.equal(state.runMetrics.wallTouchActive, true);
  step(state);
  assert.equal(state.runMetrics.wallTouchCount, 1);
  assert.equal(state.runMetrics.wallTouchFrames, 2);
  assert.equal(state.runMetrics.wallTouchRatePerThousandFrames, 500);
  // Reverse from the physical contact rather than clearing the score flag.
  step(state, { ...idle, source: "ws", reverse: true });
  assert.equal(state.runMetrics.wallTouchActive, false);
  assert.equal(state.runMetrics.wallTouchFrames, 2);
  step(state, { ...idle, source: "ws", forward: true });
  assert.equal(state.runMetrics.wallTouchCount, 2);
  assert.equal(state.runMetrics.wallTouchFrames, 3);
  assert.equal(state.runMetrics.touchCount, 0);
  assert.equal(freshState().runMetrics.wallTouchCount, 0);
});

test("corners count one episode and invisible field bounds use the same collision limits", () => {
  const state = freshState();
  state.obstacles = { walls: [] };
  const bounds = getGroundBounds(state.columns, state.rows);
  state.chaserPosition = { x: bounds.minX, z: bounds.minZ };
  step(state);
  step(state);
  assert.equal(state.runMetrics.wallTouchCount, 1);
  assert.equal(state.runMetrics.wallTouchFrames, 2);
});

test("rotated obstacle contacts match padded collision geometry and near misses stay clear", () => {
  const state = freshState();
  const wall = { id: "rotated", x: 0, z: 0, width: 1, depth: 1, rotationRadians: Math.PI / 4 };
  state.obstacles = { walls: [wall] };
  const localX = wall.width / 2 + CAR_BOUND_RADIUS;
  const place = (offset) => {
    const x = localX + offset;
    state.chaserPosition = { x: x * Math.cos(wall.rotationRadians), z: -x * Math.sin(wall.rotationRadians) };
  };
  place(0.0001);
  step(state);
  assert.equal(state.runMetrics.wallTouchActive, false);
  place(0);
  step(state);
  assert.equal(state.runMetrics.wallTouchActive, true);
  assert.equal(state.runMetrics.wallTouchCount, 1);
  place(0.0001);
  step(state);
  assert.equal(state.runMetrics.wallTouchActive, false);
});

test("score rows expose wall metrics without changing evader touch values", () => {
  const state = freshState();
  const bounds = getGroundBounds(state.columns, state.rows);
  state.chaserPosition = { x: bounds.maxX, z: 0 };
  step(state);
  const rows = buildGameRows({ runMetrics: state.runMetrics, simulationSettings: { framesPerSecond: 60 } });
  const value = (label) => rows.find((row) => row.label === label)?.value;
  assert.equal(value("Touches"), "0");
  assert.equal(value("Wall touches"), "1");
  assert.equal(value("Wall contact frames"), "1");
  assert.equal(value("Wall contact active"), "yes");
  assert.equal(value("Wall touches / 1k frames"), "1000");
});

test("paused reasoning does not accrue wall score until the pending action commits", () => {
  const state = freshState();
  const bounds = getGroundBounds(state.columns, state.rows);
  state.chaserPosition = { x: bounds.minX, z: 0 };
  stepChaseSimulation(state, { humanInput: idle, pauseBeforeActions: true });
  stepChaseSimulation(state, { humanInput: idle, pauseBeforeActions: true });
  assert.equal(state.runMetrics.elapsedFrames, 0);
  assert.equal(state.runMetrics.wallTouchFrames, 0);
  assert.equal(state.runMetrics.wallTouchCount, 0);
  stepChaseSimulation(state, { pauseBeforeActions: false });
  assert.equal(state.runMetrics.elapsedFrames, 1);
  assert.equal(state.runMetrics.wallTouchFrames, 1);
  assert.equal(state.runMetrics.wallTouchCount, 1);
});
