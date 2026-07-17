import * as THREE from "three";
import { CAR_HEIGHT } from "../config/constants.mjs";
import { vectorToAngle } from "../decision-model/core/math.ts";
import {
  configureCamera,
  createCar,
  createEvaderFieldOfViewCone,
  createFieldOfViewCone,
  createFieldOfViewConeGeometry,
  createFloorGrid,
  createMapKnowledgeOverlayDisplayState,
  createMapRecencyOverlayDisplayState,
  createPredictionDebugDisplayState,
  createSurfacePatch,
  createTexturedFloor,
  createWall,
  disposeObject3D,
  disposeMapKnowledgeOverlayDisplayState,
  disposeMapRecencyOverlayDisplayState,
  disposePredictionDebugDisplayState,
  getWallMaterialOptions,
  setCarWheelSteeringAngle,
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
import { createActorViewImageCapture } from "./actor-view-controller.mjs";
import { SIMULATION_RENDERING_PROFILE } from "../rendering/profiles.ts";
import {
  applyRenderingEnvironment,
  createSceneLighting,
} from "./rendering/environment.mjs";

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
  const actorViewImageCapture = createActorViewImageCapture();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "block h-full w-full";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-columns / 2, columns / 2, rows / 2, -rows / 2, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const lighting = createSceneLighting();
  scene.add(lighting.ambientLight, lighting.keyLight, lighting.keyLightTarget);

  const chaserFieldOfView = createFieldOfViewCone(
    vehicleSettings.fieldOfViewAngleRadians,
    { distance: vehicleSettings.fieldOfViewDistance },
  );
  const evaderFieldOfView = createEvaderFieldOfViewCone(
    vehicleSettings.fieldOfViewAngleRadians,
    vehicleSettings.fieldOfViewDistance,
  );
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
  const floorGroup = new THREE.Group();
  let floorMesh = null;
  let floorGrid = null;
  let renderedFloorKey = null;
  const obstacleGroup = new THREE.Group();
  const obstacleMeshes = [];
  const surfaceGroup = new THREE.Group();
  const surfaceMeshes = [];
  const frontViewCaptureDebugObjects = [
    evaderProjectionGroup,
    idaePredictionDebugGroup,
    chaserActionPathDebugGroup,
  ];
  let renderedObstacles = null;
  let renderedSurfaces = null;
  let renderedProfile = null;
  let renderedProfileColumns = null;
  let renderedProfileRows = null;

  const getRenderingProfile = () =>
    simulationState.renderingProfile ?? SIMULATION_RENDERING_PROFILE;

  const getFieldDimensions = () => ({
    columns: Number.isFinite(simulationState.columns) ? simulationState.columns : columns,
    rows: Number.isFinite(simulationState.rows) ? simulationState.rows : rows,
  });

  const syncRenderingProfile = () => {
    const nextProfile = getRenderingProfile();
    const dimensions = getFieldDimensions();
    const profileChanged = nextProfile !== renderedProfile;
    if (
      !profileChanged
      && dimensions.columns === renderedProfileColumns
      && dimensions.rows === renderedProfileRows
    ) {
      return nextProfile;
    }
    renderedProfile = nextProfile;
    renderedProfileColumns = dimensions.columns;
    renderedProfileRows = dimensions.rows;
    applyRenderingEnvironment({ renderer, lighting, ...dimensions }, renderedProfile);
    if (profileChanged) {
      renderedFloorKey = null;
      renderedObstacles = null;
      renderedSurfaces = null;
    }
    return renderedProfile;
  };

  const disposeObstacleMesh = (mesh) => disposeObject3D(mesh);

  const getFloorKey = () => {
    const { columns: fieldColumns, rows: fieldRows } = getFieldDimensions();
    return `${fieldColumns}:${fieldRows}`;
  };

  const syncFloorMeshes = () => {
    const floorKey = getFloorKey();
    if (floorKey !== renderedFloorKey) {
      renderedFloorKey = floorKey;
      floorGroup.clear();
      disposeObject3D(floorMesh);
      disposeObject3D(floorGrid);
      const [fieldColumns, fieldRows] = floorKey.split(":").map(Number);
      floorMesh = createTexturedFloor(
        fieldColumns,
        fieldRows,
        renderedProfile.environment.materials.floor,
      );
      floorGrid = createFloorGrid(fieldColumns, fieldRows);
      floorGroup.add(floorMesh, floorGrid);
    }
    if (floorGrid) {
      floorGrid.visible = Boolean(simulationState.simulationSettings?.floorGridVisible);
    }
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
      const materialOptions = getWallMaterialOptions(
        wall,
        renderedProfile.environment.materials,
      );
      const mesh = createWall(wall, materialOptions);
      obstacleMeshes.push(mesh);
      obstacleGroup.add(mesh);
    });
  };

  const syncSurfaceMeshes = () => {
    if (simulationState.surfaces === renderedSurfaces) {
      return;
    }
    renderedSurfaces = simulationState.surfaces;
    surfaceMeshes.splice(0).forEach((mesh) => {
      surfaceGroup.remove(mesh);
      disposeObstacleMesh(mesh);
    });
    (simulationState.surfaces ?? []).forEach((surface) => {
      const mesh = createSurfacePatch(surface, renderedProfile.environment.materials.surface);
      surfaceMeshes.push(mesh);
      surfaceGroup.add(mesh);
    });
  };
  syncRenderingProfile();
  syncFloorMeshes();
  syncObstacleMeshes();
  syncSurfaceMeshes();

  const getSteeringAngle = (action) => {
    const steering = Number(action?.steering);
    return Number.isFinite(steering)
      ? steering * vehicleSettings.maxSteeringAngleRadians
      : 0;
  };

  evaderProjectionGroup.visible = false;
  idaePredictionDebugGroup.visible = false;
  chaserActionPathDebugGroup.visible = false;
  mapKnowledgeOverlayGroup.visible = false;
  mapRecencyOverlayGroup.visible = false;
  scene.add(
    floorGroup,
    mapKnowledgeOverlayGroup,
    mapRecencyOverlayGroup,
    surfaceGroup,
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
    const nextChaserGeometry = createFieldOfViewConeGeometry(
      vehicleSettings.fieldOfViewAngleRadians,
      vehicleSettings.fieldOfViewDistance,
    );
    chaserFieldOfView.geometry.dispose();
    chaserFieldOfView.geometry = nextChaserGeometry;
    const nextEvaderGeometry = createFieldOfViewConeGeometry(
      vehicleSettings.fieldOfViewAngleRadians,
      vehicleSettings.fieldOfViewDistance,
    );
    evaderFieldOfView.geometry.dispose();
    evaderFieldOfView.geometry = nextEvaderGeometry;
    chaserView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
    chaserView.setFieldOfViewDistance(vehicleSettings.fieldOfViewDistance);
    evaderView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
    evaderView.setFieldOfViewDistance(vehicleSettings.fieldOfViewDistance);
  };

  const syncActorMeshes = () => {
    const {
      chaserPosition,
      chaserLookDirection,
      evaderExists,
      evaderPosition,
      evaderDirection,
    } = simulationState;
    chaser.position.set(chaserPosition.x, CAR_HEIGHT / 2, chaserPosition.z);
    chaser.rotation.y = vectorToAngle(chaserLookDirection);
    setCarWheelSteeringAngle(chaser, getSteeringAngle(simulationState.lastStep.chaserAction));
    chaserFieldOfView.position.set(chaserPosition.x, 0, chaserPosition.z);
    chaserFieldOfView.rotation.y = vectorToAngle(chaserLookDirection);
    evader.visible = Boolean(evaderExists && evaderPosition && evaderDirection);
    evaderFieldOfView.visible = Boolean(evaderExists && evaderPosition && evaderDirection);
    if (evader.visible) {
      evader.position.set(evaderPosition.x, CAR_HEIGHT / 2, evaderPosition.z);
      evader.rotation.y = vectorToAngle(evaderDirection);
      setCarWheelSteeringAngle(evader, getSteeringAngle(simulationState.lastStep.evaderMovementDecision));
      evaderFieldOfView.position.set(evaderPosition.x, 0, evaderPosition.z);
      evaderFieldOfView.rotation.y = vectorToAngle(evaderDirection);
    }
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
    syncRenderingProfile();
    syncFloorMeshes();
    syncObstacleMeshes();
    syncSurfaceMeshes();
    const chaserSnapshot = lastStep.chaserReasoning?.snapshot ?? null;
    const evaderLocationMemory = chaserSnapshot?.memory?.directObservation?.evaderLocation ?? null;
    const evaderMotionProjection = chaserSnapshot?.projections?.evaderMotion ?? null;
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
      evaderMotionProjection?.prediction ?? null,
      projectionSettings,
      evaderMotionModel?.speedEstimateUnitsPerFrame,
      evaderMotionProjection?.path ?? null,
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
    syncActorMeshes();
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
        floorGrid: Boolean(simulationState.simulationSettings?.floorGridVisible),
        mapKnowledgeDebug: mapKnowledgeDebugVisible,
        mapRecencyDebug: mapRecencyDebugVisible,
      },
    };
  };

  const captureActorView = ({
    actorId = "chaser",
    width,
    height,
    includeDebugVisualizations = false,
  } = {}) => {
    syncRenderingProfile();
    syncFloorMeshes();
    syncObstacleMeshes();
    syncSurfaceMeshes();
    syncActorMeshes();
    if (actorId === "evader") {
      if (!simulationState.evaderExists || !simulationState.evaderPosition || !simulationState.evaderDirection) {
        return null;
      }
      return actorViewImageCapture.capture({
        scene,
        actorMesh: evader,
        actorFieldOfView: evaderFieldOfView,
        otherActorFieldOfView: chaserFieldOfView,
        actorPosition: simulationState.evaderPosition,
        actorLookDirection: simulationState.evaderDirection,
        fieldOfViewAngleRadians: vehicleSettings.fieldOfViewAngleRadians,
        fieldOfViewDistance: vehicleSettings.fieldOfViewDistance,
        renderingProfile: renderedProfile,
        excludedObjects: includeDebugVisualizations ? [] : frontViewCaptureDebugObjects,
        width,
        height,
      });
    }
    return actorViewImageCapture.capture({
      scene,
      actorMesh: chaser,
      actorFieldOfView: chaserFieldOfView,
      otherActorFieldOfView: evaderFieldOfView,
      actorPosition: simulationState.chaserPosition,
      actorLookDirection: simulationState.chaserLookDirection,
      fieldOfViewAngleRadians: vehicleSettings.fieldOfViewAngleRadians,
      fieldOfViewDistance: vehicleSettings.fieldOfViewDistance,
      renderingProfile: renderedProfile,
      excludedObjects: includeDebugVisualizations ? [] : frontViewCaptureDebugObjects,
      width,
      height,
    });
  };

  const dispose = () => {
    resizeObserver.disconnect();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    disposeObject3D(chaser);
    chaserFieldOfView.geometry.dispose();
    chaserFieldOfView.material.dispose();
    evaderFieldOfView.geometry.dispose();
    evaderFieldOfView.material.dispose();
    disposeObject3D(evader);
    syncProjectionFrames(evaderProjectionGroup, evaderProjectionFrames, 0);
    disposePredictionDebugDisplayState(idaePredictionDebugGroup, idaePredictionDebugDisplayState);
    disposePredictionDebugDisplayState(chaserActionPathDebugGroup, chaserActionPathDebugDisplayState);
    disposeMapKnowledgeOverlayDisplayState(mapKnowledgeOverlayGroup, mapKnowledgeOverlayDisplayState);
    disposeMapRecencyOverlayDisplayState(mapRecencyOverlayGroup, mapRecencyOverlayDisplayState);
    disposeObject3D(floorMesh);
    disposeObject3D(floorGrid);
    obstacleMeshes.forEach(disposeObstacleMesh);
    surfaceMeshes.forEach(disposeObstacleMesh);
    actorViewImageCapture.dispose();
    renderer.dispose();
  };

  return {
    updateRenderingProfile() {
      syncRenderingProfile();
      syncFloorMeshes();
      syncObstacleMeshes();
      syncSurfaceMeshes();
    },
    updateFieldOfView,
    renderFrame,
    captureActorView,
    getAnimationFrameWindow: () =>
      chaserView.getRenderWindow?.()
      ?? evaderView.getRenderWindow?.()
      ?? window,
    resize,
    dispose,
  };
}
