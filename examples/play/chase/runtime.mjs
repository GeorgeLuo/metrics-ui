import * as THREE from "three";
import {
  CAR_HEIGHT,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_SPEED_ACTION_ID,
  CHASER_VIEW_ACTION_ID,
  CHASER_VIEW_MAX_DISTANCE,
  DEFAULT_CHASER_SPEED_UNITS_PER_SECOND,
  DEFAULT_CAR_TURN_RATE_RADIANS_PER_SECOND,
  DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS,
  DEFAULT_TARGET_SPEED_UNITS_PER_SECOND,
  MAX_TARGET_PROJECTION_HORIZON_FRAMES,
  MAX_TARGET_PROJECTION_SAMPLES_PER_SECOND,
  STRATEGY_DEBUG_ACTION_ID,
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
    chaserSpeedUnitsPerSecond: DEFAULT_CHASER_SPEED_UNITS_PER_SECOND,
    targetSpeedUnitsPerSecond: DEFAULT_TARGET_SPEED_UNITS_PER_SECOND,
    turnRateRadiansPerSecond: DEFAULT_CAR_TURN_RATE_RADIANS_PER_SECOND,
    fieldOfViewAngleRadians: DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS,
  };
}

function createChaserViewController({ createFloatingFrame, vehicleSettings, onVisibilityChange }) {
  const chaserViewWidth = 280;
  let mountedView = null;
  let suppressNextCloseNotification = false;

  const resizeMountedView = () => {
    if (!mountedView) {
      return;
    }
    const viewWidth = Math.max(1, mountedView.frame.mount.clientWidth);
    const viewHeight = Math.max(1, mountedView.frame.mount.clientHeight);
    mountedView.renderer.setSize(viewWidth, viewHeight, false);
    mountedView.camera.aspect = viewWidth / viewHeight;
    mountedView.camera.updateProjectionMatrix();
  };

  const disposeMountedView = (notifyVisibilityChange) => {
    if (!mountedView) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    mountedView.resizeObserver.disconnect();
    mountedView.renderer.dispose();
    mountedView = null;
    if (notifyVisibilityChange) {
      onVisibilityChange?.(false);
    }
  };

  const handleFrameClose = () => {
    const notifyVisibilityChange = !suppressNextCloseNotification;
    suppressNextCloseNotification = false;
    disposeMountedView(notifyVisibilityChange);
  };

  const open = () => {
    if (mountedView || typeof createFloatingFrame !== "function") {
      return;
    }
    const frame = createFloatingFrame({
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
      closeable: true,
      onClose: handleFrameClose,
    });
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const lostTargetLabel = document.createElement("div");
    const camera = new THREE.PerspectiveCamera(
      vehicleSettings.fieldOfViewAngleRadians * 180 / Math.PI,
      4 / 3,
      0.04,
      CHASER_VIEW_MAX_DISTANCE,
    );
    const resizeObserver = new ResizeObserver(resizeMountedView);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    frame.mount.appendChild(renderer.domElement);

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
    frame.mount.appendChild(lostTargetLabel);

    mountedView = {
      frame,
      renderer,
      lostTargetLabel,
      camera,
      resizeObserver,
    };
    resizeObserver.observe(frame.mount);
    resizeMountedView();
    onVisibilityChange?.(true);
  };

  const close = ({ notifyVisibilityChange = true } = {}) => {
    if (!mountedView) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    suppressNextCloseNotification = !notifyVisibilityChange;
    mountedView.frame.close();
  };

  const setFieldOfViewAngleRadians = (fieldOfViewAngleRadians) => {
    if (!mountedView) {
      return;
    }
    mountedView.camera.fov = fieldOfViewAngleRadians * 180 / Math.PI;
    mountedView.camera.updateProjectionMatrix();
  };

  const setTargetVisible = (targetVisible) => {
    if (!mountedView) {
      return;
    }
    mountedView.lostTargetLabel.style.display = targetVisible ? "none" : "block";
  };

  const render = ({ scene, chaser, chaserFieldOfView, chaserPosition, chaserLookDirection }) => {
    if (!mountedView) {
      return;
    }
    configureChaserViewCamera(mountedView.camera, chaserPosition, chaserLookDirection);
    chaser.visible = false;
    chaserFieldOfView.visible = false;
    mountedView.renderer.render(scene, mountedView.camera);
    chaser.visible = true;
    chaserFieldOfView.visible = true;
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    resize: resizeMountedView,
    setFieldOfViewAngleRadians,
    setTargetVisible,
    render,
    isOpen: () => mountedView !== null,
  };
}

function createStrategyDebugController({ createFloatingFrame, onVisibilityChange }) {
  let mountedDebugFrame = null;
  let suppressNextCloseNotification = false;

  const handleFrameClose = () => {
    const notifyVisibilityChange = !suppressNextCloseNotification;
    suppressNextCloseNotification = false;
    mountedDebugFrame = null;
    if (notifyVisibilityChange) {
      onVisibilityChange?.(false);
    }
  };

  const open = () => {
    if (mountedDebugFrame) {
      return;
    }
    mountedDebugFrame = mountStrategyDebugFrame(createFloatingFrame, {
      onClose: handleFrameClose,
    });
    if (mountedDebugFrame) {
      onVisibilityChange?.(true);
    }
  };

  const close = ({ notifyVisibilityChange = true } = {}) => {
    if (!mountedDebugFrame) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    suppressNextCloseNotification = !notifyVisibilityChange;
    mountedDebugFrame.close();
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    update: (payload) => mountedDebugFrame?.update(payload),
    isOpen: () => mountedDebugFrame !== null,
  };
}

function registerSidebarActions({
  setSidebarActionHandler,
  getProgrammaticChaserEnabled,
  setProgrammaticChaserEnabled,
  refreshSidebarSections,
  getChaserViewVisible,
  openChaserView,
  closeChaserView,
  getStrategyDebugVisible,
  openStrategyDebug,
  closeStrategyDebug,
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
  setSidebarActionHandler(CHASER_VIEW_ACTION_ID, (value) => {
    const nextVisible = typeof value === "boolean" ? value : !getChaserViewVisible();
    if (nextVisible) {
      openChaserView();
    } else {
      closeChaserView();
    }
  });
  setSidebarActionHandler(CHASER_SPEED_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.chaserSpeedUnitsPerSecond = clampNumber(parsed, 0.2, 12);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(TARGET_SPEED_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.targetSpeedUnitsPerSecond = clampNumber(parsed, 0.2, 12);
    }
    refreshSidebarSections();
  });
  setSidebarActionHandler(VEHICLE_TURN_RATE_ACTION_ID, (value) => {
    const parsed = parseEditableNumber(value);
    if (parsed !== null) {
      vehicleSettings.turnRateRadiansPerSecond = degreesToRadians(clampNumber(parsed, 10, 720));
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
  setSidebarActionHandler(STRATEGY_DEBUG_ACTION_ID, (value) => {
    const nextVisible = typeof value === "boolean" ? value : !getStrategyDebugVisible();
    if (nextVisible) {
      openStrategyDebug();
    } else {
      closeStrategyDebug();
    }
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
      projectionSettings.samplesPerSecond = clampNumber(
        parsed,
        0.5,
        MAX_TARGET_PROJECTION_SAMPLES_PER_SECOND,
      );
      writeStoredProjectionSettings(projectionSettings);
    }
    refreshSidebarSections();
  });
}

function clearSidebarActions(setSidebarActionHandler) {
  setSidebarActionHandler?.(CHASER_AUTOPILOT_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_VIEW_ACTION_ID, null);
  setSidebarActionHandler?.(CHASER_SPEED_ACTION_ID, null);
  setSidebarActionHandler?.(STRATEGY_DEBUG_ACTION_ID, null);
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
  let chaserViewVisible = false;
  let strategyDebugVisible = false;
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
      {
        chaserViewVisible,
        strategyDebugVisible,
      },
      vehicleSettings,
      projectionSettings,
    );
  };

  const chaserView = createChaserViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange: (visible) => {
      chaserViewVisible = visible;
      refreshSidebarSections();
    },
  });
  const strategyDebugFrame = createStrategyDebugController({
    createFloatingFrame,
    onVisibilityChange: (visible) => {
      strategyDebugVisible = visible;
      refreshSidebarSections();
    },
  });
  const updateFieldOfView = () => {
    if (chaserFieldOfView) {
      const nextGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
      chaserFieldOfView.geometry.dispose();
      chaserFieldOfView.geometry = nextGeometry;
    }
    chaserView.setFieldOfViewAngleRadians(vehicleSettings.fieldOfViewAngleRadians);
  };

  refreshSidebarSections();
  registerSidebarActions({
    setSidebarActionHandler,
    getProgrammaticChaserEnabled: () => programmaticChaserEnabled,
    setProgrammaticChaserEnabled: (value) => {
      programmaticChaserEnabled = value;
    },
    refreshSidebarSections,
    getChaserViewVisible: () => chaserViewVisible,
    openChaserView: () => chaserView.open(),
    closeChaserView: () => chaserView.close(),
    getStrategyDebugVisible: () => strategyDebugVisible,
    openStrategyDebug: () => strategyDebugFrame.open(),
    closeStrategyDebug: () => strategyDebugFrame.close(),
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
    chaserView.resize();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let animationFrame = 0;
  let previousTime = performance.now();
  const tick = (timestamp) => {
    const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - previousTime) / 1000));
    previousTime = timestamp;

    const chaserPerception = getChaserTargetPerception(
      chaserPosition,
      targetPosition,
      chaserLookDirection,
      vehicleSettings.fieldOfViewAngleRadians,
      obstacles,
    );
    chaserView.setTargetVisible(chaserPerception.visible);
    updateTargetMotionEstimate(
      targetMotionEstimate,
      chaserPerception,
      chaserPosition,
      chaserLookDirection,
      deltaSeconds,
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
    const targetPredictionPlan = buildTargetPredictionPlan({
      estimate: targetMotionEstimate,
      speedUnitsPerSecond: targetMotionEstimate.speedEstimateUnitsPerSecond,
      columns,
      rows,
      obstacles,
      wallAvoidanceEvidence,
      deltaSeconds,
      targetVisible: chaserPerception.visible,
      planState: targetPredictionPlanState,
      horizonFrames: projectionSettings.horizonFrames,
      samplesPerSecond: projectionSettings.samplesPerSecond,
    });
    updateTargetProjectionDisplay(
      targetProjectionGroup,
      targetProjectionFrames,
      targetMotionEstimate,
      targetPredictionPlan.prediction,
      projectionSettings,
      targetMotionEstimate.speedEstimateUnitsPerSecond,
      targetPredictionPlan.path,
    );

    const chaserInput = programmaticChaserEnabled
      ? getProgrammaticChaserInput({
        targetPerception: chaserPerception,
        chaserPosition,
        chaserLookDirection,
        targetEstimate: targetMotionEstimate,
        predictionPlan: targetPredictionPlan,
        autopilotState: chaserAutopilotState,
        chaserSpeedUnitsPerSecond: vehicleSettings.chaserSpeedUnitsPerSecond,
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
          + steeringInput * vehicleSettings.turnRateRadiansPerSecond * deltaSeconds,
      );
      chaserLookDirection.x = nextHeading.x;
      chaserLookDirection.z = nextHeading.z;
    }
    const nextChaser = resolveObstacleCollisions({
      x: chaserPosition.x
        + chaserLookDirection.x * vehicleSettings.chaserSpeedUnitsPerSecond * deltaSeconds * (isChaserMoving ? 1 : 0),
      z: chaserPosition.z
        + chaserLookDirection.z * vehicleSettings.chaserSpeedUnitsPerSecond * deltaSeconds * (isChaserMoving ? 1 : 0),
    }, chaserPosition, columns, rows, obstacles);
    chaserPosition.x = nextChaser.x;
    chaserPosition.z = nextChaser.z;

    const targetMovementDecision = getTargetMovementDecision(
      targetPosition,
      targetDirection,
      columns,
      rows,
      timestamp,
      obstacles,
    );
    const nextDirection = constrainDirectionToBounds(
      targetPosition,
      steerDirectionToward(
        targetDirection,
        targetMovementDecision.direction,
        vehicleSettings.turnRateRadiansPerSecond * deltaSeconds,
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
      x: targetPosition.x + targetDirection.x * vehicleSettings.targetSpeedUnitsPerSecond * deltaSeconds,
      z: targetPosition.z + targetDirection.z * vehicleSettings.targetSpeedUnitsPerSecond * deltaSeconds,
    }, targetPosition, columns, rows, obstacles);
    targetPosition.x = nextTarget.x;
    targetPosition.z = nextTarget.z;

    chaser.position.set(chaserPosition.x, CAR_HEIGHT / 2, chaserPosition.z);
    chaser.rotation.y = vectorToAngle(chaserLookDirection);
    chaserFieldOfView.position.set(chaserPosition.x, 0, chaserPosition.z);
    chaserFieldOfView.rotation.y = vectorToAngle(chaserLookDirection);
    target.position.set(targetPosition.x, CAR_HEIGHT / 2, targetPosition.z);
    target.rotation.y = vectorToAngle(targetDirection);

    renderer.render(scene, camera);
    chaserView.render({ scene, chaser, chaserFieldOfView, chaserPosition, chaserLookDirection });
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
      chaserView.dispose();
      strategyDebugFrame.dispose();
    },
  };
}
