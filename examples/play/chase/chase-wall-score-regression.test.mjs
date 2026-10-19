import test from "node:test";
import assert from "node:assert/strict";
import { CAR_BOUND_RADIUS } from "./config/constants.mjs";
import { getChaseScenarioDefinition, getChaseScenarioOptions } from "./scenarios/index.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import { createChaseSimulationState, stepChaseSimulation } from "./simulation/simulation.mjs";
import { buildGameRows } from "./ui/sidebar/game-section.mjs";
import { getGroundBounds, resolveObstacleCollisions } from "./world/world.mjs";

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

test("continuous forward input stops at the front obstacle while simulation keeps advancing", () => {
  const state = createChaseSimulationState({
    scenario: resolveChaseScenario(getChaseScenarioDefinition("chaser-empty-map"), GRID),
    ...GRID,
  });
  const forward = { ...idle, forward: true };
  for (let frame = 0; frame < 200 && !state.runMetrics.wallTouchActive; frame += 1) {
    step(state, forward);
  }
  assert.equal(state.runMetrics.wallTouchActive, true);
  const contactPosition = { ...state.chaserPosition };
  const contactDirection = { ...state.chaserLookDirection };
  const contactFrame = state.frameIndex;
  for (let frame = 0; frame < 180; frame += 1) step(state, forward);
  assert.equal(state.frameIndex, contactFrame + 180);
  assert.deepEqual(state.chaserPosition, contactPosition);
  assert.deepEqual(state.chaserLookDirection, contactDirection);
  assert.equal(state.lastStep.chaserAction.forward, true);
  assert.equal(state.runMetrics.wallTouchCount, 1);
  assert.equal(state.runMetrics.wallTouchFrames, 181);
  step(state, { ...idle, reverse: true });
  assert.equal(state.runMetrics.wallTouchActive, false);
  assert.ok(state.chaserPosition.z > contactPosition.z);
});

for (const rotationRadians of [0, Math.PI / 6, -Math.PI / 4]) {
  test(`oblique impact stops sliding and steering yaw, then permits reverse (${rotationRadians})`, () => {
    const state = freshState();
    const wall = { id: "barrier", x: 0, z: 0, width: 1, depth: 4, rotationRadians };
    state.obstacles = { walls: [wall] };
    const worldVector = ({ x, z }) => ({
      x: x * Math.cos(rotationRadians) + z * Math.sin(rotationRadians),
      z: -x * Math.sin(rotationRadians) + z * Math.cos(rotationRadians),
    });
    const faceX = wall.width / 2 + CAR_BOUND_RADIUS;
    state.chaserPosition = worldVector({ x: faceX + 0.01, z: 0 });
    state.chaserLookDirection = worldVector({ x: -Math.cos(0.3), z: Math.sin(0.3) });
    const forward = { ...idle, source: "ws", forward: true };
    step(state, forward);
    assert.equal(state.runMetrics.wallTouchActive, true);
    const contactPosition = { ...state.chaserPosition };
    const contactDirection = { ...state.chaserLookDirection };
    const localZ = contactPosition.x * Math.sin(rotationRadians)
      + contactPosition.z * Math.cos(rotationRadians);
    assert.ok(Math.abs(localZ - 0.01 * Math.tan(0.3)) < 1e-10);
    for (let frame = 0; frame < 120; frame += 1) {
      step(state, { ...forward, steering: 0.8 });
    }
    assert.ok(Math.hypot(
      state.chaserPosition.x - contactPosition.x,
      state.chaserPosition.z - contactPosition.z,
    ) < 1e-10);
    assert.ok(Math.hypot(
      state.chaserLookDirection.x - contactDirection.x,
      state.chaserLookDirection.z - contactDirection.z,
    ) < 1e-10);
    assert.equal(state.runMetrics.wallTouchCount, 1);
    step(state, { ...idle, source: "ws", reverse: true, steering: 0.8 });
    assert.equal(state.runMetrics.wallTouchActive, false);
    assert.notDeepEqual(state.chaserLookDirection, contactDirection);
  });
}

test("oblique perimeter impact stops both axes and heading under continued throttle", () => {
  const state = freshState();
  state.obstacles = { walls: [] };
  const bounds = getGroundBounds(state.columns, state.rows);
  state.chaserPosition = { x: bounds.minX + 0.01, z: 0 };
  state.chaserLookDirection = { x: -Math.cos(0.3), z: Math.sin(0.3) };
  const forward = { ...idle, source: "ws", forward: true };
  step(state, forward);
  assert.equal(state.chaserPosition.x, bounds.minX);
  assert.ok(Math.abs(state.chaserPosition.z - 0.01 * Math.tan(0.3)) < 1e-10);
  const contactPosition = { ...state.chaserPosition };
  const contactDirection = { ...state.chaserLookDirection };
  for (let frame = 0; frame < 120; frame += 1) step(state, { ...forward, steering: -0.8 });
  assert.deepEqual(state.chaserPosition, contactPosition);
  assert.deepEqual(state.chaserLookDirection, contactDirection);
});

test("a fast step stops at the earliest obstacle regardless of wall ordering", () => {
  const near = { id: "near", x: 1.5, z: 0, width: 0.2, depth: 2 };
  const far = { id: "far", x: 0, z: 0, width: 0.2, depth: 2 };
  for (const walls of [[near, far], [far, near]]) {
    const resolved = resolveObstacleCollisions(
      { x: -3, z: 0.6 }, { x: 3, z: 0 }, GRID.columns, GRID.rows, { walls },
    );
    assert.ok(Math.abs(resolved.x - (1.6 + CAR_BOUND_RADIUS)) < 1e-10);
    assert.ok(Math.abs(resolved.z - (3 - resolved.x) * 0.1) < 1e-10);
  }
});

test("steering on the impact frame turns only for the distance traveled before contact", () => {
  const blocked = freshState();
  const clear = freshState();
  const wall = { id: "barrier", x: 0, z: 0, width: 1, depth: 4 };
  for (const state of [blocked, clear]) {
    state.chaserPosition = { x: 0.5 + CAR_BOUND_RADIUS + 0.01, z: 0 };
    state.chaserLookDirection = { x: -1, z: 0 };
  }
  blocked.obstacles = { walls: [wall] };
  clear.obstacles = { walls: [] };
  const forward = { ...idle, source: "ws", forward: true, steering: 0.8 };
  step(blocked, forward);
  step(clear, forward);
  assert.equal(blocked.runMetrics.wallTouchActive, true);
  assert.ok(Math.abs(blocked.chaserLookDirection.z) > 0);
  assert.ok(Math.abs(blocked.chaserLookDirection.z) < Math.abs(clear.chaserLookDirection.z));
});
