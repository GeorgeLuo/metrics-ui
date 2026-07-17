/**
 * Normalized observer-world input contract for Chase decision adapters.
 *
 * Perception, fixtures, and future vision pipelines produce this envelope.
 * The generic decision model consumes only the normalized record and must not
 * reach for renderer state, raw PNG bytes, or simulator-global truth.
 */

export const OBSERVER_WORLD_SOURCE_IDS = {
  SIMULATION: "simulation",
  FRONT_VIEW: "front-view",
  VISION: "vision",
} as const;

export type ObserverWorldSourceId =
  typeof OBSERVER_WORLD_SOURCE_IDS[keyof typeof OBSERVER_WORLD_SOURCE_IDS];

export const UNDERSTOOD_WORLD_FACT_KINDS = {
  EVADER: "evader",
  MAP_WALL: "map-wall",
  MAP_AREA: "map-area",
} as const;

export type UnderstoodWorldFactKind =
  typeof UNDERSTOOD_WORLD_FACT_KINDS[keyof typeof UNDERSTOOD_WORLD_FACT_KINDS];

/**
 * One discrete understood-world claim with its own confidence.
 *
 * `value` stays intentionally structural rather than image-derived so adapters
 * can pass geometry, actor visibility, or free-space cells without embedding
 * capture bytes.
 */
export type UnderstoodWorldFact = Readonly<{
  kind: UnderstoodWorldFactKind | string;
  id: string;
  confidence: number;
  value: Readonly<Record<string, unknown>>;
}>;

/**
 * Provenance that proves how an observer-world record was produced.
 *
 * Capture and rendering identifiers are optional so pure simulation geometry
 * observations can still declare an interpreter without claiming a PNG source.
 */
export type ObservationProvenance = Readonly<{
  interpreterId: string;
  producedAtFrameIndex: number | null;
  captureId: string | null;
  capturePath: string | null;
  renderingProfileId: string | null;
  notes: string | null;
}>;

/**
 * Trusted decision-model input after perception or fixture interpretation.
 *
 * `facts` are the only understood content. `confidence` is the envelope-level
 * trust assigned by the producer; individual facts may carry finer confidence.
 */
export type ObserverWorldInput = Readonly<{
  source: ObserverWorldSourceId;
  frameIndex: number | null;
  facts: readonly UnderstoodWorldFact[];
  confidence: number;
  provenance: ObservationProvenance;
}>;

/**
 * Fixture artifact boundary for chaser front-view interpretation.
 *
 * Work package 2 implements deterministic interpretation against this shape.
 * The contract freezes the minimum fields a fixture must supply so interpreters
 * cannot pull simulator-global geometry by accident.
 */
export type ChaserObservationFixtureBoundary = Readonly<{
  fixtureId: string;
  source: typeof OBSERVER_WORLD_SOURCE_IDS.FRONT_VIEW;
  frameIndex: number | null;
  image: Readonly<{
    contentType: string;
    width: number;
    height: number;
    relativePath: string;
  }>;
  captureMetadata: Readonly<{
    actorId: string;
    renderingProfileId: string | null;
    camera: Readonly<Record<string, unknown>> | null;
  }>;
}>;

export const OBSERVER_WORLD_SOURCE_ID_VALUES = Object.freeze(
  Object.values(OBSERVER_WORLD_SOURCE_IDS),
);

export const UNDERSTOOD_WORLD_FACT_FIELDS = Object.freeze([
  "kind",
  "id",
  "confidence",
  "value",
] as const);

export const OBSERVATION_PROVENANCE_FIELDS = Object.freeze([
  "interpreterId",
  "producedAtFrameIndex",
  "captureId",
  "capturePath",
  "renderingProfileId",
  "notes",
] as const);

export const OBSERVER_WORLD_INPUT_FIELDS = Object.freeze([
  "source",
  "frameIndex",
  "facts",
  "confidence",
  "provenance",
] as const);

export const CHASER_OBSERVATION_FIXTURE_BOUNDARY_FIELDS = Object.freeze([
  "fixtureId",
  "source",
  "frameIndex",
  "image",
  "captureMetadata",
] as const);

function clampUnitInterval(value: unknown, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const numeric = Number(value);
  if (numeric < 0) {
    return 0;
  }
  if (numeric > 1) {
    return 1;
  }
  return numeric;
}

function normalizeFrameIndex(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(Number(value));
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeSource(value: unknown): ObserverWorldSourceId {
  if (
    value === OBSERVER_WORLD_SOURCE_IDS.SIMULATION
    || value === OBSERVER_WORLD_SOURCE_IDS.FRONT_VIEW
    || value === OBSERVER_WORLD_SOURCE_IDS.VISION
  ) {
    return value;
  }
  return OBSERVER_WORLD_SOURCE_IDS.SIMULATION;
}

function normalizeFactValue(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({});
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

/**
 * Normalizes one understood fact into the stable decision-input shape.
 */
export function normalizeUnderstoodWorldFact(
  fact: Partial<UnderstoodWorldFact> | null | undefined,
  index = 0,
): UnderstoodWorldFact {
  const kind = normalizeNullableString(fact?.kind) ?? "unknown";
  const id = normalizeNullableString(fact?.id) ?? `${kind}-${index}`;
  return Object.freeze({
    kind,
    id,
    confidence: clampUnitInterval(fact?.confidence, 0),
    value: normalizeFactValue(fact?.value),
  });
}

/**
 * Normalizes observation provenance with explicit nullable capture fields.
 */
export function normalizeObservationProvenance(
  provenance: Partial<ObservationProvenance> | null | undefined,
): ObservationProvenance {
  return Object.freeze({
    interpreterId: normalizeNullableString(provenance?.interpreterId)
      ?? "unspecified",
    producedAtFrameIndex: normalizeFrameIndex(provenance?.producedAtFrameIndex),
    captureId: normalizeNullableString(provenance?.captureId),
    capturePath: normalizeNullableString(provenance?.capturePath),
    renderingProfileId: normalizeNullableString(provenance?.renderingProfileId),
    notes: normalizeNullableString(provenance?.notes),
  });
}

export type CreateObserverWorldInputOptions = {
  source?: unknown;
  frameIndex?: unknown;
  facts?: ReadonlyArray<Partial<UnderstoodWorldFact> | null | undefined> | null;
  confidence?: unknown;
  provenance?: Partial<ObservationProvenance> | null;
};

/**
 * Builds an immutable observer-world input record for decision adapters.
 *
 * Invalid sources fall back to simulation so producers cannot invent a source
 * label that decision code would treat as a new perception channel.
 */
export function createObserverWorldInput(
  options: CreateObserverWorldInputOptions = {},
): ObserverWorldInput {
  const facts = Object.freeze(
    (options.facts ?? [])
      .filter((fact): fact is Partial<UnderstoodWorldFact> => Boolean(fact))
      .map((fact, index) => normalizeUnderstoodWorldFact(fact, index)),
  );

  return Object.freeze({
    source: normalizeSource(options.source),
    frameIndex: normalizeFrameIndex(options.frameIndex),
    facts,
    confidence: clampUnitInterval(options.confidence, 0),
    provenance: normalizeObservationProvenance(options.provenance),
  });
}

export type CreateChaserObservationFixtureBoundaryOptions = {
  fixtureId?: unknown;
  frameIndex?: unknown;
  image?: Partial<ChaserObservationFixtureBoundary["image"]> | null;
  captureMetadata?: Partial<
    ChaserObservationFixtureBoundary["captureMetadata"]
  > | null;
};

/**
 * Builds the minimum fixture boundary used by front-view interpreters.
 *
 * The source is fixed to `front-view`. Interpreters must not receive additional
 * simulator-global geometry through this boundary.
 */
export function createChaserObservationFixtureBoundary(
  options: CreateChaserObservationFixtureBoundaryOptions = {},
): ChaserObservationFixtureBoundary {
  const image = options.image ?? {};
  const captureMetadata = options.captureMetadata ?? {};
  const width = Number.isFinite(image.width) ? Math.max(1, Math.trunc(Number(image.width))) : 1;
  const height = Number.isFinite(image.height)
    ? Math.max(1, Math.trunc(Number(image.height)))
    : 1;

  return Object.freeze({
    fixtureId: normalizeNullableString(options.fixtureId) ?? "unnamed-fixture",
    source: OBSERVER_WORLD_SOURCE_IDS.FRONT_VIEW,
    frameIndex: normalizeFrameIndex(options.frameIndex),
    image: Object.freeze({
      contentType: normalizeNullableString(image.contentType) ?? "image/png",
      width,
      height,
      relativePath: normalizeNullableString(image.relativePath) ?? "",
    }),
    captureMetadata: Object.freeze({
      actorId: normalizeNullableString(captureMetadata.actorId) ?? "chaser",
      renderingProfileId: normalizeNullableString(
        captureMetadata.renderingProfileId,
      ),
      camera: captureMetadata.camera
        && typeof captureMetadata.camera === "object"
        && !Array.isArray(captureMetadata.camera)
        ? Object.freeze({
          ...(captureMetadata.camera as Record<string, unknown>),
        })
        : null,
    }),
  });
}
