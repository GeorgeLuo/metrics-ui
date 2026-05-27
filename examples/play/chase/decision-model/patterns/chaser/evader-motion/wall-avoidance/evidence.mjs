import {
  WALL_APPROACH_RESOLUTION_FRAMES,
  WALL_HIT_DISTANCE,
} from "../../../../../config/constants.mjs";
import { getWorldWallPressure } from "../../../../../world/world.mjs";

/**
 * @typedef {Object} WallAvoidancePendingApproach
 * @property {string} wall Wall id under observation.
 * @property {number} frames Number of frames spent monitoring this approach.
 */

/**
 * @typedef {Object} WallAvoidanceLatestEvidence
 * @property {boolean} observed Whether the latest sample was observed.
 * @property {string} nearestWall Nearest wall id or none.
 * @property {number | null} nearestDistance Distance to nearest wall.
 * @property {boolean} nearingWall Whether the target is approaching a wall.
 * @property {boolean} hitWall Whether the target contacted the wall.
 * @property {"idle" | "watching" | "hit" | "avoided"} episodeStatus Current episode state.
 */

/**
 * @typedef {Object} WallAvoidanceEvidenceState
 * @property {number} observedSampleCount Count of observed wall-pressure samples.
 * @property {number} approachEpisodeCount Count of completed wall approach episodes.
 * @property {number} avoidedApproachCount Count of approaches resolved as avoided.
 * @property {number} hitApproachCount Count of approaches resolved as wall hits.
 * @property {WallAvoidancePendingApproach | null} pendingApproach Approach currently being monitored.
 * @property {string | null} cooldownWall Wall id temporarily ignored after a completed episode.
 * @property {number} wallAvoidanceScore Avoided approaches divided by approach opportunities.
 * @property {WallAvoidanceLatestEvidence} latest Latest evidence snapshot.
 */

/**
 * @typedef {Object} WallPressure
 * @property {boolean} active Whether the target is close enough to a wall to count as pressure.
 * @property {string} nearestWall Nearest wall id or none.
 * @property {number | null} nearestDistance Distance to nearest wall.
 */

export const WALL_AVOIDANCE_EVIDENCE_STATE_FIELDS = Object.freeze([
  "observedSampleCount",
  "approachEpisodeCount",
  "avoidedApproachCount",
  "hitApproachCount",
  "pendingApproach",
  "cooldownWall",
  "wallAvoidanceScore",
  "latest",
]);

export const WALL_AVOIDANCE_LATEST_EVIDENCE_FIELDS = Object.freeze([
  "observed",
  "nearestWall",
  "nearestDistance",
  "nearingWall",
  "hitWall",
  "episodeStatus",
]);

/**
 * @returns {WallAvoidanceEvidenceState}
 */
function createBaseWallAvoidanceState() {
  return {
    observedSampleCount: 0,
    approachEpisodeCount: 0,
    avoidedApproachCount: 0,
    hitApproachCount: 0,
    pendingApproach: null,
    cooldownWall: null,
    wallAvoidanceScore: 0,
    latest: {
      observed: false,
      nearestWall: "none",
      nearestDistance: null,
      nearingWall: false,
      hitWall: false,
      episodeStatus: "idle",
    },
  };
}

/**
 * @returns {WallAvoidanceEvidenceState}
 */
export function createWallAvoidanceEvidenceState() {
  return createBaseWallAvoidanceState();
}

/**
 * @returns {WallAvoidanceEvidenceState}
 */
export function createEvaderWallAvoidanceTruthState() {
  return createBaseWallAvoidanceState();
}

/**
 * @param {WallAvoidanceEvidenceState} state
 * @returns {void}
 */
function updateWallAvoidanceMetric(state) {
  state.wallAvoidanceScore = state.approachEpisodeCount > 0
    ? state.avoidedApproachCount / state.approachEpisodeCount
    : 0;
}

/**
 * @param {WallAvoidanceEvidenceState} state
 * @param {WallPressure} wallPressure
 * @returns {{nearingWall: boolean, hitWall: boolean, episodeStatus: WallAvoidanceLatestEvidence["episodeStatus"]}}
 */
function updateApproachEpisode(state, wallPressure) {
  const nearingWall = wallPressure.active;
  const hitWall = wallPressure.active
    && Number.isFinite(wallPressure.nearestDistance)
    && wallPressure.nearestDistance <= WALL_HIT_DISTANCE;
  let episodeStatus = state.pendingApproach ? "watching" : "idle";

  if (
    state.cooldownWall
    && (!nearingWall || state.cooldownWall !== wallPressure.nearestWall)
  ) {
    state.cooldownWall = null;
  }

  if (state.pendingApproach) {
    state.pendingApproach.frames += 1;
    if (hitWall) {
      state.approachEpisodeCount += 1;
      state.hitApproachCount += 1;
      state.cooldownWall = state.pendingApproach.wall;
      state.pendingApproach = null;
      episodeStatus = "hit";
    } else if (state.pendingApproach.frames >= WALL_APPROACH_RESOLUTION_FRAMES) {
      state.approachEpisodeCount += 1;
      state.avoidedApproachCount += 1;
      state.cooldownWall = state.pendingApproach.wall;
      state.pendingApproach = null;
      episodeStatus = "avoided";
    }
  }

  if (
    !state.pendingApproach
    && !state.cooldownWall
    && nearingWall
    && !hitWall
  ) {
    state.pendingApproach = {
      wall: wallPressure.nearestWall,
      frames: 0,
    };
    episodeStatus = "watching";
  }

  updateWallAvoidanceMetric(state);

  return {
    nearingWall,
    hitWall,
    episodeStatus,
  };
}

/**
 * @param {WallAvoidanceEvidenceState} state
 * @param {WallPressure} wallPressure
 * @param {boolean} observed
 * @returns {WallAvoidanceEvidenceState}
 */
function updateStateFromWallPressure(state, wallPressure, observed = true) {
  if (observed) {
    state.observedSampleCount += 1;
  }
  const episode = updateApproachEpisode(state, wallPressure);

  state.latest = {
    observed,
    nearestWall: wallPressure.nearestWall,
    nearestDistance: wallPressure.nearestDistance,
    nearingWall: episode.nearingWall,
    hitWall: episode.hitWall,
    episodeStatus: episode.episodeStatus,
  };

  return state;
}

/**
 * @param {WallAvoidanceEvidenceState} state
 * @param {{decisionDebug?: {wallAvoidanceActive?: boolean, nearestWall?: string, nearestDistance?: number | null}}} context
 * @returns {WallAvoidanceEvidenceState}
 */
export function updateEvaderWallAvoidanceTruth(
  state,
  {
    decisionDebug,
  },
) {
  const wallPressure = {
    active: Boolean(decisionDebug?.wallAvoidanceActive),
    nearestWall: decisionDebug?.nearestWall ?? "none",
    nearestDistance: decisionDebug?.nearestDistance ?? null,
  };
  return updateStateFromWallPressure(state, wallPressure);
}

/**
 * @param {WallAvoidanceEvidenceState} state
 * @param {{
 *   estimate?: {position?: {x: number, z: number} | null, observationCount?: number},
 *   evaderVisible?: boolean,
 *   columns?: number,
 *   rows?: number,
 *   obstacles?: import("../../../../observer-world/interfaces.ts").ObstacleSet
 * }} context
 * @returns {WallAvoidanceEvidenceState}
 */
export function updateWallAvoidanceEvidence(
  state,
  {
    estimate,
    evaderVisible,
    columns,
    rows,
    obstacles,
  },
) {
  const observed = Boolean(evaderVisible && estimate?.observationCount > 0 && estimate?.position);
  if (!observed) {
    state.latest = {
      ...state.latest,
      observed: false,
      nearingWall: false,
      hitWall: false,
    };
    return state;
  }

  return updateStateFromWallPressure(
    state,
    getWorldWallPressure(estimate.position, columns, rows, obstacles),
  );
}
