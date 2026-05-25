/**
 * @typedef {Object} VectorXZ
 * @property {number} x Position or direction component on the x axis.
 * @property {number} z Position or direction component on the z axis.
 */

/**
 * @typedef {Object} WallObstacle
 * @property {string} [id] Stable obstacle id when one is known.
 * @property {number} x Wall center on the x axis.
 * @property {number} z Wall center on the z axis.
 * @property {number} width Wall width in world units.
 * @property {number} depth Wall depth in world units.
 */

/**
 * @typedef {Object} ObstacleSet
 * @property {WallObstacle[]} [walls] Known wall obstacles.
 */

/**
 * @typedef {Object} WorldContext
 * @property {number} [columns] Field width in world columns.
 * @property {number} [rows] Field depth in world rows.
 * @property {ObstacleSet} [obstacles] Obstacles known to the actor.
 */

/**
 * @typedef {Object} ProjectionContext
 * @property {number} [horizonFrames] Number of future frames to model.
 * @property {number} [sampleSpacingFrames] Frame spacing between prediction samples.
 */

/**
 * @typedef {Object} ActorLocationMemory
 * @property {boolean} [visible] Whether the actor is currently visible.
 * @property {VectorXZ | null} [position] Last known position.
 * @property {VectorXZ | null} [direction] Last known direction.
 * @property {number} [observationCount] Number of observations recorded.
 */

/**
 * @typedef {Object} ObservedMotionMemory
 * @property {number} [observationCount] Number of target observations.
 * @property {number} [motionObservationCount] Number of motion observations.
 * @property {number} [speedEstimateUnitsPerFrame] Estimated speed in world units per frame.
 * @property {number} [speedObservationCount] Number of speed observations.
 * @property {VectorXZ | null} [lastObservedDirection] Most recent observed direction.
 * @property {VectorXZ | null} [previousObservedDirection] Previous observed direction.
 * @property {number} [observedTurnRadiansPerFrame] Estimated turn rate.
 * @property {VectorXZ | null} [lastObservedPosition] Most recent observed position.
 */

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
