import {
  CHASE_RENDERING_PROFILE_IDS,
  type ChaseRenderingProfile,
} from "./profile-contract.ts";

type SeededUnitGenerator = () => number;

function interpolate(minimum: number, maximum: number, amount: number): number {
  return minimum + (maximum - minimum) * amount;
}

/** Creates a deterministic sequence of unit values from an unsigned rendering seed. */
export function createSeededUnitGenerator(seed: number): SeededUnitGenerator {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
}

/**
 * Produces bounded visual variation around the calibrated RC indoor profile.
 *
 * Camera placement and projection remain fixed so seed changes only image
 * appearance, never the geometry seen by the decision model.
 */
export function createSeededRcIndoorVariation(
  baseProfile: ChaseRenderingProfile,
  seed: number,
): ChaseRenderingProfile {
  const next = createSeededUnitGenerator(seed);
  const exposure = interpolate(1.05, 1.25, next());
  const ambientIntensity = interpolate(0.78, 1.02, next());
  const keyIntensity = interpolate(2.15, 2.65, next());
  const shadowRadius = interpolate(1.6, 2.4, next());
  const floorRoughness = interpolate(0.94, 0.995, next());
  const obstacleRoughness = interpolate(0.82, 0.94, next());
  const barrelDistortion = interpolate(0.08, 0.16, next());
  const vignette = interpolate(0.06, 0.14, next());

  return {
    ...baseProfile,
    id: CHASE_RENDERING_PROFILE_IDS.RANDOMIZED,
    seed,
    environment: {
      ...baseProfile.environment,
      renderer: {
        ...baseProfile.environment.renderer,
        exposure,
        shadows: {
          ...baseProfile.environment.renderer.shadows,
          radius: shadowRadius,
        },
      },
      ambientLight: {
        ...baseProfile.environment.ambientLight,
        intensity: ambientIntensity,
      },
      keyLight: {
        ...baseProfile.environment.keyLight,
        intensity: keyIntensity,
      },
      materials: {
        ...baseProfile.environment.materials,
        floor: {
          ...baseProfile.environment.materials.floor,
          roughness: floorRoughness,
        },
        obstacle: {
          ...baseProfile.environment.materials.obstacle,
          roughness: obstacleRoughness,
        },
      },
    },
    sensor: {
      ...baseProfile.sensor,
      barrelDistortion,
      vignette,
    },
  };
}
