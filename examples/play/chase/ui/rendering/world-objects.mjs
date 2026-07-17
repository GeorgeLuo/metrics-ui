import * as THREE from "three";
import {
  CAR_HEIGHT,
  CAR_LENGTH,
  CAR_WIDTH,
  CHASER_FIELD_OF_VIEW_COLOR,
  FIELD_OF_VIEW_DISTANCE,
  FIELD_OF_VIEW_SEGMENTS,
  OBSTACLE_PRISM_HEIGHT,
  EVADER_FIELD_OF_VIEW_COLOR,
} from "../../config/constants.mjs";
import { SIMULATION_RENDERING_PROFILE } from "../../rendering/profiles.ts";
import { createWallTexture } from "./textures/wall-texture.mjs";

export function createCar(color) {
  const car = new THREE.Group();
  const bodyGeometry = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.45,
    metalness: 0.05,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  const wheelGeometry = new THREE.BoxGeometry(CAR_WIDTH * 0.12, CAR_HEIGHT * 0.42, CAR_LENGTH * 0.22);
  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.7,
    metalness: 0.05,
  });
  const wheelX = CAR_WIDTH * 0.58;
  const frontZ = CAR_LENGTH * 0.34;
  const rearZ = -CAR_LENGTH * 0.34;
  const wheelY = -CAR_HEIGHT * 0.22;
  const frontWheels = [];

  [
    { x: -wheelX, z: frontZ, steerable: true },
    { x: wheelX, z: frontZ, steerable: true },
    { x: -wheelX, z: rearZ, steerable: false },
    { x: wheelX, z: rearZ, steerable: false },
  ].forEach((wheelSpec) => {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    wheel.position.set(wheelSpec.x, wheelY, wheelSpec.z);
    wheel.name = wheelSpec.steerable ? "front-wheel" : "rear-wheel";
    if (wheelSpec.steerable) {
      frontWheels.push(wheel);
    }
    car.add(wheel);
  });

  car.add(body);
  car.position.y = CAR_HEIGHT / 2;
  car.userData.frontWheels = frontWheels;
  return car;
}

export function setCarWheelSteeringAngle(car, steeringAngleRadians = 0) {
  const steeringAngle = Number.isFinite(steeringAngleRadians)
    ? steeringAngleRadians
    : 0;
  (car?.userData?.frontWheels ?? []).forEach((wheel) => {
    wheel.rotation.y = steeringAngle;
  });
  return steeringAngle;
}

export function disposeObject3D(object) {
  const geometries = new Set();
  const materials = new Set();
  object?.traverse?.((child) => {
    if (child.geometry) {
      geometries.add(child.geometry);
    }
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => materials.add(material));
      return;
    }
    if (child.material) {
      materials.add(child.material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => {
    [
      material.map,
      material.normalMap,
      material.roughnessMap,
      material.metalnessMap,
      material.alphaMap,
      material.emissiveMap,
    ].forEach((texture) => texture?.dispose?.());
    material.dispose?.();
  });
}

/** Selects visual material values without changing obstacle geometry semantics. */
export function getWallMaterialOptions(
  wall,
  materials = SIMULATION_RENDERING_PROFILE.environment.materials,
) {
  return wall?.boundary ? materials.roomWall : materials.obstacle;
}

export function createWall(
  wall,
  materialOptions = SIMULATION_RENDERING_PROFILE.environment.materials.obstacle,
) {
  const wallHeight = Number.isFinite(wall?.height) && wall.height > 0
    ? wall.height
    : OBSTACLE_PRISM_HEIGHT;
  const geometry = new THREE.BoxGeometry(wall.width, wallHeight, wall.depth);
  const texture = createWallTexture({ ...wall, height: wallHeight }, materialOptions);
  const material = new THREE.MeshStandardMaterial({
    color: texture
      ? materialOptions.color
      : materialOptions.fallbackColor ?? materialOptions.color,
    map: texture,
    roughness: materialOptions.roughness,
    metalness: materialOptions.metalness,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(wall.x, wallHeight / 2, wall.z);
  mesh.rotation.y = Number(wall.rotationRadians) || 0;
  const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: materialOptions.edgeColor,
    transparent: true,
    opacity: materialOptions.edgeOpacity,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.name = "wall-boundary-edges";
  edges.position.y = 0.006;
  edges.renderOrder = 2;
  mesh.add(edges);
  return mesh;
}

export function createSurfacePatch(
  surface,
  materialOptions = SIMULATION_RENDERING_PROFILE.environment.materials.surface,
) {
  const geometry = new THREE.BoxGeometry(surface.width, 0.006, surface.depth);
  const material = new THREE.MeshStandardMaterial({
    color: Number.isFinite(surface.color) ? surface.color : materialOptions.color,
    transparent: true,
    opacity: Number.isFinite(surface.opacity) ? surface.opacity : materialOptions.opacity,
    roughness: materialOptions.roughness,
    metalness: materialOptions.metalness,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.position.set(surface.x, 0.003, surface.z);
  mesh.rotation.y = Number(surface.rotationRadians) || 0;
  return mesh;
}

export function createFieldOfViewConeGeometry(
  fieldOfViewAngleRadians,
  fieldOfViewDistance = FIELD_OF_VIEW_DISTANCE,
) {
  const positions = [0, 0.012, 0];
  for (let index = 0; index <= FIELD_OF_VIEW_SEGMENTS; index += 1) {
    const t = index / FIELD_OF_VIEW_SEGMENTS;
    const angle = -fieldOfViewAngleRadians / 2 + t * fieldOfViewAngleRadians;
    positions.push(
      Math.sin(angle) * fieldOfViewDistance,
      0.012,
      Math.cos(angle) * fieldOfViewDistance,
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
    distance = FIELD_OF_VIEW_DISTANCE,
  } = {},
) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(createFieldOfViewConeGeometry(fieldOfViewAngleRadians, distance), material);
}

export function createEvaderFieldOfViewCone(
  fieldOfViewAngleRadians,
  distance = FIELD_OF_VIEW_DISTANCE,
) {
  return createFieldOfViewCone(fieldOfViewAngleRadians, {
    color: EVADER_FIELD_OF_VIEW_COLOR,
    opacity: 0.12,
    distance,
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
