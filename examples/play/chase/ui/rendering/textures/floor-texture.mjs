import {
  createRepeatingCanvasTexture,
  createTextureCanvas,
} from "./canvas-texture.mjs";

const FLOOR_TEXTURE_SIZE = 256;

function createSimulationFloorCanvas() {
  const resources = createTextureCanvas(FLOOR_TEXTURE_SIZE);
  if (!resources) {
    return null;
  }
  const { canvas, context } = resources;
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

function createLightCarpetCanvas() {
  const resources = createTextureCanvas(FLOOR_TEXTURE_SIZE);
  if (!resources) {
    return null;
  }
  const { canvas, context } = resources;
  const fiberColors = [
    "rgba(116, 103, 88, 0.22)",
    "rgba(166, 151, 133, 0.24)",
    "rgba(244, 239, 231, 0.38)",
    "rgba(205, 194, 180, 0.3)",
  ];

  context.fillStyle = "#d8d0c5";
  context.fillRect(0, 0, FLOOR_TEXTURE_SIZE, FLOOR_TEXTURE_SIZE);
  for (let row = 0; row < FLOOR_TEXTURE_SIZE; row += 8) {
    const alpha = 0.025 + ((row / 8) % 4) * 0.008;
    context.fillStyle = `rgba(93, 79, 64, ${alpha.toFixed(3)})`;
    context.fillRect(0, row, FLOOR_TEXTURE_SIZE, 3);
  }
  for (let index = 0; index < 2400; index += 1) {
    const x = (index * 73 + Math.floor(index / 29) * 17) % FLOOR_TEXTURE_SIZE;
    const y = (index * 151 + Math.floor(index / 47) * 23) % FLOOR_TEXTURE_SIZE;
    const length = 1 + index % 4;
    const slope = index % 5 === 0 ? 1 : index % 7 === 0 ? -1 : 0;
    context.strokeStyle = fiberColors[index % fiberColors.length];
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + slope);
    context.stroke();
  }
  return canvas;
}

/** Creates the floor texture selected by a resolved rendering profile. */
export function createFloorTexture(columns, rows, materialOptions) {
  const textureKind = materialOptions?.texture ?? "simulation-floor";
  const canvas = textureKind === "carpet-light"
    ? createLightCarpetCanvas()
    : createSimulationFloorCanvas();
  const repeatUnits = Math.max(0.1, Number(materialOptions?.textureRepeatUnits) || 2);
  return createRepeatingCanvasTexture(
    canvas,
    columns / repeatUnits,
    rows / repeatUnits,
    `chase-${textureKind}`,
  );
}
