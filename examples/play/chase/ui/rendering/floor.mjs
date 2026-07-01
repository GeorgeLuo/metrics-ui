import * as THREE from "three";

const FLOOR_TEXTURE_SIZE = 256;
const FLOOR_CELL_UNITS = 0.5;
const FLOOR_Y = -0.003;
const GRID_Y = 0.008;

function createFloorCanvas() {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = FLOOR_TEXTURE_SIZE;
  canvas.height = FLOOR_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = "#eee9dc";
  context.fillRect(0, 0, FLOOR_TEXTURE_SIZE, FLOOR_TEXTURE_SIZE);

  for (let row = 0; row < FLOOR_TEXTURE_SIZE; row += 2) {
    const alpha = 0.024 + ((row % 17) / 17) * 0.016;
    context.fillStyle = `rgba(112, 104, 91, ${alpha.toFixed(3)})`;
    context.fillRect(0, row, FLOOR_TEXTURE_SIZE, 1);
  }

  for (let index = 0; index < 900; index += 1) {
    const x = (index * 37) % FLOOR_TEXTURE_SIZE;
    const y = (index * 91) % FLOOR_TEXTURE_SIZE;
    const shade = index % 3 === 0 ? 255 : 104;
    const alpha = index % 3 === 0 ? 0.04 : 0.026;
    context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
    context.fillRect(x, y, 1, 1);
  }

  context.strokeStyle = "rgba(134, 125, 108, 0.08)";
  context.lineWidth = 1;
  for (let x = -FLOOR_TEXTURE_SIZE; x < FLOOR_TEXTURE_SIZE * 2; x += 32) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 42, FLOOR_TEXTURE_SIZE);
    context.stroke();
  }

  return canvas;
}

function createFloorTexture(columns, rows) {
  const canvas = createFloorCanvas();
  if (!canvas) {
    return null;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    Math.max(1, columns / 2),
    Math.max(1, rows / 2),
  );
  texture.needsUpdate = true;
  return texture;
}

export function createTexturedFloor(columns, rows) {
  const safeColumns = Math.max(0.1, Number(columns) || 1);
  const safeRows = Math.max(0.1, Number(rows) || 1);
  const texture = createFloorTexture(safeColumns, safeRows);
  const material = new THREE.MeshStandardMaterial({
    color: texture ? 0xffffff : 0xeee9dc,
    map: texture,
    roughness: 0.94,
    metalness: 0,
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
