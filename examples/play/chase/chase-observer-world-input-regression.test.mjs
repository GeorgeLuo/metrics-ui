import assert from "node:assert/strict";
import test from "node:test";

import {
  CHASER_OBSERVATION_FIXTURE_BOUNDARY_FIELDS,
  OBSERVATION_PROVENANCE_FIELDS,
  OBSERVER_WORLD_INPUT_FIELDS,
  OBSERVER_WORLD_SOURCE_IDS,
  UNDERSTOOD_WORLD_FACT_FIELDS,
  UNDERSTOOD_WORLD_FACT_KINDS,
  createChaserObservationFixtureBoundary,
  createObserverWorldInput,
  normalizeObservationProvenance,
  normalizeUnderstoodWorldFact,
} from "./decision-model/observer-world/input-contract.ts";

test("observer-world input normalizes source, confidence, and immutable facts", () => {
  const input = createObserverWorldInput({
    source: "front-view",
    frameIndex: 12.9,
    confidence: 1.4,
    facts: [
      {
        kind: UNDERSTOOD_WORLD_FACT_KINDS.EVADER,
        id: "evader",
        confidence: -0.2,
        value: { visible: true, distance: 3.5 },
      },
      null,
      {
        kind: UNDERSTOOD_WORLD_FACT_KINDS.MAP_WALL,
        confidence: 0.8,
        value: { wallId: "north" },
      },
    ],
    provenance: {
      interpreterId: "fixture-v1",
      producedAtFrameIndex: 12,
      captureId: "cap-1",
      capturePath: "fixtures/cap-1.png",
      renderingProfileId: "rc-indoor",
      notes: " deterministic boundary ",
    },
  });

  assert.equal(input.source, OBSERVER_WORLD_SOURCE_IDS.FRONT_VIEW);
  assert.equal(input.frameIndex, 12);
  assert.equal(input.confidence, 1);
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.facts), true);
  assert.equal(input.facts.length, 2);
  assert.equal(input.facts[0].confidence, 0);
  assert.equal(input.facts[0].value.visible, true);
  assert.equal(input.facts[1].id, "map-wall-1");
  assert.equal(input.provenance.interpreterId, "fixture-v1");
  assert.equal(input.provenance.notes, "deterministic boundary");
  assert.deepEqual([...OBSERVER_WORLD_INPUT_FIELDS], [
    "source",
    "frameIndex",
    "facts",
    "confidence",
    "provenance",
  ]);
});

test("unknown observer-world sources fall back to simulation", () => {
  const input = createObserverWorldInput({
    source: "lidar",
    confidence: 0.5,
    facts: [],
  });

  assert.equal(input.source, OBSERVER_WORLD_SOURCE_IDS.SIMULATION);
  assert.equal(input.frameIndex, null);
  assert.equal(input.facts.length, 0);
  assert.equal(input.provenance.interpreterId, "unspecified");
  assert.equal(input.provenance.captureId, null);
  assert.equal(input.provenance.capturePath, null);
  assert.equal(input.provenance.renderingProfileId, null);
  assert.equal(input.provenance.notes, null);
});

test("fact and provenance helpers freeze normalized records", () => {
  const fact = normalizeUnderstoodWorldFact({
    kind: UNDERSTOOD_WORLD_FACT_KINDS.MAP_AREA,
    id: "cell-0-0",
    confidence: 0.55,
    value: { cellX: 0, cellZ: 0 },
  });
  const provenance = normalizeObservationProvenance({
    interpreterId: "simulation-geometry-v1",
    producedAtFrameIndex: null,
  });

  assert.equal(Object.isFrozen(fact), true);
  assert.equal(Object.isFrozen(fact.value), true);
  assert.equal(Object.isFrozen(provenance), true);
  assert.equal(fact.kind, UNDERSTOOD_WORLD_FACT_KINDS.MAP_AREA);
  assert.equal(provenance.interpreterId, "simulation-geometry-v1");
  assert.deepEqual([...UNDERSTOOD_WORLD_FACT_FIELDS], [
    "kind",
    "id",
    "confidence",
    "value",
  ]);
  assert.deepEqual([...OBSERVATION_PROVENANCE_FIELDS], [
    "interpreterId",
    "producedAtFrameIndex",
    "captureId",
    "capturePath",
    "renderingProfileId",
    "notes",
  ]);
});

test("front-view fixture boundary freezes capture-only fields", () => {
  const fixture = createChaserObservationFixtureBoundary({
    fixtureId: "piracer-frame-0",
    frameIndex: 0,
    image: {
      contentType: "image/png",
      width: 320.8,
      height: 240.2,
      relativePath: "evidence/front-view/piracer-frame-0.png",
    },
    captureMetadata: {
      actorId: "chaser",
      renderingProfileId: "rc-indoor",
      camera: { verticalFovDegrees: 48 },
    },
  });

  assert.equal(fixture.source, OBSERVER_WORLD_SOURCE_IDS.FRONT_VIEW);
  assert.equal(fixture.image.width, 320);
  assert.equal(fixture.image.height, 240);
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.image), true);
  assert.equal(Object.isFrozen(fixture.captureMetadata), true);
  assert.equal(Object.isFrozen(fixture.captureMetadata.camera), true);
  assert.equal(fixture.captureMetadata.camera.verticalFovDegrees, 48);
  assert.deepEqual([...CHASER_OBSERVATION_FIXTURE_BOUNDARY_FIELDS], [
    "fixtureId",
    "source",
    "frameIndex",
    "image",
    "captureMetadata",
  ]);
});

test("fixture boundary defaults never invent a non-front-view source", () => {
  const fixture = createChaserObservationFixtureBoundary({});
  assert.equal(fixture.fixtureId, "unnamed-fixture");
  assert.equal(fixture.source, OBSERVER_WORLD_SOURCE_IDS.FRONT_VIEW);
  assert.equal(fixture.image.relativePath, "");
  assert.equal(fixture.captureMetadata.actorId, "chaser");
  assert.equal(fixture.captureMetadata.camera, null);
});
