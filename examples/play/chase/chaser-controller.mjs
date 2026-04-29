import { CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING } from "./constants.mjs";
import {
  planProgrammaticChaserAction,
  selectPursuitPoint,
} from "./chaser-action-strategies.mjs";

export function createChaserAutopilotState() {
  return {
    searchSteering: CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
    lastPursuitSource: "search",
    wallFollowSign: 1,
    actionEngines: createChaserActionEngines(),
  };
}

export const CHASER_ACTION_ENGINE_IDS = Object.freeze({
  PROJECTION_PURSUIT: "projectionPursuit",
  VISIBLE_BEARING_FALLBACK: "visibleBearingFallback",
  SEARCH: "search",
  LOCAL_NAVIGATION: "localNavigation",
});

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

export function createChaserActionEngines(overrides = {}) {
  return {
    [CHASER_ACTION_ENGINE_IDS.PROJECTION_PURSUIT]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.PROJECTION_PURSUIT],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.VISIBLE_BEARING_FALLBACK]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.VISIBLE_BEARING_FALLBACK],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.SEARCH]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.SEARCH],
      true,
    ),
    [CHASER_ACTION_ENGINE_IDS.LOCAL_NAVIGATION]: asEnabled(
      overrides[CHASER_ACTION_ENGINE_IDS.LOCAL_NAVIGATION],
      true,
    ),
  };
}

export function setChaserActionEngineEnabled(autopilotState, engineId, enabled) {
  if (!autopilotState?.actionEngines || !(engineId in autopilotState.actionEngines)) {
    return;
  }
  autopilotState.actionEngines[engineId] = Boolean(enabled);
}

export function getProgrammaticChaserInput({
  knowledgeBase,
  chaserPosition,
  chaserLookDirection,
  autopilotState,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  columns,
  rows,
  obstacles,
} = {}) {
  const actionEngines = autopilotState?.actionEngines ?? createChaserActionEngines();
  const actionPlan = planProgrammaticChaserAction({
    knowledgeBase,
    chaserPosition,
    chaserLookDirection,
    actionEngines,
    searchSteering: autopilotState?.searchSteering ?? CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING,
    previousWallFollowSign: autopilotState?.wallFollowSign ?? 1,
    chaserSpeedUnitsPerFrame,
    speedUnitsPerFrame,
    columns,
    rows,
    obstacles,
  });

  if (autopilotState) {
    autopilotState.lastPursuitSource = actionPlan.chosenStrategy;
    autopilotState.wallFollowSign = actionPlan.wallFollowSign;
    if (actionPlan.searchSteeringHint !== null) {
      autopilotState.searchSteering = actionPlan.searchSteeringHint;
    }
  }

  return {
    forward: actionPlan.forward,
    steering: actionPlan.steering,
    pursuitPoint: actionPlan.pursuitPoint ?? null,
    movement: actionPlan.movement ?? null,
    chosenStrategy: actionPlan.chosenStrategy,
    actionStrategies: actionPlan.proposals,
    actionPlan,
  };
}
