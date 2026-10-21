import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildHeadlessUrl,
  comparePane,
  parseArgs,
  readHeadlessConfig,
} from "./play-chase-headless.mjs";
import { readExperimentStartup } from "../examples/play/chase/evaluation/experiment-startup.mjs";
import { createChaseSimulationState } from "../examples/play/chase/simulation/simulation.mjs";
import { setChaserControlSource } from "../examples/play/chase/simulation/chaser-control-source.mjs";
import { createChaseScenarioSession } from "../examples/play/chase/ui/scenario-session.mjs";
import { applySidebarSettings } from "../examples/play/chase/ui/sidebar-actions.mjs";
import { publishSidebarSections } from "../examples/play/chase/ui/sidebar.mjs";
import { getActorActionProposalCollections } from "../examples/play/chase/ui/action-proposal-overrides.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILE = path.join(REPO_ROOT, "examples/play/chase/config/headless/chaser-depth-obstacles-rc-indoor.json");

/** Start a game the way the headless page does and return the left pane it publishes. */
function publishStartupPane(config) {
  const startup = readExperimentStartup(new URL(buildHeadlessUrl(5064, config)).search);
  const session = createChaseScenarioSession({ columns: 9, rows: 8 });
  let scenario = session.loadScenario(startup.scenarioId);
  const state = createChaseSimulationState({ scenario, columns: 9, rows: 8 });
  setChaserControlSource(state, startup.controlSource);
  state.simulationSettings.pauseBeforeActions = true;
  const setRendering = (next) => {
    scenario = next;
    state.scenario = scenario;
    state.renderingProfile = scenario.rendering;
  };
  applySidebarSettings({
    simulationSettings: state.simulationSettings,
    vehicleSettings: state.vehicleSettings,
    refreshSidebarSections() {},
    updateFieldOfView() {},
    setRenderingProfile: (id) => setRendering(session.setRenderingProfile(id)),
    setRenderingSeed: (seed) => setRendering(session.setRenderingSeed(seed)),
  }, startup.settings ?? []);
  let sections = null;
  publishSidebarSections(
    (next) => { sections = next; },
    state.chaserControlSource,
    {},
    state.simulationSettings,
    state.vehicleSettings,
    state.projectionSettings,
    getActorActionProposalCollections(state),
    state.runMetrics,
    session.getSidebarControls(state),
  );
  return { startup, sections };
}

test("options default to the shipped config on port 5064 and reject unknown flags", () => {
  assert.equal(parseArgs([]).port, 5064);
  assert.match(parseArgs([]).config, /chaser-depth-obstacles-rc-indoor\.json$/);
  assert.equal(parseArgs(["--port", "5070"]).port, 5070);
  assert.throws(() => parseArgs(["--port", "web"]));
  assert.throws(() => parseArgs(["--headful"]));
  assert.throws(() => parseArgs(["--config"]));
});

test("the headless URL carries the config into the page startup unchanged", () => {
  const config = readHeadlessConfig(CONFIG_FILE);
  const startup = readExperimentStartup(new URL(buildHeadlessUrl(5064, config)).search);
  assert.equal(startup.scenarioId, "chaser-depth-obstacles");
  assert.equal(startup.controlSource, "ws");
  assert.equal(startup.headless, true);
  assert.deepEqual(startup.settings, Object.entries(config.settings));
});

test("the shipped config produces a left pane that matches it, with Playback on", () => {
  const config = readHeadlessConfig(CONFIG_FILE);
  const { sections } = publishStartupPane(config);
  assert.deepEqual(comparePane(config, sections), []);
});

test("the pane comparison flags clamped values and settings the pane does not show", () => {
  const config = readHeadlessConfig(CONFIG_FILE);
  const clamped = { ...config, settings: { ...config.settings, "vehicle-fov": 200 } };
  assert.deepEqual(comparePane(clamped, publishStartupPane(clamped).sections), [
    { id: "vehicle-fov", expected: 200, actual: "140" },
  ]);
  const paused = { ...config, settings: { ...config.settings, "simulation-pause-before-actions": false } };
  assert.deepEqual(comparePane(config, publishStartupPane(paused).sections), [
    { id: "simulation-pause-before-actions", expected: true, actual: false },
  ]);
  const { sections } = publishStartupPane(config);
  assert.deepEqual(comparePane({ ...config, settings: { "no-such-setting": 1 } }, sections), [
    { id: "no-such-setting", expected: 1, actual: "(not in left pane)" },
  ]);
});
