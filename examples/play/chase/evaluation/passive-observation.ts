import type {
  AtomicEvaluationCapture,
} from "./atomic-capture.ts";

export const CHASE_PASSIVE_OBSERVATION_QUERY_ID = "atomic-evaluation-capture";
export const CHASE_PASSIVE_OBSERVATION_CAMERA_ID = "front_camera";
export const CHASE_PASSIVE_OBSERVATION_PRESERVED_FIELDS = Object.freeze([
  "gameId",
  "scenarioId",
  "simulationEpoch",
  "playback",
  "controlSource",
  "controlInput",
  "actorId",
  "cameraId",
]);
export const CHASE_PASSIVE_OBSERVATION_SESSION_IDENTITY_FIELDS = Object.freeze([
  "gameId",
  "scenarioId",
  "simulationEpoch",
  "actorId",
  "cameraId",
]);

export type ChaseControlInputFingerprint = {
  source: string;
  forward: boolean;
  reverse: boolean;
  steering: number;
} | null;

export type ChasePassiveObservationFingerprint = {
  gameId: "chase";
  scenarioId: string;
  simulationEpoch: string;
  playback: {
    frameIndex: number;
    phase: "running" | "paused-before-actions";
    pendingAction: boolean;
  };
  controlSource: string;
  controlInput: ChaseControlInputFingerprint;
  actorId: string;
  cameraId: typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID;
};

export type ChasePassiveObservationCapability = {
  supported: true;
  queryId: typeof CHASE_PASSIVE_OBSERVATION_QUERY_ID;
  actors: string[];
  cameras: [typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID];
  preservedFields: string[];
};

export type ChasePassiveObservationUnsupported = {
  passiveObservation: {
    supported: false;
    queryId: typeof CHASE_PASSIVE_OBSERVATION_QUERY_ID;
    reason: {
      code: string;
      message: string;
      field?: string;
      requested?: unknown;
      available?: unknown;
      changedFields?: string[];
    };
    before?: ChasePassiveObservationFingerprint;
    after?: ChasePassiveObservationFingerprint;
  };
};

export type ChasePassiveObservationCapture = AtomicEvaluationCapture & {
  passiveObservation: {
    supported: true;
    queryId: typeof CHASE_PASSIVE_OBSERVATION_QUERY_ID;
    actorId: string;
    cameraId: typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID;
    preservedFields: string[];
    preservation: {
      preserved: true;
      before: ChasePassiveObservationFingerprint;
      after: ChasePassiveObservationFingerprint;
    };
  };
};

type PassiveObservationOptions = {
  // Unknown when present so malformed JSON types are rejected rather than
  // coerced to the chaser/front_camera defaults.
  actorId?: unknown;
  cameraId?: unknown;
  width?: number;
  height?: number;
};

type BuildPassiveObservationCaptureOptions = {
  request?: PassiveObservationOptions;
  capability: ChasePassiveObservationCapability;
  getFingerprint: (
    actorId: string,
    cameraId: typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID,
  ) => ChasePassiveObservationFingerprint | null;
  capture: (actorId: string) => AtomicEvaluationCapture;
};

function resolveOptionalTargetString(
  request: PassiveObservationOptions,
  field: "actorId" | "cameraId",
  defaultValue: string,
):
  | { ok: true; value: string }
  | { ok: false; requested: unknown } {
  if (!Object.prototype.hasOwnProperty.call(request, field)) {
    return { ok: true, value: defaultValue };
  }
  const requested = request[field];
  if (typeof requested === "string" && requested.trim()) {
    return { ok: true, value: requested.trim() };
  }
  return { ok: false, requested };
}

function cloneControlInput(
  input: ChaseControlInputFingerprint,
): ChaseControlInputFingerprint {
  return input ? { ...input } : null;
}

export function cloneChasePassiveObservationFingerprint(
  fingerprint: ChasePassiveObservationFingerprint,
): ChasePassiveObservationFingerprint {
  return {
    ...fingerprint,
    playback: { ...fingerprint.playback },
    controlInput: cloneControlInput(fingerprint.controlInput),
  };
}

function buildUnsupported(
  code: string,
  message: string,
  details: ChasePassiveObservationUnsupported["passiveObservation"]["reason"] = {
    code,
    message,
  },
  fingerprints: {
    before?: ChasePassiveObservationFingerprint;
    after?: ChasePassiveObservationFingerprint;
  } = {},
): ChasePassiveObservationUnsupported {
  return {
    passiveObservation: {
      supported: false,
      queryId: CHASE_PASSIVE_OBSERVATION_QUERY_ID,
      reason: {
        ...details,
        code,
        message,
      },
      ...(fingerprints.before ? { before: cloneChasePassiveObservationFingerprint(fingerprints.before) } : {}),
      ...(fingerprints.after ? { after: cloneChasePassiveObservationFingerprint(fingerprints.after) } : {}),
    },
  };
}

export function getChangedChasePassiveObservationFingerprintFields(
  before: ChasePassiveObservationFingerprint,
  after: ChasePassiveObservationFingerprint,
  fields: readonly string[] = CHASE_PASSIVE_OBSERVATION_PRESERVED_FIELDS,
): string[] {
  return fields.filter((field) =>
    JSON.stringify(before[field as keyof ChasePassiveObservationFingerprint])
      !== JSON.stringify(after[field as keyof ChasePassiveObservationFingerprint]));
}

function captureMatchesFingerprint(
  capture: AtomicEvaluationCapture,
  fingerprint: ChasePassiveObservationFingerprint,
): boolean {
  return capture.actorId === fingerprint.actorId
    && capture.frameIdentity.gameId === fingerprint.gameId
    && capture.frameIdentity.simulationEpoch === fingerprint.simulationEpoch
    && capture.frameIdentity.frameIndex === fingerprint.playback.frameIndex;
}

/** Describes passive observation support for the actors in the current Chase session. */
export function buildChasePassiveObservationCapability({
  evaderExists = true,
}: {
  evaderExists?: boolean;
} = {}): ChasePassiveObservationCapability {
  return {
    supported: true,
    queryId: CHASE_PASSIVE_OBSERVATION_QUERY_ID,
    actors: evaderExists ? ["chaser", "evader"] : ["chaser"],
    cameras: [CHASE_PASSIVE_OBSERVATION_CAMERA_ID],
    preservedFields: [...CHASE_PASSIVE_OBSERVATION_PRESERVED_FIELDS],
  };
}

/** Creates the stable session fields used on both sides of one passive capture. */
export function buildChasePassiveObservationFingerprint({
  scenarioId,
  simulationEpoch,
  frameIndex,
  pauseBeforeActions,
  pendingAction,
  controlSource,
  controlInput,
  actorId,
  cameraId = CHASE_PASSIVE_OBSERVATION_CAMERA_ID,
}: {
  scenarioId: string;
  simulationEpoch: string;
  frameIndex: number;
  pauseBeforeActions: boolean;
  pendingAction: boolean;
  controlSource: string;
  controlInput: ChaseControlInputFingerprint;
  actorId: string;
  cameraId?: typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID;
}): ChasePassiveObservationFingerprint | null {
  if (!scenarioId || !simulationEpoch || !Number.isInteger(frameIndex) || frameIndex < 0
    || !controlSource || !actorId || cameraId !== CHASE_PASSIVE_OBSERVATION_CAMERA_ID) {
    return null;
  }
  return {
    gameId: "chase",
    scenarioId,
    simulationEpoch,
    playback: {
      frameIndex,
      phase: pauseBeforeActions ? "paused-before-actions" : "running",
      pendingAction,
    },
    controlSource,
    controlInput: cloneControlInput(controlInput),
    actorId,
    cameraId,
  };
}

/**
 * Captures one camera frame only when all declared session fields remain stable.
 *
 * Unsupported requests and preservation failures return structured results
 * without a sensor artifact, so consumers cannot accidentally use an unproven
 * frame.
 */
export function buildPassiveChaseEvaluationCapture({
  request = {},
  capability,
  getFingerprint,
  capture,
}: BuildPassiveObservationCaptureOptions):
  ChasePassiveObservationCapture | ChasePassiveObservationUnsupported {
  const requestRecord = request && typeof request === "object" ? request : {};
  const resolvedActor = resolveOptionalTargetString(requestRecord, "actorId", "chaser");
  if (!resolvedActor.ok) {
    return buildUnsupported(
      "actor_invalid",
      "Requested actorId must be a non-empty string when provided.",
      {
        code: "actor_invalid",
        message: "Requested actorId must be a non-empty string when provided.",
        field: "actorId",
        requested: resolvedActor.requested,
        available: capability.actors,
      },
    );
  }
  const resolvedCamera = resolveOptionalTargetString(
    requestRecord,
    "cameraId",
    CHASE_PASSIVE_OBSERVATION_CAMERA_ID,
  );
  if (!resolvedCamera.ok) {
    return buildUnsupported(
      "camera_invalid",
      "Requested cameraId must be a non-empty string when provided.",
      {
        code: "camera_invalid",
        message: "Requested cameraId must be a non-empty string when provided.",
        field: "cameraId",
        requested: resolvedCamera.requested,
        available: capability.cameras,
      },
    );
  }
  const actorId = resolvedActor.value;
  const cameraId = resolvedCamera.value;

  if (!capability.actors.includes(actorId)) {
    return buildUnsupported("actor_unavailable", "Requested actor is not available.", {
      code: "actor_unavailable",
      message: "Requested actor is not available.",
      field: "actorId",
      requested: actorId,
      available: capability.actors,
    });
  }
  if (!capability.cameras.includes(cameraId as typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID)) {
    return buildUnsupported("camera_unavailable", "Requested camera is not available.", {
      code: "camera_unavailable",
      message: "Requested camera is not available.",
      field: "cameraId",
      requested: cameraId,
      available: capability.cameras,
    });
  }

  const normalizedCameraId = cameraId as typeof CHASE_PASSIVE_OBSERVATION_CAMERA_ID;
  const before = getFingerprint(actorId, normalizedCameraId);
  if (!before) {
    return buildUnsupported(
      "session_fingerprint_unavailable",
      "Required session state is unavailable.",
      {
        code: "session_fingerprint_unavailable",
        message: "Required session state is unavailable.",
        field: "session",
      },
    );
  }

  let result: AtomicEvaluationCapture;
  try {
    result = capture(actorId);
  } catch (error) {
    return buildUnsupported("capture_unavailable", "Camera capture is unavailable.", {
      code: "capture_unavailable",
      message: error instanceof Error ? error.message : "Camera capture is unavailable.",
      field: "cameraId",
      requested: normalizedCameraId,
      available: capability.cameras,
    }, { before });
  }

  const after = getFingerprint(actorId, normalizedCameraId);
  if (!after) {
    return buildUnsupported(
      "session_fingerprint_unavailable",
      "Required session state became unavailable.",
      {
        code: "session_fingerprint_unavailable",
        message: "Required session state became unavailable.",
        field: "session",
      },
      { before },
    );
  }
  const changedFields = getChangedChasePassiveObservationFingerprintFields(before, after);
  if (changedFields.length > 0) {
    return buildUnsupported(
      "session_changed",
      "Session state changed while capturing.",
      {
        code: "session_changed",
        message: "Session state changed while capturing.",
        changedFields,
      },
      { before, after },
    );
  }
  if (!captureMatchesFingerprint(result, before)) {
    return buildUnsupported(
      "capture_identity_mismatch",
      "Camera frame identity does not match the preserved session.",
      {
        code: "capture_identity_mismatch",
        message: "Camera frame identity does not match the preserved session.",
        field: "frameIdentity",
      },
      { before, after },
    );
  }

  return {
    ...result,
    passiveObservation: {
      supported: true,
      queryId: CHASE_PASSIVE_OBSERVATION_QUERY_ID,
      actorId,
      cameraId: normalizedCameraId,
      preservedFields: [...CHASE_PASSIVE_OBSERVATION_PRESERVED_FIELDS],
      preservation: {
        preserved: true,
        before: cloneChasePassiveObservationFingerprint(before),
        after: cloneChasePassiveObservationFingerprint(after),
      },
    },
  };
}
