import test from "node:test";
import assert from "node:assert/strict";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import {
  createChaseSimulationState,
  stepChaseSimulation,
} from "./simulation/simulation.mjs";
import {
  getLatestVehicleFrontViewCapture,
} from "./decision-model/memory/vehicle/front-view-captures.ts";
import {
  renderVehicleFrontViewCaptureSvg,
} from "./ui/rendering/front-view-capture-svg.ts";
import {
  buildManualFrontViewSnapshot,
} from "./ui/front-view-snapshot.ts";

const GRID = Object.freeze({ columns: 9, rows: 6 });
const BASE_SCENARIO = Object.freeze(resolveChaseScenario(defaultScenarioDefinition, GRID));

function buildManualChaserScenario(mutator) {
  const scenario = structuredClone(BASE_SCENARIO);
  scenario.runtime.programmaticChaserEnabled = false;
  mutator?.(scenario);
  return scenario;
}

function idleInput() {
  return { forward: false, steering: 0 };
}

test("vehicle front-view capture action stores reconstructable memory after commit", () => {
  const scenario = buildManualChaserScenario((draft) => {
    draft.map.obstacles = { walls: [] };
    draft.actors.chaser.position = { x: 0, z: 0 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: 1, z: 0 };
    draft.actors.evader.direction = { x: -1, z: 0 };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  stepChaseSimulation(state, {
    humanInput: { ...idleInput(), captureFrontView: true },
    pauseBeforeActions: true,
  });
  assert.equal(
    getLatestVehicleFrontViewCapture(
      state.chaserIdae.state.memory.directObservation.frontViewCaptures,
    ),
    null,
  );

  stepChaseSimulation(state, { pauseBeforeActions: false });

  const capture = getLatestVehicleFrontViewCapture(
    state.chaserIdae.state.memory.directObservation.frontViewCaptures,
  );
  assert.ok(capture, "expected chaser front-view capture memory");
  assert.equal(capture.actorId, "chaser");
  assert.equal(capture.frameIndex, 1);
  assert.equal(state.lastStep.frontViewCaptures.chaser, capture);
  assert.equal(capture.visibleActors[0]?.actorId, "evader");
  assert.ok(
    (capture.map.visibleArea?.observationCount ?? 0) > 0,
    "expected capture to retain visible map area facts",
  );

  const svg = renderVehicleFrontViewCaptureSvg(capture, { width: 320, height: 240 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /actor=chaser/);
  assert.match(svg, /evader/);
});

test("manual front-view snapshot renders without storing referenceable actor memory", () => {
  const scenario = buildManualChaserScenario((draft) => {
    draft.map.obstacles = { walls: [] };
    draft.actors.chaser.position = { x: 0, z: 0 };
    draft.actors.chaser.direction = { x: 1, z: 0 };
    draft.actors.evader.position = { x: 1, z: 0 };
    draft.actors.evader.direction = { x: -1, z: 0 };
  });
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });

  const snapshot = buildManualFrontViewSnapshot(state, {
    actorId: "chaser",
    width: 320,
    height: 240,
    renderedImage: {
      contentType: "image/png",
      rendererId: "test-renderer",
      width: 320,
      height: 240,
      dataUrl: "data:image/png;base64,dGVzdA==",
    },
  });

  assert.equal(snapshot.referenceable, false);
  assert.equal(snapshot.persistence.storedInActorMemory, false);
  assert.equal(snapshot.persistence.memoryPath, null);
  assert.equal(snapshot.record.actorId, "chaser");
  assert.equal(snapshot.record.image.contentType, "image/png");
  assert.equal(snapshot.record.image.rendererId, "test-renderer");
  assert.equal(snapshot.image.dataUrl, "data:image/png;base64,dGVzdA==");
  assert.equal(
    getLatestVehicleFrontViewCapture(
      state.chaserIdae.state.memory.directObservation.frontViewCaptures,
    ),
    null,
  );
});
