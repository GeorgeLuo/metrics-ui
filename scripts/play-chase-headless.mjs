import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = "examples/play/chase/config/headless/chaser-depth-obstacles-rc-indoor.json";
const DEFAULT_PORT = 5064;
const READY_TIMEOUT_MS = 30_000;
const PLAYBACK_ACTION_ID = "simulation-pause-before-actions";
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

export function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, config: DEFAULT_CONFIG, chrome: process.env.CHROME_PATH || null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--port", "--config", "--chrome"].includes(flag)) throw new Error(`Unknown option ${flag}`);
    if (!value) throw new Error(`${flag} needs a value`);
    options[flag.slice(2)] = flag === "--port" ? Number(value) : value;
    index += 1;
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("--port must be a TCP port number");
  }
  return options;
}

export function readHeadlessConfig(file) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Config must be a JSON object");
  if (typeof config.scenario !== "string" || !config.scenario) throw new Error("Config needs a scenario id");
  const settings = config.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Config settings must be an object of left-pane action ids");
  }
  return { scenario: config.scenario, controlSource: config.controlSource ?? "ws", settings };
}

export function buildHeadlessUrl(port, config) {
  const params = new URLSearchParams({
    playScenario: config.scenario,
    playControl: config.controlSource,
    playHeadless: "1",
    playSettings: JSON.stringify(config.settings),
  });
  return `http://127.0.0.1:${port}/?${params}`;
}

/** Rows of `playSidebarSections` by action id; fields carry `value`, toggles carry `enabled`. */
export function collectPaneRows(sections) {
  const rows = new Map();
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && ("value" in node || "enabled" in node) && !rows.has(node.id)) {
      rows.set(node.id, node);
    }
    Object.values(node).forEach(visit);
  };
  visit(sections);
  return rows;
}

function matchesPaneValue(expected, row) {
  if (typeof expected === "boolean") return row.enabled === expected;
  const shown = String(row.value ?? "");
  if (typeof expected === "number") {
    // The pane rounds numbers for display; its decimals set the comparison resolution.
    const decimals = (shown.split(".")[1] ?? "").length;
    return shown.trim() !== "" && Math.abs(Number(shown) - expected) <= 0.5 * 10 ** -decimals + 1e-12;
  }
  return shown === String(expected);
}

/** Config entries the left pane does not show as configured. */
export function comparePane(config, sections) {
  const rows = collectPaneRows(sections);
  const expected = [
    ["scenario-select", config.scenario],
    ["chaser-control-source", config.controlSource],
    ...Object.entries(config.settings),
  ];
  return expected.flatMap(([id, value]) => {
    const row = rows.get(id);
    if (!row) return [{ id, expected: value, actual: "(not in left pane)" }];
    return matchesPaneValue(value, row) ? [] : [{ id, expected: value, actual: "enabled" in row ? row.enabled : row.value }];
  });
}

function findChrome(explicit) {
  const candidates = explicit ? [explicit] : CHROME_CANDIDATES;
  const searchPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    const resolved = candidate.includes(path.sep)
      ? [candidate]
      : searchPath.map((directory) => path.join(directory, candidate));
    const found = resolved.find((file) => fs.existsSync(file));
    if (found) return found;
  }
  throw new Error(explicit ? `Chrome not found at ${explicit}` : "Chrome not found; pass --chrome or set CHROME_PATH");
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

class ControlClient {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.waiters = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    const registered = new Promise((resolve, reject) => {
      const onMessage = (data) => {
        const message = JSON.parse(String(data));
        if (message.type === "ack" && message.payload === "registered as agent") {
          this.ws.off("message", onMessage);
          resolve();
        } else if (message.type === "error") {
          reject(new Error(message.error ?? "registration failed"));
        }
      };
      this.ws.on("message", onMessage);
    });
    this.ws.send(JSON.stringify({ type: "register", role: "agent" }));
    await registered;
    this.ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      const waiter = this.waiters.get(message.request_id);
      if (!waiter || (message.type !== waiter.responseType && message.type !== "error")) return;
      this.waiters.delete(message.request_id);
      if (message.type === "error") waiter.reject(new Error(message.error ?? "request failed"));
      else waiter.resolve(message.payload);
    });
  }

  request(type, responseType, timeoutMs = 5000) {
    const requestId = `headless-${type}-${this.nextId += 1}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        reject(new Error(`Timed out waiting for ${responseType}`));
      }, timeoutMs);
      this.waiters.set(requestId, {
        responseType,
        resolve: (payload) => { clearTimeout(timer); resolve(payload); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ type, request_id: requestId }));
    });
  }

  close() {
    this.ws?.close();
  }
}

async function waitForHttp(url, deadline, isAlive) {
  while (Date.now() < deadline && isAlive()) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Server did not answer at ${url}`);
}

async function waitForConfiguredPane(client, config, deadline) {
  let mismatches = [{ id: "playSidebarSections", expected: "published", actual: "(none yet)" }];
  while (Date.now() < deadline) {
    try {
      const state = await client.request("get_state", "state_update");
      if (state?.playSidebarSections) {
        mismatches = comparePane(config, state.playSidebarSections);
        if (mismatches.length === 0) return collectPaneRows(state.playSidebarSections);
      }
    } catch {
      // The headless page has not registered yet.
    }
    await delay(500);
  }
  const lines = mismatches.map(({ id, expected, actual }) => `  ${id}: expected ${JSON.stringify(expected)}, pane shows ${JSON.stringify(actual)}`);
  throw new Error(`Left pane does not match the config:\n${lines.join("\n")}`);
}

async function measureFrameRate(client) {
  const before = await client.request("get_play_debug", "play_debug");
  const startedMs = Date.now();
  await delay(1000);
  const after = await client.request("get_play_debug", "play_debug");
  return (Number(after?.frameIndex) - Number(before?.frameIndex)) / ((Date.now() - startedMs) / 1000);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configFile = path.resolve(REPO_ROOT, options.config);
  const config = readHeadlessConfig(configFile);
  const chromePath = findChrome(options.chrome);
  if (await isPortInUse(options.port)) {
    throw new Error(`Port ${options.port} is in use. The server accepts one frontend, so the headless page needs its own server port.`);
  }

  const children = [];
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "chase-headless-"));
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    children.forEach((child) => { if (child.exitCode === null) child.kill("SIGTERM"); });
    fs.rmSync(profileDirectory, { recursive: true, force: true });
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  const startChild = (name, command, args, spawnOptions) => {
    const child = spawn(command, args, spawnOptions);
    child.on("exit", (code, signal) => {
      if (stopping) return;
      console.error(`[headless] ${name} exited (${signal ?? code}); stopping`);
      stop(1);
    });
    children.push(child);
    return child;
  };

  const serverUrl = `http://127.0.0.1:${options.port}/`;
  const wsUrl = `ws://127.0.0.1:${options.port}/ws/control`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  try {
    const server = startChild("server", path.join(REPO_ROOT, "node_modules/.bin/tsx"), ["server/index.ts"], {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(options.port), NODE_ENV: "development" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    await waitForHttp(serverUrl, deadline, () => server.exitCode === null);
    startChild("chrome", chromePath, [
      "--headless=new",
      `--user-data-dir=${profileDirectory}`,
      "--window-size=1280,800",
      "--no-first-run",
      "--no-default-browser-check",
      buildHeadlessUrl(options.port, config),
    ], { stdio: "ignore" });

    const client = new ControlClient(wsUrl);
    await client.connect();
    const rows = await waitForConfiguredPane(client, config, deadline);
    const playing = rows.get(PLAYBACK_ACTION_ID)?.enabled === true;
    const framesPerSecond = playing ? await measureFrameRate(client) : 0;
    client.close();
    if (playing && !(framesPerSecond > 0)) throw new Error("Playback is on but the simulation is not advancing frames");

    console.log(`[headless] Chase simulator ready (config ${path.relative(REPO_ROOT, configFile)})`);
    for (const [id, row] of rows) {
      if (id === "scenario-select" || id === "chaser-control-source" || id in config.settings) {
        console.log(`  ${id} = ${"enabled" in row ? row.enabled : row.value}`);
      }
    }
    console.log(playing ? `  simulation ${framesPerSecond.toFixed(1)} frames/s` : "  simulation paused (Playback off)");
    console.log(`CHASE_UI_WS_URL=${wsUrl}`);
  } catch (error) {
    console.error(`[headless] ${error instanceof Error ? error.message : String(error)}`);
    stop(1);
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  await main().catch((error) => {
    console.error(`[headless] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
