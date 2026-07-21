import test from "node:test";
import assert from "node:assert/strict";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import { createChaseSimulationState } from "./simulation/simulation.mjs";
import { buildManualFrontViewSnapshot } from "./ui/front-view-snapshot.ts";
import {
  buildAtomicEvaluationCapture,
  buildAtomicEvaluationCaptureFromSnapshot,
  createAtomicEvaluationCaptureSource,
} from "./evaluation/atomic-capture.ts";
import { createChaseSimulationEpochOwner } from "./evaluation/runtime-identity.mjs";

const GRID = Object.freeze({ columns: 9, rows: 6 });
const BASE_SCENARIO = Object.freeze(resolveChaseScenario(defaultScenarioDefinition, GRID));

function createSnapshot() {
  const scenario = structuredClone(BASE_SCENARIO);
  scenario.runtime.programmaticChaserEnabled = false;
  scenario.map.obstacles = { walls: [] };
  scenario.actors.chaser.position = { x: 0, z: 0 };
  scenario.actors.chaser.direction = { x: 1, z: 0 };
  scenario.actors.evader.position = { x: 1, z: 0 };
  scenario.actors.evader.direction = { x: -1, z: 0 };
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
      rendererId: "atomic-evaluation-test",
      width: 320,
      height: 240,
      dataUrl: "data:image/png;base64,dGVzdA==",
    },
  });
  return { state, snapshot };
}

test("atomic evaluation capture keeps camera and evaluator data on one frozen frame", () => {
  const { state, snapshot } = createSnapshot();
  const frameIndexBeforeCapture = state.frameIndex;
  const response = buildAtomicEvaluationCaptureFromSnapshot(snapshot, {
    simulationEpoch: "test-run-1",
  });

  assert.equal(response.captureId, "chase:evaluation:test-run-1:chaser:0");
  assert.deepEqual(response.frameIdentity, {
    gameId: "chase",
    simulationEpoch: "test-run-1",
    frameIndex: snapshot.frameIndex,
  });
  assert.equal(response.frameIdentity.frameIndex, snapshot.record.frameIndex);
  assert.deepEqual(response.playback, { advanced: false });
  assert.equal(state.frameIndex, frameIndexBeforeCapture, "capture must not advance playback");
  assert.deepEqual(response.sensor, {
    image: {
      contentType: "image/png",
      rendererId: "atomic-evaluation-test",
      width: 320,
      height: 240,
      dataUrl: "data:image/png;base64,dGVzdA==",
    },
  });
  assert.deepEqual(response.evaluator, {
    classification: "non-sensor",
    shadow: {
      kind: "visible-observation-summary",
      visibleActorCount: 1,
      visibleWallCount: 0,
      visibleAreaCellCount: snapshot.record.map.visibleArea.cells.length,
      observationCount: snapshot.record.map.observationCount,
    },
  });
});

test("atomic evaluation source discards mutable geometry before public serialization", () => {
  const { snapshot } = createSnapshot();
  const runContext = { simulationEpoch: "test-run-1" };
  const source = createAtomicEvaluationCaptureSource(snapshot, runContext);
  runContext.simulationEpoch = "mutated-run";
  snapshot.image.dataUrl = "data:image/png;base64,bXV0YXRlZA==";
  snapshot.record.visibleActors[0].position.x = 999;
  snapshot.record.map.visibleArea.cells.length = 0;

  const response = buildAtomicEvaluationCapture(source);
  assert.equal(response.frameIdentity.simulationEpoch, "test-run-1");
  assert.equal(response.sensor.image.dataUrl, "data:image/png;base64,dGVzdA==");
  assert.equal(response.evaluator.shadow.visibleActorCount, 1);
  assert.ok(response.evaluator.shadow.visibleAreaCellCount > 0);
  assert.deepEqual(Object.keys(response.evaluator.shadow), [
    "kind",
    "visibleActorCount",
    "visibleWallCount",
    "visibleAreaCellCount",
    "observationCount",
  ]);
  assert.deepEqual(Object.keys(response.sensor), ["image"]);
  assert.equal("record" in response, false);
  assert.equal("map" in response.sensor, false);
  assert.equal("position" in response.sensor, false);
  assert.equal("obstacles" in response.sensor, false);
});

test("atomic evaluation capture rejects a snapshot whose frame identity drifts", () => {
  const { snapshot } = createSnapshot();
  snapshot.record.frameIndex += 1;

  assert.throws(
    () => createAtomicEvaluationCaptureSource(snapshot, {
      simulationEpoch: "test-run-1",
    }),
    /identity does not match/i,
  );
});

test("atomic evaluation frame identity remains distinct across simulation resets", () => {
  const first = buildAtomicEvaluationCaptureFromSnapshot(
    createSnapshot().snapshot,
    { simulationEpoch: "run-before-reset" },
  );
  const second = buildAtomicEvaluationCaptureFromSnapshot(
    createSnapshot().snapshot,
    { simulationEpoch: "run-after-reset" },
  );

  assert.equal(first.frameIdentity.frameIndex, 0);
  assert.equal(second.frameIdentity.frameIndex, 0);
  assert.notEqual(first.captureId, second.captureId);
  assert.notDeepEqual(first.frameIdentity, second.frameIdentity);
});

test("Chase runtime identity advances its epoch for each simulation run", () => {
  const epochs = ["run-initial", "run-after-reset", "run-after-load"];
  const owner = createChaseSimulationEpochOwner({
    generateEpoch: () => epochs.shift(),
  });

  assert.equal(owner.current(), "run-initial");
  assert.equal(owner.beginRun(), "run-after-reset");
  assert.equal(owner.current(), "run-after-reset");
  assert.equal(owner.beginRun(), "run-after-load");
  assert.equal(owner.current(), "run-after-load");
});
