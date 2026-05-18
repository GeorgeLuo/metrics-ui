import {
  DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
  FIELD_OF_VIEW_DISTANCE,
} from "../../../config/constants.mjs";
import {
  KNOWN_AREA_CELL_SIZE,
  RECENT_VISITATION_MAX_AGE_FRAMES,
} from "./chaser-map-memory.mjs";
import {
  createKnownMapRouteIndex,
  getFieldBoundsOrMemoryBounds,
  getGroundBoundsOrMemoryBounds,
  getMapCellCenter,
  getMapCellId,
  isMapCellInsideRememberedWall,
  isPositionInsideBounds,
} from "./chaser-map-navigation.mjs";
import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../../decision-model/math.mjs";
import { CHASER_STRATEGY_IDS } from "../../../config/strategy-ids.mjs";

const DEFAULT_ACTION_PATH_HORIZON_FRAMES = 36;
const MIN_RECENCY_REFRESH_SCORE = 0.12;
const NEIGHBOR_OFFSETS = Object.freeze([
  { x: -1, z: -1 },
  { x: 0, z: -1 },
  { x: 1, z: -1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: -1, z: 1 },
  { x: 0, z: 1 },
  { x: 1, z: 1 },
]);

function clamp01(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numericValue));
}

function clampUnit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, numericValue));
}

function clonePosition(position, fallback = { x: 0, z: 0 }) {
  const x = Number(position?.x);
  const z = Number(position?.z);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

function cloneDirection(direction, fallback = { x: 1, z: 0 }) {
  const normalized = normalizeVector(
    Number(direction?.x ?? fallback.x),
    Number(direction?.z ?? fallback.z),
  );
  return normalized.x === 0 && normalized.z === 0 ? { ...fallback } : normalized;
}

function normalizeKnownAreas(mapShapeMemory) {
  return (Array.isArray(mapShapeMemory?.knownAreas) ? mapShapeMemory.knownAreas : [])
    .map((area) => {
      const cellX = Number(area?.cellX);
      const cellZ = Number(area?.cellZ);
      if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
        return null;
      }
      const center = area?.center ? clonePosition(area.center) : getMapCellCenter(cellX, cellZ);
      return {
        id: String(area?.id ?? getMapCellId(cellX, cellZ)),
        cellX,
        cellZ,
        center,
        firstObservedFrame: Number.isFinite(area?.firstObservedFrame)
          ? area.firstObservedFrame
          : null,
        lastObservedFrame: Number.isFinite(area?.lastObservedFrame)
          ? area.lastObservedFrame
          : Number.isFinite(area?.firstObservedFrame)
            ? area.firstObservedFrame
            : null,
      };
    })
    .filter(Boolean);
}

function getRememberedWalls(mapShapeMemory) {
  return Array.isArray(mapShapeMemory?.obstacles?.walls)
    ? mapShapeMemory.obstacles.walls
    : [];
}

function isCellCenterWithinBounds(cellX, cellZ, bounds) {
  return isPositionInsideBounds(getMapCellCenter(cellX, cellZ), bounds);
}

function getUnknownNeighborCount(area, knownAreaIds, bounds, obstacles) {
  return NEIGHBOR_OFFSETS.reduce((count, offset) => {
    const cellX = area.cellX + offset.x;
    const cellZ = area.cellZ + offset.z;
    if (!isCellCenterWithinBounds(cellX, cellZ, bounds)) {
      return count;
    }
    if (
      knownAreaIds.has(getMapCellId(cellX, cellZ))
      || isMapCellInsideRememberedWall(cellX, cellZ, obstacles, 0)
    ) {
      return count;
    }
    return count + 1;
  }, 0);
}

function getBearingScore(chaserPosition, chaserLookDirection, targetPosition) {
  if (!chaserPosition || !chaserLookDirection || !targetPosition) {
    return 0;
  }
  const targetDirection = normalizeVector(
    targetPosition.x - chaserPosition.x,
    targetPosition.z - chaserPosition.z,
  );
  if (targetDirection.x === 0 && targetDirection.z === 0) {
    return 0;
  }
  const bearing = normalizeAngleDelta(
    vectorToAngle(targetDirection) - vectorToAngle(chaserLookDirection),
  );
  return (Math.cos(bearing) + 1) / 2;
}

function getDistanceScore(chaserPosition, targetPosition) {
  if (!chaserPosition || !targetPosition) {
    return 0;
  }
  const distance = Math.hypot(
    targetPosition.x - chaserPosition.x,
    targetPosition.z - chaserPosition.z,
  );
  if (distance < KNOWN_AREA_CELL_SIZE * 1.5) {
    return 0;
  }
  return clamp01(distance / Math.max(1, FIELD_OF_VIEW_DISTANCE * 0.45));
}

function getAreaAgeFrames(area, frameIndex) {
  if (!Number.isFinite(frameIndex) || !Number.isFinite(area?.lastObservedFrame)) {
    return 0;
  }
  return Math.max(0, frameIndex - area.lastObservedFrame);
}

function getSteeringFromBearing(bearingRadians) {
  return bearingRadians > 0.08 ? 1 : bearingRadians < -0.08 ? -1 : 0;
}

function stepActionPathFrame({
  position,
  direction,
  throttle,
  steering,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
} = {}) {
  const currentPosition = clonePosition(position);
  const currentDirection = cloneDirection(direction);
  const resolvedThrottle = clampUnit(throttle);
  const resolvedSteering = clampUnit(steering);
  const speed = Math.max(0, Number(speedUnitsPerFrame) || 0);
  const turnRate = Math.max(
    0,
    Number(turnRateRadiansPerFrame) || DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
  );
  const nextDirection = Math.abs(resolvedThrottle) > 0.001 && resolvedSteering !== 0
    ? angleToVector(
      vectorToAngle(currentDirection)
        + resolvedSteering * turnRate * (resolvedThrottle < 0 ? -1 : 1),
    )
    : currentDirection;
  return {
    throttle: resolvedThrottle,
    steering: resolvedSteering,
    position: {
      x: currentPosition.x + nextDirection.x * speed * resolvedThrottle,
      z: currentPosition.z + nextDirection.z * speed * resolvedThrottle,
    },
    direction: nextDirection,
  };
}

function createActionFrame({
  frameOffset,
  throttle,
  steering,
  position,
  direction,
  metadata = {},
}) {
  const resolvedThrottle = clampUnit(throttle);
  const resolvedSteering = clampUnit(steering);
  return {
    frameOffset,
    framesAhead: frameOffset,
    throttle: resolvedThrottle,
    steer: resolvedSteering,
    steering: resolvedSteering,
    forward: resolvedThrottle > 0.001,
    reverse: resolvedThrottle < -0.001,
    predictedPosition: clonePosition(position),
    predictedDirection: cloneDirection(direction),
    ...metadata,
  };
}

function getNextWaypointIndex(waypoints, position, currentIndex) {
  let nextIndex = Math.max(0, currentIndex);
  while (
    nextIndex < waypoints.length - 1
    && Math.hypot(
      waypoints[nextIndex].x - position.x,
      waypoints[nextIndex].z - position.z,
    ) <= KNOWN_AREA_CELL_SIZE * 0.75
  ) {
    nextIndex += 1;
  }
  return nextIndex;
}

function buildActionPathAlongRoute({
  chaserPosition,
  chaserLookDirection,
  route,
  fallbackTargetPosition,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  horizonFrames = DEFAULT_ACTION_PATH_HORIZON_FRAMES,
  metadata = {},
} = {}) {
  const waypoints = Array.isArray(route?.waypoints) && route.waypoints.length > 0
    ? route.waypoints
    : fallbackTargetPosition ? [fallbackTargetPosition] : [];
  if (!chaserPosition || !chaserLookDirection || waypoints.length === 0) {
    return [];
  }

  let position = clonePosition(chaserPosition);
  let direction = cloneDirection(chaserLookDirection);
  let waypointIndex = getNextWaypointIndex(waypoints, position, 0);
  const path = [];
  const frameCount = Math.max(1, Math.floor(Number(horizonFrames) || DEFAULT_ACTION_PATH_HORIZON_FRAMES));

  for (let frameOffset = 1; frameOffset <= frameCount; frameOffset += 1) {
    waypointIndex = getNextWaypointIndex(waypoints, position, waypointIndex);
    const targetPosition = waypoints[waypointIndex] ?? waypoints.at(-1);
    if (!targetPosition) {
      break;
    }
    const targetDirection = normalizeVector(
      targetPosition.x - position.x,
      targetPosition.z - position.z,
    );
    if (targetDirection.x === 0 && targetDirection.z === 0) {
      break;
    }
    const bearing = normalizeAngleDelta(
      vectorToAngle(targetDirection) - vectorToAngle(direction),
    );
    const nextFrame = stepActionPathFrame({
      position,
      direction,
      throttle: 1,
      steering: getSteeringFromBearing(bearing),
      speedUnitsPerFrame,
      turnRateRadiansPerFrame,
    });
    position = nextFrame.position;
    direction = nextFrame.direction;
    path.push(createActionFrame({
      frameOffset,
      throttle: nextFrame.throttle,
      steering: nextFrame.steering,
      position,
      direction,
      metadata: {
        ...metadata,
        waypointIndex,
        routeTargetPosition: { ...targetPosition },
      },
    }));
  }

  return path;
}

function createInactiveKnowledgeProposal(id, extra = {}) {
  return {
    id,
    active: false,
    confidence: 0,
    actionPath: [],
    firstAction: null,
    targetCandidate: null,
    ...extra,
  };
}

function createKnowledgeProposal(id, candidate, {
  chaserPosition,
  chaserLookDirection,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
} = {}) {
  if (!candidate?.position) {
    return createInactiveKnowledgeProposal(id);
  }
  const actionPath = buildActionPathAlongRoute({
    chaserPosition,
    chaserLookDirection,
    route: candidate.route,
    fallbackTargetPosition: candidate.position,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    metadata: {
      proposalId: id,
      targetCandidateId: candidate.id,
      pursuitSource: "knowledge-acquisition",
    },
  });
  if (actionPath.length === 0) {
    return createInactiveKnowledgeProposal(id, { targetCandidate: candidate });
  }
  return {
    id,
    active: true,
    confidence: clamp01(candidate.score),
    pursuitSource: "knowledge-acquisition",
    goalDirection: normalizeVector(
      (candidate.route?.waypoints?.[1] ?? candidate.route?.waypoints?.[0] ?? candidate.position).x
        - chaserPosition.x,
      (candidate.route?.waypoints?.[1] ?? candidate.route?.waypoints?.[0] ?? candidate.position).z
        - chaserPosition.z,
    ),
    targetCandidate: candidate,
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}

function rankCandidates(candidates) {
  return [...candidates].sort((first, second) =>
    second.score - first.score || first.id.localeCompare(second.id));
}

export function createKnowledgeAcquisitionSignal({
  mapShapeMemory,
  chaserPosition,
  chaserLookDirection,
  frameIndex,
  columns,
  rows,
} = {}) {
  const knownAreas = normalizeKnownAreas(mapShapeMemory);
  const knownAreaIds = new Set(knownAreas.map((area) => area.id));
  const obstacles = { walls: getRememberedWalls(mapShapeMemory) };
  const mapBounds = getFieldBoundsOrMemoryBounds(columns, rows, knownAreas);
  const movementBounds = getGroundBoundsOrMemoryBounds(columns, rows, knownAreas);
  const routeIndex = createKnownMapRouteIndex({
    knownAreas,
    obstacles,
    startPosition: chaserPosition,
    bounds: movementBounds,
  });
  const maxAgeFrames = Math.max(
    1,
    Number(mapShapeMemory?.recentVisitationMaxAgeFrames) || RECENT_VISITATION_MAX_AGE_FRAMES,
  );
  const candidates = knownAreas.map((area) => {
    const unknownNeighborCount = getUnknownNeighborCount(area, knownAreaIds, mapBounds, obstacles);
    const route = routeIndex.getRouteToArea(area);
    const reachable = Boolean(route?.reachable);
    const distanceScore = getDistanceScore(chaserPosition, area.center);
    const bearingScore = getBearingScore(chaserPosition, chaserLookDirection, area.center);
    const ageFrames = getAreaAgeFrames(area, frameIndex);
    const recency = clamp01(ageFrames / maxAgeFrames);
    const discovery = reachable
      ? clamp01(unknownNeighborCount / NEIGHBOR_OFFSETS.length)
      : 0;
    const discoveryScore = discovery > 0
      ? clamp01(discovery * 0.7 + distanceScore * 0.2 + bearingScore * 0.1)
      : 0;
    const recencyScore = reachable && recency > 0
      ? clamp01(recency * 0.82 + distanceScore * 0.12 + bearingScore * 0.06)
      : 0;
    return {
      id: area.id,
      kind: "knownCell",
      position: { ...area.center },
      score: Math.max(discoveryScore, recencyScore),
      components: {
        discovery: discoveryScore,
        recency: recencyScore,
        recencyDebt: recency,
        frontier: discovery,
      },
      cellX: area.cellX,
      cellZ: area.cellZ,
      firstObservedFrame: area.firstObservedFrame,
      lastObservedFrame: area.lastObservedFrame,
      ageFrames,
      unknownNeighborCount,
      route,
      routeCost: route?.cost ?? null,
      reachable,
      visibleFromCurrentPose: ageFrames === 0,
    };
  });
  const discoveryCandidates = rankCandidates(candidates
    .filter((candidate) => candidate.reachable && candidate.components.discovery > 0));
  const recencyCandidates = rankCandidates(candidates
    .filter((candidate) =>
      candidate.reachable && candidate.components.recencyDebt >= MIN_RECENCY_REFRESH_SCORE));
  const selected = {
    [CHASER_STRATEGY_IDS.MAP_DISCOVERY]: discoveryCandidates[0] ?? null,
    [CHASER_STRATEGY_IDS.MAP_RECENCY_REFRESH]: recencyCandidates[0] ?? null,
  };

  return {
    id: "knowledgeAcquisition",
    motiveId: "knowledgeAcquisition",
    frameIndex: Number.isFinite(frameIndex) ? frameIndex : null,
    knownAreaCount: knownAreas.length,
    discoveryComplete: discoveryCandidates.length === 0,
    candidates,
    selected,
    selectedCandidateId: selected[CHASER_STRATEGY_IDS.MAP_DISCOVERY]?.id
      ?? selected[CHASER_STRATEGY_IDS.MAP_RECENCY_REFRESH]?.id
      ?? null,
  };
}

export function buildKnowledgeAcquisitionProposals({
  enabled,
  actionEngines = {},
  snapshot,
  chaserPosition,
  chaserLookDirection,
  frameIndex,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  columns,
  rows,
} = {}) {
  const signal = createKnowledgeAcquisitionSignal({
    mapShapeMemory: snapshot?.memory?.abstracted?.mapShape,
    chaserPosition,
    chaserLookDirection,
    frameIndex,
    columns,
    rows,
  });
  const proposalContext = {
    chaserPosition,
    chaserLookDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
  };
  const mapDiscovery = enabled && actionEngines[CHASER_STRATEGY_IDS.MAP_DISCOVERY] !== false
    ? createKnowledgeProposal(
      CHASER_STRATEGY_IDS.MAP_DISCOVERY,
      signal.selected[CHASER_STRATEGY_IDS.MAP_DISCOVERY],
      proposalContext,
    )
    : createInactiveKnowledgeProposal(CHASER_STRATEGY_IDS.MAP_DISCOVERY);
  const mapRecencyRefresh = enabled
    && actionEngines[CHASER_STRATEGY_IDS.MAP_RECENCY_REFRESH] !== false
    ? createKnowledgeProposal(
      CHASER_STRATEGY_IDS.MAP_RECENCY_REFRESH,
      signal.selected[CHASER_STRATEGY_IDS.MAP_RECENCY_REFRESH],
      proposalContext,
    )
    : createInactiveKnowledgeProposal(CHASER_STRATEGY_IDS.MAP_RECENCY_REFRESH);

  return {
    signal,
    mapDiscovery,
    mapRecencyRefresh,
  };
}
