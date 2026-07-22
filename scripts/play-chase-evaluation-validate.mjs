import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CAPTURE_NAMES = Object.freeze([
  "before",
  "repeat",
  "after-move",
  "after-reset",
]);
const SENSOR_KEYS = Object.freeze(["image"]);
const SENSOR_IMAGE_KEYS = Object.freeze([
  "contentType",
  "file",
  "height",
  "rendererId",
  "width",
]);
const FRAME_IDENTITY_KEYS = Object.freeze([
  "frameIndex",
  "gameId",
  "simulationEpoch",
]);
const EVALUATOR_KEYS = Object.freeze(["classification", "shadow"]);
const EVALUATOR_SHADOW_KEYS = Object.freeze([
  "kind",
  "observationCount",
  "visibleActorCount",
  "visibleAreaCellCount",
  "visibleWallCount",
]);

function parseArgs(argv) {
  const options = { directory: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if ((argv[index] === "--dir" || argv[index] === "--directory") && argv[index + 1]) {
      options.directory = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--out" && argv[index + 1]) {
      options.output = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function sortedKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function sameKeys(value, expected) {
  return JSON.stringify(sortedKeys(value)) === JSON.stringify([...expected].sort());
}

function sameIdentity(left, right) {
  return left.gameId === right.gameId
    && left.simulationEpoch === right.simulationEpoch
    && left.frameIndex === right.frameIndex;
}

function readCapture(directory, name) {
  const metadataPath = path.join(directory, `${name}.json`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const imageFile = metadata?.sensor?.image?.file;
  if (typeof imageFile !== "string" || !imageFile || path.basename(imageFile) !== imageFile) {
    throw new Error(`${name} does not reference a local image filename.`);
  }
  const imagePath = path.join(directory, imageFile);
  const image = fs.readFileSync(imagePath);
  return {
    name,
    metadata,
    metadataPath,
    imagePath,
    imageSha256: createHash("sha256").update(image).digest("hex"),
  };
}

function compactCapture(capture) {
  return {
    captureId: capture.metadata.captureId,
    actorId: capture.metadata.actorId,
    frameIdentity: capture.metadata.frameIdentity,
    imageFile: path.basename(capture.imagePath),
    imageSha256: capture.imageSha256,
  };
}

export function validateEvidenceDirectory(directoryInput) {
  const directory = path.resolve(directoryInput);
  const evidenceDirectory = path.normalize(String(directoryInput));
  const captures = Object.fromEntries(
    CAPTURE_NAMES.map((name) => [name, readCapture(directory, name)]),
  );
  const before = captures.before;
  const repeat = captures.repeat;
  const afterMove = captures["after-move"];
  const afterReset = captures["after-reset"];
  const checks = [];

  const check = (id, passed, detail) => {
    checks.push({ id, passed: Boolean(passed), detail });
  };

  for (const capture of Object.values(captures)) {
    const { metadata } = capture;
    check(
      `${capture.name}:contract-version`,
      metadata.contractVersion === 1,
      `contractVersion=${metadata.contractVersion ?? "missing"}`,
    );
    check(
      `${capture.name}:frame-identity`,
      sameKeys(metadata.frameIdentity, FRAME_IDENTITY_KEYS)
        && typeof metadata.frameIdentity.gameId === "string"
        && metadata.frameIdentity.gameId.length > 0
        && typeof metadata.frameIdentity.simulationEpoch === "string"
        && metadata.frameIdentity.simulationEpoch.length > 0
        && Number.isInteger(metadata.frameIdentity.frameIndex)
        && metadata.frameIdentity.frameIndex >= 0,
      JSON.stringify(metadata.frameIdentity ?? null),
    );
    check(
      `${capture.name}:playback-neutral`,
      sameKeys(metadata.playback, ["advanced"]) && metadata.playback.advanced === false,
      `advanced=${metadata.playback?.advanced ?? "missing"}`,
    );
    check(
      `${capture.name}:sensor-boundary`,
      sameKeys(metadata.sensor, SENSOR_KEYS)
        && sameKeys(metadata.sensor?.image, SENSOR_IMAGE_KEYS),
      `sensorKeys=${sortedKeys(metadata.sensor).join(",")} imageKeys=${sortedKeys(metadata.sensor?.image).join(",")}`,
    );
    check(
      `${capture.name}:evaluator-boundary`,
      sameKeys(metadata.evaluator, EVALUATOR_KEYS)
        && metadata.evaluator.classification === "non-sensor"
        && sameKeys(metadata.evaluator.shadow, EVALUATOR_SHADOW_KEYS)
        && metadata.evaluator.shadow.kind === "visible-observation-summary",
      `classification=${metadata.evaluator?.classification ?? "missing"}`,
    );
  }

  check(
    "same-state:identity",
    before.metadata.captureId === repeat.metadata.captureId
      && sameIdentity(before.metadata.frameIdentity, repeat.metadata.frameIdentity),
    `${before.metadata.captureId} vs ${repeat.metadata.captureId}`,
  );
  check(
    "same-state:image",
    before.imageSha256 === repeat.imageSha256,
    `${before.imageSha256} vs ${repeat.imageSha256}`,
  );
  check(
    "movement:later-frame",
    before.metadata.frameIdentity.gameId === afterMove.metadata.frameIdentity.gameId
      && before.metadata.frameIdentity.simulationEpoch === afterMove.metadata.frameIdentity.simulationEpoch
      && afterMove.metadata.frameIdentity.frameIndex > before.metadata.frameIdentity.frameIndex,
    `before=${before.metadata.frameIdentity.frameIndex} after=${afterMove.metadata.frameIdentity.frameIndex}`,
  );
  check(
    "movement:image-changed",
    before.imageSha256 !== afterMove.imageSha256,
    `${before.imageSha256} vs ${afterMove.imageSha256}`,
  );
  check(
    "reset:new-epoch",
    before.metadata.frameIdentity.gameId === afterReset.metadata.frameIdentity.gameId
      && before.metadata.frameIdentity.simulationEpoch !== afterReset.metadata.frameIdentity.simulationEpoch
      && before.metadata.captureId !== afterReset.metadata.captureId,
    `${before.metadata.frameIdentity.simulationEpoch} vs ${afterReset.metadata.frameIdentity.simulationEpoch}`,
  );

  const failedChecks = checks.filter((entry) => !entry.passed);
  return {
    schema: "chase-evaluation-validation-v1",
    status: failedChecks.length === 0 ? "pass" : "fail",
    evidenceDirectory,
    summary: {
      checks: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length,
    },
    captures: Object.fromEntries(
      Object.entries(captures).map(([name, capture]) => [name, compactCapture(capture)]),
    ),
    checks,
  };
}

function printUsage() {
  console.log("Usage: npm run play:chase:evaluation:validate -- --dir <capture-directory> [--out <report.json>]");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.directory) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    report = validateEvidenceDirectory(options.directory);
  } catch (error) {
    report = {
      schema: "chase-evaluation-validation-v1",
      status: "error",
      evidenceDirectory: path.normalize(String(options.directory)),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  await main();
}
