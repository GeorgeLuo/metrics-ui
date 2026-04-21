import * as THREE from "three";

export const manifest = {
  id: "chase",
  label: "Chase",
  description: "A same-speed overhead chase field: I moves the blue chaser forward while A/D steer left and right.",
  frameAspect: [9, 6],
  grid: [9, 6],
};

const CAR_WIDTH = 0.24;
const CAR_LENGTH = 0.46;
const CAR_HEIGHT = 0.14;
const CAR_BOUND_RADIUS = Math.hypot(CAR_WIDTH, CAR_LENGTH) / 2;
const DEFAULT_CAR_SPEED_UNITS_PER_SECOND = 2.4;
const DEFAULT_CAR_TURN_RATE_RADIANS_PER_SECOND = Math.PI * 1.15;
const FORWARD_CONTROL_CODES = new Set(["KeyI"]);
const LEFT_CONTROL_CODES = new Set(["KeyA"]);
const RIGHT_CONTROL_CODES = new Set(["KeyD"]);
const CONTROL_CODES = new Set([
  ...FORWARD_CONTROL_CODES,
  ...LEFT_CONTROL_CODES,
  ...RIGHT_CONTROL_CODES,
]);
const CHASER_AUTOPILOT_ACTION_ID = "chaser-autopilot";
const VEHICLE_SPEED_ACTION_ID = "vehicle-speed";
const VEHICLE_TURN_RATE_ACTION_ID = "vehicle-turn-rate";
const VEHICLE_FOV_ACTION_ID = "vehicle-fov";
const CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS = 0.08;
const CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING = 1;
const DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS = Math.PI / 3;
const FIELD_OF_VIEW_SEGMENTS = 28;
const CHASER_VIEW_CAMERA_HEIGHT = 0.42;
const CHASER_VIEW_LOOK_DISTANCE = 3;
const CHASER_VIEW_MAX_DISTANCE = 9;
const FIELD_OF_VIEW_DISTANCE = CHASER_VIEW_MAX_DISTANCE;
const WALL_AVOID_DISTANCE = 0.8;
const EDGE_LOCK_EPSILON = 0.04;
const PILLAR_RADIUS = 0.42;
const PILLAR_HEIGHT = 0.9;
const PILLAR_SEGMENTS = 28;
const WALL_THICKNESS = PILLAR_RADIUS * 2;
const WALL_LENGTH_RATIO = 0.36;

function isTextEditingTarget(target) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function normalizeVector(x, z) {
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function hasPressedKey(pressedKeys, codes) {
  for (const code of codes) {
    if (pressedKeys.has(code)) {
      return true;
    }
  }
  return false;
}

function getHumanChaserInput(pressedKeys) {
  return {
    forward: hasPressedKey(pressedKeys, FORWARD_CONTROL_CODES),
    steering:
      (hasPressedKey(pressedKeys, LEFT_CONTROL_CODES) ? 1 : 0)
      - (hasPressedKey(pressedKeys, RIGHT_CONTROL_CODES) ? 1 : 0),
  };
}

function vectorToAngle(direction) {
  return Math.atan2(direction.x, direction.z);
}

function angleToVector(angle) {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

function normalizeAngleDelta(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatEditableNumber(value, digits = 1) {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function parseEditableNumber(value) {
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function getFieldObstacleLayout(columns, rows) {
  return {
    pillars: [-1, 1].map((zSign) => ({
      x: columns / 4,
      z: zSign * rows / 4,
    })),
    walls: [
      {
        x: -columns / 4,
        z: 0,
        width: WALL_THICKNESS,
        depth: rows * WALL_LENGTH_RATIO,
      },
    ],
  };
}

function getWallBounds(wall, padding = 0) {
  return {
    minX: wall.x - wall.width / 2 - padding,
    maxX: wall.x + wall.width / 2 + padding,
    minZ: wall.z - wall.depth / 2 - padding,
    maxZ: wall.z + wall.depth / 2 + padding,
  };
}

function isPositionInsideBounds(position, bounds) {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

function doesLineSegmentIntersectBounds(startPosition, endPosition, bounds) {
  const directionX = endPosition.x - startPosition.x;
  const directionZ = endPosition.z - startPosition.z;
  let tMin = 0;
  let tMax = 1;

  const applySlab = (start, direction, min, max) => {
    if (direction === 0) {
      return start >= min && start <= max;
    }
    const first = (min - start) / direction;
    const second = (max - start) / direction;
    tMin = Math.max(tMin, Math.min(first, second));
    tMax = Math.min(tMax, Math.max(first, second));
    return tMin <= tMax;
  };

  return applySlab(startPosition.x, directionX, bounds.minX, bounds.maxX)
    && applySlab(startPosition.z, directionZ, bounds.minZ, bounds.maxZ)
    && tMax > 0
    && tMin < 1;
}

function isLineOfSightBlockedByObstacles(startPosition, endPosition, obstacles) {
  const segmentX = endPosition.x - startPosition.x;
  const segmentZ = endPosition.z - startPosition.z;
  const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  if (segmentLengthSquared === 0) {
    return false;
  }

  const isBlockedByPillar = obstacles.pillars.some((pillar) => {
    const t = (
      (pillar.x - startPosition.x) * segmentX
      + (pillar.z - startPosition.z) * segmentZ
    ) / segmentLengthSquared;
    if (t <= 0 || t >= 1) {
      return false;
    }

    const closestX = startPosition.x + segmentX * t;
    const closestZ = startPosition.z + segmentZ * t;
    return Math.hypot(pillar.x - closestX, pillar.z - closestZ) <= PILLAR_RADIUS;
  });
  return isBlockedByPillar
    || obstacles.walls.some((wall) =>
      doesLineSegmentIntersectBounds(startPosition, endPosition, getWallBounds(wall)),
    );
}

function getChaserTargetPerception(
  chaserPosition,
  targetPosition,
  chaserLookDirection,
  fieldOfViewAngleRadians,
  obstacles,
) {
  const offsetX = targetPosition.x - chaserPosition.x;
  const offsetZ = targetPosition.z - chaserPosition.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance <= CAR_BOUND_RADIUS) {
    return { visible: true, bearingRadians: 0, distance };
  }

  const targetDirection = normalizeVector(offsetX, offsetZ);
  const bearingRadians = normalizeAngleDelta(
    vectorToAngle(targetDirection) - vectorToAngle(chaserLookDirection),
  );
  const targetAngularRadius = Math.atan2(CAR_BOUND_RADIUS, distance);
  const isVisible =
    distance <= FIELD_OF_VIEW_DISTANCE + CAR_BOUND_RADIUS
    && Math.abs(bearingRadians) <= fieldOfViewAngleRadians / 2 + targetAngularRadius;
  const isOccluded = isVisible
    && isLineOfSightBlockedByObstacles(chaserPosition, targetPosition, obstacles);

  return isVisible && !isOccluded
    ? { visible: true, bearingRadians, distance }
    : { visible: false };
}

function getProgrammaticChaserInput(targetPerception, autopilotState) {
  if (!targetPerception.visible) {
    return {
      forward: true,
      steering: autopilotState.searchSteering,
    };
  }

  const steering = targetPerception.bearingRadians > CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS
    ? 1
    : targetPerception.bearingRadians < -CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS
      ? -1
      : 0;
  if (steering !== 0) {
    autopilotState.searchSteering = steering;
  }

  return {
    forward: true,
    steering,
  };
}

function steerDirectionToward(currentDirection, desiredDirection, maxDelta) {
  if (desiredDirection.x === 0 && desiredDirection.z === 0) {
    return currentDirection;
  }

  const currentAngle = vectorToAngle(currentDirection);
  const desiredAngle = vectorToAngle(desiredDirection);
  const delta = normalizeAngleDelta(desiredAngle - currentAngle);
  const clampedDelta = Math.min(Math.abs(delta), maxDelta) * Math.sign(delta);
  return angleToVector(currentAngle + clampedDelta);
}

function getGroundBounds(columns, rows) {
  const halfWidth = columns / 2;
  const halfDepth = rows / 2;
  return {
    minX: -halfWidth + CAR_BOUND_RADIUS,
    maxX: halfWidth - CAR_BOUND_RADIUS,
    minZ: -halfDepth + CAR_BOUND_RADIUS,
    maxZ: halfDepth - CAR_BOUND_RADIUS,
  };
}

function clampPosition(position, columns, rows) {
  const bounds = getGroundBounds(columns, rows);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z)),
  };
}

function resolveWallCollision(position, previousPosition, columns, rows, wall) {
  const bounds = getWallBounds(wall, CAR_BOUND_RADIUS);
  if (
    !isPositionInsideBounds(position, bounds)
    && !doesLineSegmentIntersectBounds(previousPosition, position, bounds)
  ) {
    return position;
  }

  let resolved = { ...position };
  if (previousPosition.x <= bounds.minX) {
    resolved.x = bounds.minX;
  } else if (previousPosition.x >= bounds.maxX) {
    resolved.x = bounds.maxX;
  } else if (previousPosition.z <= bounds.minZ) {
    resolved.z = bounds.minZ;
  } else if (previousPosition.z >= bounds.maxZ) {
    resolved.z = bounds.maxZ;
  } else {
    const distances = [
      { axis: "x", value: bounds.minX, distance: Math.abs(position.x - bounds.minX) },
      { axis: "x", value: bounds.maxX, distance: Math.abs(position.x - bounds.maxX) },
      { axis: "z", value: bounds.minZ, distance: Math.abs(position.z - bounds.minZ) },
      { axis: "z", value: bounds.maxZ, distance: Math.abs(position.z - bounds.maxZ) },
    ].sort((first, second) => first.distance - second.distance);
    const nearestEdge = distances[0];
    resolved = {
      ...resolved,
      [nearestEdge.axis]: nearestEdge.value,
    };
  }

  return clampPosition(resolved, columns, rows);
}

function resolveObstacleCollisions(position, previousPosition, columns, rows, obstacles) {
  const clearanceRadius = PILLAR_RADIUS + CAR_BOUND_RADIUS;
  let resolved = clampPosition(position, columns, rows);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const pillar of obstacles.pillars) {
      const offsetX = resolved.x - pillar.x;
      const offsetZ = resolved.z - pillar.z;
      const distance = Math.hypot(offsetX, offsetZ);
      if (distance >= clearanceRadius) {
        continue;
      }

      const fallbackDirection = normalizeVector(
        previousPosition.x - pillar.x,
        previousPosition.z - pillar.z,
      );
      const pushDirection = distance > 0
        ? { x: offsetX / distance, z: offsetZ / distance }
        : fallbackDirection.x !== 0 || fallbackDirection.z !== 0
          ? fallbackDirection
          : normalizeVector(resolved.x, resolved.z);
      resolved = clampPosition({
        x: pillar.x + pushDirection.x * clearanceRadius,
        z: pillar.z + pushDirection.z * clearanceRadius,
      }, columns, rows);
    }

    for (const wall of obstacles.walls) {
      resolved = resolveWallCollision(resolved, previousPosition, columns, rows, wall);
    }
  }

  return resolved;
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

function createCar(color) {
  const geometry = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.45,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = CAR_HEIGHT / 2;
  return mesh;
}

function createPillar(position) {
  const geometry = new THREE.CylinderGeometry(
    PILLAR_RADIUS,
    PILLAR_RADIUS,
    PILLAR_HEIGHT,
    PILLAR_SEGMENTS,
  );
  const material = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.62,
    metalness: 0.04,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, PILLAR_HEIGHT / 2, position.z);
  return mesh;
}

function createWall(wall) {
  const geometry = new THREE.BoxGeometry(wall.width, PILLAR_HEIGHT, wall.depth);
  const material = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.62,
    metalness: 0.04,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(wall.x, PILLAR_HEIGHT / 2, wall.z);
  return mesh;
}

function createFieldOfViewConeGeometry(fieldOfViewAngleRadians) {
  const positions = [0, 0.012, 0];
  for (let index = 0; index <= FIELD_OF_VIEW_SEGMENTS; index += 1) {
    const t = index / FIELD_OF_VIEW_SEGMENTS;
    const angle = -fieldOfViewAngleRadians / 2 + t * fieldOfViewAngleRadians;
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
  return geometry;
}

function createFieldOfViewCone(fieldOfViewAngleRadians) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(createFieldOfViewConeGeometry(fieldOfViewAngleRadians), material);
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
    CAR_HEIGHT / 2,
    chaserPosition.z + lookDirection.z * CHASER_VIEW_LOOK_DISTANCE,
  );
}

function publishSidebarSections(setSidebarSections, programmaticChaserEnabled, vehicleSettings) {
  if (typeof setSidebarSections !== "function") {
    return;
  }

  setSidebarSections([
    {
      id: "controls",
      title: "Controls",
      hint: "Game-provided controls for the active Play example.",
      rows: [
        {
          kind: "toggle",
          id: CHASER_AUTOPILOT_ACTION_ID,
          label: "Programmatic chaser",
          enabled: programmaticChaserEnabled,
          enabledLabel: "on",
          disabledLabel: "off",
          hint: "Let the game algorithm press the same forward and steering inputs available to a human player.",
        },
        { kind: "value", label: "Forward", value: "I" },
        { kind: "value", label: "Steer", value: "A / D" },
      ],
    },
    {
      id: "vehicle",
      title: "Vehicle",
      hint: "Game-provided vehicle parameters for the active Play example.",
      rows: [
        {
          kind: "editableValue",
          id: VEHICLE_SPEED_ACTION_ID,
          label: "Speed",
          value: formatEditableNumber(vehicleSettings.speedUnitsPerSecond, 1),
          suffix: "units/s",
          hint: "Edit the chaser and target speed.",
        },
        {
          kind: "editableValue",
          id: VEHICLE_TURN_RATE_ACTION_ID,
          label: "Turn rate",
          value: formatEditableNumber(THREE.MathUtils.radToDeg(vehicleSettings.turnRateRadiansPerSecond), 0),
          suffix: "deg/s",
          hint: "Edit the steering rate used by the same input model.",
        },
        {
          kind: "editableValue",
          id: VEHICLE_FOV_ACTION_ID,
          label: "FOV",
          value: formatEditableNumber(THREE.MathUtils.radToDeg(vehicleSettings.fieldOfViewAngleRadians), 0),
          suffix: "deg",
          hint: "Edit the blue chaser field of view.",
        },
      ],
    },
  ]);
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
  const vehicleSettings = {
    speedUnitsPerSecond: DEFAULT_CAR_SPEED_UNITS_PER_SECOND,
    turnRateRadiansPerSecond: DEFAULT_CAR_TURN_RATE_RADIANS_PER_SECOND,
    fieldOfViewAngleRadians: DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS,
  };
  let chaserFieldOfView = null;
  let chaserViewCamera = null;

  const refreshSidebarSections = () => {
    publishSidebarSections(setSidebarSections, programmaticChaserEnabled, vehicleSettings);
  };
  const updateFieldOfView = () => {
    if (chaserFieldOfView) {
      const nextGeometry = createFieldOfViewConeGeometry(vehicleSettings.fieldOfViewAngleRadians);
      chaserFieldOfView.geometry.dispose();
      chaserFieldOfView.geometry = nextGeometry;
    }
    if (chaserViewCamera) {
      chaserViewCamera.fov = THREE.MathUtils.radToDeg(vehicleSettings.fieldOfViewAngleRadians);
      chaserViewCamera.updateProjectionMatrix();
    }
  };
  refreshSidebarSections();
  if (typeof setSidebarActionHandler === "function") {
    setSidebarActionHandler(CHASER_AUTOPILOT_ACTION_ID, () => {
      programmaticChaserEnabled = !programmaticChaserEnabled;
      refreshSidebarSections();
    });
    setSidebarActionHandler(VEHICLE_SPEED_ACTION_ID, (value) => {
      const parsed = parseEditableNumber(value);
      if (parsed !== null) {
        vehicleSettings.speedUnitsPerSecond = clampNumber(parsed, 0.2, 12);
      }
      refreshSidebarSections();
    });
    setSidebarActionHandler(VEHICLE_TURN_RATE_ACTION_ID, (value) => {
      const parsed = parseEditableNumber(value);
      if (parsed !== null) {
        vehicleSettings.turnRateRadiansPerSecond = THREE.MathUtils.degToRad(clampNumber(parsed, 10, 720));
      }
      refreshSidebarSections();
    });
    setSidebarActionHandler(VEHICLE_FOV_ACTION_ID, (value) => {
      const parsed = parseEditableNumber(value);
      if (parsed !== null) {
        vehicleSettings.fieldOfViewAngleRadians = THREE.MathUtils.degToRad(clampNumber(parsed, 20, 140));
        updateFieldOfView();
      }
      refreshSidebarSections();
    });
  }

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
  const chaserViewLostTargetLabel = chaserViewFrame
    ? document.createElement("div")
    : null;
  if (chaserViewRenderer && chaserViewFrame) {
    chaserViewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    chaserViewRenderer.setClearColor(0x000000, 0);
    chaserViewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    chaserViewRenderer.domElement.style.display = "block";
    chaserViewRenderer.domElement.style.width = "100%";
    chaserViewRenderer.domElement.style.height = "100%";
    chaserViewFrame.mount.appendChild(chaserViewRenderer.domElement);
    if (chaserViewLostTargetLabel) {
      Object.assign(chaserViewLostTargetLabel.style, {
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
      chaserViewLostTargetLabel.textContent = "Target out of sight";
      chaserViewFrame.mount.appendChild(chaserViewLostTargetLabel);
    }
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-columns / 2, columns / 2, rows / 2, -rows / 2, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  chaserViewCamera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(vehicleSettings.fieldOfViewAngleRadians),
    4 / 3,
    0.04,
    CHASER_VIEW_MAX_DISTANCE,
  );

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(3, 8, 4);
  scene.add(ambientLight, keyLight);

  chaserFieldOfView = createFieldOfViewCone(vehicleSettings.fieldOfViewAngleRadians);
  const chaser = createCar(0x38bdf8);
  const target = createCar(0xf43f5e);
  const obstacles = getFieldObstacleLayout(columns, rows);
  const obstacleMeshes = [
    ...obstacles.pillars.map(createPillar),
    ...obstacles.walls.map(createWall),
  ];
  scene.add(chaserFieldOfView, chaser, target, ...obstacleMeshes);

  const chaserPosition = { x: -columns * 0.38, z: 0 };
  const chaserLookDirection = normalizeVector(1, 0);
  const targetPosition = { x: columns / 4, z: 0 };
  const targetDirection = normalizeVector(-1, 0.4);
  const chaserAutopilotState = {
    searchSteering: CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
  };

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

    const chaserPerception = getChaserTargetPerception(
      chaserPosition,
      targetPosition,
      chaserLookDirection,
      vehicleSettings.fieldOfViewAngleRadians,
      obstacles,
    );
    if (chaserViewLostTargetLabel) {
      chaserViewLostTargetLabel.style.display = chaserPerception.visible ? "none" : "block";
    }

    const chaserInput = programmaticChaserEnabled
      ? getProgrammaticChaserInput(
        chaserPerception,
        chaserAutopilotState,
      )
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
        + chaserLookDirection.x * vehicleSettings.speedUnitsPerSecond * deltaSeconds * (isChaserMoving ? 1 : 0),
      z: chaserPosition.z
        + chaserLookDirection.z * vehicleSettings.speedUnitsPerSecond * deltaSeconds * (isChaserMoving ? 1 : 0),
    }, chaserPosition, columns, rows, obstacles);
    chaserPosition.x = nextChaser.x;
    chaserPosition.z = nextChaser.z;

    const desiredTargetDirection = getTargetDirection(
      targetPosition,
      targetDirection,
      columns,
      rows,
      timestamp,
    );
    const nextDirection = constrainDirectionToBounds(
      targetPosition,
      steerDirectionToward(
        targetDirection,
        desiredTargetDirection,
        vehicleSettings.turnRateRadiansPerSecond * deltaSeconds,
      ),
      columns,
      rows,
    );
    targetDirection.x = nextDirection.x;
    targetDirection.z = nextDirection.z;
    const nextTarget = resolveObstacleCollisions({
      x: targetPosition.x + targetDirection.x * vehicleSettings.speedUnitsPerSecond * deltaSeconds,
      z: targetPosition.z + targetDirection.z * vehicleSettings.speedUnitsPerSecond * deltaSeconds,
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
      setSidebarActionHandler?.(CHASER_AUTOPILOT_ACTION_ID, null);
      setSidebarActionHandler?.(VEHICLE_SPEED_ACTION_ID, null);
      setSidebarActionHandler?.(VEHICLE_TURN_RATE_ACTION_ID, null);
      setSidebarActionHandler?.(VEHICLE_FOV_ACTION_ID, null);
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
      obstacleMeshes.forEach((obstacle) => {
        obstacle.geometry.dispose();
        obstacle.material.dispose();
      });
      renderer.dispose();
      chaserViewRenderer?.dispose();
      chaserViewFrame?.close();
    },
  };
}
