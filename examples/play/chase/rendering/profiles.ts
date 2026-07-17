import {
  CHASER_VIEW_CAMERA_HEIGHT,
  CHASER_VIEW_LOOK_DISTANCE,
} from "../config/constants.mjs";

export const CHASE_RENDERING_PROFILE_IDS = {
  SIMULATION: "simulation",
  RC_INDOOR: "rc-indoor",
  RANDOMIZED: "randomized",
} as const;

export type ChaseRenderingProfileId =
  typeof CHASE_RENDERING_PROFILE_IDS[keyof typeof CHASE_RENDERING_PROFILE_IDS];

/** Material values already resolved for direct Three.js consumption. */
export type ChaseRenderingMaterial = Readonly<{
  color: number;
  roughness: number;
  metalness: number;
}>;

/**
 * Immutable visual input shared by the main scene, actor views, and captures.
 *
 * Renderer modules consume this shape and never select a preset themselves.
 */
export type ChaseRenderingProfile = Readonly<{
  id: ChaseRenderingProfileId;
  seed: number | null;
  environment: Readonly<{
    clear: Readonly<{ color: number; alpha: number }>;
    ambientLight: Readonly<{ color: number; intensity: number }>;
    keyLight: Readonly<{
      color: number;
      intensity: number;
      position: Readonly<{ x: number; y: number; z: number }>;
    }>;
    materials: Readonly<{
      floor: ChaseRenderingMaterial & Readonly<{ fallbackColor: number }>;
      obstacle: ChaseRenderingMaterial & Readonly<{
        edgeColor: number;
        edgeOpacity: number;
      }>;
      surface: ChaseRenderingMaterial & Readonly<{ opacity: number }>;
    }>;
  }>;
  camera: Readonly<{
    mount: Readonly<{ height: number; lookDistance: number }>;
    lensModel: "pinhole";
  }>;
  sensor: Readonly<{
    imageProcessing: "none";
  }>;
}>;

const PROFILE_ID_SET = new Set<string>(Object.values(CHASE_RENDERING_PROFILE_IDS));
const MAX_SEED = 0xffffffff;

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function createBaselineProfile(id: ChaseRenderingProfileId): ChaseRenderingProfile {
  return deepFreeze({
    id,
    seed: id === CHASE_RENDERING_PROFILE_IDS.RANDOMIZED ? 0 : null,
    environment: {
      clear: { color: 0x000000, alpha: 0 },
      ambientLight: { color: 0xffffff, intensity: 1.8 },
      keyLight: {
        color: 0xffffff,
        intensity: 1.2,
        position: { x: 3, y: 8, z: 4 },
      },
      materials: {
        floor: {
          color: 0xffffff,
          fallbackColor: 0xeee9dc,
          roughness: 0.94,
          metalness: 0,
        },
        obstacle: {
          color: 0xffffff,
          roughness: 0.58,
          metalness: 0.02,
          edgeColor: 0x334155,
          edgeOpacity: 0.9,
        },
        surface: {
          color: 0x94a3b8,
          opacity: 0.18,
          roughness: 0.82,
          metalness: 0,
        },
      },
    },
    camera: {
      mount: {
        height: CHASER_VIEW_CAMERA_HEIGHT,
        lookDistance: CHASER_VIEW_LOOK_DISTANCE,
      },
      lensModel: "pinhole",
    },
    sensor: {
      imageProcessing: "none",
    },
  });
}

/** Named, fully resolved profiles available to scenario and session settings. */
export const CHASE_RENDERING_PROFILES = deepFreeze({
  [CHASE_RENDERING_PROFILE_IDS.SIMULATION]: createBaselineProfile(
    CHASE_RENDERING_PROFILE_IDS.SIMULATION,
  ),
  [CHASE_RENDERING_PROFILE_IDS.RC_INDOOR]: createBaselineProfile(
    CHASE_RENDERING_PROFILE_IDS.RC_INDOOR,
  ),
  [CHASE_RENDERING_PROFILE_IDS.RANDOMIZED]: createBaselineProfile(
    CHASE_RENDERING_PROFILE_IDS.RANDOMIZED,
  ),
});

export const SIMULATION_RENDERING_PROFILE =
  CHASE_RENDERING_PROFILES[CHASE_RENDERING_PROFILE_IDS.SIMULATION];

/** Stable selector options for the Chase Game settings. */
export const CHASE_RENDERING_PROFILE_OPTIONS = deepFreeze([
  { value: CHASE_RENDERING_PROFILE_IDS.SIMULATION, label: "simulation" },
  { value: CHASE_RENDERING_PROFILE_IDS.RC_INDOOR, label: "RC indoor" },
  { value: CHASE_RENDERING_PROFILE_IDS.RANDOMIZED, label: "randomized" },
]);

/** Returns a supported profile ID, falling back to deterministic simulation. */
export function normalizeChaseRenderingProfileId(value: unknown): ChaseRenderingProfileId {
  return typeof value === "string" && PROFILE_ID_SET.has(value)
    ? value as ChaseRenderingProfileId
    : CHASE_RENDERING_PROFILE_IDS.SIMULATION;
}

function normalizeSeed(value: unknown, fallback: number | null): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.round(Math.max(0, Math.min(MAX_SEED, numericValue)))
    : fallback;
}

/**
 * Resolves scenario-facing profile selection into one immutable renderer input.
 *
 * All named profiles intentionally retain baseline visual values in this
 * contract delivery. Later work packages can change presets without changing
 * renderer ownership or the scenario/session interface.
 */
export function resolveChaseRenderingProfile(value: unknown): ChaseRenderingProfile {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = normalizeChaseRenderingProfileId(record.profile ?? record.id ?? value);
  const preset = CHASE_RENDERING_PROFILES[id];
  const seed = normalizeSeed(record.seed, preset.seed);
  return seed === preset.seed
    ? preset
    : deepFreeze({ ...preset, seed });
}
