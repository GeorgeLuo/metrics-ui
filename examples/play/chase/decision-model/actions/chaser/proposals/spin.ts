import {
  CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
  CHASER_AUTOPILOT_SPIN_LEAD_RADIANS,
} from "../../../../config/constants.mjs";
import { CHASER_ACTION_PROPOSAL_IDS } from "../../../../config/decision-ids.mjs";
import {
  buildFeasibleActionPath,
  clampUnit,
  createInactiveActionProposal,
} from "../../vehicle/action-paths.ts";
import { angleToVector, vectorToAngle } from "../../../core/math.ts";
import type { VehicleActionProposal } from "../../vehicle/interfaces.ts";
import type { VectorXZ } from "../../../observer-world/interfaces.ts";

/**
 * Computes the lead direction represented by a fixed steering sweep.
 */
function getSpinDirection(
  currentDirection: VectorXZ,
  spinSteering: number,
): VectorXZ {
  return angleToVector(
    vectorToAngle(currentDirection)
      + spinSteering * CHASER_AUTOPILOT_SPIN_LEAD_RADIANS,
  );
}

/**
 * Builds the fallback knowledge-acquisition proposal that sweeps in place.
 */
export function buildSpinProposal({
  enabled,
  chaserPosition,
  chaserLookDirection,
  spinSteering = CHASER_AUTOPILOT_DEFAULT_SPIN_STEERING,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
}: Record<string, any> = {}): VehicleActionProposal {
  if (!enabled || !chaserLookDirection) {
    return createInactiveActionProposal(CHASER_ACTION_PROPOSAL_IDS.SPIN);
  }

  const steering = clampUnit(spinSteering);
  const actionPath = buildFeasibleActionPath({
    vehiclePosition: chaserPosition,
    vehicleDirection: chaserLookDirection,
    spinSteering,
    speedUnitsPerFrame,
    maxSteeringAngleRadians,
    metadata: {
      targetDirection: getSpinDirection(chaserLookDirection, steering),
    },
    getFrameSteering: () => steering,
  });

  return {
    id: CHASER_ACTION_PROPOSAL_IDS.SPIN,
    active: true,
    confidence: 0.35,
    pursuitSource: CHASER_ACTION_PROPOSAL_IDS.SPIN,
    goalDirection: getSpinDirection(chaserLookDirection, steering),
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}
