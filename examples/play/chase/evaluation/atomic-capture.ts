import type {
  VehicleFrontViewCaptureRecord,
} from "../decision-model/memory/vehicle/front-view-captures.ts";

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

/** Count-only evaluation facts derived from a visible-only front-view record. */
export type BoundedEvaluatorShadow = {
  kind: "visible-observation-summary";
  visibleActorIds: readonly string[];
  visibleActorCount: number;
  visibleWallCount: number;
  visibleAreaCellCount: number;
  observationCount: number;
};

/** Immutable, non-public source used to build one atomic evaluation response. */
export type AtomicEvaluationCaptureSource = {
  captureId: string;
  actorId: string;
  frameIndex: number;
  image: AtomicEvaluationCaptureImage;
  evaluatorShadow: BoundedEvaluatorShadow;
};

/** Public response shape for a camera frame and its separately labeled evaluator data. */
export type AtomicEvaluationCapture = {
  contractVersion: typeof ATOMIC_EVALUATION_CAPTURE_CONTRACT_VERSION;
  captureId: string;
  actorId: string;
  frameIndex: number;
  playback: {
    advanced: false;
  };
  sensor: {
    image: AtomicEvaluationCaptureImage;
  };
  evaluator: {
    classification: "non-sensor";
    shadow: BoundedEvaluatorShadow;
  };
};

/** Snapshot fields required to establish a same-state evaluation capture. */
export type AtomicEvaluationCaptureSnapshot = {
  actorId: string;
  frameIndex: number | null;
  image: AtomicEvaluationCaptureImage;
  record: Pick<
    VehicleFrontViewCaptureRecord,
    "actorId" | "frameIndex" | "map" | "visibleActors"
  >;
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

function cloneShadow(shadow: BoundedEvaluatorShadow): BoundedEvaluatorShadow {
  return {
    ...shadow,
    visibleActorIds: [...shadow.visibleActorIds],
  };
}

function requireFrameIndex(frameIndex: number | null | undefined): number {
  if (!Number.isInteger(frameIndex) || Number(frameIndex) < 0) {
    throw new Error("Atomic evaluation capture requires a non-negative integer frame index.");
  }
  return Number(frameIndex);
}

function requireActorId(actorId: string): string {
  const normalizedActorId = actorId.trim();
  if (!normalizedActorId) {
    throw new Error("Atomic evaluation capture requires an actor id.");
  }
  return normalizedActorId;
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

function buildEvaluatorShadow(
  record: AtomicEvaluationCaptureSnapshot["record"],
): BoundedEvaluatorShadow {
  const visibleActorIds = [...new Set(
    record.visibleActors
      .filter((actor) => actor.visible)
      .map((actor) => actor.actorId)
      .filter(Boolean),
  )].sort();
  const visibleArea = record.map.visibleArea;
  return {
    kind: "visible-observation-summary",
    visibleActorIds,
    visibleActorCount: visibleActorIds.length,
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
): AtomicEvaluationCaptureSource {
  const actorId = requireActorId(snapshot.actorId);
  const frameIndex = requireFrameIndex(snapshot.frameIndex);
  if (snapshot.record.actorId !== actorId || snapshot.record.frameIndex !== frameIndex) {
    throw new Error("Atomic evaluation capture snapshot identity does not match its capture record.");
  }

  const evaluatorShadow = buildEvaluatorShadow(snapshot.record);
  return Object.freeze({
    captureId: `chase:evaluation:${actorId}:${frameIndex}`,
    actorId,
    frameIndex,
    image: Object.freeze(requireImage(snapshot.image)),
    evaluatorShadow: Object.freeze({
      ...evaluatorShadow,
      visibleActorIds: Object.freeze(evaluatorShadow.visibleActorIds),
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
    frameIndex: source.frameIndex,
    playback: { advanced: false },
    sensor: {
      image: cloneImage(source.image),
    },
    evaluator: {
      classification: "non-sensor",
      shadow: cloneShadow(source.evaluatorShadow),
    },
  };
}

/** Creates a public atomic response directly from one manual front-view snapshot. */
export function buildAtomicEvaluationCaptureFromSnapshot(
  snapshot: AtomicEvaluationCaptureSnapshot,
): AtomicEvaluationCapture {
  return buildAtomicEvaluationCapture(createAtomicEvaluationCaptureSource(snapshot));
}

export const ATOMIC_EVALUATION_CAPTURE_SENSOR_FIELDS = Object.freeze([
  "image",
]);

export const BOUNDED_EVALUATOR_SHADOW_FIELDS = Object.freeze([
  "kind",
  "visibleActorIds",
  "visibleActorCount",
  "visibleWallCount",
  "visibleAreaCellCount",
  "observationCount",
]);
