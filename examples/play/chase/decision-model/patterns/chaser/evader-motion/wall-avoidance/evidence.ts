import {
  WALL_APPROACH_RESOLUTION_FRAMES,
  WALL_HIT_DISTANCE,
} from "../../../../../config/constants.mjs";
import { getWorldWallPressure } from "../../../../../world/world.mjs";
import type {
  ObstacleSet,
  VectorXZ,
} from "../../../../observer-world/interfaces.ts";

/**
 * Wall approach episode currently under observation.
 */
export type WallAvoidancePendingApproach = {
  wall: string;
  frames: number;
};

/**
 * Lifecycle status for the currently observed wall approach.
 */
export type WallAvoidanceEpisodeStatus = "idle" | "watching" | "hit" | "avoided";

/**
 * Latest wall-pressure evidence sample.
 */
export type WallAvoidanceLatestEvidence = {
  observed: boolean;
  nearestWall: string;
  nearestDistance: number | null;
  nearingWall: boolean;
  hitWall: boolean;
  episodeStatus: WallAvoidanceEpisodeStatus;
};

/**
 * Evidence state tracked for wall-avoidance behavior.
 */
export type WallAvoidanceEvidenceState = {
  observedSampleCount: number;
  approachEpisodeCount: number;
  avoidedApproachCount: number;
  hitApproachCount: number;
  pendingApproach: WallAvoidancePendingApproach | null;
  cooldownWall: string | null;
  wallAvoidanceScore: number;
  latest: WallAvoidanceLatestEvidence;
};

/**
 * Wall pressure sample from field boundaries and obstacles.
 */
export type WallPressure = {
  active: boolean;
  nearestWall: string;
  nearestDistance: number | null;
};

/**
 * Runtime debug facts emitted by the evader controller itself.
 */
export type EvaderWallAvoidanceTruthContext = {
  decisionDebug?: {
    wallAvoidanceActive?: boolean;
    nearestWall?: string;
    nearestDistance?: number | null;
  } | null;
};

/**
 * Chaser-observable context used to infer evader wall-avoidance episodes.
 */
export type WallAvoidanceEvidenceContext = {
  estimate?: {
    position?: VectorXZ | null;
    observationCount?: number | null;
  } | null;
  evaderVisible?: boolean;
  columns?: number;
  rows?: number;
  obstacles?: ObstacleSet;
};

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

function createBaseWallAvoidanceState(): WallAvoidanceEvidenceState {
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
 * Creates an empty wall-avoidance evidence state.
 */
export function createWallAvoidanceEvidenceState(): WallAvoidanceEvidenceState {
  return createBaseWallAvoidanceState();
}

/**
 * Creates the simulation truth tracker for evader wall-avoidance behavior.
 */
export function createEvaderWallAvoidanceTruthState(): WallAvoidanceEvidenceState {
  return createBaseWallAvoidanceState();
}

function updateWallAvoidanceMetric(state: WallAvoidanceEvidenceState): void {
  state.wallAvoidanceScore = state.approachEpisodeCount > 0
    ? state.avoidedApproachCount / state.approachEpisodeCount
    : 0;
}

function updateApproachEpisode(
  state: WallAvoidanceEvidenceState,
  wallPressure: WallPressure,
): {
  nearingWall: boolean;
  hitWall: boolean;
  episodeStatus: WallAvoidanceEpisodeStatus;
} {
  const nearingWall = wallPressure.active;
  const hitWall = wallPressure.active
    && typeof wallPressure.nearestDistance === "number"
    && Number.isFinite(wallPressure.nearestDistance)
    && wallPressure.nearestDistance <= WALL_HIT_DISTANCE;
  let episodeStatus: WallAvoidanceEpisodeStatus = state.pendingApproach ? "watching" : "idle";

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

function updateStateFromWallPressure(
  state: WallAvoidanceEvidenceState,
  wallPressure: WallPressure,
  observed = true,
): WallAvoidanceEvidenceState {
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
 * Updates wall-avoidance truth from evader-controller debug output.
 */
export function updateEvaderWallAvoidanceTruth(
  state: WallAvoidanceEvidenceState,
  {
    decisionDebug,
  }: EvaderWallAvoidanceTruthContext,
): WallAvoidanceEvidenceState {
  const wallPressure = {
    active: Boolean(decisionDebug?.wallAvoidanceActive),
    nearestWall: decisionDebug?.nearestWall ?? "none",
    nearestDistance: decisionDebug?.nearestDistance ?? null,
  };
  return updateStateFromWallPressure(state, wallPressure);
}

/**
 * Updates chaser-observable wall-avoidance evidence from the latest evader estimate.
 */
export function updateWallAvoidanceEvidence(
  state: WallAvoidanceEvidenceState,
  {
    estimate,
    evaderVisible,
    columns,
    rows,
    obstacles,
  }: WallAvoidanceEvidenceContext,
): WallAvoidanceEvidenceState {
  const position = estimate?.position ?? null;
  if (!evaderVisible || Number(estimate?.observationCount) <= 0 || !position) {
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
    getWorldWallPressure(position, columns, rows, obstacles),
  );
}
