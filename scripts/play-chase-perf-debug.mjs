import WebSocket from "ws";

const WS_URL = process.env.UI_WS || process.env.WS_URL || "ws://127.0.0.1:5050/ws/control";
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_WATCH_COUNT = 1;
const ACTION_IDS = Object.freeze({
  IDAE_DEBUG: "idae-debug",
  CHASER_VIEW: "chaser-view",
  EVADER_VIEW: "evader-view",
  SIMULATION_FPS: "simulation-fps",
});

function parseArgs(argv) {
  const args = {
    watch: false,
    count: DEFAULT_WATCH_COUNT,
    intervalMs: DEFAULT_INTERVAL_MS,
    json: false,
    settleMs: 750,
    actions: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") {
      args.watch = true;
      args.count = Number.POSITIVE_INFINITY;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--open-debug") {
      args.actions.push({ actionId: ACTION_IDS.IDAE_DEBUG, value: true });
    } else if (arg === "--close-debug") {
      args.actions.push({ actionId: ACTION_IDS.IDAE_DEBUG, value: false });
    } else if (arg === "--open-views") {
      args.actions.push({ actionId: ACTION_IDS.CHASER_VIEW, value: true });
      args.actions.push({ actionId: ACTION_IDS.EVADER_VIEW, value: true });
    } else if (arg === "--close-views") {
      args.actions.push({ actionId: ACTION_IDS.CHASER_VIEW, value: false });
      args.actions.push({ actionId: ACTION_IDS.EVADER_VIEW, value: false });
    } else if (arg === "--fps") {
      args.actions.push({ actionId: ACTION_IDS.SIMULATION_FPS, value: argv[index + 1] });
      index += 1;
    } else if (arg === "--settle-ms") {
      args.settleMs = Math.max(0, Number(argv[index + 1]) || 0);
      index += 1;
    } else if (arg === "--count") {
      args.count = Math.max(1, Number(argv[index + 1]) || DEFAULT_WATCH_COUNT);
      index += 1;
    } else if (arg === "--interval-ms") {
      args.intervalMs = Math.max(100, Number(argv[index + 1]) || DEFAULT_INTERVAL_MS);
      index += 1;
    }
  }

  return args;
}

function connectAgent() {
  const ws = new WebSocket(WS_URL);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out connecting to ${WS_URL}`));
    }, 5000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", role: "agent" }));
    });

    ws.on("message", (data) => {
      let parsed;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (parsed?.type === "ack" && typeof parsed?.payload === "string" && parsed.payload.includes("registered")) {
        clearTimeout(timeout);
        resolve(ws);
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function requestPlayAction(ws, { actionId, value }) {
  const requestId = `play-chase-action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ws.send(JSON.stringify({
    type: "play_game_action",
    request_id: requestId,
    actionId,
    value,
  }));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for play action ack: ${actionId}`));
    }, 5000);

    function onMessage(data) {
      let parsed;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (parsed?.request_id !== requestId) {
        return;
      }
      if (parsed?.type === "ack") {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(parsed);
        return;
      }
      if (parsed?.type === "error") {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        reject(new Error(parsed.error || `Play action failed: ${actionId}`));
      }
    }

    ws.on("message", onMessage);
  });
}

function requestUiDebug(ws) {
  const requestId = `play-chase-perf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ws.send(JSON.stringify({ type: "get_ui_debug", request_id: requestId }));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for ui_debug response."));
    }, 5000);

    function onMessage(data) {
      let parsed;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (parsed?.request_id !== requestId) {
        return;
      }
      clearTimeout(timeout);
      ws.off("message", onMessage);
      if (parsed?.type === "ui_debug") {
        resolve(parsed.payload);
      } else {
        reject(new Error(parsed?.error || "UI returned a non-debug response."));
      }
    }

    ws.on("message", onMessage);
  });
}

function getChasePerformance(debugPayload) {
  return debugPayload?.refs?.playChasePerformance ?? null;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}ms` : "n/a";
}

function rankSegments(latest) {
  return Object.entries(latest?.segments ?? {})
    .map(([name, value]) => ({ name, ms: Number(value) || 0 }))
    .sort((first, second) => second.ms - first.ms);
}

function diagnose(performanceSnapshot) {
  if (!performanceSnapshot) {
    return [
      "No chase performance snapshot is available. Open the Play app, select Chase, and let it run.",
    ];
  }

  const latest = performanceSnapshot.latest ?? {};
  const summary = performanceSnapshot.summary ?? {};
  const causes = performanceSnapshot.suspectedCauses ?? {};
  const messages = [];
  const totalP95 = summary.totalTick?.p95Ms ?? 0;
  const rafGapP95 = summary.rafGap?.p95Ms ?? 0;
  const stepP95 = summary.simulationStep?.p95Ms ?? 0;
  const catchupCount = summary.catchupTickCount ?? 0;
  const topSegment = latest.topSegment ?? rankSegments(latest)[0] ?? null;

  if (catchupCount > 0 || (causes.catchup ?? 0) > 0) {
    messages.push("Catch-up stepping is occurring: the loop sometimes advances multiple simulation frames before one paint.");
  }
  if (rafGapP95 > 24) {
    messages.push("RAF gaps are high: the browser/main thread is not calling the game loop consistently.");
  }
  if (stepP95 > 8) {
    messages.push("Simulation/IDAE step time is high enough to contribute directly.");
  }
  if (totalP95 > 16.7 && topSegment?.name) {
    messages.push(`Total tick p95 exceeds a 60Hz visual budget; latest largest segment is ${topSegment.name}.`);
  }
  if (messages.length === 0) {
    messages.push("No obvious stutter source in the current sample window.");
  }
  return messages;
}

function printHuman(performanceSnapshot) {
  if (!performanceSnapshot) {
    console.log("No chase performance snapshot found.");
    console.log("Open the UI, select Play -> Chase, and keep the tab active.");
    return;
  }

  const latest = performanceSnapshot.latest ?? {};
  const summary = performanceSnapshot.summary ?? {};
  const causes = performanceSnapshot.suspectedCauses ?? {};
  const rankedSegments = rankSegments(latest).slice(0, 5);

  console.log(`[play-chase-perf] ${performanceSnapshot.generatedAt}`);
  console.log(`samples=${performanceSnapshot.sampleCount} threshold=${performanceSnapshot.slowFrameThresholdMs}ms`);
  console.log(
    `latest frame=${latest.frameIndex ?? "n/a"} total=${formatMs(latest.totalTickMs)} `
      + `rafGap=${formatMs(latest.elapsedMs)} steps=${latest.stepsThisTick ?? "n/a"} `
      + `step=${formatMs(latest.stepMs)}`,
  );
  console.log(
    `p95 total=${formatMs(summary.totalTick?.p95Ms)} rafGap=${formatMs(summary.rafGap?.p95Ms)} `
      + `step=${formatMs(summary.simulationStep?.p95Ms)} render=${formatMs(summary.mainRender?.p95Ms)} `
      + `debug=${formatMs(summary.idaeDebug?.p95Ms)} sidebar=${formatMs(summary.sidebar?.p95Ms)}`,
  );
  console.log(
    `counts catchup=${summary.catchupTickCount ?? 0} overVisual=${summary.overVisualBudgetCount ?? 0} `
      + `slowTick=${causes.slowTick ?? 0} rafGap=${causes.rafGap ?? 0}`,
  );
  console.log(`latest top segments: ${rankedSegments.map((entry) => `${entry.name}=${formatMs(entry.ms)}`).join(", ") || "none"}`);
  console.log("diagnosis:");
  for (const message of diagnose(performanceSnapshot)) {
    console.log(`- ${message}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ws = await connectAgent();
  try {
    for (const action of args.actions) {
      await requestPlayAction(ws, action);
    }
    if (args.actions.length > 0 && args.settleMs > 0) {
      await wait(args.settleMs);
    }

    let iteration = 0;
    while (iteration < args.count) {
      const debug = await requestUiDebug(ws);
      const performanceSnapshot = getChasePerformance(debug);
      if (args.json) {
        console.log(JSON.stringify({
          ws: WS_URL,
          performance: performanceSnapshot,
          diagnosis: diagnose(performanceSnapshot),
        }, null, 2));
      } else {
        printHuman(performanceSnapshot);
      }
      iteration += 1;
      if (iteration < args.count) {
        await wait(args.intervalMs);
      }
    }
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  console.error(`[play-chase-perf] ${error?.stack || String(error)}`);
  process.exit(1);
});
