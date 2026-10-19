import test from "node:test";
import assert from "node:assert/strict";
import { createChaseSimulationState, stepChaseSimulation } from "./simulation/simulation.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import { getChaseScenarioDefinition } from "./scenarios/index.mjs";
import { createChaseEvaluationTrace } from "./evaluation/evaluation-trace.mjs";
import { createExperimentSession } from "./evaluation/experiment-session.mjs";
import { createExperimentEvidence } from "./evaluation/experiment-evidence.mjs";
import { readExperimentStartup } from "./evaluation/experiment-startup.mjs";
import { createChaseLoop } from "./ui/chase-loop.mjs";
import { sendPlayAck } from "../../../client/src/hooks/ws/handlers/play-experiment-ack.ts";
import { handleQueryCommand } from "../../../client/src/hooks/ws/handlers/query.ts";

const neutral = { source: "ws", forward: false, reverse: false, steering: 0 };
function fixture() {
  const state = createChaseSimulationState({ columns: 9, rows: 6, scenario: resolveChaseScenario(getChaseScenarioDefinition("wall-escape"), { columns: 9, rows: 6 }) });
  const settings = state.simulationSettings;
  settings.pauseBeforeActions = true;
  const trace = createChaseEvaluationTrace({ getState: () => state, getSimulationEpoch: () => "epoch1", nowUs: () => state.frameIndex * 1000 });
  trace.configure({ enabled: true, maxFrames: 20001 });
  let latch = { ...neutral };
  const tracker = { getChaserInput: () => ({ ...latch }) };
  const session = createExperimentSession({ state, settings, inputTracker: tracker, getEpoch: () => "epoch1", frontendInstanceId: "tab1", buildIdentity: { digest: "digest" }, trace, resetTiming() {} });
  return { state, settings, trace, session, tracker, setLatch(value) { latch = value; } };
}
const request = { expectedSimulationEpoch: "epoch1", expectedFrameIndex: 0, expectedFrontendInstanceId: "tab1", frames: 3 };

test("explicit selected-scenario entry is inert and rejects typos before game creation", () => {
  assert.equal(readExperimentStartup(""), null);
  assert.deepEqual(readExperimentStartup("?playScenario=wall-escape"), { scenarioId: "wall-escape", controlSource: "ws", paused: true });
  assert.throws(() => readExperimentStartup("?playScenario=typo"));
  assert.throws(() => readExperimentStartup("?playScenario=wall-escape&playPaused=0"));
  assert.throws(() => readExperimentStartup("?playScenario=wall-escape&playControl=bad"));
});

test("read-only experiment state separates live latch, frozen pending action and last commit", () => {
  const f = fixture();
  stepChaseSimulation(f.state, { humanInput: { ...neutral, forward: true, steering: .85 } });
  stepChaseSimulation(f.state, { humanInput: { ...neutral, reverse: true }, pauseBeforeActions: true });
  const snapshot = f.session.snapshot();
  assert.equal(snapshot.currentInput.forward, false);
  assert.equal(snapshot.pendingAction.input.reverse, true);
  assert.equal(snapshot.lastCommittedAction.input.forward, true);
  assert.equal(snapshot.lastCommittedAction.phase, "after-actions");
  snapshot.currentInput.forward = true;
  snapshot.lastCommittedAction.input.forward = false;
  assert.equal(f.session.snapshot().currentInput.forward, false);
  assert.equal(f.session.snapshot().lastCommittedAction.input.forward, true);
  assert.equal(f.state.frameIndex, 1);
});

test("advance refuses wrong frontend, epoch, frame, running game and insufficient trace without effects", () => {
  for (const mutation of [{ expectedSimulationEpoch: "wrong" }, { expectedFrameIndex: 1 }, { expectedFrontendInstanceId: "other" }, { frames: 0 }, { frames: 20001 }]) {
    const f = fixture();
    assert.throws(() => f.session.advance({ ...request, ...mutation }));
    assert.equal(f.settings.pauseBeforeActions, true);
    assert.equal(f.state.frameIndex, 0);
  }
  const f = fixture();
  f.trace.configure({ enabled: true, maxFrames: 2 });
  assert.throws(() => f.session.advance(request));
  f.settings.pauseBeforeActions = false;
  assert.throws(() => f.session.advance(request));
});

test("exact-N budget stops inside a multi-step RAF tick with no polling overrun", () => {
  const f = fixture();
  let tick, now = 0;
  const previousWindow = globalThis.window, previousPerformance = globalThis.performance;
  globalThis.window = { requestAnimationFrame(fn) { tick = fn; return 1; }, cancelAnimationFrame() {} };
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
  try {
    const loop = createChaseLoop({ simulationState: f.state, simulationSettings: f.settings, inputTracker: f.tracker,
      sceneView: { renderFrame: () => ({ visibility: {}, timings: {} }) },
      performanceTracker: { getSnapshot: () => ({}), recordTick() {} },
      getProjectionSettings: () => ({}), getPredictionDebugState: () => ({}), getActionPathDebugSettings: () => ({}), getMapKnowledgeDebugSettings: () => ({}), getVisibility: () => ({}),
      afterCommit: () => f.session.afterCommit() });
    f.session.advance(request);
    tick(); now = 200; tick();
    assert.equal(f.state.frameIndex, 3);
    assert.equal(f.settings.pauseBeforeActions, true);
    assert.equal(f.session.snapshot().advancement.status, "complete");
    now = 400; tick(); now = 600; tick();
    assert.equal(f.state.frameIndex, 3);
    assert.deepEqual(f.trace.snapshot().frames.map((x) => x.frameIndex), [0, 1, 2, 3]);
    assert.equal(f.session.result().trace.currentFrameIndex, 3);
    assert.equal(f.session.result().state.paused, true);
    f.session.beginRun();
    assert.equal(f.session.result(), null);
    loop.dispose();
  } finally {
    globalThis.window = previousWindow;
    Object.defineProperty(globalThis, "performance", { configurable: true, value: previousPerformance });
  }
});

test("advance preserves pending action semantics and explicit cancellation pauses", () => {
  const f = fixture();
  stepChaseSimulation(f.state, { humanInput: { ...neutral, forward: true }, pauseBeforeActions: true });
  f.session.advance({ ...request, frames: 1 });
  stepChaseSimulation(f.state, { humanInput: neutral }); f.session.afterCommit();
  assert.equal(f.state.lastCommittedActionFrame.chaserInput.forward, true);
  assert.equal(f.session.snapshot().advancement.status, "complete");
  f.session.advance({ ...request, expectedFrameIndex: 1, frames: 2 });
  f.session.cancel();
  assert.equal(f.settings.pauseBeforeActions, true);
  assert.equal(f.session.snapshot().advancement.status, "interrupted");
});

test("shared evidence freezes original camera payload and separates baseline, suffix and clock domains", async () => {
  const f = fixture();
  const evidence = createExperimentEvidence({ getState: f.session.snapshot, trace: f.trace, maxCameraRecords: 1 });
  const capture = { captureId: "camera0", frameIdentity: { simulationEpoch: "epoch1", frameIndex: 0 }, sensor: { image: { dataUrl: "data:image/jpeg;base64,YWJj" } } };
  evidence.recordCamera(capture, { captureStartedAtUs: 1, capturedAtUs: 2 });
  capture.captureId = "changed";
  evidence.recordReceipt({ receipt: { type: "ack", request_id: "r1", payload: { identity: f.session.identity() } } });
  evidence.recordCamera(capture, {});
  stepChaseSimulation(f.state, { humanInput: neutral });
  const exported = await evidence.export({ expectedSimulationEpoch: "epoch1" });
  assert.equal(exported.baseline.frameIndex, 0);
  assert.deepEqual(exported.suffix.frames.map((x) => x.frameIndex), [1]);
  assert.equal(exported.cameraRecords[0].response.captureId, "camera0");
  assert.equal(exported.cameraRecords[0].imageSha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(exported.droppedCameraRecords, 1);
  assert.equal(exported.clockDomains.mappingVerified, false);
  assert.equal(exported.commandReceipts[0].receipt.request_id, "r1");
  await assert.rejects(evidence.export({ expectedSimulationEpoch: "other" }));
  evidence.beginRun();
  assert.equal((await evidence.export()).cameraRecords.length, 0);
});

test("frontend ack binds responding instance/build/epoch/frame; legacy game ack remains compatible", () => {
  const f = fixture(), sent = [], legacy = [];
  const context = { onPlayGameQuery: () => f.session.snapshot(), sendMessage: (m) => { sent.push(m); return true; }, sendAck: (...args) => legacy.push(args) };
  sendPlayAck(context, "r1", { type: "play_game_command", commandId: "set-chaser-input" });
  assert.deepEqual(sent[0].payload.identity, f.session.identity());
  assert.equal(sent[0].request_id, "r1");
  assert.equal(legacy.length, 0);
  context.onPlayGameQuery = () => undefined;
  sendPlayAck(context, "r2", { type: "play_game_command" });
  assert.equal(legacy.length, 1);
});

test("async evidence query returns its original request identity and structured errors", async () => {
  const sent = [], errors = [];
  const context = { onPlayGameQuery: ({ queryId }) => queryId === "experiment-state" ? fixture().session.snapshot() : Promise.resolve({ schema: "bundle" }), sendMessage: (m) => { sent.push(m); return true; }, sendError: (...a) => errors.push(a), sendAck() {} };
  handleQueryCommand({ type: "play_game_query", queryId: "experiment-evidence" }, "q1", context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[0].request_id, "q1"); assert.equal(sent[0].payload.result.schema, "bundle");
  assert.equal(sent[1].payload.identity.frontendInstanceId, "tab1");
  context.onPlayGameQuery = () => Promise.reject(new Error("bad epoch"));
  handleQueryCommand({ type: "play_game_query", queryId: "experiment-evidence" }, "q2", context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
});

test("prepare transaction validates before effects and selects neutral paused scene before trace baseline", async () => {
  const { prepareChaseExperiment } = await import("./evaluation/experiment-prepare.mjs");
  const events = [];
  const handlers = { pause: () => events.push("pause"), neutralize: () => events.push("neutral"), replace: (options) => events.push(options), configureTrace: (config) => events.push(config) };
  assert.throws(() => prepareChaseExperiment({ scenarioId: "typo" }, handlers));
  assert.throws(() => prepareChaseExperiment({ scenarioId: "wall-escape", maxFrames: 1 }, handlers));
  assert.deepEqual(events, []);
  prepareChaseExperiment({ scenarioId: "wall-escape" }, handlers);
  assert.deepEqual(events, ["pause", "neutral", { scenarioId: "wall-escape", controlSource: "ws", paused: true }, { enabled: true, maxFrames: 20001 }]);
});


test("prepare-experiment preserves selected camera rendering through the real game command", async () => {
  const { createPlayGame } = await import("./ui/runtime.mjs");
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  globalThis.document = { createElement: () => ({ style: {}, remove() {} }) };
  try {
    for (const profile of ["rc-indoor", "randomized"]) {
      const actions = new Map();
      let snapshot, cameraProfile;
      const game = createPlayGame({ container: { appendChild() {} }, columns: 9, rows: 6,
        setSidebarActionHandler: (id, handler) => actions.set(id, handler),
        setDebugSnapshot: (value) => { snapshot = value; },
        createSceneView: ({ simulationState }) => ({
          updateRenderingProfile() { cameraProfile = simulationState.renderingProfile; },
          updateFieldOfView() {}, resize() {}, dispose() {},
        }),
      });
      try {
        actions.get("rendering-profile")(profile);
        actions.get("rendering-seed")(17);
        game.handleCommand({ commandId: "set-chaser-input", payload: { forward: true, steering: .8 } });
        const selected = structuredClone(snapshot.world.renderingProfile);
        const beforeInvalid = game.handleQuery({ queryId: "experiment-state" });
        assert.throws(() => game.handleCommand({ commandId: "prepare-experiment", payload: { scenarioId: "typo" } }));
        assert.deepEqual(game.handleQuery({ queryId: "experiment-state" }), beforeInvalid);
        game.handleCommand({ commandId: "prepare-experiment", payload: { scenarioId: "wall-escape" } });
        const prepared = game.handleQuery({ queryId: "experiment-state" });
        assert.equal(prepared.scenarioId, "wall-escape");
        assert.equal(prepared.paused, true);
        assert.equal(prepared.frameIndex, 0);
        assert.equal(prepared.currentInput.forward, false);
        assert.equal(prepared.currentInput.steering, 0);
        assert.deepEqual(snapshot.world.renderingProfile, selected);
        assert.deepEqual(cameraProfile, selected);
        const trace = game.handleQuery({ queryId: "evaluation-trace" });
        assert.equal(trace.enabled, true);
        assert.equal(trace.frames[0].frameIndex, 0);
        // The session override also survives the next reset.
        actions.get("simulation-reset")();
        assert.deepEqual(snapshot.world.renderingProfile, selected);
      } finally { game.dispose(); }
    }
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test("an export completing after preparation keeps its old ack outside the new run's receipts", async (t) => {
  const { createPlayGame } = await import("./ui/runtime.mjs");
  const originalGlobals = { window: globalThis.window, document: globalThis.document,
    addEventListener: globalThis.addEventListener, removeEventListener: globalThis.removeEventListener };
  const events = new EventTarget();
  globalThis.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}, dispatchEvent: events.dispatchEvent.bind(events) };
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.document = { createElement: () => ({ style: {}, remove() {} }) };
  let game;
  try {
    game = createPlayGame({ frontendInstanceId: "tab1", container: { appendChild() {} }, columns: 9, rows: 6,
      createSceneView: () => ({ updateRenderingProfile() {}, updateFieldOfView() {}, resize() {}, dispose() {},
        captureActorView: () => ({ contentType: "image/png", rendererId: "test", width: 320, height: 240, dataUrl: "data:image/png;base64,YWJj" }),
      }),
    });
    const prepare = () => game.handleCommand({ commandId: "prepare-experiment", payload: { scenarioId: "wall-escape" } });
    prepare();
    const oldIdentity = game.handleQuery({ queryId: "experiment-state" }).identity;
    const capture = game.handleQuery({ queryId: "atomic-evaluation-capture" });
    assert.equal(capture.passiveObservation.supported, true);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let finishHash, started;
    const hashingStarted = new Promise((resolve) => { started = resolve; });
    t.mock.method(crypto.subtle, "digest", (...args) => {
      const hash = digest(...args);
      return new Promise((resolve, reject) => {
        finishHash = () => hash.then(resolve, reject);
        started();
      });
    });
    let finishAck;
    const acknowledged = new Promise((resolve) => { finishAck = resolve; });
    const sent = [];
    const context = { onPlayGameQuery: game.handleQuery,
      sendMessage(message) { sent.push(message); if (message.type === "ack" && message.request_id === "old-export") finishAck(); return true; },
      sendAck() { assert.fail("Expected identity-bound acknowledgment"); }, sendError(...args) { assert.fail(JSON.stringify(args)); },
    };
    handleQueryCommand({ type: "play_game_query", queryId: "experiment-evidence", payload: { expectedSimulationEpoch: oldIdentity.simulationEpoch } }, "old-export", context);
    await hashingStarted;
    prepare();
    const currentIdentity = game.handleQuery({ queryId: "experiment-state" }).identity;
    assert.notEqual(currentIdentity.simulationEpoch, oldIdentity.simulationEpoch);
    finishHash();
    await acknowledged;
    assert.deepEqual(sent.find((message) => message.type === "play_game_query_result").payload.result.state.identity, oldIdentity);
    assert.deepEqual(sent.find((message) => message.type === "ack").payload.identity, oldIdentity);
    for (const [requestId, identity] of [
      ["foreign-tab", { ...currentIdentity, frontendInstanceId: "other" }],
      ["missing-epoch", { frontendInstanceId: currentIdentity.frontendInstanceId }],
    ]) {
      window.dispatchEvent(new CustomEvent("metrics-ui:play-receipt", { detail: { receipt: { type: "ack", request_id: requestId, payload: { identity } } } }));
    }
    sendPlayAck(context, "current-run", { type: "play_game_command", commandId: "prepare-experiment" });
    const evidence = await game.handleQuery({ queryId: "experiment-evidence", payload: { expectedSimulationEpoch: currentIdentity.simulationEpoch } });
    assert.deepEqual(evidence.commandReceipts.map((entry) => entry.receipt.request_id), ["current-run"]);
    assert.equal(evidence.cameraRecords.length, 0);
  } finally {
    game?.dispose();
    Object.assign(globalThis, originalGlobals);
  }
});
