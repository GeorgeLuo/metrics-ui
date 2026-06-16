import type { Express, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

type ActorId = "chaser" | "evader";

type PointXZ = {
  x: number;
  z: number;
};

type Wall = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotationRadians?: number;
};

type ChaseActor = {
  exists?: boolean;
  position?: PointXZ | null;
  direction?: PointXZ | null;
};

type ChaseScenario = {
  id?: string;
  label?: string;
  map?: {
    obstacles?: {
      walls?: Wall[];
    };
  };
  actors?: Partial<Record<ActorId, ChaseActor>>;
  vehicleSettings?: {
    fieldOfViewAngleRadians?: number;
  };
};

type ProjectedPoint = { x: number; y: number; depth: number };
type ActorViewRenderOptions = { actorId: ActorId; width: number; height: number };

const DEFAULT_SCENARIO_ID = "default";
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const MIN_IMAGE_SIZE = 160;
const MAX_IMAGE_SIZE = 1600;
const OBSTACLE_HEIGHT = 0.62;
const CAMERA_HEIGHT = 0.42;
const CAMERA_LOOK_DISTANCE = 3;
const CAMERA_TARGET_HEIGHT = 0.07;
const DEFAULT_FIELD_OF_VIEW_RADIANS = Math.PI / 3;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.round(clampNumber(numericValue, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE));
}

function isSafeScenarioId(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeVector(vector: PointXZ): PointXZ {
  const magnitude = Math.hypot(vector.x, vector.z);
  return magnitude > 0.000001
    ? { x: vector.x / magnitude, z: vector.z / magnitude }
    : { x: 0, z: 1 };
}

function getWallCorners(wall: Wall): PointXZ[] {
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

function toSvgPoints(points: ProjectedPoint[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

async function importFresh(filePath: string): Promise<Record<string, unknown>> {
  const stat = fs.statSync(filePath);
  const url = `${pathToFileURL(filePath).href}?v=${Math.floor(stat.mtimeMs)}`;
  return import(url) as Promise<Record<string, unknown>>;
}

async function resolveScenario(projectRoot: string, scenarioId: string) {
  const scenarioIndexPath = path.resolve(projectRoot, "examples/play/chase/scenarios/index.mjs");
  const scenarioResolverPath = path.resolve(projectRoot, "examples/play/chase/simulation/scenario.mjs");
  const scenarioIndex = await importFresh(scenarioIndexPath);
  const scenarioResolver = await importFresh(scenarioResolverPath);
  const getChaseScenarioDefinition = scenarioIndex.getChaseScenarioDefinition;
  const resolveChaseScenario = scenarioResolver.resolveChaseScenario;

  if (typeof getChaseScenarioDefinition !== "function" || typeof resolveChaseScenario !== "function") {
    throw new Error("Chase scenario modules are not available.");
  }

  const definition = getChaseScenarioDefinition(scenarioId);
  return resolveChaseScenario(definition, {}) as ChaseScenario;
}

function projectPoint({
  point,
  y,
  actorPosition,
  actorDirection,
  fieldOfViewRadians,
  width,
  height,
}: {
  point: PointXZ;
  y: number;
  actorPosition: PointXZ;
  actorDirection: PointXZ;
  fieldOfViewRadians: number;
  width: number;
  height: number;
}): ProjectedPoint | null {
  const forward = normalizeVector(actorDirection);
  const right = { x: forward.z, z: -forward.x };
  const dx = point.x - actorPosition.x;
  const dz = point.z - actorPosition.z;
  const localX = dx * right.x + dz * right.z;
  const localZ = dx * forward.x + dz * forward.z;
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
  const tanHalfFov = Math.tan(fieldOfViewRadians / 2);
  const ndcX = (localX / cameraZ) / (tanHalfFov * aspect);
  const ndcY = (cameraY / cameraZ) / tanHalfFov;
  return {
    x: (ndcX + 1) * width / 2,
    y: (1 - ndcY) * height / 2,
    depth: cameraZ,
  };
}

function getWallFaces({
  wall,
  actorPosition,
  actorDirection,
  fieldOfViewRadians,
  width,
  height,
}: {
  wall: Wall;
  actorPosition: PointXZ;
  actorDirection: PointXZ;
  fieldOfViewRadians: number;
  width: number;
  height: number;
}) {
  const bottom = getWallCorners(wall).map((corner) => projectPoint({
    point: corner,
    y: 0,
    actorPosition,
    actorDirection,
    fieldOfViewRadians,
    width,
    height,
  }));
  const top = getWallCorners(wall).map((corner) => projectPoint({
    point: corner,
    y: OBSTACLE_HEIGHT,
    actorPosition,
    actorDirection,
    fieldOfViewRadians,
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

function renderActorViewSvg(scenario: ChaseScenario, {
  actorId,
  width,
  height,
}: ActorViewRenderOptions): string {
  const actor = scenario.actors?.[actorId];
  const actorPosition = actor?.position ?? null;
  const actorDirection = actor?.direction ?? null;
  if (!actorPosition || !actorDirection) {
    throw new Error(`Scenario does not include a usable ${actorId} pose.`);
  }

  const fieldOfViewRadians = Number(scenario.vehicleSettings?.fieldOfViewAngleRadians)
    || DEFAULT_FIELD_OF_VIEW_RADIANS;
  const walls = Array.isArray(scenario.map?.obstacles?.walls)
    ? scenario.map.obstacles.walls as Wall[]
    : [];
  const faces = walls
    .flatMap((wall) => getWallFaces({
      wall,
      actorPosition,
      actorDirection,
      fieldOfViewRadians,
      width,
      height,
    }))
    .sort((left, right) => right.depth - left.depth);
  const horizonY = height * 0.39;
  const fovDegrees = fieldOfViewRadians * 180 / Math.PI;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(scenario.label)} ${actorId} view">`,
    "<defs>",
    "<linearGradient id=\"floor\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c5ad98\"/><stop offset=\"1\" stop-color=\"#a98973\"/></linearGradient>",
    "</defs>",
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#d9ece9"/>`,
    `<rect x="0" y="${horizonY.toFixed(1)}" width="${width}" height="${(height - horizonY).toFixed(1)}" fill="url(#floor)"/>`,
    `<line x1="0" y1="${horizonY.toFixed(1)}" x2="${width}" y2="${horizonY.toFixed(1)}" stroke="#725238" stroke-width="2" opacity="0.45"/>`,
    ...faces.map((face) => (
      `<polygon id="${escapeXml(face.id)}" points="${toSvgPoints(face.points)}" fill="${face.fill}" stroke="#4a3327" stroke-width="2" stroke-linejoin="round"/>`
    )),
    `<text x="12" y="${height - 14}" fill="#2f241d" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">scenario=${escapeXml(scenario.id)} actor=${actorId} fov=${fovDegrees.toFixed(1)}deg walls=${walls.length}</text>`,
    "</svg>",
  ].join("");
}

function sendSvg(res: Response, svg: string) {
  res.setHeader("Cache-Control", "no-cache");
  res.type("image/svg+xml").send(svg);
}

export function registerPlayChaseActorViewImageRoute({
  app,
  projectRoot,
}: {
  app: Express;
  projectRoot: string;
}) {
  app.get("/api/play/games/chase/actor-view.svg", async (req, res) => {
    try {
      const scenarioId = typeof req.query.scenario === "string" && req.query.scenario.trim()
        ? req.query.scenario.trim()
        : DEFAULT_SCENARIO_ID;
      if (!isSafeScenarioId(scenarioId)) {
        return res.status(400).json({ error: "Invalid scenario id." });
      }
      const actorId = req.query.actor === "evader" ? "evader" : "chaser";
      const width = parsePositiveInteger(req.query.width, DEFAULT_WIDTH);
      const height = parsePositiveInteger(req.query.height, DEFAULT_HEIGHT);
      const scenario = await resolveScenario(projectRoot, scenarioId);
      return sendSvg(res, renderActorViewSvg(scenario, {
        actorId,
        width,
        height,
      }));
    } catch (error) {
      console.error("Failed to render Chase actor view image:", error);
      return res.status(500).json({ error: "Chase actor view image is not available." });
    }
  });
}
