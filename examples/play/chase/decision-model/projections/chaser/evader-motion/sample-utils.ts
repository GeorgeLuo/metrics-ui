import type { VectorXZ } from "../../../core/math.ts";

/**
 * Clones a vector while coercing loose numeric inputs into finite values.
 */
export function cloneVector(vector: Partial<VectorXZ> | null | undefined): VectorXZ | null {
  return vector
    ? {
      x: Number(vector.x) || 0,
      z: Number(vector.z) || 0,
    }
    : null;
}

/**
 * Clones a world position into the projection coordinate shape.
 */
export function clonePosition(position: Partial<VectorXZ> | null | undefined): VectorXZ | null {
  return position
    ? {
      x: Number(position.x) || 0,
      z: Number(position.z) || 0,
    }
    : null;
}
