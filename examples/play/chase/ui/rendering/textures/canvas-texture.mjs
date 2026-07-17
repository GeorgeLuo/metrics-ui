import * as THREE from "three";

/** Creates a browser canvas and 2D context, or null in non-DOM runtimes. */
export function createTextureCanvas(size = 256) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  return context ? { canvas, context, size } : null;
}

/** Converts a generated canvas into a deterministic repeating color texture. */
export function createRepeatingCanvasTexture(canvas, repeatX, repeatY, name) {
  if (!canvas) {
    return null;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  texture.needsUpdate = true;
  return texture;
}
