import { CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING } from "../../config/constants.mjs";
import {
  planProgrammaticChaserAction,
  selectPursuitPoint,
} from "../../decision-model/actions/chaser/action-proposals.ts";
import { CHASER_ACTION_PROPOSAL_IDS } from "../../config/decision-ids.mjs";

/**
 * @typedef {import("../../decision-model/actions/chaser/interfaces.ts").ProgrammaticChaserAction} ProgrammaticChaserAction
 */

export function createChaserAutopilotState() {
  return {
    spinSteering: CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
    lastPursuitSource: "spin",
    wallFollowSign: 1,
    actionEngines: createChaserActionEngines(),
  };
}

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

export function createChaserActionEngines(overrides = {}) {
  return {
    [CHASER_ACTION_PROPOSAL_IDS.EVADER_PREDICTION_PURSUIT]: asEnabled(
      overrides[CHASER_ACTION_PROPOSAL_IDS.EVADER_PREDICTION_PURSUIT],
      true,
    ),
    [CHASER_ACTION_PROPOSAL_IDS.LINE_OF_SIGHT_PURSUIT]: asEnabled(
      overrides[CHASER_ACTION_PROPOSAL_IDS.LINE_OF_SIGHT_PURSUIT],
      true,
    ),
    [CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY]: asEnabled(
      overrides[CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY],
      true,
    ),
    [CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH]: asEnabled(
      overrides[CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH],
      true,
    ),
    [CHASER_ACTION_PROPOSAL_IDS.SPIN]: asEnabled(
      overrides[CHASER_ACTION_PROPOSAL_IDS.SPIN],
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

/**
 * @returns {ProgrammaticChaserAction}
 */
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
    autopilotState.lastPursuitSource = actionPlan.selectedActionProposalId;
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
    selectedActionProposalId: actionPlan.selectedActionProposalId,
    actionProposals: actionPlan.proposals,
    actionPlan,
  };
}
