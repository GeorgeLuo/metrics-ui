import {
  CAR_HEIGHT,
  CHASER_VIEW_CAMERA_HEIGHT,
  CHASER_VIEW_LOOK_DISTANCE,
} from "../config/constants.mjs";
import {
  CHASE_RENDERING_PROFILE_IDS,
  type ChaseRenderingProfile,
  type ChaseRenderingProfileId,
} from "./profile-contract.ts";

const PROFILE_ID_SET = new Set<string>(Object.values(CHASE_RENDERING_PROFILE_IDS));
const MAX_SEED = 0xffffffff;
const CAMERA_NEAR_DISTANCE = 0.04;
const CAMERA_IMAGE_WIDTH = 640;
const CAMERA_IMAGE_HEIGHT = 480;
const RC_INDOOR_COMPOSITION_HORIZONTAL_FOV_DEGREES = 86;
const RC_INDOOR_REFERENCE_ASPECT = CAMERA_IMAGE_WIDTH / CAMERA_IMAGE_HEIGHT;
const RC_INDOOR_COMPOSITION_VERTICAL_FOV_DEGREES = 2 * Math.atan(
  Math.tan(RC_INDOOR_COMPOSITION_HORIZONTAL_FOV_DEGREES * Math.PI / 360)
  / RC_INDOOR_REFERENCE_ASPECT,
) * 180 / Math.PI;
const SIMULATION_CAMERA_PITCH_DOWN_RADIANS = Math.atan2(
  CHASER_VIEW_CAMERA_HEIGHT - CAR_HEIGHT / 2,
  CHASER_VIEW_LOOK_DISTANCE,
);

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
      renderer: {
        toneMapping: "none",
        exposure: 1,
        shadows: {
          enabled: false,
          mapSize: 1024,
          bias: 0,
          normalBias: 0,
          radius: 1,
          cameraPadding: 1,
          cameraFar: 30,
        },
      },
      clear: { color: 0x000000, alpha: 0 },
      ambientLight: { color: 0xffffff, intensity: 1.8 },
      keyLight: {
        color: 0xffffff,
        intensity: 1.2,
        position: { x: 3, y: 8, z: 4 },
        target: { x: 0, y: 0, z: 0 },
      },
      materials: {
        floor: {
          color: 0xffffff,
          fallbackColor: 0xeee9dc,
          roughness: 0.94,
          metalness: 0,
          texture: "simulation-floor",
          textureRepeatUnits: 2,
        },
        obstacle: {
          color: 0xffffff,
          fallbackColor: 0xffffff,
          roughness: 0.58,
          metalness: 0.02,
          texture: "none",
          textureRepeatUnits: 1,
          edgeColor: 0x334155,
          edgeOpacity: 0.9,
        },
        roomWall: {
          color: 0xffffff,
          fallbackColor: 0xffffff,
          roughness: 0.58,
          metalness: 0.02,
          texture: "none",
          textureRepeatUnits: 1,
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
        pitchDownRadians: SIMULATION_CAMERA_PITCH_DOWN_RADIANS,
        yawRadians: 0,
        lookDistance: CHASER_VIEW_LOOK_DISTANCE,
      },
      projection: {
        source: "perception",
        verticalFovDegrees: null,
        near: CAMERA_NEAR_DISTANCE,
        far: null,
        imageWidth: CAMERA_IMAGE_WIDTH,
        imageHeight: CAMERA_IMAGE_HEIGHT,
      },
      lensModel: "pinhole",
    },
    sensor: {
      imageProcessing: "none",
    },
  });
}

function createRcIndoorProfile(): ChaseRenderingProfile {
  const baseline = createBaselineProfile(CHASE_RENDERING_PROFILE_IDS.RC_INDOOR);
  return deepFreeze({
    ...baseline,
    environment: {
      ...baseline.environment,
      renderer: {
        toneMapping: "aces-filmic",
        exposure: 1.15,
        shadows: {
          enabled: true,
          mapSize: 1024,
          bias: -0.00035,
          normalBias: 0.018,
          radius: 2,
          cameraPadding: 1,
          cameraFar: 30,
        },
      },
      clear: { color: 0xd8d6cf, alpha: 1 },
      ambientLight: { color: 0xfff3e2, intensity: 0.9 },
      keyLight: {
        color: 0xffdfb5,
        intensity: 2.4,
        position: { x: -3, y: 6, z: 1.5 },
        target: { x: 0, y: 0, z: 0 },
      },
      materials: {
        ...baseline.environment.materials,
        floor: {
          color: 0xffffff,
          fallbackColor: 0xd6cec2,
          roughness: 0.98,
          metalness: 0,
          texture: "carpet-light",
          textureRepeatUnits: 1.25,
        },
        obstacle: {
          color: 0xffffff,
          fallbackColor: 0xb88752,
          roughness: 0.88,
          metalness: 0,
          texture: "cardboard-kraft",
          textureRepeatUnits: 0.8,
          edgeColor: 0x6d4b2d,
          edgeOpacity: 0.42,
        },
        roomWall: {
          color: 0xf3f0e8,
          fallbackColor: 0xf3f0e8,
          roughness: 0.9,
          metalness: 0,
          texture: "none",
          textureRepeatUnits: 2,
          edgeColor: 0x8c8a82,
          edgeOpacity: 0.72,
        },
      },
    },
    camera: {
      ...baseline.camera,
      mount: {
        height: 0.16,
        pitchDownRadians: 2.8 * Math.PI / 180,
        yawRadians: 0,
        lookDistance: 2,
      },
      projection: {
        source: "profile",
        verticalFovDegrees: RC_INDOOR_COMPOSITION_VERTICAL_FOV_DEGREES,
        near: CAMERA_NEAR_DISTANCE,
        far: 14,
        imageWidth: CAMERA_IMAGE_WIDTH,
        imageHeight: CAMERA_IMAGE_HEIGHT,
      },
    },
  });
}

/** Named, fully resolved profiles available to scenario and session settings. */
export const CHASE_RENDERING_PROFILES = deepFreeze({
  [CHASE_RENDERING_PROFILE_IDS.SIMULATION]: createBaselineProfile(
    CHASE_RENDERING_PROFILE_IDS.SIMULATION,
  ),
  [CHASE_RENDERING_PROFILE_IDS.RC_INDOOR]: createRcIndoorProfile(),
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
 * Named profiles own values; renderer modules only consume the resolved shape.
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
