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
import {
  createActorViewImageCapture,
  renderActorViewScene,
} from "./ui/actor-view-controller.mjs";

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

test("front-view image rendering excludes debug projections and restores scene visibility", () => {
  const actorMesh = { visible: true };
  const actorFieldOfView = { visible: true };
  const otherActorFieldOfView = { visible: false };
  const projectionGroup = { visible: true };
  const renderer = {
    render() {
      assert.equal(actorMesh.visible, false);
      assert.equal(actorFieldOfView.visible, false);
      assert.equal(otherActorFieldOfView.visible, false);
      assert.equal(projectionGroup.visible, false);
    },
  };

  renderActorViewScene({
    renderer,
    camera: {},
    scene: {},
    actorMesh,
    actorFieldOfView,
    otherActorFieldOfView,
    excludedObjects: [projectionGroup],
  });

  assert.equal(actorMesh.visible, true);
  assert.equal(actorFieldOfView.visible, true);
  assert.equal(otherActorFieldOfView.visible, false);
  assert.equal(projectionGroup.visible, true);
});

test("front-view captures reuse one WebGL renderer until scene disposal", () => {
  let rendererCount = 0;
  let renderCount = 0;
  let disposeCount = 0;
  let contextLossCount = 0;
  const context = { isContextLost: () => false };
  const captureSession = createActorViewImageCapture({
    createRenderer() {
      rendererCount += 1;
      return {
        domElement: { toDataURL: () => "data:image/png;base64,dGVzdA==" },
        dispose: () => { disposeCount += 1; },
        forceContextLoss: () => { contextLossCount += 1; },
        getContext: () => context,
        render: () => { renderCount += 1; },
        setClearColor() {},
        setPixelRatio() {},
        setSize() {},
      };
    },
    createCamera() {
      return {
        position: { set() {} },
        lookAt() {},
        updateProjectionMatrix() {},
      };
    },
  });
  const captureOptions = {
    scene: {},
    actorMesh: { visible: true },
    actorFieldOfView: { visible: true },
    actorPosition: { x: 0, z: 0 },
    actorLookDirection: { x: 1, z: 0 },
    fieldOfViewAngleRadians: Math.PI / 3,
  };

  captureSession.capture(captureOptions);
  captureSession.capture(captureOptions);

  assert.equal(rendererCount, 1);
  assert.equal(renderCount, 2);
  assert.equal(disposeCount, 0);
  assert.equal(contextLossCount, 0);

  captureSession.dispose();
  assert.equal(disposeCount, 1);
  assert.equal(contextLossCount, 1);
});

test("RC indoor captures reuse one sensor pipeline and retain resolved settings", () => {
  let pipelineCount = 0;
  let pipelineRenderCount = 0;
  let pipelineDisposeCount = 0;
  const captureSession = createActorViewImageCapture({
    createRenderer: () => ({
      domElement: { toDataURL: () => "data:image/png;base64,dGVzdA==" },
      dispose() {},
      forceContextLoss() {},
      getContext: () => ({ isContextLost: () => false }),
      render() {},
      setClearColor() {},
      setPixelRatio() {},
      setSize() {},
    }),
    createCamera: () => ({
      position: { set() {} },
      lookAt() {},
      updateProjectionMatrix() {},
    }),
    createSensorPipeline: () => {
      pipelineCount += 1;
      return {
        render() { pipelineRenderCount += 1; },
        dispose() { pipelineDisposeCount += 1; },
      };
    },
  });
  const renderingProfile = {
    ...structuredClone(BASE_SCENARIO.rendering),
    sensor: {
      imageProcessing: "radial-vignette",
      barrelDistortion: 0.12,
      vignette: 0.1,
    },
  };
  const captureOptions = {
    scene: {},
    actorMesh: { visible: true },
    actorFieldOfView: { visible: true },
    actorPosition: { x: 0, z: 0 },
    actorLookDirection: { x: 1, z: 0 },
    fieldOfViewAngleRadians: Math.PI / 3,
    renderingProfile,
  };

  const first = captureSession.capture(captureOptions);
  const second = captureSession.capture(captureOptions);

  assert.equal(first.sensor.imageProcessing, "radial-vignette");
  assert.deepEqual(first.sensor, second.sensor);
  assert.equal(pipelineCount, 1);
  assert.equal(pipelineRenderCount, 2);
  captureSession.dispose();
  assert.equal(pipelineDisposeCount, 1);
});
