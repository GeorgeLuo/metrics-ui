import { FIELD_OF_VIEW_DISTANCE } from "../../../config/constants.mjs";
import {
  KNOWN_AREA_CELL_SIZE,
  RECENT_VISITATION_MAX_AGE_FRAMES,
  type BoundsXZ,
  type MapAreaMemory,
  type MapObstacleMemory,
} from "../../memory/chaser/map/memory.ts";
import {
  createKnownMapRouteIndex,
  getFieldBoundsOrMemoryBounds,
  getGroundBoundsOrMemoryBounds,
  getMapCellCenter,
  getMapCellId,
  isMapCellInsideRememberedWall,
  isPositionInsideBounds,
} from "../../memory/chaser/map/navigation.ts";
import {
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "../../core/math.ts";
import { CHASER_ACTION_PROPOSAL_IDS } from "../../../config/decision-ids.mjs";
import { buildActionPathAlongRoute } from "../vehicle/route-paths.ts";
import type { ActionSelectionSignal } from "../core/interfaces.ts";
import type { VehicleActionProposal } from "../vehicle/interfaces.ts";
import type { VectorXZ } from "../../observer-world/interfaces.ts";

type AnyRecord = Record<string, any>;

/**
 * Ranked map-memory target considered by knowledge-acquisition proposals.
 */
type KnowledgeCandidate = AnyRecord & {
  id: string;
  score: number;
};

type UnknownNeighborCell = {
  id: string;
  cellX: number;
  cellZ: number;
  center: VectorXZ;
};

/**
 * Selection payload shared by map discovery and recency refresh proposals.
 */
type KnowledgeAcquisitionSignal = ActionSelectionSignal<KnowledgeCandidate> & AnyRecord & {
  selected: Record<string, KnowledgeCandidate | null>;
};

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

/**
 * Clamps numeric confidence and score values to the normalized range.
 */
function clamp01(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numericValue));
}

/**
 * Normalizes a possibly partial position object into an x/z vector.
 */
function clonePosition(
  position: Partial<VectorXZ> | null | undefined,
  fallback: VectorXZ = { x: 0, z: 0 },
): VectorXZ {
  const x = Number(position?.x);
  const z = Number(position?.z);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

/**
 * Converts persisted map memory cells into complete candidate source records.
 */
function normalizeKnownAreas(mapShapeMemory: AnyRecord | null | undefined): MapAreaMemory[] {
  return (Array.isArray(mapShapeMemory?.knownAreas) ? mapShapeMemory.knownAreas : [])
    .flatMap((area: AnyRecord): MapAreaMemory[] => {
      const cellX = Number(area?.cellX);
      const cellZ = Number(area?.cellZ);
      if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
        return [];
      }
      const center = area?.center ? clonePosition(area.center) : getMapCellCenter(cellX, cellZ);
      return [{
        id: String(area?.id ?? getMapCellId(cellX, cellZ)),
        cellX,
        cellZ,
        center,
        vertices: Array.isArray(area?.vertices)
          ? area.vertices.map((vertex: Partial<VectorXZ>) => clonePosition(vertex))
          : [],
        firstObservedFrame: Number.isFinite(area?.firstObservedFrame)
          ? area.firstObservedFrame
          : null,
        lastObservedFrame: Number.isFinite(area?.lastObservedFrame)
          ? area.lastObservedFrame
          : Number.isFinite(area?.firstObservedFrame)
            ? area.firstObservedFrame
            : null,
      }];
    });
}

/**
 * Reads remembered obstacles from chaser map memory.
 */
function getRememberedWalls(
  mapShapeMemory: AnyRecord | null | undefined,
): MapObstacleMemory["walls"] {
  return Array.isArray(mapShapeMemory?.obstacles?.walls)
    ? mapShapeMemory.obstacles.walls
    : [];
}

/**
 * Tests whether a remembered cell center is within the current map bounds.
 */
function isCellCenterWithinBounds(cellX: number, cellZ: number, bounds: BoundsXZ): boolean {
  return isPositionInsideBounds(getMapCellCenter(cellX, cellZ), bounds);
}

/**
 * Returns adjacent traversable cells that have not been observed yet.
 */
function getUnknownNeighbors(
  area: MapAreaMemory,
  knownAreaIds: Set<string>,
  bounds: BoundsXZ,
  obstacles: MapObstacleMemory,
): UnknownNeighborCell[] {
  return NEIGHBOR_OFFSETS.flatMap((offset) => {
    const cellX = area.cellX + offset.x;
    const cellZ = area.cellZ + offset.z;
    if (!isCellCenterWithinBounds(cellX, cellZ, bounds)) {
      return [];
    }
    const id = getMapCellId(cellX, cellZ);
    if (
      knownAreaIds.has(id)
      || isMapCellInsideRememberedWall(cellX, cellZ, obstacles, 0)
    ) {
      return [];
    }
    return [{
      id,
      cellX,
      cellZ,
      center: getMapCellCenter(cellX, cellZ),
    }];
  });
}

/**
 * Scores how well a target aligns with the chaser's current heading.
 */
function getBearingScore(
  chaserPosition: VectorXZ | null | undefined,
  chaserLookDirection: VectorXZ | null | undefined,
  targetPosition: VectorXZ | null | undefined,
): number {
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

/**
 * Scores target distance so already-immediate cells do not dominate selection.
 */
function getDistanceScore(
  chaserPosition: VectorXZ | null | undefined,
  targetPosition: VectorXZ | null | undefined,
): number {
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

/**
 * Chooses which unknown adjacent cell a frontier visit should reveal first.
 */
function selectDiscoveryTarget(
  unknownNeighbors: UnknownNeighborCell[],
  chaserPosition: VectorXZ | null | undefined,
  chaserLookDirection: VectorXZ | null | undefined,
): UnknownNeighborCell | null {
  return [...unknownNeighbors].sort((first, second) =>
    getBearingScore(chaserPosition, chaserLookDirection, second.center)
      - getBearingScore(chaserPosition, chaserLookDirection, first.center)
    || getDistanceScore(chaserPosition, first.center)
      - getDistanceScore(chaserPosition, second.center)
    || first.id.localeCompare(second.id))[0] ?? null;
}

/**
 * Computes how long it has been since a known area was last visible.
 */
function getAreaAgeFrames(area: MapAreaMemory, frameIndex: unknown): number {
  const numericFrameIndex = Number(frameIndex);
  const lastObservedFrame = Number(area.lastObservedFrame);
  if (!Number.isFinite(numericFrameIndex) || !Number.isFinite(lastObservedFrame)) {
    return 0;
  }
  return Math.max(0, numericFrameIndex - lastObservedFrame);
}

/**
 * Builds an inactive knowledge-acquisition proposal with optional diagnostics.
 */
function createInactiveKnowledgeProposal(
  id: string,
  extra: Record<string, unknown> = {},
): VehicleActionProposal {
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

/**
 * Converts a selected knowledge candidate into a feasible vehicle proposal.
 */
function createKnowledgeProposal(id: string, candidate: KnowledgeCandidate | null | undefined, {
  chaserPosition,
  chaserLookDirection,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
}: AnyRecord = {}): VehicleActionProposal {
  if (!candidate?.position) {
    return createInactiveKnowledgeProposal(id);
  }
  const actionPath = buildActionPathAlongRoute({
    vehiclePosition: chaserPosition,
    vehicleDirection: chaserLookDirection,
    route: id === CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY
      ? candidate.discoveryRoute ?? candidate.route
      : candidate.route,
    fallbackTargetPosition: id === CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY
      ? candidate.discoveryTargetPosition ?? candidate.position
      : candidate.position,
    speedUnitsPerFrame,
    maxSteeringAngleRadians,
    waypointReachDistance: KNOWN_AREA_CELL_SIZE * 0.75,
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
    confidence: clamp01(id === CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY
      ? candidate.components?.discovery ?? candidate.score
      : candidate.components?.recency ?? candidate.score),
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

/**
 * Sorts candidates by score with deterministic id tie-breaking.
 */
function rankCandidates(candidates: KnowledgeCandidate[]): KnowledgeCandidate[] {
  return [...candidates].sort((first, second) =>
    Number(second.score) - Number(first.score) || String(first.id).localeCompare(String(second.id)));
}

/**
 * Sorts candidates by a specific knowledge-acquisition component.
 */
function rankCandidatesByComponent(
  candidates: KnowledgeCandidate[],
  component: string,
): KnowledgeCandidate[] {
  return [...candidates].sort((first, second) =>
    Number(second.components?.[component] ?? 0) - Number(first.components?.[component] ?? 0)
    || Number(second.score) - Number(first.score)
    || String(first.id).localeCompare(String(second.id)));
}

/**
 * Produces knowledge-acquisition candidates from the chaser's remembered map.
 *
 * Map discovery targets known cells adjacent to unknown traversable space.
 * Recency refresh targets known cells whose latest observation is aging out.
 */
export function createKnowledgeAcquisitionSignal({
  mapShapeMemory,
  chaserPosition,
  chaserLookDirection,
  frameIndex,
  columns,
  rows,
}: AnyRecord = {}): KnowledgeAcquisitionSignal {
  const knownAreas = normalizeKnownAreas(mapShapeMemory);
  const knownAreaIds = new Set(knownAreas.map((area) => area.id));
  const obstacles: MapObstacleMemory = { walls: getRememberedWalls(mapShapeMemory) };
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
  const candidates: KnowledgeCandidate[] = knownAreas.map((area) => {
    const unknownNeighbors = getUnknownNeighbors(area, knownAreaIds, mapBounds, obstacles);
    const discoveryTarget = selectDiscoveryTarget(
      unknownNeighbors,
      chaserPosition,
      chaserLookDirection,
    );
    const unknownNeighborCount = unknownNeighbors.length;
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
      unknownNeighbors,
      discoveryTargetPosition: discoveryTarget?.center ?? null,
      discoveryRoute: route?.reachable && discoveryTarget
        ? {
          ...route,
          waypoints: [
            ...route.waypoints,
            { ...discoveryTarget.center },
          ],
          cost: route.cost + 1,
        }
        : route,
      route,
      routeCost: route?.cost ?? null,
      reachable,
      visibleFromCurrentPose: ageFrames === 0,
    };
  });
  const discoveryCandidates = rankCandidatesByComponent(
    candidates
      .filter((candidate: AnyRecord) => candidate.reachable && candidate.components.discovery > 0),
    "discovery",
  );
  const recencyCandidates = rankCandidates(candidates
    .filter((candidate: AnyRecord) =>
      candidate.reachable && candidate.components.recencyDebt >= MIN_RECENCY_REFRESH_SCORE));
  const selected = {
    [CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY]: discoveryCandidates[0] ?? null,
    [CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH]: recencyCandidates[0] ?? null,
  };

  return {
    id: "knowledgeAcquisition",
    confidence: 1,
    motiveId: "knowledgeAcquisition",
    frameIndex: Number.isFinite(frameIndex) ? frameIndex : null,
    knownAreaCount: knownAreas.length,
    discoveryCandidateCount: discoveryCandidates.length,
    recencyCandidateCount: recencyCandidates.length,
    discoveryComplete: discoveryCandidates.length === 0,
    candidates,
    selected,
    selectedCandidateId: selected[CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY]?.id
      ?? selected[CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH]?.id
      ?? null,
  };
}

/**
 * Builds map discovery and recency refresh proposals for the action stage.
 *
 * Discovery has primacy over recency refresh: when a frontier candidate is
 * active, refresh reports why it was inactive instead of competing.
 */
export function buildKnowledgeAcquisitionProposals({
  enabled,
  actionEngines = {},
  snapshot,
  chaserPosition,
  chaserLookDirection,
  frameIndex,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
  columns,
  rows,
}: AnyRecord = {}) {
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
    maxSteeringAngleRadians,
  };
  const mapDiscovery = enabled && actionEngines[CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY] !== false
    ? createKnowledgeProposal(
      CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY,
      signal.selected[CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY],
      proposalContext,
    )
    : createInactiveKnowledgeProposal(CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY);
  const mapRecencyRefreshEnabled = enabled
    && actionEngines[CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH] !== false;
  let mapRecencyRefresh = createInactiveKnowledgeProposal(
    CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH,
  );
  if (mapRecencyRefreshEnabled) {
    mapRecencyRefresh = mapDiscovery.active
      ? createInactiveKnowledgeProposal(CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH, {
        inactiveReason: "discovery-frontier-available",
        targetCandidate: signal.selected[CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH],
      })
      : createKnowledgeProposal(
        CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH,
        signal.selected[CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH],
        proposalContext,
      );
  }

  return {
    signal,
    mapDiscovery,
    mapRecencyRefresh,
  };
}
