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
import { buildActorControlReference } from "./evaluation/actor-control-reference.ts";
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
  snapshot.evaluatorReference = buildActorControlReference(state, snapshot.actorId);
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
    reference: {
      kind: "actor-control-reference",
      scenarioId: "default",
      controlSource: "keyboard",
      phase: "initial",
      actionFrameIndex: 0,
      input: {
        source: "human",
        forward: false,
        reverse: false,
        steering: 0,
      },
      action: {
        source: "human",
        forward: false,
        reverse: false,
        steering: 0,
        selectedActionProposalId: null,
      },
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
  snapshot.evaluatorReference.controlSource = "mutated";
  snapshot.evaluatorReference.action.steering = 1;

  const response = buildAtomicEvaluationCapture(source);
  assert.equal(response.frameIdentity.simulationEpoch, "test-run-1");
  assert.equal(response.sensor.image.dataUrl, "data:image/png;base64,dGVzdA==");
  assert.equal(response.evaluator.shadow.visibleActorCount, 1);
  assert.ok(response.evaluator.shadow.visibleAreaCellCount > 0);
  assert.equal(response.evaluator.reference.controlSource, "keyboard");
  assert.equal(response.evaluator.reference.action.steering, 0);
  assert.deepEqual(Object.keys(response.evaluator.shadow), [
    "kind",
    "visibleActorCount",
    "visibleWallCount",
    "visibleAreaCellCount",
    "observationCount",
  ]);
  assert.deepEqual(Object.keys(response.sensor), ["image"]);
  assert.deepEqual(Object.keys(response.evaluator.reference), [
    "kind",
    "scenarioId",
    "controlSource",
    "phase",
    "actionFrameIndex",
    "input",
    "action",
  ]);
  assert.equal("record" in response, false);
  assert.equal("map" in response.sensor, false);
  assert.equal("position" in response.sensor, false);
  assert.equal("obstacles" in response.sensor, false);
  assert.equal("world" in response.evaluator.reference, false);
  assert.equal("position" in response.evaluator.reference, false);
  assert.equal("actionProposals" in response.evaluator.reference.action, false);
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

test("atomic evaluation capture rejects a control reference from a future frame", () => {
  const { snapshot } = createSnapshot();
  snapshot.evaluatorReference.actionFrameIndex = 1;

  assert.throws(
    () => createAtomicEvaluationCaptureSource(snapshot, {
      simulationEpoch: "test-run-1",
    }),
    /future frame/i,
  );
});

test("bounded control reference reports runtime authority without geometry", () => {
  const scenario = structuredClone(BASE_SCENARIO);
  scenario.runtime.chaserControlSource = "ws";
  scenario.runtime.programmaticChaserEnabled = false;
  const state = createChaseSimulationState({
    scenario,
    columns: GRID.columns,
    rows: GRID.rows,
  });
  const reference = buildActorControlReference(state, "chaser");

  assert.equal(reference.scenarioId, "default");
  assert.equal(reference.controlSource, "ws");
  assert.equal(reference.input.source, "human");
  assert.equal(reference.action.source, "human");
  assert.deepEqual(Object.keys(reference), [
    "kind",
    "scenarioId",
    "controlSource",
    "phase",
    "actionFrameIndex",
    "input",
    "action",
  ]);
  assert.equal("scenario" in reference, false);
  assert.equal("position" in reference, false);
  assert.equal("obstacles" in reference, false);
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
