const DEFAULT_SURFACE_SPEED_MULTIPLIER = 1;

function getSurfaceRotationRadians(surface) {
  const rotation = Number(surface?.rotationRadians);
  return Number.isFinite(rotation) ? rotation : 0;
}

function getSurfaceCenter(surface) {
  return {
    x: Number(surface?.x) || 0,
    z: Number(surface?.z) || 0,
  };
}

function getSurfaceLocalBounds(surface) {
  const halfWidth = Math.max(0, Number(surface?.width) || 0) / 2;
  const halfDepth = Math.max(0, Number(surface?.depth) || 0) / 2;
  return {
    minX: -halfWidth,
    maxX: halfWidth,
    minZ: -halfDepth,
    maxZ: halfDepth,
  };
}

function getSurfaceLocalPoint(position, surface) {
  const center = getSurfaceCenter(surface);
  const rotation = getSurfaceRotationRadians(surface);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = (Number(position?.x) || 0) - center.x;
  const dz = (Number(position?.z) || 0) - center.z;
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function isPositionInsideBounds(position, bounds) {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

export function isPositionInsideSurfacePatch(position, surface) {
  return isPositionInsideBounds(
    getSurfaceLocalPoint(position, surface),
    getSurfaceLocalBounds(surface),
  );
}

export function getSurfacePatchAtPosition(position, surfaces) {
  const patches = Array.isArray(surfaces) ? surfaces : [];
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    if (isPositionInsideSurfacePatch(position, patches[index])) {
      return patches[index];
    }
  }
  return null;
}

export function getSurfaceSpeedMultiplierAtPosition(position, surfaces, fallback = DEFAULT_SURFACE_SPEED_MULTIPLIER) {
  const surface = getSurfacePatchAtPosition(position, surfaces);
  const speedMultiplier = Number(surface?.speedMultiplier);
  return Number.isFinite(speedMultiplier) && speedMultiplier >= 0
    ? speedMultiplier
    : fallback;
}
