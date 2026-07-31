export const CHASE_PLAY_QUERY_IDS = Object.freeze({
  ATOMIC_EVALUATION_CAPTURE: "atomic-evaluation-capture",
});

function normalizeCaptureOptions(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return {
    ...(typeof payload.actorId === "string" ? { actorId: payload.actorId } : {}),
    ...(typeof payload.cameraId === "string" ? { cameraId: payload.cameraId } : {}),
    ...(Number.isFinite(payload.width) ? { width: Number(payload.width) } : {}),
    ...(Number.isFinite(payload.height) ? { height: Number(payload.height) } : {}),
  };
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
