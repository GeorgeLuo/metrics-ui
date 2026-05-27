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
