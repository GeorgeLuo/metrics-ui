export const CHASE_PLAY_QUERY_IDS = Object.freeze({
  ATOMIC_EVALUATION_CAPTURE: "atomic-evaluation-capture",
});

function normalizeCaptureOptions(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  // Preserve present actor/camera values even when malformed so the capture
  // boundary can reject them instead of silently defaulting to chaser/front_camera.
  const options = {};
  if (Object.prototype.hasOwnProperty.call(payload, "actorId")) {
    options.actorId = payload.actorId;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "cameraId")) {
    options.cameraId = payload.cameraId;
  }
  if (Number.isFinite(payload.width)) {
    options.width = Number(payload.width);
  }
  if (Number.isFinite(payload.height)) {
    options.height = Number(payload.height);
  }
  return options;
}

/** Adapts generic Play queries to Chase-owned read models. */
export function handleChasePlayQuery(query = {}, handlers = {}) {
  if (query.queryId !== CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE) {
    return undefined;
  }
  if (typeof handlers.getAtomicEvaluationCapture !== "function") {
    throw new Error("Chase atomic evaluation capture is not available.");
  }
  return handlers.getAtomicEvaluationCapture(normalizeCaptureOptions(query.payload));
}
