import {
  createWallAvoidanceEvidenceState,
  updateWallAvoidanceEvidence,
} from "./wall-avoidance-detection.mjs";
import { createStatefulPattern, getPatternOutput, updatePattern } from "./patterns.mjs";

export const WALL_AVOIDANCE_PATTERN_ID = "wallAvoidance";

export function createWallAvoidancePattern() {
  return createStatefulPattern({
    id: WALL_AVOIDANCE_PATTERN_ID,
    createState: createWallAvoidanceEvidenceState,
    updateState: (state, context) => updateWallAvoidanceEvidence(state, context),
    getOutput: (state) => state,
    getConfidence: (state) => Number(state?.wallAvoidanceScore) || 0,
  });
}

export function updateWallAvoidancePattern(pattern, context) {
  return updatePattern(pattern, context);
}

export function getWallAvoidancePatternOutput(pattern) {
  return getPatternOutput(pattern);
}
