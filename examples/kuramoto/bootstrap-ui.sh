#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEC_TEMPLATE="$ROOT_DIR/examples/kuramoto/view-spec.json"
SIM_CAPTURE="${SIM_CAPTURE:-$ROOT_DIR/../examples/kuramoto/output/kuramoto_simulation.jsonl}"
EVAL_CAPTURE="${EVAL_CAPTURE:-$ROOT_DIR/../examples/kuramoto/output/kuramoto_evaluation.jsonl}"
UI_URL="${UI_URL:-ws://127.0.0.1:5050/ws/control}"
VERIFY_ONLY="${VERIFY_ONLY:-false}"

if [[ ! -f "$SPEC_TEMPLATE" ]]; then
  echo "[kuramoto-bootstrap] Missing template spec: $SPEC_TEMPLATE" >&2
  exit 1
fi

if [[ ! -f "$SIM_CAPTURE" ]]; then
  echo "[kuramoto-bootstrap] Missing simulation capture: $SIM_CAPTURE" >&2
  exit 1
fi

if [[ ! -f "$EVAL_CAPTURE" ]]; then
  echo "[kuramoto-bootstrap] Missing evaluation capture: $EVAL_CAPTURE" >&2
  exit 1
fi

TMP_SPEC_BASE="$(mktemp /tmp/kuramoto-view-spec.XXXXXX)"
TMP_SPEC="${TMP_SPEC_BASE}.json"
mv "$TMP_SPEC_BASE" "$TMP_SPEC"
trap 'rm -f "$TMP_SPEC"' EXIT

node - "$SPEC_TEMPLATE" "$TMP_SPEC" "$SIM_CAPTURE" "$EVAL_CAPTURE" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [templatePath, outPath, simPath, evalPath] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const captures = Array.isArray(spec.captures) ? spec.captures : [];
for (const capture of captures) {
  if (capture.id === "kuramoto-sim") capture.source = simPath;
  if (capture.id === "kuramoto-eval") capture.source = evalPath;
}
if (spec.visualization && typeof spec.visualization === "object" && spec.visualization.pluginFile) {
  const pluginPath = String(spec.visualization.pluginFile);
  spec.visualization.pluginFile = path.isAbsolute(pluginPath)
    ? pluginPath
    : path.resolve(path.dirname(templatePath), pluginPath);
}
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
NODE

echo "[kuramoto-bootstrap] bootstrapping using spec: $TMP_SPEC"
simeval ui bootstrap-verify \
  --spec "$TMP_SPEC" \
  --verify-only "$VERIFY_ONLY" \
  --ui "$UI_URL"
