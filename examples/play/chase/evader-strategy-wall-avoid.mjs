import { DEFAULT_EVADER_WALL_AVOID_WEIGHT } from "./constants.mjs";
import {
  createStatefulStrategy,
  getStrategyOutput,
  updateStrategy,
} from "./strategies.mjs";
import { getEvaderPolicyNumber } from "./evader-strategy-policy.mjs";
import { getWorldWallPressure } from "./world.mjs";

export const EVADER_WALL_AVOID_STRATEGY_ID = "wallAvoidance";

export function createEvaderWallAvoidStrategy() {
  return createStatefulStrategy({
    id: EVADER_WALL_AVOID_STRATEGY_ID,
    createState: () => null,
    createOutput: () => ({
      direction: { x: 0, z: 0 },
      active: false,
      nearestWall: null,
      nearestDistance: null,
      magnitude: 0,
    }),
    deriveOutput: (_state, context = {}) => {
      const wallPressure = getWorldWallPressure(
        context.position,
        context.columns,
        context.rows,
        context.obstacles,
      );
      const wallAvoidWeight = getEvaderPolicyNumber(
        context.policy,
        "wallAvoidWeight",
        DEFAULT_EVADER_WALL_AVOID_WEIGHT,
      );
      return {
        direction: {
          x: wallPressure.direction.x * wallPressure.magnitude * wallAvoidWeight,
          z: wallPressure.direction.z * wallPressure.magnitude * wallAvoidWeight,
        },
        active: wallPressure.active,
        nearestWall: wallPressure.nearestWall,
        nearestDistance: wallPressure.nearestDistance,
        magnitude: wallPressure.magnitude,
      };
    },
    getConfidence: (output) => Number(output?.magnitude) || 0,
    isActionable: () => true,
  });
}

export function updateEvaderWallAvoidStrategy(strategy, context) {
  return updateStrategy(strategy, context);
}

export function getEvaderWallAvoidStrategyOutput(strategy) {
  return getStrategyOutput(strategy);
}
