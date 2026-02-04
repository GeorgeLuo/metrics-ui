#!/usr/bin/env bash
set -euo pipefail

UI_URL="${UI_URL:-ws://127.0.0.1:5050/ws/control}"
CAPTURE_ID="${CAPTURE_ID:-}"
EXPECTED_TICK="${EXPECTED_TICK:-}"
REQUIRE_METRICS="${REQUIRE_METRICS:-1}"
MIN_CHART_POINTS="${MIN_CHART_POINTS:-2}"
TIMEOUT_SEC="${TIMEOUT_SEC:-30}"
POLL_SEC="${POLL_SEC:-2}"

echo "[ui-regress] ui=${UI_URL} capture=${CAPTURE_ID:-<any>} expected_tick=${EXPECTED_TICK:-<any>}"

start_time="$(date +%s)"
last_error=""

while true; do
  snapshot_json="$(simeval ui display-snapshot --ui "${UI_URL}")"

  capture_tick="$(
    CAPTURE_ID="${CAPTURE_ID}" node -e '
      const fs = require("fs");
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      const captures = Array.isArray(data.captures) ? data.captures : [];
      const target = process.env.CAPTURE_ID || "";
      const capture = target ? captures.find((c) => c.id === target) : captures[0];
      if (!capture) process.exit(1);
      const tick = typeof capture.tickCount === "number" ? capture.tickCount : "";
      process.stdout.write(String(tick));
    ' <<<"${snapshot_json}"
  )" || {
    last_error="[ui-regress] FAIL: capture not found in display snapshot"
    capture_tick=""
  }

  if [[ -z "${capture_tick}" ]]; then
    last_error="[ui-regress] FAIL: missing tickCount in display snapshot"
  elif [[ "${capture_tick}" -le 0 ]]; then
    last_error="[ui-regress] FAIL: tickCount is ${capture_tick} (expected > 0)"
  elif [[ -n "${EXPECTED_TICK}" && "${capture_tick}" != "${EXPECTED_TICK}" ]]; then
    last_error="[ui-regress] FAIL: tickCount ${capture_tick} != expected ${EXPECTED_TICK}"
  else
    selected_total="$(
      node -e '
        const fs = require("fs");
        const data = JSON.parse(fs.readFileSync(0, "utf8"));
        const metrics = Array.isArray(data.selectedMetrics) ? data.selectedMetrics : [];
        process.stdout.write(String(metrics.length));
      ' <<<"${snapshot_json}"
    )"

    if [[ "${REQUIRE_METRICS}" != "0" && "${selected_total}" -le 0 ]]; then
      last_error="[ui-regress] FAIL: no selected metrics found"
    else
      mem_json="$(simeval ui memory-stats --ui "${UI_URL}")"
      chart_points="$(
        node -e '
          const fs = require("fs");
          const data = JSON.parse(fs.readFileSync(0, "utf8"));
          const points = data && data.chartData && typeof data.chartData.points === "number"
            ? data.chartData.points
            : 0;
          process.stdout.write(String(points));
        ' <<<"${mem_json}"
      )"
      if [[ "${REQUIRE_METRICS}" != "0" && "${chart_points}" -lt "${MIN_CHART_POINTS}" ]]; then
        last_error="[ui-regress] FAIL: chart points ${chart_points} (expected >= ${MIN_CHART_POINTS})"
      else
        echo "[ui-regress] PASS: tickCount=${capture_tick} selectedMetrics=${selected_total} chartPoints=${chart_points}"
        exit 0
      fi
    fi
  fi

  now="$(date +%s)"
  if (( now - start_time >= TIMEOUT_SEC )); then
    echo "${last_error}"
    exit 1
  fi
  sleep "${POLL_SEC}"
done
