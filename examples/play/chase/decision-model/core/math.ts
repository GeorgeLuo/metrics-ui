export type VectorXZ = {
  x: number;
  z: number;
};

export function normalizeVector(x: number, z: number): VectorXZ {
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

export function vectorToAngle(direction: VectorXZ): number {
  return Math.atan2(direction.x, direction.z);
}

export function angleToVector(angle: number): VectorXZ {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

export function normalizeAngleDelta(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}

export function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

export function formatEditableNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function parseEditableNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}
