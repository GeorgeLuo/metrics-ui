import * as THREE from "three";
import { CAR_HEIGHT } from "../config/constants.mjs";
import { vectorToAngle } from "../decision-model/core/math.ts";
import {
  configureCamera,
  createCar,
  createEvaderFieldOfViewCone,
  createFieldOfViewCone,
  createFieldOfViewConeGeometry,
  createMapKnowledgeOverlayDisplayState,
  createMapRecencyOverlayDisplayState,
  createPredictionDebugDisplayState,
  createWall,
  disposeMapKnowledgeOverlayDisplayState,
  disposeMapRecencyOverlayDisplayState,
  disposePredictionDebugDisplayState,
  syncProjectionFrames,
  updateChaserActionPathDebugDisplay,
  updateEvaderProjectionDisplay,
  updateMapKnowledgeOverlayDisplay,
  updateMapRecencyOverlayDisplay,
  updatePredictionDebugDisplay,
} from "./rendering.mjs";
import {
  isMapKnowledgeOverlayVisible,
  isMapRecencyOverlayVisible,
} from "./settings.mjs";

export function createChaseSceneView({
  container,
  columns,
  rows,
  simulationState,
  vehicleSettings,
  chaserView,
  evaderView,
}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "block h-full w-full";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-columns / 2, columns / 2, rows / 2, -rows / 2, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(3, 8, 4);
  scene.add(ambientLight, keyLight);

  const chaserFieldOfView = createFieldOfViewCone(vehicleSettings.fieldOfViewAngleRadians);
  const evaderFieldOfView = createEvaderFieldOfViewCone(vehicleSettings.fieldOfViewAngleRadians);
  const chaser = createCar(0x38bdf8);
  const evader = createCar(0xf43f5e);
  const evaderProjectionGroup = new THREE.Group();
  const evaderProjectionFrames = [];
  const idaePredictionDebugGroup = new THREE.Group();
  const idaePredictionDebugDisplayState = createPredictionDebugDisplayState();
  const chaserActionPathDebugGroup = new THREE.Group();
  const chaserActionPathDebugDisplayState = createPredictionDebugDisplayState();
  const mapKnowledgeOverlayGroup = new THREE.Group();
  const mapKnowledgeOverlayDisplayState = createMapKnowledgeOverlayDisplayState();
  const mapRecencyOverlayGroup = new THREE.Group();
  const mapRecencyOverlayDisplayState = createMapRecencyOverlayDisplayState();
  const obstacleGroup = new THREE.Group();
  const obstacleMeshes = [];
  let renderedObstacles = null;

  const disposeObstacleMesh = (mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  };

  const syncObstacleMeshes = () => {
    if (simulationState.obstacles === renderedObstacles) {
      return;
    }
    renderedObstacles = simulationState.obstacles;
    obstacleMeshes.splice(0).forEach((mesh) => {
      obstacleGroup.remove(mesh);
      disposeObstacleMesh(mesh);
    });
    (simulationState.obstacles?.walls ?? []).forEach((wall) => {
      const mesh = createWall(wall);
      obstacleMeshes.push(mesh);
      obstacleGroup.add(mesh);
    });
  };
  syncObstacleMeshes();

  evaderProjectionGroup.visible = false;
  idaePredictionDebugGroup.visible = false;
  chaserActionPathDebugGroup.visible = false;
  mapKnowledgeOverlayGroup.visible = false;
  mapRecencyOverlayGroup.visible = false;
  scene.add(
    mapKnowledgeOverlayGroup,
    mapRecencyOverlayGroup,
    chaserFieldOfView,
    evaderFieldOfView,
    obstacleGroup,
    evaderProjectionGroup,
    idaePredictionDebugGroup,
    chaserActionPathDebugGroup,
    chaser,
    evader,
  );

  const updateFieldOfView = () => {
    const nextChaserGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
    chaserFieldOfView.geometry.dispose();
    chaserFieldOfView.geometry = nextChaserGeometry;
    const nextEvaderGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
    evaderFieldOfView.geometry.dispose();
    evaderFieldOfView.geometry = nextEvaderGeometry;
    chaserView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
    evaderView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const fieldColumns = Number.isFinite(simulationState.columns)
      ? simulationState.columns
      : columns;
    const fieldRows = Number.isFinite(simulationState.rows)
      ? simulationState.rows
      : rows;
    renderer.setSize(width, height, false);
    configureCamera(camera, fieldColumns, fieldRows, width, height);
    chaserView.resize();
    evaderView.resize();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const renderFrame = ({
    projectionSettings,
    predictionDebugState,
    actionPathDebugSettings,
    mapKnowledgeDebugSettings,
  }) => {
    const {
      chaserPosition,
      chaserLookDirection,
      evaderExists,
      evaderPosition,
      evaderDirection,
      lastStep,
    } = simulationState;
    syncObstacleMeshes();
    const chaserSnapshot = lastStep.chaserReasoning?.snapshot ?? null;
    const evaderLocationMemory = chaserSnapshot?.memory?.directObservation?.evaderLocation ?? null;
    const evaderPredictionPlan = chaserSnapshot?.strategies?.evaderPrediction ?? null;
    const evaderMotionModel = chaserSnapshot?.patterns?.evaderMotionModel ?? null;
    const evaderSnapshot = lastStep.evaderReasoning?.snapshot ?? null;
    const chaserVisibleFromEvader = Boolean(
      evaderSnapshot?.memory?.directObservation?.chaserLocation?.visible,
    );
    chaserView.setTrackedActorVisible(Boolean(evaderLocationMemory?.visible));
    evaderView.setTrackedActorVisible(Boolean(evaderExists && chaserVisibleFromEvader));

    const projectionDisplayStartMs = performance.now();
    updateEvaderProjectionDisplay(
      evaderProjectionGroup,
      evaderProjectionFrames,
      evaderMotionModel,
      evaderPredictionPlan?.prediction ?? null,
      projectionSettings,
      evaderMotionModel?.speedEstimateUnitsPerFrame,
      evaderPredictionPlan?.path ?? null,
    );
    const projectionDisplayMs = performance.now() - projectionDisplayStartMs;

    const predictionDebugDisplayStartMs = performance.now();
    const actorSnapshots = {
      chaser: chaserSnapshot,
      evader: evaderSnapshot,
    };
    updatePredictionDebugDisplay(
      idaePredictionDebugGroup,
      idaePredictionDebugDisplayState,
      actorSnapshots[predictionDebugState.actorId] ?? null,
      { visible: predictionDebugState.visible },
    );
    updateChaserActionPathDebugDisplay(
      chaserActionPathDebugGroup,
      chaserActionPathDebugDisplayState,
      lastStep.chaserAction ?? null,
      actionPathDebugSettings,
    );
    const predictionDebugDisplayMs = performance.now() - predictionDebugDisplayStartMs;

    const mapKnowledgeDisplayStartMs = performance.now();
    const mapKnowledgeDebugVisible = isMapKnowledgeOverlayVisible(mapKnowledgeDebugSettings);
    const mapRecencyDebugVisible = isMapRecencyOverlayVisible(mapKnowledgeDebugSettings);
    updateMapKnowledgeOverlayDisplay(
      mapKnowledgeOverlayGroup,
      mapKnowledgeOverlayDisplayState,
      chaserSnapshot?.memory?.abstracted?.mapShape ?? null,
      { visible: mapKnowledgeDebugVisible },
    );
    updateMapRecencyOverlayDisplay(
      mapRecencyOverlayGroup,
      mapRecencyOverlayDisplayState,
      chaserSnapshot?.memory?.abstracted?.mapShape ?? null,
      {
        visible: mapRecencyDebugVisible,
        currentFrame: simulationState.frameIndex,
      },
    );
    const mapKnowledgeDisplayMs = performance.now() - mapKnowledgeDisplayStartMs;

    const sceneSyncStartMs = performance.now();
    chaser.position.set(chaserPosition.x, CAR_HEIGHT / 2, chaserPosition.z);
    chaser.rotation.y = vectorToAngle(chaserLookDirection);
    chaserFieldOfView.position.set(chaserPosition.x, 0, chaserPosition.z);
    chaserFieldOfView.rotation.y = vectorToAngle(chaserLookDirection);
    evader.visible = Boolean(evaderExists && evaderPosition && evaderDirection);
    evaderFieldOfView.visible = Boolean(evaderExists && evaderPosition && evaderDirection);
    if (evader.visible) {
      evader.position.set(evaderPosition.x, CAR_HEIGHT / 2, evaderPosition.z);
      evader.rotation.y = vectorToAngle(evaderDirection);
      evaderFieldOfView.position.set(evaderPosition.x, 0, evaderPosition.z);
      evaderFieldOfView.rotation.y = vectorToAngle(evaderDirection);
    }
    const sceneSyncMs = performance.now() - sceneSyncStartMs;

    const mainRenderStartMs = performance.now();
    renderer.render(scene, camera);
    const mainRenderMs = performance.now() - mainRenderStartMs;

    const chaserViewRenderStartMs = performance.now();
    chaserView.render({
      scene,
      actorMesh: chaser,
      actorFieldOfView: chaserFieldOfView,
      otherActorFieldOfView: evaderFieldOfView,
      actorPosition: chaserPosition,
      actorLookDirection: chaserLookDirection,
    });
    const chaserViewRenderMs = performance.now() - chaserViewRenderStartMs;

    const evaderViewRenderStartMs = performance.now();
    if (evaderExists && evaderPosition && evaderDirection) {
      evaderView.render({
        scene,
        actorMesh: evader,
        actorFieldOfView: evaderFieldOfView,
        otherActorFieldOfView: chaserFieldOfView,
        actorPosition: evaderPosition,
        actorLookDirection: evaderDirection,
      });
    }
    const evaderViewRenderMs = performance.now() - evaderViewRenderStartMs;

    return {
      actorSnapshots,
      chaserSnapshot,
      timings: {
        projectionDisplayMs,
        predictionDebugDisplayMs,
        mapKnowledgeDisplayMs,
        sceneSyncMs,
        mainRenderMs,
        chaserViewRenderMs,
        evaderViewRenderMs,
      },
      visibility: {
        idaePredictionDebug: predictionDebugState.visible,
        mapKnowledgeDebug: mapKnowledgeDebugVisible,
        mapRecencyDebug: mapRecencyDebugVisible,
      },
    };
  };

  const dispose = () => {
    resizeObserver.disconnect();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    chaser.geometry.dispose();
    chaser.material.dispose();
    chaserFieldOfView.geometry.dispose();
    chaserFieldOfView.material.dispose();
    evaderFieldOfView.geometry.dispose();
    evaderFieldOfView.material.dispose();
    evader.geometry.dispose();
    evader.material.dispose();
    syncProjectionFrames(evaderProjectionGroup, evaderProjectionFrames, 0);
    disposePredictionDebugDisplayState(idaePredictionDebugGroup, idaePredictionDebugDisplayState);
    disposePredictionDebugDisplayState(chaserActionPathDebugGroup, chaserActionPathDebugDisplayState);
    disposeMapKnowledgeOverlayDisplayState(mapKnowledgeOverlayGroup, mapKnowledgeOverlayDisplayState);
    disposeMapRecencyOverlayDisplayState(mapRecencyOverlayGroup, mapRecencyOverlayDisplayState);
    obstacleMeshes.forEach(disposeObstacleMesh);
    renderer.dispose();
  };

  return {
    updateFieldOfView,
    renderFrame,
    resize,
    dispose,
  };
}
