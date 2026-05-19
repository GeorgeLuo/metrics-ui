import { CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING } from "../../config/constants.mjs";
import {
  planProgrammaticChaserAction,
  selectPursuitPoint,
} from "./chaser-action-strategies.mjs";
import {
  CHASER_LEGACY_STRATEGY_IDS,
  CHASER_STRATEGY_IDS,
} from "../../config/strategy-ids.mjs";

export function createChaserAutopilotState() {
  return {
    spinSteering: CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
    lastPursuitSource: "spin",
    wallFollowSign: 1,
    actionEngines: createChaserActionEngines(),
  };
}

export const CHASER_ACTION_ENGINE_IDS = CHASER_STRATEGY_IDS;

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

export function createChaserActionEngines(overrides = {}) {
  return {
    [CHASER_ACTION_ENGINE_IDS.EVADER_PREDICTION_PURSUIT]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.EVADER_PREDICTION_PURSUIT],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.LINE_OF_SIGHT_PURSUIT]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.LINE_OF_SIGHT_PURSUIT],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.MAP_DISCOVERY]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.MAP_DISCOVERY],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.MAP_RECENCY_REFRESH]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.MAP_RECENCY_REFRESH],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.SPIN]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.SPIN]
        ?? overrides[CHASER_LEGACY_STRATEGY_IDS.SEARCH],
      true,
    ),
  };
}

export function setChaserActionEngineEnabled(autopilotState, engineId, enabled) {
  const normalizedEngineId = engineId === CHASER_LEGACY_STRATEGY_IDS.SEARCH
    ? CHASER_ACTION_ENGINE_IDS.SPIN
    : engineId;
  if (!autopilotState?.actionEngines || !(normalizedEngineId in autopilotState.actionEngines)) {
    return;
  }
  autopilotState.actionEngines[normalizedEngineId] = Boolean(enabled);
}

export function getProgrammaticChaserInput({
  snapshot,
  chaserPosition,
  chaserLookDirection,
  autopilotState,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
  frameIndex,
  columns,
  rows,
  obstacles,
} = {}) {
  const actionEngines = autopilotState?.actionEngines ?? createChaserActionEngines();
  const actionPlan = planProgrammaticChaserAction({
    snapshot,
    chaserPosition,
    chaserLookDirection,
    actionEngines,
    spinSteering: autopilotState?.spinSteering
      ?? autopilotState?.searchSteering
      ?? CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
    previousWallFollowSign: autopilotState?.wallFollowSign ?? 1,
    chaserSpeedUnitsPerFrame,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    frameIndex,
    columns,
    rows,
    obstacles,
  });

  if (autopilotState) {
    autopilotState.lastPursuitSource = actionPlan.chosenStrategy;
    autopilotState.wallFollowSign = actionPlan.wallFollowSign;
    if (actionPlan.spinSteeringHint !== null) {
      autopilotState.spinSteering = actionPlan.spinSteeringHint;
    }
  }

  return {
    forward: actionPlan.forward,
    reverse: actionPlan.reverse,
    steering: actionPlan.steering,
    pursuitPoint: actionPlan.pursuitPoint ?? null,
    movement: actionPlan.movement ?? null,
    actionPath: actionPlan.actionPath ?? [],
    chosenStrategy: actionPlan.chosenStrategy,
    actionStrategies: actionPlan.proposals,
    actionPlan,
  };
}
