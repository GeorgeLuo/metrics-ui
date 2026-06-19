import { CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING } from "../../config/constants.mjs";
import {
  planProgrammaticChaserAction,
} from "../../decision-model/actions/chaser/action-proposals.ts";
import { CHASER_ACTION_PROPOSAL_IDS } from "../../config/decision-ids.mjs";
import type {
  ProgrammaticChaserAction,
} from "../../decision-model/actions/chaser/interfaces.ts";
import type { VectorXZ } from "../../decision-model/core/math.ts";

type ActionEngineOverrides = Record<string, boolean | undefined>;
type ChaserActionEngines = Record<string, boolean>;

/**
 * Mutable controller-side state for the programmatic chaser.
 *
 * This sits outside IDAE memory: it stores vehicle-control hints that only make
 * sense for the simulator controller, such as continuing a spin direction or
 * remembering the previous wall-follow sign.
 */
export type ChaserAutopilotState = {
  spinSteering: number;
  lastPursuitSource: string;
  wallFollowSign: number;
  actionEngines: ChaserActionEngines;
};

type ProgrammaticChaserInputOptions = {
  snapshot?: Record<string, any> | null;
  chaserPosition?: VectorXZ | null;
  chaserLookDirection?: VectorXZ | null;
  autopilotState?: ChaserAutopilotState | null;
  chaserSpeedUnitsPerFrame?: number;
  speedUnitsPerFrame?: number;
  maxSteeringAngleRadians?: number;
  frameIndex?: number | null;
  columns?: number;
  rows?: number;
  obstacles?: unknown;
};

/**
 * Creates the chaser controller's mutable autopilot state.
 *
 * The decision model owns observations, memory, patterns, and projections; this
 * controller state owns only action-engine toggles and action-continuity hints.
 */
export function createChaserAutopilotState(): ChaserAutopilotState {
  return {
    spinSteering: CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
    lastPursuitSource: "spin",
    wallFollowSign: 1,
    actionEngines: createChaserActionEngines(),
  };
}

function asEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Builds the action-proposal toggle map used by the action stage.
 *
 * Scenario and UI overrides flow into this object; missing values default to
 * enabled so new action proposals participate unless explicitly disabled.
 */
export function createChaserActionEngines(
  overrides: ActionEngineOverrides = {},
): ChaserActionEngines {
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

/**
 * Applies a UI or scenario toggle to one chaser action proposal engine.
 */
export function setChaserActionEngineEnabled(
  autopilotState: ChaserAutopilotState | null | undefined,
  engineId: string,
  enabled: unknown,
): void {
  if (!autopilotState?.actionEngines || !(engineId in autopilotState.actionEngines)) {
    return;
  }
  autopilotState.actionEngines[engineId] = Boolean(enabled);
}

/**
 * Adapts a chaser knowledge snapshot into simulator vehicle controls.
 *
 * This is the controller boundary between IDAE action planning and the
 * simulation harness. It delegates proposal construction and mixing to
 * `planProgrammaticChaserAction`, then stores the few controller continuity
 * hints needed by later frames.
 */
export function getProgrammaticChaserInput({
  snapshot,
  chaserPosition,
  chaserLookDirection,
  autopilotState,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
  frameIndex,
  columns,
  rows,
  obstacles,
}: ProgrammaticChaserInputOptions = {}): ProgrammaticChaserAction {
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
    maxSteeringAngleRadians,
    frameIndex,
    columns,
    rows,
    obstacles,
  });

  if (autopilotState) {
    autopilotState.lastPursuitSource = actionPlan.selectedActionProposalId;
    autopilotState.wallFollowSign = Number(actionPlan.wallFollowSign) || autopilotState.wallFollowSign;
    const spinSteeringHint = actionPlan.spinSteeringHint;
    if (typeof spinSteeringHint === "number" && Number.isFinite(spinSteeringHint)) {
      autopilotState.spinSteering = spinSteeringHint;
    }
  }

  return {
    forward: actionPlan.forward,
    reverse: actionPlan.reverse,
    steering: actionPlan.steering,
    frontViewCapture: actionPlan.frontViewCapture ?? null,
    pursuitPoint: actionPlan.pursuitPoint ?? null,
    movement: actionPlan.movement ?? null,
    actionPath: actionPlan.actionPath ?? [],
    selectedActionProposalId: actionPlan.selectedActionProposalId,
    actionProposals: actionPlan.proposals,
    actionPlan,
  };
}
