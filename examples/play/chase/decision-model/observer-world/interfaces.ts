export type VectorXZ = {
  x: number;
  z: number;
};

export type WallObstacle = {
  id?: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotationRadians?: number;
};

export type ObstacleSet = {
  walls?: WallObstacle[];
};

export type WorldContext = {
  columns?: number;
  rows?: number;
  obstacles?: ObstacleSet;
};

export type ProjectionContext = {
  horizonFrames?: number;
  sampleSpacingFrames?: number;
};

export type BoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type ObservedActor = {
  visible: boolean;
  absent?: boolean;
  disabled?: boolean;
  bearingRadians?: number;
  distance?: number;
};

export type ObservedMapWall = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotationRadians: number;
};

export type ObservedMapObstacleSet = {
  walls: ObservedMapWall[];
};

export type ObservedMapAreaCell = {
  id: string;
  cellX: number;
  cellZ: number;
  center: VectorXZ;
  vertices: VectorXZ[];
};

export type ObservedMap = {
  visibleWalls: Array<{
    wall: ObservedMapWall;
    sample: {
      point: VectorXZ;
      bearingRadians: number;
      distance: number;
    };
  }>;
  visibleArea: {
    cells: ObservedMapAreaCell[];
    observationCount: number;
  };
  observationCount: number;
  disabled?: boolean;
};

export type ChaserObservedWorld = ObservedActor & {
  evader: ObservedActor;
  map: ObservedMap;
};

export type EvaderObservedWorld = {
  position?: VectorXZ | null;
  direction?: VectorXZ | null;
  chaserPosition?: VectorXZ | null;
  chaserPerception: ObservedActor;
  columns?: number;
  rows?: number;
  frameIndex?: number | null;
  obstacles?: ObstacleSet;
  turnRateRadiansPerFrame?: number;
  policy?: Record<string, unknown>;
};

export type ActorLocationMemory = {
  visible?: boolean;
  position?: VectorXZ | null;
  direction?: VectorXZ | null;
  observationCount?: number;
};

export type ObservedMotionMemory = {
  observationCount?: number;
  motionObservationCount?: number;
  speedEstimateUnitsPerFrame?: number;
  speedObservationCount?: number;
  lastObservedDirection?: VectorXZ | null;
  previousObservedDirection?: VectorXZ | null;
  observedTurnRadiansPerFrame?: number;
  lastObservedPosition?: VectorXZ | null;
};

export const VECTOR_XZ_FIELDS = Object.freeze([
  "x",
  "z",
]);

export const WALL_OBSTACLE_FIELDS = Object.freeze([
  "id",
  "x",
  "z",
  "width",
  "depth",
]);

export const OBSTACLE_SET_FIELDS = Object.freeze([
  "walls",
]);

export const WORLD_CONTEXT_FIELDS = Object.freeze([
  "columns",
  "rows",
  "obstacles",
]);

export const PROJECTION_CONTEXT_FIELDS = Object.freeze([
  "horizonFrames",
  "sampleSpacingFrames",
]);

export const OBSERVED_ACTOR_FIELDS = Object.freeze([
  "visible",
  "absent",
  "disabled",
  "bearingRadians",
  "distance",
]);

export const OBSERVED_MAP_WALL_FIELDS = Object.freeze([
  "id",
  "x",
  "z",
  "width",
  "depth",
]);

export const OBSERVED_MAP_AREA_CELL_FIELDS = Object.freeze([
  "id",
  "cellX",
  "cellZ",
  "center",
  "vertices",
]);

export const OBSERVED_MAP_FIELDS = Object.freeze([
  "visibleWalls",
  "visibleArea",
  "observationCount",
  "disabled",
]);

export const CHASER_OBSERVED_WORLD_FIELDS = Object.freeze([
  "evader",
  "map",
]);

export const EVADER_OBSERVED_WORLD_FIELDS = Object.freeze([
  "position",
  "direction",
  "chaserPosition",
  "chaserPerception",
  "columns",
  "rows",
  "frameIndex",
  "obstacles",
  "turnRateRadiansPerFrame",
  "policy",
]);

export const ACTOR_LOCATION_MEMORY_FIELDS = Object.freeze([
  "visible",
  "position",
  "direction",
  "observationCount",
]);

export const OBSERVED_MOTION_MEMORY_FIELDS = Object.freeze([
  "observationCount",
  "motionObservationCount",
  "speedEstimateUnitsPerFrame",
  "speedObservationCount",
  "lastObservedDirection",
  "previousObservedDirection",
  "observedTurnRadiansPerFrame",
  "lastObservedPosition",
]);
