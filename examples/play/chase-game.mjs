import * as THREE from "three";

export const manifest = {
  id: "chase",
  label: "Chase",
  description: "A same-speed overhead chase field: WASD moves the blue chaser while the red target follows autonomous drift.",
  frameAspect: [9, 6],
  grid: [9, 6],
};

const DOT_RADIUS = 0.1;
const DOT_SPEED_UNITS_PER_SECOND = 2.4;
const CONTROL_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const FIELD_OF_VIEW_ANGLE_RADIANS = Math.PI / 3;
const FIELD_OF_VIEW_SEGMENTS = 28;
const CHASER_VIEW_CAMERA_HEIGHT = 0.42;
const CHASER_VIEW_LOOK_DISTANCE = 3;
const CHASER_VIEW_MAX_DISTANCE = 9;
const FIELD_OF_VIEW_DISTANCE = CHASER_VIEW_MAX_DISTANCE;
const WALL_AVOID_DISTANCE = 0.8;
const EDGE_LOCK_EPSILON = 0.04;

function isTextEditingTarget(target) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function normalizeVector(x, z) {
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function getGroundBounds(columns, rows) {
  const halfWidth = columns / 2;
  const halfDepth = rows / 2;
  return {
    minX: -halfWidth + DOT_RADIUS,
    maxX: halfWidth - DOT_RADIUS,
    minZ: -halfDepth + DOT_RADIUS,
    maxZ: halfDepth - DOT_RADIUS,
  };
}

function clampPosition(position, columns, rows) {
  const bounds = getGroundBounds(columns, rows);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z)),
  };
}

function getDriftDirection(timestamp) {
  return normalizeVector(
    Math.sin(timestamp * 0.0007),
    Math.cos(timestamp * 0.0005),
  );
}

function constrainDirectionToBounds(position, direction, columns, rows) {
  const bounds = getGroundBounds(columns, rows);
  let x = direction.x;
  let z = direction.z;

  if (position.x >= bounds.maxX - EDGE_LOCK_EPSILON && x > 0) {
    x = -Math.max(0.35, Math.abs(z) * 0.5);
  } else if (position.x <= bounds.minX + EDGE_LOCK_EPSILON && x < 0) {
    x = Math.max(0.35, Math.abs(z) * 0.5);
  }

  if (position.z >= bounds.maxZ - EDGE_LOCK_EPSILON && z > 0) {
    z = -Math.max(0.35, Math.abs(x) * 0.5);
  } else if (position.z <= bounds.minZ + EDGE_LOCK_EPSILON && z < 0) {
    z = Math.max(0.35, Math.abs(x) * 0.5);
  }

  const constrained = normalizeVector(x, z);
  return constrained.x === 0 && constrained.z === 0
    ? normalizeVector(-position.x, -position.z)
    : constrained;
}

function getTargetDirection(targetPosition, currentDirection, columns, rows, timestamp) {
  const bounds = getGroundBounds(columns, rows);
  const drift = getDriftDirection(timestamp);
  const wallDirection = {
    x:
      Math.max(0, 1 - ((targetPosition.x - bounds.minX) / WALL_AVOID_DISTANCE)) * 2.5
      - Math.max(0, 1 - ((bounds.maxX - targetPosition.x) / WALL_AVOID_DISTANCE)) * 2.5,
    z:
      Math.max(0, 1 - ((targetPosition.z - bounds.minZ) / WALL_AVOID_DISTANCE)) * 2.5
      - Math.max(0, 1 - ((bounds.maxZ - targetPosition.z) / WALL_AVOID_DISTANCE)) * 2.5,
  };
  const direction = normalizeVector(
    drift.x * 0.45 + wallDirection.x + currentDirection.x,
    drift.z * 0.45 + wallDirection.z + currentDirection.z,
  );

  return constrainDirectionToBounds(
    targetPosition,
    direction.x === 0 && direction.z === 0 ? drift : direction,
    columns,
    rows,
  );
}

function createDot(color) {
  const geometry = new THREE.CylinderGeometry(DOT_RADIUS, DOT_RADIUS, 0.12, 32);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.45,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.08;
  return mesh;
}

function createFieldOfViewCone() {
  const positions = [0, 0.012, 0];
  for (let index = 0; index <= FIELD_OF_VIEW_SEGMENTS; index += 1) {
    const t = index / FIELD_OF_VIEW_SEGMENTS;
    const angle = -FIELD_OF_VIEW_ANGLE_RADIANS / 2 + t * FIELD_OF_VIEW_ANGLE_RADIANS;
    positions.push(
      Math.sin(angle) * FIELD_OF_VIEW_DISTANCE,
      0.012,
      Math.cos(angle) * FIELD_OF_VIEW_DISTANCE,
    );
  }

  const indices = [];
  for (let index = 1; index <= FIELD_OF_VIEW_SEGMENTS; index += 1) {
    indices.push(0, index, index + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

function configureCamera(camera, columns, rows, width, height) {
  const fieldAspect = columns / rows;
  const containerAspect = width > 0 && height > 0 ? width / height : fieldAspect;
  let viewWidth = columns;
  let viewHeight = rows;

  if (containerAspect > fieldAspect) {
    viewWidth = rows * containerAspect;
  } else {
    viewHeight = columns / containerAspect;
  }

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
}

function configureChaserViewCamera(camera, chaserPosition, lookDirection) {
  camera.position.set(chaserPosition.x, CHASER_VIEW_CAMERA_HEIGHT, chaserPosition.z);
  camera.lookAt(
    chaserPosition.x + lookDirection.x * CHASER_VIEW_LOOK_DISTANCE,
    DOT_RADIUS,
    chaserPosition.z + lookDirection.z * CHASER_VIEW_LOOK_DISTANCE,
  );
}

export function createPlayGame({ container, columns, rows, createFloatingFrame }) {
  const pressedKeys = new Set();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "block h-full w-full";
  container.appendChild(renderer.domElement);

  const chaserViewWidth = 280;
  const chaserViewFrame = typeof createFloatingFrame === "function"
    ? createFloatingFrame({
      id: "chaser-view",
      title: "Chaser View",
      defaultPosition: {
        x: Math.max(16, container.clientWidth - chaserViewWidth - 16),
        y: 16,
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
  if (chaserViewRenderer && chaserViewFrame) {
    chaserViewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    chaserViewRenderer.setClearColor(0x000000, 0);
    chaserViewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    chaserViewRenderer.domElement.style.display = "block";
    chaserViewRenderer.domElement.style.width = "100%";
    chaserViewRenderer.domElement.style.height = "100%";
    chaserViewFrame.mount.appendChild(chaserViewRenderer.domElement);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-columns / 2, columns / 2, rows / 2, -rows / 2, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const chaserViewCamera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(FIELD_OF_VIEW_ANGLE_RADIANS),
    4 / 3,
    0.04,
    CHASER_VIEW_MAX_DISTANCE,
  );

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(3, 8, 4);
  scene.add(ambientLight, keyLight);

  const chaserFieldOfView = createFieldOfViewCone();
  const chaser = createDot(0x38bdf8);
  const target = createDot(0xf43f5e);
  scene.add(chaserFieldOfView, chaser, target);

  const chaserPosition = { x: -columns / 4, z: 0 };
  const chaserLookDirection = normalizeVector(1, 0);
  const targetPosition = { x: columns / 4, z: 0 };
  const targetDirection = normalizeVector(-1, 0.4);

  const handleKeyDown = (event) => {
    if (!CONTROL_CODES.has(event.code) || isTextEditingTarget(event.target)) {
      return;
    }
    pressedKeys.add(event.code);
    event.preventDefault();
  };
  const handleKeyUp = (event) => {
    if (!CONTROL_CODES.has(event.code)) {
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

    if (chaserViewRenderer && chaserViewFrame) {
      const viewWidth = Math.max(1, chaserViewFrame.mount.clientWidth);
      const viewHeight = Math.max(1, chaserViewFrame.mount.clientHeight);
      chaserViewRenderer.setSize(viewWidth, viewHeight, false);
      chaserViewCamera.aspect = viewWidth / viewHeight;
      chaserViewCamera.updateProjectionMatrix();
    }
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  if (chaserViewFrame) {
    resizeObserver.observe(chaserViewFrame.mount);
  }

  let animationFrame = 0;
  let previousTime = performance.now();
  const tick = (timestamp) => {
    const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - previousTime) / 1000));
    previousTime = timestamp;

    const input = normalizeVector(
      (pressedKeys.has("KeyD") ? 1 : 0) - (pressedKeys.has("KeyA") ? 1 : 0),
      (pressedKeys.has("KeyS") ? 1 : 0) - (pressedKeys.has("KeyW") ? 1 : 0),
    );
    if (input.x !== 0 || input.z !== 0) {
      chaserLookDirection.x = input.x;
      chaserLookDirection.z = input.z;
    }
    const nextChaser = clampPosition({
      x: chaserPosition.x + input.x * DOT_SPEED_UNITS_PER_SECOND * deltaSeconds,
      z: chaserPosition.z + input.z * DOT_SPEED_UNITS_PER_SECOND * deltaSeconds,
    }, columns, rows);
    chaserPosition.x = nextChaser.x;
    chaserPosition.z = nextChaser.z;

    const nextDirection = getTargetDirection(
      targetPosition,
      targetDirection,
      columns,
      rows,
      timestamp,
    );
    targetDirection.x = nextDirection.x;
    targetDirection.z = nextDirection.z;
    const nextTarget = clampPosition({
      x: targetPosition.x + targetDirection.x * DOT_SPEED_UNITS_PER_SECOND * deltaSeconds,
      z: targetPosition.z + targetDirection.z * DOT_SPEED_UNITS_PER_SECOND * deltaSeconds,
    }, columns, rows);
    targetPosition.x = nextTarget.x;
    targetPosition.z = nextTarget.z;

    chaser.position.set(chaserPosition.x, 0.08, chaserPosition.z);
    chaserFieldOfView.position.set(chaserPosition.x, 0, chaserPosition.z);
    chaserFieldOfView.rotation.y = Math.atan2(chaserLookDirection.x, chaserLookDirection.z);
    target.position.set(targetPosition.x, 0.08, targetPosition.z);

    renderer.render(scene, camera);
    if (chaserViewRenderer) {
      configureChaserViewCamera(chaserViewCamera, chaserPosition, chaserLookDirection);
      chaser.visible = false;
      chaserFieldOfView.visible = false;
      chaserViewRenderer.render(scene, chaserViewCamera);
      chaser.visible = true;
      chaserFieldOfView.visible = true;
    }
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
      renderer.dispose();
      chaserViewRenderer?.dispose();
      chaserViewFrame?.close();
    },
  };
}
