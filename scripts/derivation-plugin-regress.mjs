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

async function fetchPluginSource(pluginId) {
  const res = await fetch(`${UI_HTTP}/api/derivations/plugins/${encodeURIComponent(pluginId)}/source`);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || `plugin source fetch failed (${res.status})`);
  }
  return payload;
}

function connectWs(role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(UI_WS);
    const timeout = setTimeout(() => reject(new Error(`${role} ws connect timeout`)), 5000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", role }));
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

async function main() {
  const pluginPath = path.join(repoRoot, "examples", "derivation-plugins", "diff.mjs");
  const capturePath = path.join(repoRoot, "examples", "captures", "simple.jsonl");
  const captureId = "test";
  const groupId = "g1";
  const outputCaptureId = `derive-test-${Date.now()}`;

  await uploadPlugin(pluginPath);
  const sourcePayload = await fetchPluginSource("diff");
  if (typeof sourcePayload?.source !== "string" || !sourcePayload.source.includes('id: "diff"')) {
    throw new Error("Plugin source endpoint did not return expected contents.");
  }

  const frontend = await connectWs("frontend");
  const agent = await connectWs("agent");

  const derived = {
    captureId: outputCaptureId,
    ticks: new Map(),
    ended: false,
  };

  frontend.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (
      msg.type === "capture_append"
      && derived.captureId
      && msg.captureId === derived.captureId
      && msg.frame
      && typeof msg.frame.tick === "number"
    ) {
      const tick = msg.frame.tick;
      const value = msg.frame.value?.diff ?? null;
      derived.ticks.set(tick, value);
    }
    if (msg.type === "capture_end" && derived.captureId && msg.captureId === derived.captureId) {
      derived.ended = true;
    }
  });

  // Register a capture source path on the server (server-side captureSources is updated for agent commands).
  agent.send(
    JSON.stringify({
      type: "capture_init",
      captureId,
      filename: "simple.jsonl",
      source: capturePath,
      reset: true,
    }),
  );

  // Publish a minimal state with a derivation group.
  frontend.send(
    JSON.stringify({
      type: "state_update",
      payload: {
        captures: [{ id: captureId, filename: "simple.jsonl", tickCount: 10, isActive: true }],
        selectedMetrics: [],
        analysisMetrics: [],
        derivationGroups: [
          {
            id: groupId,
            name: groupId,
            metrics: [
              {
                captureId,
                path: ["0", "metrics", "a"],
                fullPath: "0.metrics.a",
                label: "a",
                color: "#000000",
              },
              {
                captureId,
                path: ["0", "metrics", "b"],
                fullPath: "0.metrics.b",
                label: "b",
                color: "#000000",
              },
            ],
          },
        ],
        activeDerivationGroupId: groupId,
        displayDerivationGroupId: "",
        playback: { isPlaying: false, currentTick: 1, speed: 1, totalTicks: 10 },
        windowSize: 10,
        windowStart: 1,
        windowEnd: 10,
        autoScroll: true,
        isFullscreen: false,
        viewport: { width: 0, height: 0, chartWidth: 0, chartHeight: 0, devicePixelRatio: 1 },
        annotations: [],
        subtitles: [],
      },
    }),
  );

  agent.send(
    JSON.stringify({
      type: "run_derivation_plugin",
      groupId,
      pluginId: "diff",
      outputCaptureId,
      request_id: "run-1",
    }),
  );

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (derived.ended) {
      break;
    }
    await sleep(100);
  }

  if (!derived.ended) {
    throw new Error("Derived capture did not end within timeout.");
  }

  for (let tick = 1; tick <= 10; tick += 1) {
    const value = derived.ticks.get(tick);
    if (value !== tick) {
      throw new Error(`Tick ${tick}: expected diff=${tick}, got ${value}`);
    }
  }

  frontend.close();
  agent.close();
  console.log("[derivation-plugin-regress] PASS");
}

main().catch((error) => {
  console.error("[derivation-plugin-regress] FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
