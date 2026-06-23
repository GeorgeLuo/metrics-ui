import * as THREE from "three";
import { CHASER_VIEW_MAX_DISTANCE } from "../config/constants.mjs";
import { configureChaserViewCamera } from "./rendering.mjs";

const DEFAULT_ACTOR_VIEW_WIDTH = 280;
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
  width,
  height,
}) {
  camera.fov = fieldOfViewAngleRadians * 180 / Math.PI;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  configureChaserViewCamera(camera, actorPosition, actorLookDirection);
}

function renderActorViewScene({
  renderer,
  camera,
  scene,
  actorMesh,
  actorFieldOfView,
  otherActorFieldOfView,
}) {
  const actorMeshVisible = actorMesh.visible;
  const actorFieldOfViewVisible = actorFieldOfView.visible;
  const otherActorFieldOfViewVisible = otherActorFieldOfView?.visible ?? false;
  actorMesh.visible = false;
  actorFieldOfView.visible = false;
  if (otherActorFieldOfView) {
    otherActorFieldOfView.visible = false;
  }
  renderer.render(scene, camera);
  actorMesh.visible = actorMeshVisible;
  actorFieldOfView.visible = actorFieldOfViewVisible;
  if (otherActorFieldOfView) {
    otherActorFieldOfView.visible = otherActorFieldOfViewVisible;
  }
}

export function captureActorViewImage({
  scene,
  actorMesh,
  actorFieldOfView,
  otherActorFieldOfView,
  actorPosition,
  actorLookDirection,
  fieldOfViewAngleRadians,
  width,
  height,
  contentType = "image/png",
} = {}) {
  if (!scene || !actorMesh || !actorFieldOfView || !actorPosition || !actorLookDirection) {
    return null;
  }
  const imageWidth = normalizeCaptureDimension(width, 640);
  const imageHeight = normalizeCaptureDimension(height, 480);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  const camera = new THREE.PerspectiveCamera(
    fieldOfViewAngleRadians * 180 / Math.PI,
    imageWidth / imageHeight,
    0.04,
    CHASER_VIEW_MAX_DISTANCE,
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.setSize(imageWidth, imageHeight, false);
  configureActorViewRenderCamera(camera, {
    actorPosition,
    actorLookDirection,
    fieldOfViewAngleRadians,
    width: imageWidth,
    height: imageHeight,
  });
  renderActorViewScene({
    renderer,
    camera,
    scene,
    actorMesh,
    actorFieldOfView,
    otherActorFieldOfView,
  });
  const dataUrl = renderer.domElement.toDataURL(contentType);
  renderer.dispose();
  renderer.forceContextLoss?.();
  return {
    contentType,
    rendererId: ACTOR_VIEW_IMAGE_RENDERER_ID,
    width: imageWidth,
    height: imageHeight,
    dataUrl,
  };
}

export function createActorViewController({
  createFloatingFrame,
  vehicleSettings,
  onVisibilityChange,
  onControlWindowChange,
  frameId,
  title,
  lostLabelText,
}) {
  let mountedView = null;
  let suppressNextCloseNotification = false;
  let resizeFrame = 0;
  let currentControlWindow = null;

  const syncControlWindow = () => {
    const nextControlWindow = mountedView?.frame.mount.ownerDocument?.defaultView ?? null;
    if (nextControlWindow === currentControlWindow) {
      return;
    }
    currentControlWindow = nextControlWindow;
    onControlWindowChange?.(nextControlWindow);
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
    mountedView.camera.aspect = viewWidth / viewHeight;
    mountedView.camera.updateProjectionMatrix();
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
    const frame = createFloatingFrame({
      id: frameId,
      title,
      bounds: "viewport",
      defaultPosition: {
        x: Math.max(16, window.innerWidth - DEFAULT_ACTOR_VIEW_WIDTH - 24),
        y: 72,
      },
      defaultSize: { width: DEFAULT_ACTOR_VIEW_WIDTH, height: 210 },
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
    const resizeObserver = new ResizeObserver(scheduleMountedViewResize);

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
    lostTargetLabel.textContent = lostLabelText;
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

  const setFieldOfViewAngleRadians = (fieldOfViewAngleRadians) => {
    if (!mountedView) {
      return;
    }
    mountedView.camera.fov = fieldOfViewAngleRadians * 180 / Math.PI;
    mountedView.camera.updateProjectionMatrix();
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
    syncControlWindow();
    configureChaserViewCamera(mountedView.camera, actorPosition, actorLookDirection);
    renderActorViewScene({
      renderer: mountedView.renderer,
      camera: mountedView.camera,
      scene,
      actorMesh,
      actorFieldOfView,
      otherActorFieldOfView,
    });
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    getRenderWindow: () => mountedView?.frame.mount.ownerDocument?.defaultView ?? null,
    resize: resizeMountedView,
    setFieldOfViewAngleRadians,
    setTrackedActorVisible,
    render,
    isOpen: () => mountedView !== null,
  };
}

export function createChaserViewController({
  createFloatingFrame,
  vehicleSettings,
  onVisibilityChange,
  onControlWindowChange,
}) {
  return createActorViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange,
    onControlWindowChange,
    frameId: "chaser-view",
    title: "Chaser View",
    lostLabelText: "Evader out of sight",
  });
}

export function createEvaderViewController({ createFloatingFrame, vehicleSettings, onVisibilityChange }) {
  return createActorViewController({
    createFloatingFrame,
    vehicleSettings,
    onVisibilityChange,
    frameId: "evader-view",
    title: "Evader View",
    lostLabelText: "Chaser out of sight",
  });
}
