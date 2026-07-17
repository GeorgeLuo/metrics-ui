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
    renderer: Readonly<{
      toneMapping: "none" | "aces-filmic";
      exposure: number;
      shadows: Readonly<{
        enabled: boolean;
        mapSize: number;
        bias: number;
        normalBias: number;
        radius: number;
        cameraPadding: number;
        cameraFar: number;
      }>;
    }>;
    clear: Readonly<{ color: number; alpha: number }>;
    ambientLight: Readonly<{ color: number; intensity: number }>;
    keyLight: Readonly<{
      color: number;
      intensity: number;
      position: Readonly<{ x: number; y: number; z: number }>;
      target: Readonly<{ x: number; y: number; z: number }>;
    }>;
    materials: Readonly<{
      floor: ChaseRenderingMaterial & Readonly<{
        fallbackColor: number;
        texture: "simulation-floor" | "carpet-light";
        textureRepeatUnits: number;
      }>;
      obstacle: ChaseRenderingMaterial & Readonly<{
        fallbackColor: number;
        texture: "none" | "cardboard-kraft";
        textureRepeatUnits: number;
        edgeColor: number;
        edgeOpacity: number;
      }>;
      roomWall: ChaseRenderingMaterial & Readonly<{
        fallbackColor: number;
        texture: "none";
        textureRepeatUnits: number;
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
