import * as THREE from "three";
import { FIELD_OF_VIEW_DISTANCE } from "../config/constants.mjs";
import { SIMULATION_RENDERING_PROFILE } from "../rendering/profiles.ts";
import {
  applyChaseCameraProjection,
  configureChaseActorCamera,
  resolveChaseCamera,
} from "../rendering/camera.ts";
import {
  createChaseSensorPipeline,
  hasChaseSensorProcessing,
  resolveChaseSensor,
} from "../rendering/sensor.ts";
import { applyRenderingEnvironment } from "./rendering/environment.mjs";

const DEFAULT_ACTOR_VIEW_HEIGHT = 210;
const ACTOR_VIEW_IMAGE_RENDERER_ID = "chase-actor-view-threejs-v1";

function normalizeCaptureDimension(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.round(numericValue)
    : fallback;
}

function configureActorViewRenderCamera(camera, {
  actorPosition,
  actorLookDirection,
  fieldOfViewAngleRadians,
  fieldOfViewDistance = FIELD_OF_VIEW_DISTANCE,
  renderingProfile = SIMULATION_RENDERING_PROFILE,
  width,
  height,
}) {
  const resolvedCamera = resolveChaseCamera(
    renderingProfile,
    { fieldOfViewAngleRadians, fieldOfViewDistance },
    { width, height },
  );
  applyChaseCameraProjection(camera, resolvedCamera);
  configureChaseActorCamera(
    camera,
    actorPosition,
    actorLookDirection,
    resolvedCamera.mount,
  );
  return resolvedCamera;
}

export function renderActorViewScene({
  renderer,
  camera,
  scene,
  actorMesh,
  actorFieldOfView,
  otherActorFieldOfView,
  excludedObjects = [],
  renderScene,
}) {
  const hiddenObjects = [
    actorMesh,
    actorFieldOfView,
    otherActorFieldOfView,
    ...excludedObjects,
  ].filter(Boolean);
  const priorVisibility = hiddenObjects.map((object) => [object, object.visible]);
  hiddenObjects.forEach((object) => {
    object.visible = false;
  });
  try {
    (renderScene ?? ((nextScene, nextCamera) => renderer.render(nextScene, nextCamera)))(scene, camera);
  } finally {
    priorVisibility.forEach(([object, visible]) => {
      object.visible = visible;
    });
  }
}

function createCaptureRenderer() {
  return new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
}

function createCaptureCamera() {
  return new THREE.PerspectiveCamera(50, 4 / 3, 0.04, FIELD_OF_VIEW_DISTANCE);
}

/** Owns one reusable offscreen WebGL context for front-view image captures. */
export function createActorViewImageCapture({
  createRenderer = createCaptureRenderer,
  createCamera = createCaptureCamera,
  createSensorPipeline = createChaseSensorPipeline,
} = {}) {
  let renderer = null;
  let camera = null;
  let sensorPipeline = null;

  const disposeRenderer = () => {
    if (!renderer) {
      return;
    }
    const activeRenderer = renderer;
    renderer = null;
    sensorPipeline?.dispose();
    sensorPipeline = null;
    const context = activeRenderer.getContext?.();
    activeRenderer.dispose?.();
    if (!context?.isContextLost?.()) {
      activeRenderer.forceContextLoss?.();
    }
  };

  const ensureResources = () => {
    if (renderer?.getContext?.().isContextLost?.()) {
      disposeRenderer();
    }
    if (!renderer) {
      renderer = createRenderer();
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1);
    }
    camera ??= createCamera();
    return { renderer, camera };
  };

  const capture = ({
    scene,
    actorMesh,
    actorFieldOfView,
    otherActorFieldOfView,
    actorPosition,
    actorLookDirection,
    fieldOfViewAngleRadians,
    fieldOfViewDistance = FIELD_OF_VIEW_DISTANCE,
    renderingProfile = SIMULATION_RENDERING_PROFILE,
    excludedObjects = [],
    width,
    height,
    contentType = "image/png",
    quality,
  } = {}) => {
    if (!scene || !actorMesh || !actorFieldOfView || !actorPosition || !actorLookDirection) {
      return null;
    }
    const imageWidth = normalizeCaptureDimension(
      width,
      renderingProfile.camera.projection.imageWidth,
    );
    const imageHeight = normalizeCaptureDimension(
      height,
      renderingProfile.camera.projection.imageHeight,
    );
    const resources = ensureResources();
    resources.renderer.setSize(imageWidth, imageHeight, false);
    applyRenderingEnvironment({ renderer: resources.renderer }, renderingProfile);
    const resolvedCamera = configureActorViewRenderCamera(resources.camera, {
      actorPosition,
      actorLookDirection,
      fieldOfViewAngleRadians,
      fieldOfViewDistance,
      renderingProfile,
      width: imageWidth,
      height: imageHeight,
    });
    const sensor = resolveChaseSensor(renderingProfile);
    renderActorViewScene({
      renderer: resources.renderer,
      camera: resources.camera,
      scene,
      actorMesh,
      actorFieldOfView,
      otherActorFieldOfView,
      excludedObjects,
      renderScene: (nextScene, nextCamera) => {
        if (!hasChaseSensorProcessing(sensor)) {
          resources.renderer.render(nextScene, nextCamera);
          return;
        }
        sensorPipeline ??= createSensorPipeline(resources.renderer);
        sensorPipeline.render(nextScene, nextCamera, sensor, imageWidth, imageHeight);
      },
    });
    const dataUrl = contentType === "image/jpeg"
      ? resources.renderer.domElement.toDataURL(contentType, quality)
      : resources.renderer.domElement.toDataURL(contentType);
    return {
      contentType,
      rendererId: ACTOR_VIEW_IMAGE_RENDERER_ID,
      width: imageWidth,
      height: imageHeight,
      camera: resolvedCamera,
      sensor,
      dataUrl,
    };
  };

  return {
    capture,
    dispose() {
      disposeRenderer();
      camera = null;
    },
  };
}

export function createActorViewController({
  createFloatingFrame,
  vehicleSettings,
  getRenderingProfile = () => SIMULATION_RENDERING_PROFILE,
  onVisibilityChange,
  onControlWindowChange,
  onRenderWindowChange,
  frameId,
  title,
  lostLabelText,
}) {
  let mountedView = null;
  let suppressNextCloseNotification = false;
  let resizeFrame = 0;
  let currentControlWindow = null;

  const syncControlWindow = () => {
    const candidateWindow = mountedView?.frame.mount.ownerDocument?.defaultView ?? null;
    const nextControlWindow = candidateWindow && !candidateWindow.closed
      ? candidateWindow
      : null;
    if (nextControlWindow === currentControlWindow) {
      return;
    }
    currentControlWindow = nextControlWindow;
    onControlWindowChange?.(nextControlWindow);
  };

  const getRenderWindow = () => {
    const candidateWindow = mountedView?.frame.mount.ownerDocument?.defaultView ?? null;
    return candidateWindow && !candidateWindow.closed ? candidateWindow : null;
  };

  const clearControlWindow = () => {
    if (currentControlWindow === null) {
      return;
    }
    currentControlWindow = null;
    onControlWindowChange?.(null);
  };

  const resizeMountedView = () => {
    resizeFrame = 0;
    if (!mountedView) {
      return;
    }
    syncControlWindow();
    const viewWidth = Math.max(1, mountedView.frame.mount.clientWidth);
    const viewHeight = Math.max(1, mountedView.frame.mount.clientHeight);
    mountedView.renderer.setSize(viewWidth, viewHeight, false);
    applyChaseCameraProjection(
      mountedView.camera,
      resolveChaseCamera(
        getRenderingProfile(),
        {
          fieldOfViewAngleRadians: vehicleSettings.fieldOfViewAngleRadians,
          fieldOfViewDistance: vehicleSettings.fieldOfViewDistance,
        },
        { width: viewWidth, height: viewHeight },
      ),
    );
  };

  const scheduleMountedViewResize = () => {
    if (resizeFrame !== 0) {
      return;
    }
    resizeFrame = requestAnimationFrame(resizeMountedView);
  };

  const disposeMountedView = (notifyVisibilityChange) => {
    if (!mountedView) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    if (resizeFrame !== 0) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
    mountedView.resizeObserver.disconnect();
    mountedView.sensorPipeline?.dispose();
    mountedView.renderer.dispose();
    mountedView = null;
    clearControlWindow();
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
    const initialCamera = resolveChaseCamera(
      getRenderingProfile(),
      {
        fieldOfViewAngleRadians: vehicleSettings.fieldOfViewAngleRadians,
        fieldOfViewDistance: vehicleSettings.fieldOfViewDistance,
      },
    );
    const defaultWidth = Math.round(DEFAULT_ACTOR_VIEW_HEIGHT * initialCamera.projection.aspect);
    const frame = createFloatingFrame({
      id: frameId,
      title,
      bounds: "viewport",
      defaultPosition: {
        x: Math.max(16, window.innerWidth - defaultWidth - 24),
        y: 72,
      },
      defaultSize: { width: defaultWidth, height: DEFAULT_ACTOR_VIEW_HEIGHT },
      minSize: { width: 180, height: 140 },
      minimizable: true,
      resizable: true,
      popoutable: true,
      closeable: true,
      onPopoutChange: () => {
        syncControlWindow();
        onRenderWindowChange?.();
        const scheduleDockSync = typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (callback) => setTimeout(callback, 0);
        scheduleDockSync(() => {
          syncControlWindow();
          onRenderWindowChange?.();
        });
      },
      onClose: handleFrameClose,
    });
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const lostTargetLabel = document.createElement("div");
    const camera = new THREE.PerspectiveCamera(
      initialCamera.projection.verticalFovDegrees,
      initialCamera.projection.aspect,
      initialCamera.projection.near,
      initialCamera.projection.far,
    );
    const resizeObserver = new ResizeObserver(scheduleMountedViewResize);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    applyRenderingEnvironment({ renderer }, getRenderingProfile());
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
    lostTargetLabel.textContent = lostLabelText;
    frame.mount.appendChild(lostTargetLabel);

    mountedView = {
      frame,
      renderer,
      lostTargetLabel,
      camera,
      resizeObserver,
      sensorPipeline: null,
    };
    resizeObserver.observe(frame.mount);
    resizeMountedView();
    syncControlWindow();
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

  const setTrackedActorVisible = (visible) => {
    if (!mountedView) {
      return;
    }
    mountedView.lostTargetLabel.style.display = visible ? "none" : "block";
  };

  const render = ({
    scene,
    actorMesh,
    actorFieldOfView,
    otherActorFieldOfView,
    actorPosition,
    actorLookDirection,
  }) => {
    if (!mountedView) {
      return;
    }
    if (!getRenderWindow()) {
      syncControlWindow();
      return;
    }
    syncControlWindow();
    const renderingProfile = getRenderingProfile();
    const viewWidth = Math.max(1, mountedView.frame.mount.clientWidth);
    const viewHeight = Math.max(1, mountedView.frame.mount.clientHeight);
    applyRenderingEnvironment({ renderer: mountedView.renderer }, renderingProfile);
    configureActorViewRenderCamera(mountedView.camera, {
      actorPosition,
      actorLookDirection,
      fieldOfViewAngleRadians: vehicleSettings.fieldOfViewAngleRadians,
      fieldOfViewDistance: vehicleSettings.fieldOfViewDistance,
      renderingProfile,
      width: viewWidth,
      height: viewHeight,
    });
    const sensor = resolveChaseSensor(renderingProfile);
    renderActorViewScene({
      renderer: mountedView.renderer,
      camera: mountedView.camera,
      scene,
      actorMesh,
      actorFieldOfView,
      otherActorFieldOfView,
      renderScene: (nextScene, nextCamera) => {
        if (!hasChaseSensorProcessing(sensor)) {
          mountedView.renderer.render(nextScene, nextCamera);
          return;
        }
        mountedView.sensorPipeline ??= createChaseSensorPipeline(mountedView.renderer);
        const pixelRatio = mountedView.renderer.getPixelRatio?.() ?? 1;
        mountedView.sensorPipeline.render(
          nextScene,
          nextCamera,
          sensor,
          viewWidth * pixelRatio,
          viewHeight * pixelRatio,
        );
      },
    });
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    getRenderWindow,
    resize: resizeMountedView,
    setTrackedActorVisible,
    render,
    isOpen: () => mountedView !== null,
  };
}

export function createChaserViewController({
  createFloatingFrame,
  vehicleSettings,
  getRenderingProfile,
  onVisibilityChange,
  onControlWindowChange,
  onRenderWindowChange,
}) {
  return createActorViewController({
    createFloatingFrame,
    vehicleSettings,
    getRenderingProfile,
    onVisibilityChange,
    onControlWindowChange,
    onRenderWindowChange,
    frameId: "chaser-view",
    title: "Chaser View",
    lostLabelText: "Evader out of sight",
  });
}

export function createEvaderViewController({
  createFloatingFrame,
  vehicleSettings,
  getRenderingProfile,
  onVisibilityChange,
  onRenderWindowChange,
}) {
  return createActorViewController({
    createFloatingFrame,
    vehicleSettings,
    getRenderingProfile,
    onVisibilityChange,
    onRenderWindowChange,
    frameId: "evader-view",
    title: "Evader View",
    lostLabelText: "Chaser out of sight",
  });
}
