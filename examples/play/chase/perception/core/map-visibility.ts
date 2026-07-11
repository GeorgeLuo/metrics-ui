import { FIELD_OF_VIEW_DISTANCE } from "../../config/constants.mjs";
import type { VectorXZ } from "../../decision-model/core/math.ts";
import type { ObservedMap } from "../../decision-model/observer-world/interfaces.ts";
import { getVisibleMapAreaCells } from "./map-area-visibility.ts";
import { asObstacleLike, type WorldContext } from "./map-geometry.ts";
import { getVisibleMapWalls } from "./map-wall-visibility.ts";

/**
 * Builds the current frame's visible map facts from simulated FOV and occlusion.
 */
export function getObservedMap(
  actorPosition: VectorXZ | null | undefined,
  actorLookDirection: VectorXZ | null | undefined,
  fieldOfViewAngleRadians: number,
  obstacles: unknown,
  worldContext: WorldContext = {},
  fieldOfViewDistance = FIELD_OF_VIEW_DISTANCE,
): ObservedMap {
  if (!actorPosition || !actorLookDirection) {
    return {
      visibleWalls: [],
      visibleArea: { cells: [], observationCount: 0 },
      observationCount: 0,
    };
  }

  const obstacleSet = asObstacleLike(obstacles);
  const visibleWalls = getVisibleMapWalls(
    actorPosition,
    actorLookDirection,
    fieldOfViewAngleRadians,
    obstacleSet,
    fieldOfViewDistance,
  );
  const visibleAreaCells = getVisibleMapAreaCells(
    actorPosition,
    actorLookDirection,
    fieldOfViewAngleRadians,
    obstacleSet,
    worldContext,
    fieldOfViewDistance,
  );

  return {
    visibleWalls,
    visibleArea: {
      cells: visibleAreaCells,
      observationCount: visibleAreaCells.length,
    },
    observationCount: visibleWalls.length + visibleAreaCells.length,
  };
}
