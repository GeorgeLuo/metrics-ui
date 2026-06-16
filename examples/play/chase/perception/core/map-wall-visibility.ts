import type { VectorXZ } from "../../decision-model/core/math.ts";
import type {
  ObservedMap,
  ObservedMapWall,
} from "../../decision-model/observer-world/interfaces.ts";
import {
  getWallSamplePoints,
  isLineOfSightBlockedByObstacles,
} from "../../world/world.mjs";
import {
  getObstacleWalls,
  getPointPerception,
  type ObstacleLike,
} from "./map-geometry.ts";

function getWallId(wall: Partial<ObservedMapWall> | null | undefined, index: number): string {
  return wall?.id ?? `obstacle-${index + 1}`;
}

function cloneObservedWall(wall: Partial<ObservedMapWall>, index: number): ObservedMapWall {
  return {
    id: getWallId(wall, index),
    x: Number(wall?.x) || 0,
    z: Number(wall?.z) || 0,
    width: Math.max(0, Number(wall?.width) || 0),
    depth: Math.max(0, Number(wall?.depth) || 0),
    rotationRadians: Number(wall?.rotationRadians) || 0,
  };
}

function isSampleOccludedByOtherWalls(
  actorPosition: VectorXZ,
  samplePoint: VectorXZ,
  obstacles: ObstacleLike | null | undefined,
  observedWallId: string,
): boolean {
  const blockingWalls = getObstacleWalls(obstacles).filter((wall, index) =>
    getWallId(wall, index) !== observedWallId,
  );
  return blockingWalls.length > 0
    && isLineOfSightBlockedByObstacles(
      actorPosition,
      samplePoint,
      { walls: blockingWalls },
    );
}

function getVisibleWallSample(
  actorPosition: VectorXZ,
  wall: Partial<ObservedMapWall>,
  wallId: string,
  actorLookDirection: VectorXZ,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
): ObservedMap["visibleWalls"][number]["sample"] | null {
  let nearestVisibleSample: ObservedMap["visibleWalls"][number]["sample"] | null = null;

  for (const samplePoint of getWallSamplePoints(wall)) {
    const samplePerception = getPointPerception(
      actorPosition,
      samplePoint,
      actorLookDirection,
      fieldOfViewAngleRadians,
    );
    if (!samplePerception.visible) {
      continue;
    }
    if (isSampleOccludedByOtherWalls(actorPosition, samplePoint, obstacles, wallId)) {
      continue;
    }
    if (
      !nearestVisibleSample
      || samplePerception.distance < nearestVisibleSample.distance
    ) {
      nearestVisibleSample = {
        point: { ...samplePoint },
        bearingRadians: samplePerception.bearingRadians,
        distance: samplePerception.distance,
      };
    }
  }

  return nearestVisibleSample;
}

/** Returns obstacle walls visible to the actor in the current frame. */
export function getVisibleMapWalls(
  actorPosition: VectorXZ,
  actorLookDirection: VectorXZ,
  fieldOfViewAngleRadians: number,
  obstacles: ObstacleLike | null | undefined,
): ObservedMap["visibleWalls"] {
  return getObstacleWalls(obstacles).flatMap((wall, index) => {
    const id = getWallId(wall, index);
    const visibleSample = getVisibleWallSample(
      actorPosition,
      wall,
      id,
      actorLookDirection,
      fieldOfViewAngleRadians,
      obstacles,
    );
    return visibleSample
      ? [{
        wall: cloneObservedWall(wall, index),
        sample: visibleSample,
      }]
      : [];
  });
}
