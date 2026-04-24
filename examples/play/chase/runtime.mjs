import * as THREE from "three";
import {
  CAR_HEIGHT,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_SPEED_ACTION_ID,
  CHASER_VIEW_MAX_DISTANCE,
  DEFAULT_CHASER_SPEED_UNITS_PER_FRAME,
  DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
  DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS,
  DEFAULT_TARGET_SPEED_UNITS_PER_FRAME,
  MAX_SIMULATION_STEPS_PER_TICK,
  MAX_TARGET_PROJECTION_HORIZON_FRAMES,
  MAX_TARGET_PROJECTION_SAMPLE_EVERY_FRAMES,
  SIMULATION_FRAME_DURATION_MS,
  TARGET_PROJECTION_DEBUG_ACTION_ID,
  TARGET_PROJECTION_HORIZON_ACTION_ID,
  TARGET_PROJECTION_RATE_ACTION_ID,
  TARGET_SPEED_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_TURN_RATE_ACTION_ID,
} from "./constants.mjs";
import {
  createTargetMotionEstimate,
  getChaserTargetPerception,
  updateTargetMotionEstimate,
} from "./chaser.mjs";
import {
  createChaserAutopilotState,
  getProgrammaticChaserInput,
} from "./chaser-controller.mjs";
import {
  angleToVector,
  clampNumber,
  degreesToRadians,
  normalizeVector,
  parseEditableNumber,
  vectorToAngle,
} from "./math.mjs";
import { getHumanChaserInput, isControlCode, isTextEditingTarget } from "./input.mjs";
import {
  configureCamera,
  configureChaserViewCamera,
  createCar,
  createFieldOfViewCone,
  createFieldOfViewConeGeometry,
  createWall,
  syncProjectionFrames,
  updateTargetProjectionDisplay,
} from "./rendering.mjs";
import { publishSidebarSections } from "./sidebar.mjs";
import {
  buildTargetPredictionPlan,
  createTargetPredictionPlanState,
} from "./target-prediction-plan.mjs";
import { readStoredProjectionSettings, writeStoredProjectionSettings } from "./settings.mjs";
import {
  createTargetWallAvoidanceTruthState,
  createWallAvoidanceEvidenceState,
  updateTargetWallAvoidanceTruth,
  updateWallAvoidanceEvidence,
} from "./wall-avoidance-detection.mjs";
import { mountStrategyDebugFrame } from "./strategy-debug.mjs";
import {
  getFieldObstacleLayout,
  resolveObstacleCollisions,
} from "./world.mjs";
import {
  constrainDirectionToBounds,
  getTargetMovementDecision,
  steerDirectionToward,
} from "./target.mjs";

function createVehicleSettings() {
  return {
    chaserSpeedUnitsPerFrame: DEFAULT_CHASER_SPEED_UNITS_PER_FRAME,
    targetSpeedUnitsPerFrame: DEFAULT_TARGET_SPEED_UNITS_PER_FRAME,
    turnRateRadiansPerFrame: DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
    fieldOfViewAngleRadians: DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS,
  };
}

function mountChaserView({ createFloatingFrame, vehicleSettings }) {
  const chaserViewWidth = 280;
  const chaserViewFrame = typeof createFloatingFrame === "function"
    ? createFloatingFrame({
      id: "chaser-view",
      title: "Chaser View",
      bounds: "viewport",
      defaultPosition: {
        x: Math.max(16, window.innerWidth - chaserViewWidth - 24),
        y: 72,
      },
      defaultSize: { width: chaserViewWidth, height: 210 },
      minSize: { width: 180, height: 140 },
      minimizable: true,
      resizable: true,
      popoutable: true,
    })
    : null;
  const chaserViewRenderer = chaserViewFrame
    ? new THREE.WebGLRenderer({ antialias: true, alpha: true })
    : null;
  const lostTargetLabel = chaserViewFrame
    ? document.createElement("div")
    : null;
  const camera = new THREE.PerspectiveCamera(
    vehicleSettings.fieldOfViewAngleRadians * 180 / Math.PI,
    4 / 3,
    0.04,
    CHASER_VIEW_MAX_DISTANCE,
  );

  if (chaserViewRenderer && chaserViewFrame) {
    chaserViewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    chaserViewRenderer.setClearColor(0x000000, 0);
    chaserViewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    chaserViewRenderer.domElement.style.display = "block";
    chaserViewRenderer.domElement.style.width = "100%";
    chaserViewRenderer.domElement.style.height = "100%";
    chaserViewFrame.mount.appendChild(chaserViewRenderer.domElement);
    if (lostTargetLabel) {
      Object.assign(lostTargetLabel.style, {
        position: "absolute",
        top: "10px",
        left: "50%",
        transform: "translateX(-50%)",
        color: "rgb(239, 68, 68)",
        font: "600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        pointerEvents: "none",
        display: "none",
      });
      lostTargetLabel.textContent = "Target out of sight";
      chaserViewFrame.mount.appendChild(lostTargetLabel);
    }
  }

  return {
    frame: chaserViewFrame,
    renderer: chaserViewRenderer,
    lostTargetLabel,
    camera,
  };
}

function registerSidebarActions({
  setSidebarActionHandler,
  getProgrammaticChaserEnabled,
  setProgrammaticChaserEnabled,
  refreshSidebarSections,
  updateFieldOfView,
  vehicleSettings,
  projectionSettings,
}) {
  if (typeof setSidebarActionHandler !== "function") {
    return;
  }

  setSidebarActionHandler(CHASER_AUTOPILOT_ACTION_ID, (value) => {
    setProgrammaticChaserEnabled(
      typeof value === "boolean" ? value : !getProgrammaticChaserEnabled(),
    );
    refreshSidebarSections();
  });
  setSidebarActionHandler(CHASER_SPEED_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.chaserSpeedUnitsPerFrame = clampNumber(parsed, 0.002, 0.2);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(TARGET_SPEED_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.targetSpeedUnitsPerFrame = clampNumber(parsed, 0.002, 0.2);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(VEHICLE_TURN_RATE_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.turnRateRadiansPerFrame = degreesToRadians(clampNumber(parsed, 0.1, 12));
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(VEHICLE_FOV_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.fieldOfViewAngleRadians = degreesToRadians(clampNumber(parsed, 20, 140));
      updateFieldOfView();
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(TARGET_PROJECTION_DEBUG_ACTION_ID, (value) => {
    projectionSettings.visible = typeof value === "boolean" ? value : !projectionSettings.visible;
    writeStoredProjectionSettings(projectionSettings);
    refreshSidebarSections();
  });
  setSidebarActionHandler(TARGET_PROJECTION_HORIZON_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      projectionSettings.horizonFrames = Math.round(
        clampNumber(parsed, 1, MAX_TARGET_PROJECTION_HORIZON_FRAMES),
      );
      writeStoredProjectionSettings(projectionSettings);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(TARGET_PROJECTION_RATE_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      projectionSettings.sampleEveryFrames = Math.round(clampNumber(
        parsed,
        1,
        MAX_TARGET_PROJECTION_SAMPLE_EVERY_FRAMES,
      ));
      writeStoredProjectionSettings(projectionSettings);
    }
    refreshSidebarSections();
  });
}

function clearSidebarActions(setSidebarActionHandler) {
  setSidebarActionHandler?.(CHASER_AUTOPILOT_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_SPEED_ACTION_ID, null);
  setSidebarActionHandler?.(TARGET_SPEED_ACTION_ID, null);
  setSidebarActionHandler?.(VEHICLE_TURN_RATE_ACTION_ID, null);
  setSidebarActionHandler?.(VEHICLE_FOV_ACTION_ID, null);
  setSidebarActionHandler?.(TARGET_PROJECTION_DEBUG_ACTION_ID, null);
  setSidebarActionHandler?.(TARGET_PROJECTION_HORIZON_ACTION_ID, null);
  setSidebarActionHandler?.(TARGET_PROJECTION_RATE_ACTION_ID, null);
}

export function createPlayGame({
  container,
  columns,
  rows,
  createFloatingFrame,
  setSidebarSections,
  setSidebarActionHandler,
}) {
  const pressedKeys = new Set();
  let programmaticChaserEnabled = false;
  const vehicleSettings = createVehicleSettings();
  const projectionSettings = readStoredProjectionSettings();
  const wallAvoidanceEvidence = createWallAvoidanceEvidenceState();
  const targetWallAvoidanceTruth = createTargetWallAvoidanceTruthState();
  const targetPredictionPlanState = createTargetPredictionPlanState();
  let chaserFieldOfView = null;

  const refreshSidebarSections = () => {
    publishSidebarSections(
      setSidebarSections,
      programmaticChaserEnabled,
      vehicleSettings,
      projectionSettings,
    );
  };

  const chaserView = mountChaserView({ createFloatingFrame, vehicleSettings });
  const strategyDebugFrame = mountStrategyDebugFrame(createFloatingFrame);
  const updateFieldOfView = () => {
    if (chaserFieldOfView) {
      const nextGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
      chaserFieldOfView.geometry.dispose();
      chaserFieldOfView.geometry = nextGeometry;
    }
    chaserView.camera.fov = vehicleSettings.fieldOfViewAngleRadians * 180 / Math.PI;
    chaserView.camera.updateProjectionMatrix();
  };

  refreshSidebarSections();
  registerSidebarActions({
    setSidebarActionHandler,
    getProgrammaticChaserEnabled: () => programmaticChaserEnabled,
    setProgrammaticChaserEnabled: (value) => {
      programmaticChaserEnabled = value;
    },
    refreshSidebarSections,
    updateFieldOfView,
    vehicleSettings,
    projectionSettings,
  });

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

  chaserFieldOfView = createFieldOfViewCone(vehicleSettings.fieldOfViewAngleRadians);
  const chaser = createCar(0x38bdf8);
  const target = createCar(0xf43f5e);
  const targetProjectionGroup = new THREE.Group();
  const targetProjectionFrames = [];
  targetProjectionGroup.visible = false;
  const obstacles = getFieldObstacleLayout(columns, rows);
  const obstacleMeshes = obstacles.walls.map(createWall);
  scene.add(chaserFieldOfView, targetProjectionGroup, chaser, target, ...obstacleMeshes);

  const chaserPosition = { x: -columns * 0.38, z: 0 };
  const chaserLookDirection = normalizeVector(1, 0);
  const targetPosition = { x: columns / 4, z: 0 };
  const targetDirection = normalizeVector(-1, 0.4);
  const chaserAutopilotState = createChaserAutopilotState();
  const targetMotionEstimate = createTargetMotionEstimate(targetPosition, targetDirection);

  const handleKeyDown = (event) => {
    if (!isControlCode(event.code) || isTextEditingTarget(event.target)) {
      return;
    }
    pressedKeys.add(event.code);
    event.preventDefault();
  };
  const handleKeyUp = (event) => {
    if (!isControlCode(event.code)) {
      return;
    }
    pressedKeys.delete(event.code);
    event.preventDefault();
  };
  const clearControls = () => pressedKeys.clear();

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clearControls);

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    configureCamera(camera, columns, rows, width, height);

    if (chaserView.renderer && chaserView.frame) {
      const viewWidth = Math.max(1, chaserView.frame.mount.clientWidth);
      const viewHeight = Math.max(1, chaserView.frame.mount.clientHeight);
      chaserView.renderer.setSize(viewWidth, viewHeight, false);
      chaserView.camera.aspect = viewWidth / viewHeight;
      chaserView.camera.updateProjectionMatrix();
    }
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  if (chaserView.frame) {
    resizeObserver.observe(chaserView.frame.mount);
  }

  let animationFrame = 0;
  let previousRenderTimeMs = performance.now();
  let pendingSimulationFrames = 0;
  let simulationFrameIndex = 0;
  let latestTargetPredictionPlan = {
    actionable: false,
    invalidReason: "uninitialized",
    prediction: null,
    path: [],
  };

  const renderScene = () => {
    updateTargetProjectionDisplay(
      targetProjectionGroup,
      targetProjectionFrames,
      projectionSettings,
      latestTargetPredictionPlan.path,
    );
    chaser.position.set(chaserPosition.x, CAR_HEIGHT / 2, chaserPosition.z);
    chaser.rotation.y = vectorToAngle(chaserLookDirection);
    chaserFieldOfView.position.set(chaserPosition.x, 0, chaserPosition.z);
    chaserFieldOfView.rotation.y = vectorToAngle(chaserLookDirection);
    target.position.set(targetPosition.x, CAR_HEIGHT / 2, targetPosition.z);
    target.rotation.y = vectorToAngle(targetDirection);

    renderer.render(scene, camera);
    if (chaserView.renderer) {
      configureChaserViewCamera(chaserView.camera, chaserPosition, chaserLookDirection);
      chaser.visible = false;
      chaserFieldOfView.visible = false;
      chaserView.renderer.render(scene, chaserView.camera);
      chaser.visible = true;
      chaserFieldOfView.visible = true;
    }
  };

  const stepSimulationFrame = () => {
    const chaserPerception = getChaserTargetPerception(
      chaserPosition,
      targetPosition,
      chaserLookDirection,
      vehicleSettings.fieldOfViewAngleRadians,
      obstacles,
    );
    if (chaserView.lostTargetLabel) {
      chaserView.lostTargetLabel.style.display = chaserPerception.visible ? "none" : "block";
    }
    updateTargetMotionEstimate(
      targetMotionEstimate,
      chaserPerception,
      chaserPosition,
      chaserLookDirection,
      {
        columns,
        rows,
        obstacles,
      },
    );
    updateWallAvoidanceEvidence(wallAvoidanceEvidence, {
      estimate: targetMotionEstimate,
      targetVisible: chaserPerception.visible,
      columns,
      rows,
      obstacles,
    });
    latestTargetPredictionPlan = buildTargetPredictionPlan({
      estimate: targetMotionEstimate,
      speedUnitsPerFrame: targetMotionEstimate.speedEstimateUnitsPerFrame,
      columns,
      rows,
      obstacles,
      wallAvoidanceEvidence,
      targetVisible: chaserPerception.visible,
      planState: targetPredictionPlanState,
      horizonFrames: projectionSettings.horizonFrames,
    });

    const chaserInput = programmaticChaserEnabled
      ? getProgrammaticChaserInput({
        targetPerception: chaserPerception,
        chaserPosition,
        chaserLookDirection,
        targetEstimate: targetMotionEstimate,
        predictionPlan: latestTargetPredictionPlan,
        autopilotState: chaserAutopilotState,
        chaserSpeedUnitsPerFrame: vehicleSettings.chaserSpeedUnitsPerFrame,
        columns,
        rows,
        obstacles,
      })
      : getHumanChaserInput(pressedKeys);
    const isChaserMoving = chaserInput.forward;
    const steeringInput = chaserInput.steering;
    if (isChaserMoving && steeringInput !== 0) {
      const nextHeading = angleToVector(
        vectorToAngle(chaserLookDirection)
          + steeringInput * vehicleSettings.turnRateRadiansPerFrame,
      );
      chaserLookDirection.x = nextHeading.x;
      chaserLookDirection.z = nextHeading.z;
    }
    const nextChaser = resolveObstacleCollisions({
      x: chaserPosition.x
        + chaserLookDirection.x * vehicleSettings.chaserSpeedUnitsPerFrame * (isChaserMoving ? 1 : 0),
      z: chaserPosition.z
        + chaserLookDirection.z * vehicleSettings.chaserSpeedUnitsPerFrame * (isChaserMoving ? 1 : 0),
    }, chaserPosition, columns, rows, obstacles);
    chaserPosition.x = nextChaser.x;
    chaserPosition.z = nextChaser.z;

    const targetMovementDecision = getTargetMovementDecision(
      targetPosition,
      targetDirection,
      columns,
      rows,
      simulationFrameIndex,
      obstacles,
    );
    const nextDirection = constrainDirectionToBounds(
      targetPosition,
      steerDirectionToward(
        targetDirection,
        targetMovementDecision.direction,
        vehicleSettings.turnRateRadiansPerFrame,
      ),
      columns,
      rows,
    );
    updateTargetWallAvoidanceTruth(targetWallAvoidanceTruth, {
      decisionDebug: targetMovementDecision.debug,
    });
    strategyDebugFrame?.update({
      wallEvidence: wallAvoidanceEvidence,
      targetVisible: chaserPerception.visible,
      targetWallTruth: targetWallAvoidanceTruth,
      targetEstimate: targetMotionEstimate,
    });
    targetDirection.x = nextDirection.x;
    targetDirection.z = nextDirection.z;
    const nextTarget = resolveObstacleCollisions({
      x: targetPosition.x + targetDirection.x * vehicleSettings.targetSpeedUnitsPerFrame,
      z: targetPosition.z + targetDirection.z * vehicleSettings.targetSpeedUnitsPerFrame,
    }, targetPosition, columns, rows, obstacles);
    targetPosition.x = nextTarget.x;
    targetPosition.z = nextTarget.z;
    simulationFrameIndex += 1;
  };

  const tick = (timestamp) => {
    const elapsedMs = Math.max(0, Math.min(250, timestamp - previousRenderTimeMs));
    previousRenderTimeMs = timestamp;
    pendingSimulationFrames = Math.min(
      pendingSimulationFrames + elapsedMs / SIMULATION_FRAME_DURATION_MS,
      MAX_SIMULATION_STEPS_PER_TICK,
    );

    const stepsToRun = Math.floor(pendingSimulationFrames);
    for (let stepIndex = 0; stepIndex < stepsToRun; stepIndex += 1) {
      stepSimulationFrame();
      pendingSimulationFrames -= 1;
    }

    renderScene();
    animationFrame = window.requestAnimationFrame(tick);
  };
  animationFrame = window.requestAnimationFrame(tick);

  return {
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearControls);
      clearSidebarActions(setSidebarActionHandler);
      pressedKeys.clear();

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      chaser.geometry.dispose();
      chaser.material.dispose();
      chaserFieldOfView.geometry.dispose();
      chaserFieldOfView.material.dispose();
      target.geometry.dispose();
      target.material.dispose();
      syncProjectionFrames(targetProjectionGroup, targetProjectionFrames, 0);
      obstacleMeshes.forEach((obstacle) => {
        obstacle.geometry.dispose();
        obstacle.material.dispose();
      });
      renderer.dispose();
      chaserView.renderer?.dispose();
      chaserView.frame?.close();
      strategyDebugFrame?.close();
    },
  };
}
