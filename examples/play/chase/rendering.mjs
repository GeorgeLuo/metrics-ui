import * as THREE from "three";
import {
  CAR_HEIGHT,
  CAR_LENGTH,
  CAR_WIDTH,
  CHASER_FIELD_OF_VIEW_COLOR,
  CHASER_VIEW_CAMERA_HEIGHT,
  CHASER_VIEW_LOOK_DISTANCE,
  FIELD_OF_VIEW_DISTANCE,
  FIELD_OF_VIEW_SEGMENTS,
  OBSTACLE_PRISM_HEIGHT,
  EVADER_FIELD_OF_VIEW_COLOR,
  EVADER_PROJECTION_COLOR,
} from "./constants.mjs";
import { vectorToAngle } from "./math.mjs";
import { getEvaderProjectionSampleCount } from "./evader-prediction-plan.mjs";

export function createCar(color) {
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

export function createWall(wall) {
  const geometry = new THREE.BoxGeometry(wall.width, OBSTACLE_PRISM_HEIGHT, wall.depth);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(wall.x, OBSTACLE_PRISM_HEIGHT / 2, wall.z);
  return mesh;
}

export function createFieldOfViewConeGeometry(fieldOfViewAngleRadians) {
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

export function createFieldOfViewCone(
  fieldOfViewAngleRadians,
  {
    color = CHASER_FIELD_OF_VIEW_COLOR,
    opacity = 0.16,
  } = {},
) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(createFieldOfViewConeGeometry(fieldOfViewAngleRadians), material);
}

export function createEvaderFieldOfViewCone(fieldOfViewAngleRadians) {
  return createFieldOfViewCone(fieldOfViewAngleRadians, {
    color: EVADER_FIELD_OF_VIEW_COLOR,
    opacity: 0.12,
  });
}

export function configureCamera(camera, columns, rows, width, height) {
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

export function configureChaserViewCamera(camera, chaserPosition, lookDirection) {
  camera.position.set(chaserPosition.x, CHASER_VIEW_CAMERA_HEIGHT, chaserPosition.z);
  camera.lookAt(
    chaserPosition.x + lookDirection.x * CHASER_VIEW_LOOK_DISTANCE,
    CAR_HEIGHT / 2,
    chaserPosition.z + lookDirection.z * CHASER_VIEW_LOOK_DISTANCE,
  );
}

function setProjectionFrame(frame, centerPosition, direction) {
  frame.position.set(centerPosition.x, CAR_HEIGHT / 2, centerPosition.z);
  frame.rotation.y = vectorToAngle(direction);
}

function createProjectionFrame(opacity) {
  const boxGeometry = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH);
  const geometry = new THREE.EdgesGeometry(boxGeometry);
  boxGeometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color: EVADER_PROJECTION_COLOR,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

export function syncProjectionFrames(group, frames, count) {
  while (frames.length < count) {
    const index = frames.length;
    const opacity = Math.max(0.08, 0.42 * (1 - index / Math.max(count, 1)));
    const frame = createProjectionFrame(opacity);
    frames.push(frame);
    group.add(frame);
  }

  while (frames.length > count) {
    const frame = frames.pop();
    if (frame) {
      group.remove(frame);
      frame.geometry.dispose();
      frame.material.dispose();
    }
  }

  frames.forEach((frame, index) => {
    frame.material.opacity = Math.max(0.08, 0.42 * (1 - index / Math.max(count, 1)));
  });
}

export function updateEvaderProjectionDisplay(
  group,
  frames,
  estimate,
  evaderPrediction,
  projectionSettings,
  speedUnitsPerFrame,
  evaderProjectionPath = null,
) {
  const projectionVisible = projectionSettings?.visible === true;
  const hasExplicitPath = Array.isArray(evaderProjectionPath);
  const path = projectionVisible && hasExplicitPath ? evaderProjectionPath : [];
  const count = projectionVisible
    ? (hasExplicitPath ? path.length : getEvaderProjectionSampleCount(projectionSettings))
    : 0;
  const estimatePosition = estimate?.position ?? null;
  const predictionDirection = evaderPrediction?.direction ?? estimate?.direction ?? null;
  const canProject = Boolean(estimatePosition && predictionDirection && count > 0);
  group.visible = canProject;
  syncProjectionFrames(group, frames, canProject ? count : 0);
  if (!canProject) {
    return;
  }

  frames.forEach((frame, index) => {
    const pathSample = path[index];
    const projectionFramesAhead = Number.isFinite(pathSample?.framesAhead)
      ? pathSample.framesAhead
      : (index + 1) * projectionSettings.sampleSpacingFrames;
    const direction = pathSample?.direction ?? predictionDirection;
    setProjectionFrame(
      frame,
      pathSample?.position ?? {
        x: estimate.position.x + predictionDirection.x * speedUnitsPerFrame * projectionFramesAhead,
        z: estimate.position.z + predictionDirection.z * speedUnitsPerFrame * projectionFramesAhead,
      },
      direction,
    );
  });
}
