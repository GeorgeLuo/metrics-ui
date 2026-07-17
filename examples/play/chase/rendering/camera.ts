import type {
  ChaseCameraMount,
  ChaseRenderingProfile,
} from "./profile-contract.ts";

const DEFAULT_VERTICAL_FOV_DEGREES = 60;
const DEFAULT_FAR_DISTANCE = 14;
const DEFAULT_NEAR_DISTANCE = 0.04;
const DEFAULT_IMAGE_WIDTH = 640;
const DEFAULT_IMAGE_HEIGHT = 480;

type CameraLike = {
  fov?: number;
  aspect?: number;
  near?: number;
  far?: number;
  position: { set: (x: number, y: number, z: number) => void };
  lookAt: (x: number, y: number, z: number) => void;
  updateProjectionMatrix: () => void;
};

type VectorXZ = Readonly<{ x: number; z: number }>;

export type ChaseCameraPerceptionInput = Readonly<{
  fieldOfViewAngleRadians?: number;
  fieldOfViewDistance?: number;
}>;

/** Fully numeric camera settings retained with one rendered front-view image. */
export type ResolvedChaseCamera = Readonly<{
  mount: ChaseCameraMount;
  lensModel: "pinhole";
  projection: Readonly<{
    source: "perception" | "profile";
    verticalFovDegrees: number;
    horizontalFovDegrees: number;
    near: number;
    far: number;
    imageWidth: number;
    imageHeight: number;
    aspect: number;
  }>;
}>;

function positiveNumber(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function degreesFromRadians(value: unknown, fallback: number): number {
  const radians = Number(value);
  return Number.isFinite(radians) && radians > 0
    ? radians * 180 / Math.PI
    : fallback;
}

function horizontalFovDegrees(verticalFovDegrees: number, aspect: number): number {
  const verticalFovRadians = verticalFovDegrees * Math.PI / 180;
  return 2 * Math.atan(Math.tan(verticalFovRadians / 2) * aspect) * 180 / Math.PI;
}

/**
 * Resolves a rendering profile into numeric camera values for one output image.
 *
 * Simulation rendering intentionally inherits the configurable perception FOV,
 * while calibrated profiles own their visual projection independently.
 */
export function resolveChaseCamera(
  profile: ChaseRenderingProfile,
  perception: ChaseCameraPerceptionInput = {},
  dimensions: Readonly<{ width?: number; height?: number }> = {},
): ResolvedChaseCamera {
  const projection = profile.camera.projection;
  const imageWidth = positiveNumber(dimensions.width, projection.imageWidth || DEFAULT_IMAGE_WIDTH);
  const imageHeight = positiveNumber(dimensions.height, projection.imageHeight || DEFAULT_IMAGE_HEIGHT);
  const aspect = imageWidth / imageHeight;
  const usesProfileProjection = projection.source === "profile"
    && Number.isFinite(projection.verticalFovDegrees)
    && Number.isFinite(projection.far);
  const verticalFovDegrees = usesProfileProjection
    ? positiveNumber(projection.verticalFovDegrees, DEFAULT_VERTICAL_FOV_DEGREES)
    : degreesFromRadians(
      perception.fieldOfViewAngleRadians,
      DEFAULT_VERTICAL_FOV_DEGREES,
    );
  const far = usesProfileProjection
    ? positiveNumber(projection.far, DEFAULT_FAR_DISTANCE)
    : positiveNumber(perception.fieldOfViewDistance, DEFAULT_FAR_DISTANCE);

  return {
    mount: profile.camera.mount,
    lensModel: profile.camera.lensModel,
    projection: {
      source: usesProfileProjection ? "profile" : "perception",
      verticalFovDegrees,
      horizontalFovDegrees: horizontalFovDegrees(verticalFovDegrees, aspect),
      near: positiveNumber(projection.near, DEFAULT_NEAR_DISTANCE),
      far,
      imageWidth,
      imageHeight,
      aspect,
    },
  };
}

/** Applies the resolved projection identically to a live or offscreen camera. */
export function applyChaseCameraProjection(
  camera: CameraLike,
  resolvedCamera: ResolvedChaseCamera,
): void {
  camera.fov = resolvedCamera.projection.verticalFovDegrees;
  camera.aspect = resolvedCamera.projection.aspect;
  camera.near = resolvedCamera.projection.near;
  camera.far = resolvedCamera.projection.far;
  camera.updateProjectionMatrix();
}

/** Places a rendered actor camera using its explicit mount orientation. */
export function configureChaseActorCamera(
  camera: CameraLike,
  actorPosition: VectorXZ,
  actorLookDirection: VectorXZ,
  mount: ChaseCameraMount,
): void {
  const directionLength = Math.hypot(actorLookDirection.x, actorLookDirection.z) || 1;
  const directionX = actorLookDirection.x / directionLength;
  const directionZ = actorLookDirection.z / directionLength;
  const cosYaw = Math.cos(mount.yawRadians);
  const sinYaw = Math.sin(mount.yawRadians);
  const forwardX = directionX * cosYaw + directionZ * sinYaw;
  const forwardZ = directionZ * cosYaw - directionX * sinYaw;
  const lookDistance = positiveNumber(mount.lookDistance, 1);

  camera.position.set(actorPosition.x, mount.height, actorPosition.z);
  camera.lookAt(
    actorPosition.x + forwardX * lookDistance,
    mount.height - Math.tan(mount.pitchDownRadians) * lookDistance,
    actorPosition.z + forwardZ * lookDistance,
  );
}
