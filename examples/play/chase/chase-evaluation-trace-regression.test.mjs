import test from "node:test";
import assert from "node:assert/strict";
import { getChaseScenarioDefinition } from "./scenarios/index.mjs";
import { resolveChaseScenario } from "./simulation/scenario.mjs";
import { createChaseSimulationState, stepChaseSimulation } from "./simulation/simulation.mjs";
import { createChaseSimulationEpochOwner } from "./evaluation/runtime-identity.mjs";
import { createChaseEvaluationTrace, MAX_EVALUATION_TRACE_FRAMES } from "./evaluation/evaluation-trace.mjs";
import { handleChasePlayCommand } from "./ui/chase-play-commands.mjs";
import { handleChasePlayQuery } from "./ui/chase-play-queries.mjs";
import { handleInteractionCommand } from "../../../client/src/hooks/ws/handlers/interaction.ts";
import { handleQueryCommand } from "../../../client/src/hooks/ws/handlers/query.ts";
import { buildChasePlayUsage } from "./ui/chase-play-usage.mjs";
import { getGroundBounds } from "./world/world.mjs";

const idle = { source: "ws", forward: false, reverse: false, steering: 0 };
function freshState() {
  const dimensions = { columns: 9, rows: 6 };
  return createChaseSimulationState({
    scenario: resolveChaseScenario(getChaseScenarioDefinition("wall-escape"), dimensions),
    ...dimensions,
  });
}
function setup() {
  let sequence = 0;
  let now = 100;
  const owner = createChaseSimulationEpochOwner({ generateEpoch: () => `test-run-${++sequence}` });
  let state = freshState();
  const trace = createChaseEvaluationTrace({
    getState: () => state,
    getSimulationEpoch: owner.current,
    nowUs: () => ++now,
  });
  return {
    trace, owner,
    get state() { return state; },
    reset() { state = freshState(); owner.beginRun(); trace.beginRun(); },
  };
}
function step(state, input = idle) {
  stepChaseSimulation(state, { humanInput: input });
}

test("evaluation trace is off by default and only explicit bounded configuration enables capture", () => {
  const { state, trace } = setup();
  step(state);
  const snapshot = trace.snapshot();
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.complete, false);
  assert.ok(snapshot.issues.includes("trace-disabled"));
  assert.deepEqual(snapshot.frames, []);
  assert.equal(state.evaluationTraceRecorder, undefined);
  for (const config of [{}, { enabled: true }, { enabled: true, maxFrames: 1 },
    { enabled: true, maxFrames: 2.5 }, { enabled: true, maxFrames: MAX_EVALUATION_TRACE_FRAMES + 1 }]) {
    assert.throws(() => trace.configure(config), /requires|must be/);
  }
  assert.equal(trace.snapshot().enabled, false);
  assert.throws(() => trace.snapshot({ expectedSimulationEpoch: "" }), /nonempty/);
});

test("explicit trace exports baseline and every committed frame with native metrics and shared-clock input evidence", () => {
  const { state, trace, owner } = setup();
  const bounds = getGroundBounds(state.columns, state.rows);
  state.chaserPosition = { x: bounds.minX + 0.001, z: 0 };
  state.chaserLookDirection = { x: -1, z: 0 };
  trace.configure({ enabled: true, maxFrames: 10 });
  step(state, { ...idle, forward: true });
  step(state);
  step(state, { ...idle, reverse: true });
  const snapshot = trace.snapshot({ expectedSimulationEpoch: owner.current() });
  assert.equal(snapshot.schema, "chase_evaluation_trace_v1");
  assert.equal(snapshot.classification, "non-sensor");
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.truncated, false);
  assert.deepEqual(snapshot.gaps, []);
  assert.deepEqual(snapshot.issues, []);
  assert.equal(snapshot.scenarioId, "wall-escape");
  assert.equal(snapshot.evaderExists, false);
  assert.equal(snapshot.controlSource, "ws");
  assert.equal(snapshot.currentFrameIndex, state.runMetrics.elapsedFrames);
  assert.equal(snapshot.retainedFrameCount, 4);
  assert.equal(snapshot.expectedFrameCount, 4);
  assert.deepEqual(snapshot.frames.map((f) => f.frameIndex), [0, 1, 2, 3]);
  assert.ok(snapshot.frames.every((f) => f.simulationEpoch === owner.current()));
  assert.deepEqual(snapshot.frames.map((f) => f.wallTouchActive), [false, true, true, false]);
  assert.deepEqual(snapshot.frames.map((f) => f.wallTouchCount), [0, 1, 1, 1]);
  assert.deepEqual(snapshot.frames.map((f) => f.wallTouchFrames), [0, 1, 2, 2]);
  assert.ok(snapshot.frames.every((f) => f.touchCount === 0 && f.elapsedFrames === f.frameIndex));
  assert.equal(snapshot.frames[0].phase, "baseline");
  assert.equal(snapshot.frames[0].committedAtUs, null);
  assert.deepEqual(snapshot.frames.slice(1).map((f) => f.committedAtUs), [101, 102, 103]);
  assert.deepEqual(snapshot.frames[3].chaserInput, { ...idle, reverse: true });
  assert.deepEqual(snapshot.frames[3].chaserPosition, state.chaserPosition);
  assert.equal(snapshot.frames[3].wallTouchRatePerThousandFrames, 1000 / 3);
  const before = structuredClone(state.runMetrics);
  snapshot.frames[0].chaserPosition.x = 999;
  assert.notEqual(trace.snapshot().frames[0].chaserPosition.x, 999);
  assert.deepEqual(state.runMetrics, before, "export must not advance or alter simulation");
});

test("paused reasoning adds no records and committing a pending action adds exactly one", () => {
  const { state, trace } = setup();
  trace.configure({ enabled: true, maxFrames: 10 });
  stepChaseSimulation(state, { humanInput: idle, pauseBeforeActions: true });
  stepChaseSimulation(state, { humanInput: idle, pauseBeforeActions: true });
  assert.deepEqual(trace.snapshot().frames.map((f) => f.frameIndex), [0]);
  stepChaseSimulation(state, { pauseBeforeActions: false });
  assert.deepEqual(trace.snapshot().frames.map((f) => f.frameIndex), [0, 1]);
});

test("scene/controller state reset separates epochs, clears records and preserves explicit bounded configuration", () => {
  const fixture = setup();
  fixture.trace.configure({ enabled: true, maxFrames: 10 });
  step(fixture.state);
  const old = fixture.trace.snapshot();
  fixture.reset();
  const next = fixture.trace.snapshot();
  assert.notEqual(next.simulationEpoch, old.simulationEpoch);
  assert.equal(next.complete, true);
  assert.equal(next.maxFrames, 10);
  assert.deepEqual(next.frames.map((f) => f.frameIndex), [0]);
  assert.equal(next.frames[0].wallTouchCount, 0);
  assert.equal(fixture.trace.snapshot({ expectedSimulationEpoch: old.simulationEpoch }).complete, false);
  assert.ok(fixture.trace.snapshot({ expectedSimulationEpoch: old.simulationEpoch }).issues.includes("expected-epoch-mismatch"));
});

test("bounded retention explicitly reports truncation and every missing frame", () => {
  const { state, trace } = setup();
  trace.configure({ enabled: true, maxFrames: 3 });
  for (let i = 0; i < 5; i++) step(state);
  const snapshot = trace.snapshot();
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.retainedFrameCount, 3);
  assert.equal(snapshot.recordedFrameCount, 6);
  assert.equal(snapshot.droppedFrameCount, 3);
  assert.equal(snapshot.firstRetainedFrameIndex, 0);
  assert.equal(snapshot.lastRetainedFrameIndex, 2);
  assert.deepEqual(snapshot.gaps, [{ fromFrameIndex: 3, toFrameIndex: 5 }]);
  assert.equal(snapshot.endpoint.frameIndex, 5);
  assert.equal(snapshot.endpoint.elapsedFrames, 5);
});

test("late enablement, missing epoch, skipped frames and nonadvancing indices cannot claim completeness", () => {
  const { state, trace, owner } = setup();
  step(state);
  trace.configure({ enabled: true, maxFrames: 10 });
  assert.deepEqual(trace.snapshot().gaps, [{ fromFrameIndex: 0, toFrameIndex: 0 }]);
  assert.ok(trace.snapshot().issues.includes("capture-started-after-reset"));
  step(state);
  state.evaluationTraceRecorder.frames.splice(1, 1);
  step(state);
  assert.deepEqual(trace.snapshot().gaps, [{ fromFrameIndex: 0, toFrameIndex: 0 }, { fromFrameIndex: 2, toFrameIndex: 2 }]);
  state.evaluationTraceRecorder.frames.push(structuredClone(state.evaluationTraceRecorder.frames.at(-1)));
  assert.ok(trace.snapshot().issues.includes("non-advancing-frame-index"));
  owner.beginRun(); // An unsignaled epoch change must not relabel old records.
  assert.ok(trace.snapshot().issues.includes("epoch-changed-without-reset"));
  assert.equal(trace.snapshot().complete, false);
  const noEpoch = createChaseEvaluationTrace({ getState: () => freshState(), getSimulationEpoch: () => null });
  noEpoch.configure({ enabled: true, maxFrames: 10 });
  assert.equal(noEpoch.snapshot().complete, false);
  assert.ok(noEpoch.snapshot().issues.includes("missing-simulation-epoch"));
});

test("evaluation trace transport is explicit, discoverable and separate from atomic sensor capture", () => {
  const { trace } = setup();
  const before = trace.snapshot();
  assert.equal(handleChasePlayCommand({ commandId: "configure-evaluation-trace", payload: { enabled: true, maxFrames: 10 } },
    { configureEvaluationTrace: trace.configure }), true);
  const result = handleChasePlayQuery({ queryId: "evaluation-trace" }, { getEvaluationTrace: trace.snapshot });
  assert.equal(before.enabled, false);
  assert.equal(result.enabled, true);
  assert.equal(result.complete, true);
  assert.throws(() => handleChasePlayQuery({ queryId: "evaluation-trace" }), /not available/);
  const usage = buildChasePlayUsage();
  assert.equal(usage.protocol.evaluationTraceQueryId, "evaluation-trace");
  assert.ok(usage.wireCommands.some((c) => c.commandId === "configure-evaluation-trace"));
  trace.configure({ enabled: false });
  assert.deepEqual(trace.snapshot().frames, []);
  assert.equal(trace.snapshot().complete, false);
});

test("enabling evaluator truth does not alter controller observation, memory or chosen action", () => {
  const left = setup();
  const right = setup();
  right.trace.configure({ enabled: true, maxFrames: 10 });
  for (let i = 0; i < 3; i++) {
    step(left.state, { ...idle, forward: true, steering: 0.3 });
    step(right.state, { ...idle, forward: true, steering: 0.3 });
    // Independent controllers create distinct callback functions. Compare all
    // serialized frame context, observation, memory and action evidence.
    assert.deepEqual(JSON.parse(JSON.stringify(right.state.lastStep)), JSON.parse(JSON.stringify(left.state.lastStep)));
    assert.deepEqual(right.state.chaserPosition, left.state.chaserPosition);
  }
});

test("generic WS transport acknowledges valid configuration, rejects invalid configuration and returns trace export", () => {
  const { trace } = setup();
  const acknowledgements = [];
  const errors = [];
  const messages = [];
  const context = {
    onPlayGameCommand: (command) => handleChasePlayCommand(command, { configureEvaluationTrace: trace.configure }),
    onPlayGameQuery: (query) => handleChasePlayQuery(query, { getEvaluationTrace: trace.snapshot }),
    sendAck: (requestId, command) => acknowledgements.push({ requestId, command }),
    sendError: (requestId, error) => errors.push({ requestId, error }),
    sendMessage: (message) => messages.push(message),
  };
  handleInteractionCommand({ type: "play_game_command", commandId: "configure-evaluation-trace", payload: { enabled: true, maxFrames: 10 } }, "enable", context);
  handleInteractionCommand({ type: "play_game_command", commandId: "configure-evaluation-trace", payload: { enabled: true } }, "invalid", context);
  assert.deepEqual(acknowledgements, [{ requestId: "enable", command: "play_game_command" }]);
  assert.equal(errors[0].requestId, "invalid");
  assert.match(errors[0].error, /maxFrames/);
  handleQueryCommand({ type: "play_game_query", queryId: "evaluation-trace" }, "export", context);
  assert.equal(messages[0].type, "play_game_query_result");
  assert.equal(messages[0].payload.queryId, "evaluation-trace");
  assert.equal(messages[0].payload.result.complete, true);
  assert.equal(messages[0].payload.result.maxFrames, 10, "invalid reconfiguration preserves valid capture");
  assert.deepEqual(acknowledgements[1], { requestId: "export", command: "play_game_query" });
});
