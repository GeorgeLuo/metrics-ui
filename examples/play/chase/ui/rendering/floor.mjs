import * as THREE from "three";
import { SIMULATION_RENDERING_PROFILE } from "../../rendering/profiles.ts";
import { createFloorTexture } from "./textures/floor-texture.mjs";

const FLOOR_CELL_UNITS = 0.5;
const FLOOR_Y = -0.003;
const GRID_Y = 0.008;

export function createTexturedFloor(
  columns,
  rows,
  materialOptions = SIMULATION_RENDERING_PROFILE.environment.materials.floor,
) {
  const safeColumns = Math.max(0.1, Number(columns) || 1);
  const safeRows = Math.max(0.1, Number(rows) || 1);
  const texture = createFloorTexture(safeColumns, safeRows, materialOptions);
  const material = new THREE.MeshStandardMaterial({
    color: texture ? materialOptions.color : materialOptions.fallbackColor,
    map: texture,
    roughness: materialOptions.roughness,
    metalness: materialOptions.metalness,
  });
  const geometry = new THREE.BoxGeometry(safeColumns, 0.006, safeRows);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, FLOOR_Y, 0);
  mesh.receiveShadow = true;
  mesh.userData.kind = "textured-floor";
  return mesh;
}

export function createFloorGrid(columns, rows, cellUnits = FLOOR_CELL_UNITS) {
  const safeColumns = Math.max(0.1, Number(columns) || 1);
  const safeRows = Math.max(0.1, Number(rows) || 1);
  const safeCellUnits = Math.max(0.1, Number(cellUnits) || FLOOR_CELL_UNITS);
  const halfColumns = safeColumns / 2;
  const halfRows = safeRows / 2;
  const minX = -halfColumns;
  const maxX = halfColumns;
  const minZ = -halfRows;
  const maxZ = halfRows;
  const positions = [];

  for (
    let x = Math.ceil(minX / safeCellUnits) * safeCellUnits;
    x <= maxX + 0.0001;
    x += safeCellUnits
  ) {
    positions.push(x, GRID_Y, minZ, x, GRID_Y, maxZ);
  }

  for (
    let z = Math.ceil(minZ / safeCellUnits) * safeCellUnits;
    z <= maxZ + 0.0001;
    z += safeCellUnits
  ) {
    positions.push(minX, GRID_Y, z, maxX, GRID_Y, z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x475569,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(geometry, material);
  grid.userData.kind = "floor-grid";
  return grid;
}
