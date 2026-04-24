export function normalizeVector(x, z) {
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

export function vectorToAngle(direction) {
  return Math.atan2(direction.x, direction.z);
}

export function angleToVector(angle) {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

export function normalizeAngleDelta(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function radiansToDegrees(value) {
  return value * 180 / Math.PI;
}

export function degreesToRadians(value) {
  return value * Math.PI / 180;
}

export function formatEditableNumber(value, digits = 1) {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function parseEditableNumber(value) {
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}
