import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import {
  RENDERING_PROFILE_ACTION_ID,
  RENDERING_SEED_ACTION_ID,
} from "./config/constants.mjs";
import {
  CHASE_RENDERING_PROFILE_OPTIONS,
  SIMULATION_RENDERING_PROFILE,
  resolveChaseRenderingProfile,
} from "./rendering/profiles.ts";
import { CHASE_RENDERING_PROFILE_IDS } from "./rendering/profile-contract.ts";
import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import { createChaseSimulationState } from "./simulation/simulation.mjs";
import { createActorViewImageCapture } from "./ui/actor-view-controller.mjs";
import { buildManualFrontViewSnapshot } from "./ui/front-view-snapshot.ts";
import {
  applyRenderingEnvironment,
  createSceneLighting,
} from "./ui/rendering/environment.mjs";
import { createTexturedFloor } from "./ui/rendering/floor.mjs";
import {
  createWall,
  disposeObject3D,
  getWallMaterialOptions,
} from "./ui/rendering/world-objects.mjs";
import {
  configureChaseActorCamera,
  resolveChaseCamera,
} from "./rendering/camera.ts";
import {
  hasChaseSensorProcessing,
  resolveChaseSensor,
} from "./rendering/sensor.ts";
import { createChaseScenarioSession } from "./ui/scenario-session.mjs";
import { createSidebarActionDescriptors } from "./ui/sidebar-action-descriptors.mjs";
import { publishSidebarSections } from "./ui/sidebar.mjs";

const GRID = Object.freeze({ columns: 9, rows: 6 });

function createCanvasDocumentStub() {
  const canvases = [];
  return {
    canvases,
    document: {
      createElement(tagName) {
        assert.equal(tagName, "canvas");
        const context = {
          beginPath() {},
          fillRect() {},
          lineTo() {},
          moveTo() {},
          stroke() {},
        };
        const canvas = {
          width: 0,
          height: 0,
          getContext: (kind) => kind === "2d" ? context : null,
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
}

test("rendering profiles preserve simulation and resolve distinct RC indoor values", () => {
  const fallback = resolveChaseRenderingProfile({ profile: "unsupported" });
  const rcIndoor = resolveChaseRenderingProfile({ profile: "rc-indoor", seed: 42.4 });
  const randomized = resolveChaseRenderingProfile("randomized");

  assert.equal(fallback, SIMULATION_RENDERING_PROFILE);
  assert.equal(rcIndoor.id, CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  assert.equal(rcIndoor.seed, 42);
  assert.equal(randomized.id, CHASE_RENDERING_PROFILE_IDS.RANDOMIZED);
  assert.equal(randomized.seed, 0);
  assert.equal(Object.isFrozen(rcIndoor), true);
  assert.equal(Object.isFrozen(rcIndoor.environment.materials.floor), true);
  assert.equal(SIMULATION_RENDERING_PROFILE.environment.renderer.toneMapping, "none");
  assert.equal(SIMULATION_RENDERING_PROFILE.environment.renderer.shadows.enabled, false);
  assert.equal(
    SIMULATION_RENDERING_PROFILE.environment.materials.floor.texture,
    "simulation-floor",
  );
  assert.equal(SIMULATION_RENDERING_PROFILE.environment.materials.obstacle.texture, "none");
  assert.equal(rcIndoor.environment.renderer.toneMapping, "aces-filmic");
  assert.equal(rcIndoor.environment.renderer.shadows.enabled, true);
  assert.equal(rcIndoor.environment.materials.floor.texture, "carpet-light");
  assert.equal(rcIndoor.environment.materials.obstacle.texture, "cardboard-kraft");
  assert.equal(
    getWallMaterialOptions({ boundary: false }, rcIndoor.environment.materials),
    rcIndoor.environment.materials.obstacle,
  );
  assert.equal(
    getWallMaterialOptions({ boundary: true }, rcIndoor.environment.materials),
    rcIndoor.environment.materials.roomWall,
  );
  assert.notEqual(
    rcIndoor.environment.materials.roomWall.fallbackColor,
    rcIndoor.environment.materials.obstacle.fallbackColor,
  );
  assert.equal(SIMULATION_RENDERING_PROFILE.camera.projection.source, "perception");
  assert.equal(rcIndoor.camera.projection.source, "profile");
  assert.ok(Math.abs(rcIndoor.camera.projection.verticalFovDegrees - 69.94) < 0.01);
  assert.equal(rcIndoor.camera.mount.height, 0.16);
  assert.notDeepEqual(rcIndoor.camera, SIMULATION_RENDERING_PROFILE.camera);
  assert.deepEqual(SIMULATION_RENDERING_PROFILE.sensor, {
    imageProcessing: "none",
    barrelDistortion: 0,
    vignette: 0,
  });
  assert.deepEqual(resolveChaseSensor(rcIndoor), {
    imageProcessing: "radial-vignette",
    barrelDistortion: 0.12,
    vignette: 0.1,
  });
  assert.equal(hasChaseSensorProcessing(resolveChaseSensor(rcIndoor)), true);
  assert.equal(hasChaseSensorProcessing(resolveChaseSensor(SIMULATION_RENDERING_PROFILE)), false);
});

test("camera resolution preserves simulation perception while RC indoor owns calibration", () => {
  const simulationCamera = resolveChaseCamera(
    SIMULATION_RENDERING_PROFILE,
    { fieldOfViewAngleRadians: Math.PI / 3, fieldOfViewDistance: 18 },
    { width: 640, height: 480 },
  );
  const rcIndoorCamera = resolveChaseCamera(
    resolveChaseRenderingProfile("rc-indoor"),
    { fieldOfViewAngleRadians: 86 * Math.PI / 180, fieldOfViewDistance: 30 },
    { width: 640, height: 480 },
  );

  assert.equal(simulationCamera.projection.source, "perception");
  assert.ok(Math.abs(simulationCamera.projection.verticalFovDegrees - 60) < 0.0001);
  assert.equal(simulationCamera.projection.far, 18);
  assert.equal(rcIndoorCamera.projection.source, "profile");
  assert.ok(Math.abs(rcIndoorCamera.projection.verticalFovDegrees - 69.94) < 0.01);
  assert.ok(Math.abs(rcIndoorCamera.projection.horizontalFovDegrees - 86) < 0.01);
  assert.equal(rcIndoorCamera.projection.near, 0.04);
  assert.equal(rcIndoorCamera.projection.far, 14);
  assert.deepEqual(
    [rcIndoorCamera.projection.imageWidth, rcIndoorCamera.projection.imageHeight],
    [640, 480],
  );
});

test("randomized rendering resolves reproducible bounded RC indoor variation", () => {
  const first = resolveChaseRenderingProfile({ profile: "randomized", seed: 91 });
  const repeat = resolveChaseRenderingProfile({ profile: "randomized", seed: 91 });
  const differentSeed = resolveChaseRenderingProfile({ profile: "randomized", seed: 92 });
  const rcIndoor = resolveChaseRenderingProfile("rc-indoor");

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.environment.renderer.exposure, differentSeed.environment.renderer.exposure);
  assert.equal(first.id, CHASE_RENDERING_PROFILE_IDS.RANDOMIZED);
  assert.equal(first.seed, 91);
  assert.deepEqual(first.camera, rcIndoor.camera);
  assert.ok(first.environment.renderer.exposure >= 1.05);
  assert.ok(first.environment.renderer.exposure <= 1.25);
  assert.ok(first.environment.ambientLight.intensity >= 0.78);
  assert.ok(first.environment.ambientLight.intensity <= 1.02);
  assert.ok(first.environment.keyLight.intensity >= 2.15);
  assert.ok(first.environment.keyLight.intensity <= 2.65);
  assert.ok(first.environment.materials.floor.roughness >= 0.94);
  assert.ok(first.environment.materials.floor.roughness <= 0.995);
  assert.ok(first.environment.materials.obstacle.roughness >= 0.82);
  assert.ok(first.environment.materials.obstacle.roughness <= 0.94);
  assert.ok(first.sensor.barrelDistortion >= 0.08);
  assert.ok(first.sensor.barrelDistortion <= 0.16);
  assert.ok(first.sensor.vignette >= 0.06);
  assert.ok(first.sensor.vignette <= 0.14);
});

test("scenario session retains a rendering override across reset and clears it on load", () => {
  const session = createChaseScenarioSession(GRID);
  const initial = session.buildScenario();
  assert.equal(initial.rendering.id, CHASE_RENDERING_PROFILE_IDS.SIMULATION);

  const selected = session.setRenderingProfile(CHASE_RENDERING_PROFILE_IDS.RANDOMIZED);
  assert.equal(selected.rendering.id, CHASE_RENDERING_PROFILE_IDS.RANDOMIZED);
  const seeded = session.setRenderingSeed(2468);
  assert.equal(seeded.rendering.seed, 2468);
  assert.equal(seeded.rendering.environment.renderer.toneMapping, "aces-filmic");
  assert.equal(session.buildScenario().rendering.id, CHASE_RENDERING_PROFILE_IDS.RANDOMIZED);
  assert.equal(session.buildScenario().rendering.seed, 2468);

  const piracer = session.loadScenario("piracer-room-sketch");
  assert.equal(piracer.rendering.id, CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  const controls = session.getSidebarControls(createChaseSimulationState({
    scenario: piracer,
    ...GRID,
  }));
  assert.equal(controls.renderingProfileId, CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  assert.equal(controls.renderingSeed, 0);
  assert.deepEqual(controls.renderingProfileOptions, CHASE_RENDERING_PROFILE_OPTIONS);
});

test("simulation state and manual snapshots expose the resolved rendering profile", () => {
  const scenario = resolveChaseScenario({
    ...defaultScenarioDefinition,
    rendering: { profile: "rc-indoor", seed: 17 },
  }, GRID);
  const state = createChaseSimulationState({ scenario, ...GRID });
  const snapshot = buildManualFrontViewSnapshot(state, {
    renderedImage: {
      contentType: "image/png",
      rendererId: "test-renderer",
      width: 320,
      height: 240,
      dataUrl: "data:image/png;base64,dGVzdA==",
    },
  });

  assert.equal(state.renderingProfile, scenario.rendering);
  assert.equal(snapshot.renderingProfile.id, CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  assert.equal(snapshot.renderingProfile.seed, 17);
  assert.equal(snapshot.camera.projection.source, "profile");
  assert.ok(Math.abs(snapshot.camera.projection.verticalFovDegrees - 69.94) < 0.01);
  assert.ok(Math.abs(snapshot.camera.projection.horizontalFovDegrees - 86) < 0.01);
  assert.deepEqual(snapshot.sensor, {
    imageProcessing: "radial-vignette",
    barrelDistortion: 0.12,
    vignette: 0.1,
  });
});

test("environment, materials, and camera consume resolved profile values", () => {
  const profile = structuredClone(SIMULATION_RENDERING_PROFILE);
  profile.environment.clear = { color: 0x123456, alpha: 0.4 };
  profile.environment.ambientLight = { color: 0x223344, intensity: 0.7 };
  profile.environment.keyLight = {
    color: 0x556677,
    intensity: 0.9,
    position: { x: 1, y: 2, z: 3 },
    target: { x: 0.5, y: 0, z: -0.5 },
  };
  profile.environment.renderer = {
    toneMapping: "aces-filmic",
    exposure: 1.3,
    shadows: {
      enabled: true,
      mapSize: 512,
      bias: -0.001,
      normalBias: 0.02,
      radius: 3,
      cameraPadding: 2,
      cameraFar: 20,
    },
  };
  profile.environment.materials.floor = {
    color: 0x112233,
    fallbackColor: 0x334455,
    roughness: 0.4,
    metalness: 0.1,
  };
  profile.environment.materials.obstacle = {
    ...profile.environment.materials.obstacle,
    color: 0x445566,
    fallbackColor: 0x445566,
    roughness: 0.5,
    metalness: 0.2,
    edgeColor: 0x778899,
    edgeOpacity: 0.6,
  };
  profile.camera.mount = {
    height: 1.25,
    pitchDownRadians: Math.atan(0.5 / 2.5),
    yawRadians: Math.PI / 2,
    lookDistance: 2.5,
  };

  let clearColor = null;
  const renderer = {
    shadowMap: { enabled: false, type: null, needsUpdate: false },
    setClearColor: (...values) => { clearColor = values; },
  };
  const lighting = createSceneLighting();
  applyRenderingEnvironment({
    renderer,
    lighting,
    columns: 9,
    rows: 6,
  }, profile);
  assert.deepEqual(clearColor, [0x123456, 0.4]);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.toneMappingExposure, 1.3);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.equal(renderer.shadowMap.type, THREE.PCFSoftShadowMap);
  assert.equal(lighting.ambientLight.color.getHex(), 0x223344);
  assert.equal(lighting.ambientLight.intensity, 0.7);
  assert.deepEqual(lighting.keyLight.position.toArray(), [1, 2, 3]);
  assert.deepEqual(lighting.keyLightTarget.position.toArray(), [0.5, 0, -0.5]);
  assert.equal(lighting.keyLight.castShadow, true);
  assert.equal(lighting.keyLight.shadow.mapSize.x, 512);
  assert.equal(lighting.keyLight.shadow.camera.left, -6.5);
  assert.equal(lighting.keyLight.shadow.camera.right, 6.5);

  const floor = createTexturedFloor(9, 6, profile.environment.materials.floor);
  const wall = createWall(
    { width: 1, depth: 1, x: 0, z: 0, rotationRadians: 0 },
    profile.environment.materials.obstacle,
  );
  assert.equal(floor.material.color.getHex(), 0x334455);
  assert.equal(floor.material.roughness, 0.4);
  assert.equal(wall.material.color.getHex(), 0x445566);
  assert.equal(wall.children[0].material.color.getHex(), 0x778899);
  assert.equal(wall.castShadow, true);
  assert.equal(wall.receiveShadow, true);

  const cameraCalls = { position: null, lookAt: null };
  configureChaseActorCamera({
    position: { set: (...values) => { cameraCalls.position = values; } },
    lookAt: (...values) => { cameraCalls.lookAt = values; },
  }, { x: 4, z: 5 }, { x: 1, z: 0 }, profile.camera.mount);
  assert.deepEqual(cameraCalls.position, [4, 1.25, 5]);
  assert.deepEqual(cameraCalls.lookAt, [4, 0.75, 2.5]);

  disposeObject3D(floor);
  disposeObject3D(wall);
});

test("RC indoor materials generate deterministic carpet and cardboard textures", () => {
  const priorDocument = globalThis.document;
  const stub = createCanvasDocumentStub();
  globalThis.document = stub.document;
  const profile = resolveChaseRenderingProfile("rc-indoor");
  let floor = null;
  let obstacle = null;
  let roomWall = null;
  try {
    floor = createTexturedFloor(7.8, 6.2, profile.environment.materials.floor);
    obstacle = createWall(
      { width: 1.4, height: 0.8, depth: 0.9, x: 0, z: 0, rotationRadians: 0 },
      profile.environment.materials.obstacle,
    );
    roomWall = createWall(
      { width: 7.8, height: 2.4, depth: 0.18, x: 0, z: 0, rotationRadians: 0 },
      profile.environment.materials.roomWall,
    );

    assert.equal(stub.canvases.length, 2);
    assert.equal(floor.material.map.name, "chase-carpet-light");
    assert.equal(floor.material.map.repeat.x, 7.8 / 1.25);
    assert.equal(obstacle.material.map.name, "chase-cardboard-kraft");
    assert.equal(obstacle.material.map.repeat.x, 1.4 / 0.8);
    assert.equal(roomWall.material.map, null);
    assert.equal(roomWall.material.color.getHex(), 0xf3f0e8);
  } finally {
    disposeObject3D(floor);
    disposeObject3D(obstacle);
    disposeObject3D(roomWall);
    if (typeof priorDocument === "undefined") {
      delete globalThis.document;
    } else {
      globalThis.document = priorDocument;
    }
  }
});

test("offscreen actor capture consumes profile clear color and camera mount", () => {
  const profile = structuredClone(SIMULATION_RENDERING_PROFILE);
  profile.environment.clear = { color: 0xabcdef, alpha: 0.25 };
  profile.camera.mount = {
    height: 1.1,
    pitchDownRadians: Math.atan(0.2 / 2),
    yawRadians: 0,
    lookDistance: 2,
  };
  profile.camera.projection = {
    source: "profile",
    verticalFovDegrees: 48.8,
    near: 0.06,
    far: 12,
    imageWidth: 640,
    imageHeight: 480,
  };
  const observations = { clear: null, position: null, lookAt: null, camera: null };
  const captureSession = createActorViewImageCapture({
    createRenderer: () => ({
      domElement: { toDataURL: () => "data:image/png;base64,dGVzdA==" },
      dispose() {},
      forceContextLoss() {},
      getContext: () => ({ isContextLost: () => false }),
      render() {},
      setClearColor: (...values) => { observations.clear = values; },
      setPixelRatio() {},
      setSize() {},
    }),
    createCamera: () => ({
      set fov(value) { observations.camera = { ...(observations.camera ?? {}), fov: value }; },
      set aspect(value) { observations.camera = { ...(observations.camera ?? {}), aspect: value }; },
      set near(value) { observations.camera = { ...(observations.camera ?? {}), near: value }; },
      set far(value) { observations.camera = { ...(observations.camera ?? {}), far: value }; },
      position: { set: (...values) => { observations.position = values; } },
      lookAt: (...values) => { observations.lookAt = values; },
      updateProjectionMatrix() {},
    }),
  });

  captureSession.capture({
    scene: {},
    actorMesh: { visible: true },
    actorFieldOfView: { visible: true },
    actorPosition: { x: 3, z: 4 },
    actorLookDirection: { x: 0, z: 1 },
    fieldOfViewAngleRadians: Math.PI / 3,
    renderingProfile: profile,
  });

  assert.deepEqual(observations.clear, [0xabcdef, 0.25]);
  assert.deepEqual(observations.position, [3, 1.1, 4]);
  assert.equal(observations.lookAt[0], 3);
  assert.ok(Math.abs(observations.lookAt[1] - 0.9) < 0.0001);
  assert.equal(observations.lookAt[2], 6);
  assert.deepEqual(observations.camera, {
    fov: 48.8,
    aspect: 4 / 3,
    near: 0.06,
    far: 12,
  });
  captureSession.dispose();
});

test("Game settings expose and dispatch the rendering profile selector", () => {
  const session = createChaseScenarioSession(GRID);
  const scenario = session.buildScenario();
  const state = createChaseSimulationState({ scenario, ...GRID });
  let sections = [];
  publishSidebarSections(
    (nextSections) => { sections = nextSections; },
    state.chaserControlSource,
    { chaserViewVisible: false, evaderViewVisible: false, idaeDebugVisible: false },
    state.simulationSettings,
    state.vehicleSettings,
    state.projectionSettings,
    {},
    state.runMetrics,
    session.getSidebarControls(state),
  );
  const renderingRow = sections
    .find((section) => section.id === "game")
    ?.rows.find((row) => row.id === RENDERING_PROFILE_ACTION_ID);
  assert.equal(renderingRow?.kind, "select");
  assert.equal(renderingRow?.value, CHASE_RENDERING_PROFILE_IDS.SIMULATION);
  assert.deepEqual(
    renderingRow?.options.map((option) => option.value),
    Object.values(CHASE_RENDERING_PROFILE_IDS),
  );
  const renderingSeedRow = sections
    .find((section) => section.id === "game")
    ?.rows.find((row) => row.id === RENDERING_SEED_ACTION_ID);
  assert.equal(renderingSeedRow?.kind, "editableValue");
  assert.equal(renderingSeedRow?.value, "0");

  let selectedProfile = null;
  let selectedSeed = null;
  const descriptor = createSidebarActionDescriptors({
    setRenderingProfile: (value) => { selectedProfile = value; },
    setRenderingSeed: (value) => { selectedSeed = value; },
    getActorActionProposalCollections: () => ({}),
  });
  descriptor.find((entry) => entry.id === RENDERING_PROFILE_ACTION_ID)
    ?.handler(CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  descriptor.find((entry) => entry.id === RENDERING_SEED_ACTION_ID)?.handler("1234");
  assert.equal(selectedProfile, CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  assert.equal(selectedSeed, 1234);
});
