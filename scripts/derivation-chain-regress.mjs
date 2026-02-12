import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const UI_HTTP = process.env.UI_HTTP || "http://127.0.0.1:5050";
const UI_WS = process.env.UI_WS || "ws://127.0.0.1:5050/ws/control";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadPlugin(pluginPath) {
  const file = fs.readFileSync(pluginPath);
  const fd = new FormData();
  fd.append("file", new Blob([file]), path.basename(pluginPath));
  const res = await fetch(`${UI_HTTP}/api/derivations/plugins/upload`, {
    method: "POST",
    body: fd,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || `plugin upload failed (${res.status})`);
  }
  return payload;
}

function connectWs(role, options = {}) {
  const takeover = role === "frontend" ? Boolean(options.takeover) : false;
  const instanceId =
    role === "frontend"
      ? typeof options.instanceId === "string" && options.instanceId.trim().length > 0
        ? options.instanceId
        : `chain-regress-frontend-${Date.now()}`
      : undefined;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(UI_WS);
    const timeout = setTimeout(() => reject(new Error(`${role} ws connect timeout`)), 5000);
    ws.on("open", () => {
      ws.send(
        JSON.stringify(
          role === "frontend"
            ? { type: "register", role, takeover, instanceId }
            : { type: "register", role },
        ),
      );
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === "ack") {
          clearTimeout(timeout);
          resolve(ws);
        }
      } catch {
        // ignore
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function waitForCaptureEnd(map, captureId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (map.get(captureId)?.ended === true) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for capture_end: ${captureId}`);
}

function assertSeries(valuesByTick, expected, label) {
  Object.entries(expected).forEach(([tickText, expectedValue]) => {
    const tick = Number(tickText);
    const actual = valuesByTick.get(tick);
    if (actual !== expectedValue) {
      throw new Error(`${label} tick ${tick}: expected ${expectedValue}, got ${actual}`);
    }
  });
}

async function main() {
  const pluginPath = path.join(repoRoot, "examples", "derivation-plugins", "diff.mjs");
  const capturePath = path.join(repoRoot, "examples", "captures", "simple.jsonl");
  const baseCaptureId = `chain-base-${Date.now()}`;
  const stage1CaptureId = `chain-stage1-${Date.now()}`;
  const stage2CaptureId = `chain-stage2-${Date.now()}`;

  await uploadPlugin(pluginPath);

  const frontend = await connectWs("frontend", { takeover: true, instanceId: "derivation-chain-regress" });
  const agent = await connectWs("agent");

  const captures = new Map();
  const ensureCapture = (captureId) => {
    const existing = captures.get(captureId);
    if (existing) {
      return existing;
    }
    const created = { ticks: new Map(), ended: false };
    captures.set(captureId, created);
    return created;
  };

  frontend.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === "capture_append" && msg.captureId && msg.frame && typeof msg.frame.tick === "number") {
      const state = ensureCapture(msg.captureId);
      const tick = msg.frame.tick;
      const value = msg.frame?.value?.diff ?? msg.frame?.value?.moving_avg_3 ?? null;
      state.ticks.set(tick, value);
    }
    if (msg.type === "capture_end" && msg.captureId) {
      const state = ensureCapture(msg.captureId);
      state.ended = true;
    }
  });

  // Keep only deterministic captures for this regression.
  agent.send(JSON.stringify({ type: "clear_captures" }));

  agent.send(
    JSON.stringify({
      type: "capture_init",
      captureId: baseCaptureId,
      filename: "simple.jsonl",
      source: capturePath,
      reset: true,
    }),
  );

  const baseMetrics = [
    {
      captureId: baseCaptureId,
      path: ["0", "metrics", "a"],
      fullPath: "0.metrics.a",
      label: "a",
      color: "#111111",
    },
    {
      captureId: baseCaptureId,
      path: ["0", "metrics", "b"],
      fullPath: "0.metrics.b",
      label: "b",
      color: "#222222",
    },
  ];

  // Stage 1: plugin diff over raw capture.
  agent.send(
    JSON.stringify({
      type: "run_derivation_plugin",
      groupId: "chain-stage1",
      pluginId: "diff",
      outputCaptureId: stage1CaptureId,
      metrics: baseMetrics,
      request_id: "chain-stage1-run",
    }),
  );
  await waitForCaptureEnd(captures, stage1CaptureId);

  // Verify stage1 is source-backed via /api/series/batch.
  const seriesRes = await fetch(`${UI_HTTP}/api/series/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      captureId: stage1CaptureId,
      paths: [["0", "derivations", "diff"]],
      preferCache: false,
    }),
  });
  const seriesPayload = await seriesRes.json().catch(() => ({}));
  if (!seriesRes.ok) {
    throw new Error(seriesPayload?.error || `series request failed (${seriesRes.status})`);
  }
  const tickCount = Number(seriesPayload?.series?.[0]?.tickCount ?? 0);
  const lastTick = Number(seriesPayload?.series?.[0]?.lastTick ?? 0);
  if (tickCount !== 10 || lastTick !== 10) {
    throw new Error(`Stage1 series mismatch: tickCount=${tickCount}, lastTick=${lastTick}`);
  }

  const stage1Metric = [
    {
      captureId: stage1CaptureId,
      path: ["0", "derivations", "diff"],
      fullPath: "0.derivations.diff",
      label: "stage1.diff",
      color: "#44aa88",
    },
  ];

  // Stage 2: moving average over stage1 derived output.
  agent.send(
    JSON.stringify({
      type: "run_derivation",
      kind: "moving_average",
      groupId: "chain-stage2",
      outputCaptureId: stage2CaptureId,
      window: 3,
      inputIndex: 0,
      metrics: stage1Metric,
      request_id: "chain-stage2-run",
    }),
  );
  await waitForCaptureEnd(captures, stage2CaptureId);

  const stage1Values = captures.get(stage1CaptureId)?.ticks ?? new Map();
  const stage2Values = captures.get(stage2CaptureId)?.ticks ?? new Map();

  assertSeries(
    stage1Values,
    { 1: 1, 2: 2, 3: 3, 7: 7, 10: 10 },
    "stage1.diff",
  );
  assertSeries(
    stage2Values,
    { 1: 1, 2: 1.5, 3: 2, 4: 3, 8: 7, 10: 9 },
    "stage2.moving_avg_3",
  );

  frontend.close();
  agent.close();
  console.log("[derivation-chain-regress] PASS");
}

main().catch((error) => {
  console.error("[derivation-chain-regress] FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
