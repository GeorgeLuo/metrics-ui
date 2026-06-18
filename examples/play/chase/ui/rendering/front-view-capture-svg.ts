import type {
  VehicleFrontViewCapturedActor,
  VehicleFrontViewCaptureRecord,
} from "../../decision-model/memory/vehicle/front-view-captures.ts";
import type {
  ObservedMapWall,
  VectorXZ,
} from "../../decision-model/observer-world/interfaces.ts";

type ProjectedPoint = {
  x: number;
  y: number;
  depth: number;
};

export type FrontViewCaptureSvgOptions = {
  width?: number;
  height?: number;
};

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const OBSTACLE_HEIGHT = 0.62;
const ACTOR_HEIGHT = 0.22;
const CAMERA_HEIGHT = 0.42;
const CAMERA_LOOK_DISTANCE = 3;
const CAMERA_TARGET_HEIGHT = 0.07;

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeVector(vector: VectorXZ): VectorXZ {
  const magnitude = Math.hypot(vector.x, vector.z);
  return magnitude > 0.000001
    ? { x: vector.x / magnitude, z: vector.z / magnitude }
    : { x: 1, z: 0 };
}

function getWallCorners(wall: ObservedMapWall): VectorXZ[] {
  const halfWidth = wall.width / 2;
  const halfDepth = wall.depth / 2;
  const rotation = Number(wall.rotationRadians) || 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: -halfWidth, z: halfDepth },
  ].map((localPoint) => ({
    x: wall.x + localPoint.x * cos + localPoint.z * sin,
    z: wall.z - localPoint.x * sin + localPoint.z * cos,
  }));
}

function projectPoint({
  point,
  y,
  capture,
  width,
  height,
}: {
  point: VectorXZ;
  y: number;
  capture: VehicleFrontViewCaptureRecord;
  width: number;
  height: number;
}): ProjectedPoint | null {
  const actorPosition = capture.pose.position;
  const actorDirection = normalizeVector(capture.pose.direction);
  const right = { x: actorDirection.z, z: -actorDirection.x };
  const dx = point.x - actorPosition.x;
  const dz = point.z - actorPosition.z;
  const localX = dx * right.x + dz * right.z;
  const localZ = dx * actorDirection.x + dz * actorDirection.z;
  const localY = y - CAMERA_HEIGHT;
  const pitch = Math.atan2(CAMERA_TARGET_HEIGHT - CAMERA_HEIGHT, CAMERA_LOOK_DISTANCE);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cameraY = localY * cosPitch - localZ * sinPitch;
  const cameraZ = localY * sinPitch + localZ * cosPitch;

  if (cameraZ <= 0.03) {
    return null;
  }

  const aspect = width / height;
  const tanHalfFov = Math.tan(capture.pose.fieldOfViewAngleRadians / 2);
  const ndcX = (localX / cameraZ) / (tanHalfFov * aspect);
  const ndcY = (cameraY / cameraZ) / tanHalfFov;
  return {
    x: (ndcX + 1) * width / 2,
    y: (1 - ndcY) * height / 2,
    depth: cameraZ,
  };
}

function toSvgPoints(points: ProjectedPoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function getVisibleWalls(capture: VehicleFrontViewCaptureRecord): ObservedMapWall[] {
  const wallsById = new Map<string, ObservedMapWall>();
  for (const visibleWall of capture.map.visibleWalls ?? []) {
    if (visibleWall.wall?.id) {
      wallsById.set(visibleWall.wall.id, visibleWall.wall);
    }
  }
  return [...wallsById.values()];
}

function getWallFaces({
  wall,
  capture,
  width,
  height,
}: {
  wall: ObservedMapWall;
  capture: VehicleFrontViewCaptureRecord;
  width: number;
  height: number;
}) {
  const corners = getWallCorners(wall);
  const bottom = corners.map((corner) => projectPoint({
    point: corner,
    y: 0,
    capture,
    width,
    height,
  }));
  const top = corners.map((corner) => projectPoint({
    point: corner,
    y: OBSTACLE_HEIGHT,
    capture,
    width,
    height,
  }));
  const faces: Array<{ id: string; depth: number; points: ProjectedPoint[]; fill: string }> = [];

  for (let index = 0; index < 4; index += 1) {
    const nextIndex = (index + 1) % 4;
    const points = [bottom[index], bottom[nextIndex], top[nextIndex], top[index]];
    if (points.every(Boolean)) {
      const facePoints = points as ProjectedPoint[];
      faces.push({
        id: `${wall.id}-side-${index}`,
        depth: facePoints.reduce((sum, point) => sum + point.depth, 0) / facePoints.length,
        points: facePoints,
        fill: index % 2 === 0 ? "#b98554" : "#c8955d",
      });
    }
  }

  if (top.every(Boolean)) {
    const topPoints = top as ProjectedPoint[];
    faces.push({
      id: `${wall.id}-top`,
      depth: topPoints.reduce((sum, point) => sum + point.depth, 0) / topPoints.length,
      points: topPoints,
      fill: "#d2a675",
    });
  }

  return faces;
}

function renderCapturedActor({
  actor,
  capture,
  width,
  height,
}: {
  actor: VehicleFrontViewCapturedActor;
  capture: VehicleFrontViewCaptureRecord;
  width: number;
  height: number;
}): string | null {
  if (!actor.position) {
    return null;
  }

  const ground = projectPoint({ point: actor.position, y: 0, capture, width, height });
  const top = projectPoint({ point: actor.position, y: ACTOR_HEIGHT, capture, width, height });
  if (!ground || !top) {
    return null;
  }

  const radius = Number.isFinite(actor.radius) ? Number(actor.radius) : 0.12;
  const projectedHalfWidth = Math.max(6, Math.min(46, radius * width / Math.max(ground.depth, 0.1)));
  const bodyHeight = Math.max(10, ground.y - top.y);
  const x = ground.x - projectedHalfWidth;
  const y = ground.y - bodyHeight;
  const bodyWidth = projectedHalfWidth * 2;
  return [
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}" rx="3" fill="#335c81" stroke="#1d2e40" stroke-width="2"/>`,
    `<text x="${ground.x.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" fill="#1d2e40" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${escapeXml(actor.actorId)}</text>`,
  ].join("");
}

/**
 * Reconstructs an SVG image from stored front-view capture metadata.
 */
export function renderVehicleFrontViewCaptureSvg(
  capture: VehicleFrontViewCaptureRecord,
  {
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
  }: FrontViewCaptureSvgOptions = {},
): string {
  const walls = getVisibleWalls(capture);
  const wallFaces = walls
    .flatMap((wall) => getWallFaces({ wall, capture, width, height }))
    .sort((left, right) => right.depth - left.depth);
  const actorElements = capture.visibleActors
    .map((actor) => renderCapturedActor({ actor, capture, width, height }))
    .filter((element): element is string => Boolean(element));
  const horizonY = height * 0.39;
  const fovDegrees = capture.pose.fieldOfViewAngleRadians * 180 / Math.PI;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(capture.actorId)} front-view capture">`,
    "<defs>",
    "<linearGradient id=\"floor\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c5ad98\"/><stop offset=\"1\" stop-color=\"#a98973\"/></linearGradient>",
    "</defs>",
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#d9ece9"/>`,
    `<rect x="0" y="${horizonY.toFixed(1)}" width="${width}" height="${(height - horizonY).toFixed(1)}" fill="url(#floor)"/>`,
    `<line x1="0" y1="${horizonY.toFixed(1)}" x2="${width}" y2="${horizonY.toFixed(1)}" stroke="#725238" stroke-width="2" opacity="0.45"/>`,
    ...wallFaces.map((face) => (
      `<polygon id="${escapeXml(face.id)}" points="${toSvgPoints(face.points)}" fill="${face.fill}" stroke="#4a3327" stroke-width="2" stroke-linejoin="round"/>`
    )),
    ...actorElements,
    `<text x="12" y="${height - 14}" fill="#2f241d" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">actor=${escapeXml(capture.actorId)} frame=${escapeXml(capture.frameIndex)} fov=${fovDegrees.toFixed(1)}deg walls=${walls.length}</text>`,
    "</svg>",
  ].join("");
}
