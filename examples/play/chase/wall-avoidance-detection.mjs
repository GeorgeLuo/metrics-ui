import {
  WALL_APPROACH_RESOLUTION_FRAMES,
  WALL_HIT_DISTANCE,
} from "./constants.mjs";
import { getWorldWallPressure } from "./world.mjs";

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

export function createWallAvoidanceEvidenceState() {
  return createBaseWallAvoidanceState();
}

export function createTargetWallAvoidanceTruthState() {
  return createBaseWallAvoidanceState();
}

function updateWallAvoidanceMetric(state) {
  state.wallAvoidanceScore = state.approachEpisodeCount > 0
    ? state.avoidedApproachCount / state.approachEpisodeCount
    : 0;
}

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

export function updateTargetWallAvoidanceTruth(
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

export function updateWallAvoidanceEvidence(
  state,
  {
    estimate,
    targetVisible,
    columns,
    rows,
    obstacles,
  },
) {
  const observed = Boolean(targetVisible && estimate?.observationCount > 0 && estimate?.position);
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
