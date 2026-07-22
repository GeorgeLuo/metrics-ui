import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateEvidenceDirectory } from "./play-chase-evaluation-validate.mjs";

function writeCapture(directory, name, {
  epoch = "run-a",
  frameIndex = 3,
  image = "image-a",
  sensorExtension = {},
  referenceExtension = {},
} = {}) {
  const imageFile = `${name}.png`;
  fs.writeFileSync(path.join(directory, imageFile), image);
  fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify({
    contractVersion: 1,
    captureId: `chase:evaluation:${epoch}:chaser:${frameIndex}`,
    actorId: "chaser",
    frameIdentity: {
      gameId: "chase",
      simulationEpoch: epoch,
      frameIndex,
    },
    playback: { advanced: false },
    sensor: {
      image: {
        contentType: "image/png",
        rendererId: "chase-front-view-v1",
        width: 320,
        height: 240,
        file: imageFile,
      },
      ...sensorExtension,
    },
    evaluator: {
      classification: "non-sensor",
      shadow: {
        kind: "visible-observation-summary",
        visibleActorCount: 1,
        visibleWallCount: 2,
        visibleAreaCellCount: 3,
        observationCount: 4,
      },
      reference: {
        kind: "actor-control-reference",
        scenarioId: "chaser-depth-obstacles",
        controlSource: "ws",
        phase: frameIndex === 0 ? "initial" : "after-actions",
        actionFrameIndex: Math.max(0, frameIndex - 1),
        input: {
          source: "human",
          forward: false,
          reverse: false,
          steering: 0,
        },
        action: {
          source: "human",
          forward: false,
          reverse: false,
          steering: 0,
          selectedActionProposalId: null,
        },
        ...referenceExtension,
      },
    },
    files: { metadata: `${name}.json`, image: imageFile },
  }, null, 2)}\n`);
}

function createEvidenceDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chase-evaluation-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeCapture(directory, "before");
  writeCapture(directory, "repeat");
  writeCapture(directory, "after-move", { frameIndex: 8, image: "image-b" });
  writeCapture(directory, "after-reset", { epoch: "run-b", frameIndex: 0 });
  return directory;
}

test("validates repeatability, movement, reset identity, and privilege boundaries", (t) => {
  const report = validateEvidenceDirectory(createEvidenceDirectory(t));

  assert.equal(report.status, "pass");
  assert.equal(report.summary.failed, 0);
  assert.ok(report.checks.some((check) => check.id === "same-state:image" && check.passed));
  assert.ok(report.checks.some((check) => check.id === "movement:later-frame" && check.passed));
  assert.ok(report.checks.some((check) => check.id === "reset:new-epoch" && check.passed));
  assert.ok(report.checks.some(
    (check) => check.id === "movement:controller-reference" && check.passed,
  ));
});

test("rejects simulator geometry added to the evaluator control reference", (t) => {
  const directory = createEvidenceDirectory(t);
  writeCapture(directory, "before", {
    referenceExtension: { actorPosition: { x: 1, z: 2 } },
  });

  const report = validateEvidenceDirectory(directory);
  const referenceCheck = report.checks.find(
    (check) => check.id === "before:evaluator-reference",
  );
  assert.equal(report.status, "fail");
  assert.equal(referenceCheck?.passed, false);
});

test("rejects simulator-only fields added to the sensor branch", (t) => {
  const directory = createEvidenceDirectory(t);
  writeCapture(directory, "before", {
    sensorExtension: { actorCoordinates: [{ x: 1, y: 2 }] },
  });

  const report = validateEvidenceDirectory(directory);
  const boundaryCheck = report.checks.find((check) => check.id === "before:sensor-boundary");
  assert.equal(report.status, "fail");
  assert.equal(boundaryCheck?.passed, false);
});
