import {
  createRepeatingCanvasTexture,
  createTextureCanvas,
} from "./canvas-texture.mjs";

const CARDBOARD_TEXTURE_SIZE = 256;

function createKraftCardboardCanvas() {
  const resources = createTextureCanvas(CARDBOARD_TEXTURE_SIZE);
  if (!resources) {
    return null;
  }
  const { canvas, context } = resources;
  const fiberColors = [
    "rgba(76, 48, 25, 0.22)",
    "rgba(121, 77, 37, 0.18)",
    "rgba(238, 202, 151, 0.24)",
  ];

  context.fillStyle = "#b88752";
  context.fillRect(0, 0, CARDBOARD_TEXTURE_SIZE, CARDBOARD_TEXTURE_SIZE);
  for (let x = 0; x < CARDBOARD_TEXTURE_SIZE; x += 18) {
    context.fillStyle = "rgba(74, 45, 23, 0.035)";
    context.fillRect(x, 0, 5, CARDBOARD_TEXTURE_SIZE);
  }
  for (let index = 0; index < 1800; index += 1) {
    const x = (index * 97 + Math.floor(index / 37) * 11) % CARDBOARD_TEXTURE_SIZE;
    const y = (index * 53 + Math.floor(index / 19) * 29) % CARDBOARD_TEXTURE_SIZE;
    const length = 2 + index % 7;
    context.strokeStyle = fiberColors[index % fiberColors.length];
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (index % 3) - 1);
    context.stroke();
  }
  context.strokeStyle = "rgba(79, 48, 24, 0.2)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, CARDBOARD_TEXTURE_SIZE / 2);
  context.lineTo(CARDBOARD_TEXTURE_SIZE, CARDBOARD_TEXTURE_SIZE / 2);
  context.stroke();
  return canvas;
}

/** Creates a wall texture for named non-geometric material appearance. */
export function createWallTexture(wall, materialOptions) {
  if (materialOptions?.texture !== "cardboard-kraft") {
    return null;
  }
  const repeatUnits = Math.max(0.1, Number(materialOptions.textureRepeatUnits) || 1);
  const width = Math.max(0.1, Number(wall?.width) || 1);
  const height = Math.max(0.1, Number(wall?.height) || 1);
  return createRepeatingCanvasTexture(
    createKraftCardboardCanvas(),
    width / repeatUnits,
    height / repeatUnits,
    "chase-cardboard-kraft",
  );
}
