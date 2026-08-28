export const ATOMIC_EVALUATION_CAPTURE_CONTRACT_VERSION = 1;

/** Encoded camera artifact that an external controller may treat as perception. */
export type AtomicEvaluationCaptureImage = {
  contentType: string;
  rendererId: string;
  width: number;
  height: number;
  dataUrl?: string;
  svg?: string;
};

/** Stable identity for one frame within one simulation run. */
export type AtomicEvaluationFrameIdentity = {
  gameId: string;
  simulationEpoch: string;
  frameIndex: number;
};

/** Count-only evaluation facts derived from a visible-only front-view record. */
export type BoundedEvaluatorShadow = {
  kind: "visible-observation-summary";
  visibleActorCount: number;
  visibleWallCount: number;
  visibleAreaCellCount: number;
  observationCount: number;
};

export type BoundedEvaluatorControlInput = {
  source: string;
  forward: boolean;
  reverse: boolean;
  steering: number;
};

export type BoundedEvaluatorControlAction = BoundedEvaluatorControlInput & {
  selectedActionProposalId: string | null;
};

/** Evaluator-only control facts captured synchronously with the sensor image. */
export type BoundedEvaluatorControlReference = {
  kind: "actor-control-reference";
  scenarioId: string;
  controlSource: string;
  phase: string;
  actionFrameIndex: number;
  input: BoundedEvaluatorControlInput;
  action: BoundedEvaluatorControlAction;
};

/** Immutable, non-public source used to build one atomic evaluation response. */
export type AtomicEvaluationCaptureSource = {
  captureId: string;
  actorId: string;
  frameIdentity: AtomicEvaluationFrameIdentity;
  image: AtomicEvaluationCaptureImage;
  evaluatorShadow: BoundedEvaluatorShadow;
  evaluatorReference: BoundedEvaluatorControlReference;
};

/** Public response shape for a camera frame and its separately labeled evaluator data. */
export type AtomicEvaluationCapture = {
  contractVersion: typeof ATOMIC_EVALUATION_CAPTURE_CONTRACT_VERSION;
  captureId: string;
  actorId: string;
  frameIdentity: AtomicEvaluationFrameIdentity;
  playback: {
    advanced: false;
  };
  sensor: {
    image: AtomicEvaluationCaptureImage;
  };
  evaluator: {
    classification: "non-sensor";
    shadow: BoundedEvaluatorShadow;
    reference: BoundedEvaluatorControlReference;
  };
};

/** Snapshot fields required to establish a same-state evaluation capture. */
export type AtomicEvaluationCaptureSnapshot = {
  gameId: string;
  actorId: string;
  frameIndex: number | null;
  image: AtomicEvaluationCaptureImage;
  evaluatorReference: BoundedEvaluatorControlReference;
  record: {
    actorId: string;
    frameIndex: number | null;
    map: {
      visibleWalls: readonly unknown[];
      visibleArea: {
        cells: readonly unknown[];
      };
      observationCount: number;
    };
    visibleActors: readonly {
      actorId: string;
      visible: boolean;
    }[];
  };
};

/** Runtime identity that remains stable for the lifetime of one simulation run. */
export type AtomicEvaluationCaptureRunContext = {
  simulationEpoch: string;
};

function cloneImage(image: AtomicEvaluationCaptureImage): AtomicEvaluationCaptureImage {
  return {
    contentType: image.contentType,
    rendererId: image.rendererId,
    width: image.width,
    height: image.height,
    ...(typeof image.dataUrl === "string" ? { dataUrl: image.dataUrl } : {}),
    ...(typeof image.svg === "string" ? { svg: image.svg } : {}),
  };
}

function cloneFrameIdentity(
  frameIdentity: AtomicEvaluationFrameIdentity,
): AtomicEvaluationFrameIdentity {
  return {
    gameId: frameIdentity.gameId,
    simulationEpoch: frameIdentity.simulationEpoch,
    frameIndex: frameIdentity.frameIndex,
  };
}

function cloneShadow(shadow: BoundedEvaluatorShadow): BoundedEvaluatorShadow {
  return { ...shadow };
}

function cloneControlInput(
  input: BoundedEvaluatorControlInput,
): BoundedEvaluatorControlInput {
  return { ...input };
}

function cloneControlAction(
  action: BoundedEvaluatorControlAction,
): BoundedEvaluatorControlAction {
  return { ...action };
}

function cloneEvaluatorReference(
  reference: BoundedEvaluatorControlReference,
): BoundedEvaluatorControlReference {
  return {
    kind: reference.kind,
    scenarioId: reference.scenarioId,
    controlSource: reference.controlSource,
    phase: reference.phase,
    actionFrameIndex: reference.actionFrameIndex,
    input: cloneControlInput(reference.input),
    action: cloneControlAction(reference.action),
  };
}

function requireFrameIndex(frameIndex: number | null | undefined): number {
  if (!Number.isInteger(frameIndex) || Number(frameIndex) < 0) {
    throw new Error("Atomic evaluation capture requires a non-negative integer frame index.");
  }
  return Number(frameIndex);
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Atomic evaluation capture requires ${label}.`);
  }
  return value.trim();
}

function requireImage(image: AtomicEvaluationCaptureImage): AtomicEvaluationCaptureImage {
  if (!image || typeof image !== "object") {
    throw new Error("Atomic evaluation capture requires an image artifact.");
  }
  if (!Number.isInteger(image.width) || image.width <= 0
    || !Number.isInteger(image.height) || image.height <= 0) {
    throw new Error("Atomic evaluation capture image dimensions must be positive integers.");
  }
  if (typeof image.dataUrl !== "string" && typeof image.svg !== "string") {
    throw new Error("Atomic evaluation capture image requires encoded image content.");
  }
  return cloneImage(image);
}

function requireSteering(value: number, label: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`Atomic evaluation capture ${label} must be between -1 and 1.`);
  }
  return value;
}

function requireControlInput(
  value: BoundedEvaluatorControlInput,
  label: string,
): BoundedEvaluatorControlInput {
  if (!value || typeof value !== "object") {
    throw new Error(`Atomic evaluation capture requires ${label}.`);
  }
  return {
    source: requireIdentifier(value.source, `${label} source`),
    forward: Boolean(value.forward),
    reverse: Boolean(value.reverse),
    steering: requireSteering(value.steering, `${label} steering`),
  };
}

function requireEvaluatorReference(
  value: BoundedEvaluatorControlReference,
  frameIndex: number,
): BoundedEvaluatorControlReference {
  if (!value || typeof value !== "object" || value.kind !== "actor-control-reference") {
    throw new Error("Atomic evaluation capture requires an actor control reference.");
  }
  const actionFrameIndex = requireFrameIndex(value.actionFrameIndex);
  if (actionFrameIndex > frameIndex) {
    throw new Error("Atomic evaluation capture control reference cannot cite a future frame.");
  }
  const input = requireControlInput(value.input, "control input");
  const actionInput = requireControlInput(value.action, "control action");
  return {
    kind: "actor-control-reference",
    scenarioId: requireIdentifier(value.scenarioId, "a scenario id"),
    controlSource: requireIdentifier(value.controlSource, "a control source"),
    phase: requireIdentifier(value.phase, "a control phase"),
    actionFrameIndex,
    input,
    action: {
      ...actionInput,
      selectedActionProposalId: typeof value.action.selectedActionProposalId === "string"
        && value.action.selectedActionProposalId.trim()
        ? value.action.selectedActionProposalId.trim()
        : null,
    },
  };
}

function buildEvaluatorShadow(
  record: AtomicEvaluationCaptureSnapshot["record"],
): BoundedEvaluatorShadow {
  const visibleActorCount = new Set(
    record.visibleActors
      .filter((actor) => actor.visible)
      .map((actor) => actor.actorId)
      .filter(Boolean),
  ).size;
  const visibleArea = record.map.visibleArea;
  return {
    kind: "visible-observation-summary",
    visibleActorCount,
    visibleWallCount: record.map.visibleWalls.length,
    visibleAreaCellCount: visibleArea.cells.length,
    observationCount: record.map.observationCount,
  };
}

/**
 * Freezes the visible-only facts and image that belong to one evaluation frame.
 *
 * The returned source intentionally discards poses, map geometry, and actor
 * coordinates. Later transport code can serialize the public bundle without
 * reading mutable simulation state or handing controller perception a world model.
 */
export function createAtomicEvaluationCaptureSource(
  snapshot: AtomicEvaluationCaptureSnapshot,
  runContext: AtomicEvaluationCaptureRunContext,
): AtomicEvaluationCaptureSource {
  const gameId = requireIdentifier(snapshot.gameId, "a game id");
  const simulationEpoch = requireIdentifier(
    runContext.simulationEpoch,
    "a simulation epoch",
  );
  const actorId = requireIdentifier(snapshot.actorId, "an actor id");
  const frameIndex = requireFrameIndex(snapshot.frameIndex);
  if (snapshot.record.actorId !== actorId || snapshot.record.frameIndex !== frameIndex) {
    throw new Error("Atomic evaluation capture snapshot identity does not match its capture record.");
  }

  const frameIdentity = Object.freeze({
    gameId,
    simulationEpoch,
    frameIndex,
  });
  const evaluatorShadow = buildEvaluatorShadow(snapshot.record);
  const evaluatorReference = requireEvaluatorReference(
    snapshot.evaluatorReference,
    frameIndex,
  );
  return Object.freeze({
    captureId: [
      encodeURIComponent(gameId),
      "evaluation",
      encodeURIComponent(simulationEpoch),
      encodeURIComponent(actorId),
      frameIndex,
    ].join(":"),
    actorId,
    frameIdentity,
    image: Object.freeze(requireImage(snapshot.image)),
    evaluatorShadow: Object.freeze(evaluatorShadow),
    evaluatorReference: Object.freeze({
      ...evaluatorReference,
      input: Object.freeze(evaluatorReference.input),
      action: Object.freeze(evaluatorReference.action),
    }),
  });
}

/**
 * Builds the public atomic response from an already frozen capture source.
 *
 * This is pure: it neither reads nor mutates playback state. The sensor branch
 * contains only the camera artifact; evaluator facts stay in a separate branch.
 */
export function buildAtomicEvaluationCapture(
  source: AtomicEvaluationCaptureSource,
): AtomicEvaluationCapture {
  return {
    contractVersion: ATOMIC_EVALUATION_CAPTURE_CONTRACT_VERSION,
    captureId: source.captureId,
    actorId: source.actorId,
    frameIdentity: cloneFrameIdentity(source.frameIdentity),
    playback: { advanced: false },
    sensor: {
      image: cloneImage(source.image),
    },
    evaluator: {
      classification: "non-sensor",
      shadow: cloneShadow(source.evaluatorShadow),
      reference: cloneEvaluatorReference(source.evaluatorReference),
    },
  };
}

/** Creates a public atomic response directly from one manual front-view snapshot. */
export function buildAtomicEvaluationCaptureFromSnapshot(
  snapshot: AtomicEvaluationCaptureSnapshot,
  runContext: AtomicEvaluationCaptureRunContext,
): AtomicEvaluationCapture {
  return buildAtomicEvaluationCapture(
    createAtomicEvaluationCaptureSource(snapshot, runContext),
  );
}

export const ATOMIC_EVALUATION_CAPTURE_SENSOR_FIELDS = Object.freeze([
  "image",
]);

export const ATOMIC_EVALUATION_FRAME_IDENTITY_FIELDS = Object.freeze([
  "gameId",
  "simulationEpoch",
  "frameIndex",
]);

export const BOUNDED_EVALUATOR_SHADOW_FIELDS = Object.freeze([
  "kind",
  "visibleActorCount",
  "visibleWallCount",
  "visibleAreaCellCount",
  "observationCount",
]);

export const BOUNDED_EVALUATOR_REFERENCE_FIELDS = Object.freeze([
  "kind",
  "scenarioId",
  "controlSource",
  "phase",
  "actionFrameIndex",
  "input",
  "action",
]);

export const BOUNDED_EVALUATOR_CONTROL_INPUT_FIELDS = Object.freeze([
  "source",
  "forward",
  "reverse",
  "steering",
]);

export const BOUNDED_EVALUATOR_CONTROL_ACTION_FIELDS = Object.freeze([
  ...BOUNDED_EVALUATOR_CONTROL_INPUT_FIELDS,
  "selectedActionProposalId",
]);
