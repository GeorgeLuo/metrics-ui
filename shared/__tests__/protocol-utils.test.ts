import test from "node:test";
import assert from "node:assert/strict";
import type { CaptureRecord, CaptureSession, ComponentNode, SelectedMetric } from "../schema";
import {
  buildComponentsList,
  buildDisplaySnapshot,
  buildMetricCoverage,
  buildRenderDebug,
  buildRenderTable,
  buildSeriesWindow,
  getNumericValueAtPath,
} from "../protocol-utils";

const records: CaptureRecord[] = [
  {
    tick: 1,
    entities: {
      "1": {
        comp: { a: 1, b: 2, note: "x" },
        status: "idle",
      },
    },
  },
  {
    tick: 2,
    entities: {
      "1": {
        comp: { a: 3, b: 4, note: "y" },
        status: 7,
      },
      "2": {
        foo: 10,
      },
    },
  },
  {
    tick: 3,
    entities: {
      "1": {
        comp: { a: 5 },
      },
    },
  },
];

const components: ComponentNode[] = [
  {
    id: "1",
    label: "1",
    path: ["1"],
    valueType: "object",
    isLeaf: false,
    children: [
      {
        id: "1.comp",
        label: "comp",
        path: ["1", "comp"],
        valueType: "object",
        isLeaf: false,
        children: [
          {
            id: "1.comp.a",
            label: "a",
            path: ["1", "comp", "a"],
            valueType: "number",
            isLeaf: true,
            children: [],
          },
          {
            id: "1.comp.b",
            label: "b",
            path: ["1", "comp", "b"],
            valueType: "number",
            isLeaf: true,
            children: [],
          },
          {
            id: "1.comp.note",
            label: "note",
            path: ["1", "comp", "note"],
            valueType: "string",
            isLeaf: true,
            children: [],
          },
        ],
      },
      {
        id: "1.status",
        label: "status",
        path: ["1", "status"],
        valueType: "string",
        isLeaf: true,
        children: [],
      },
    ],
  },
  {
    id: "2",
    label: "2",
    path: ["2"],
    valueType: "object",
    isLeaf: false,
    children: [
      {
        id: "2.foo",
        label: "foo",
        path: ["2", "foo"],
        valueType: "number",
        isLeaf: true,
        children: [],
      },
    ],
  },
];

const capture: CaptureSession = {
  id: "cap-1",
  filename: "cap-1.jsonl",
  fileSize: 0,
  tickCount: 3,
  records,
  components,
  isActive: true,
};

const metrics: SelectedMetric[] = [
  {
    captureId: "cap-1",
    path: ["1", "comp", "a"],
    fullPath: "1.comp.a",
    label: "a",
    color: "red",
  },
  {
    captureId: "cap-1",
    path: ["1", "comp", "b"],
    fullPath: "1.comp.b",
    label: "b",
    color: "blue",
  },
];

test("getNumericValueAtPath returns numbers and nulls", () => {
  assert.equal(getNumericValueAtPath(records[0], ["1", "comp", "a"]), 1);
  assert.equal(getNumericValueAtPath(records[0], ["1", "status"]), null);
  assert.equal(getNumericValueAtPath(records[2], ["1", "comp", "b"]), null);
  assert.equal(getNumericValueAtPath(records[1], ["2", "foo"]), 10);
});

test("buildSeriesWindow returns ordered points and summary", () => {
  const result = buildSeriesWindow({
    records,
    path: ["1", "comp", "a"],
    currentTick: 3,
    windowSize: 2,
  });

  assert.deepEqual(result.points, [
    { tick: 2, value: 3 },
    { tick: 3, value: 5 },
  ]);
  assert.deepEqual(result.summary, { last: 5, min: 3, max: 5, nulls: 0 });
});

test("buildSeriesWindow counts nulls for missing values", () => {
  const result = buildSeriesWindow({
    records,
    path: ["1", "comp", "b"],
    currentTick: 3,
    windowSize: 2,
  });

  assert.deepEqual(result.points, [
    { tick: 2, value: 4 },
    { tick: 3, value: null },
  ]);
  assert.deepEqual(result.summary, { last: null, min: 4, max: 4, nulls: 1 });
});

test("buildComponentsList returns numeric leaves and respects search", () => {
  const list = buildComponentsList({ components, search: "comp", limit: 10 });
  const ids = list.items.map((item) => item.fullPath);
  assert.deepEqual(ids, ["1.comp.a", "1.comp.b"]);
});

test("buildDisplaySnapshot summarizes selected metrics", () => {
  const snapshot = buildDisplaySnapshot({
    captures: [capture],
    selectedMetrics: metrics,
    playback: { isPlaying: false, currentTick: 3, speed: 1, totalTicks: 3 },
    windowSize: 2,
  });

  assert.equal(snapshot.captureId, "cap-1");
  assert.equal(snapshot.currentTick, 3);
  assert.equal(snapshot.windowSize, 2);
  const summary = snapshot.seriesSummary.map((item) => ({
    path: item.fullPath,
    last: item.summary.last,
  }));
  assert.deepEqual(summary, [
    { path: "1.comp.a", last: 5 },
    { path: "1.comp.b", last: null },
  ]);
});

test("buildMetricCoverage returns totals and last tick", () => {
  const coverage = buildMetricCoverage({
    captures: [capture],
    metrics,
    captureId: "cap-1",
  });
  const byPath = new Map(coverage.map((entry) => [entry.fullPath, entry]));
  assert.deepEqual(byPath.get("1.comp.a"), {
    captureId: "cap-1",
    path: ["1", "comp", "a"],
    fullPath: "1.comp.a",
    label: "a",
    numericCount: 3,
    total: 3,
    lastTick: 3,
  });
  assert.deepEqual(byPath.get("1.comp.b"), {
    captureId: "cap-1",
    path: ["1", "comp", "b"],
    fullPath: "1.comp.b",
    label: "b",
    numericCount: 2,
    total: 3,
    lastTick: 2,
  });
});

test("buildRenderTable returns rows for the current window", () => {
  const table = buildRenderTable({
    records,
    metrics,
    currentTick: 3,
    windowSize: 2,
  });

  assert.deepEqual(table.columns, ["tick", "1.comp.a", "1.comp.b"]);
  assert.deepEqual(table.rows, [
    [2, 3, 4],
    [3, 5, null],
  ]);
});

test("buildRenderDebug summarizes window state", () => {
  const debug = buildRenderDebug({
    captures: [capture],
    selectedMetrics: metrics,
    playback: { isPlaying: false, currentTick: 3, speed: 1, totalTicks: 3 },
    windowSize: 2,
    autoScroll: true,
  });

  assert.equal(debug.windowStart, 2);
  assert.equal(debug.windowEnd, 3);
  assert.equal(debug.windowPoints, 2);
  assert.equal(debug.captures[0].recordCount, 3);
  assert.equal(debug.captures[0].windowRecordCount, 2);
  assert.equal(debug.captures[0].componentNodes, 8);
  assert.equal(debug.captures[0].selectedMetricCount, 2);
  assert.equal(debug.captures[0].storesRecords, true);

  const metricMap = new Map(debug.metrics.map((item) => [item.fullPath, item]));
  assert.deepEqual(metricMap.get("1.comp.a"), {
    captureId: "cap-1",
    path: ["1", "comp", "a"],
    fullPath: "1.comp.a",
    label: "a",
    active: true,
    windowNumericCount: 2,
    windowTotal: 2,
    startValue: 3,
    endValue: 5,
    firstTick: 2,
    lastTick: 3,
  });
  assert.deepEqual(metricMap.get("1.comp.b"), {
    captureId: "cap-1",
    path: ["1", "comp", "b"],
    fullPath: "1.comp.b",
    label: "b",
    active: true,
    windowNumericCount: 1,
    windowTotal: 2,
    startValue: 4,
    endValue: null,
    firstTick: 2,
    lastTick: 2,
  });
  assert.ok(debug.domains);
  assert.equal(debug.domains?.hasSecondaryAxis, false);
  assert.equal(debug.domains?.primaryMetricCount, 2);
  assert.equal(debug.domains?.secondaryMetricCount, 0);
  assert.equal(debug.domains?.yPrimaryManual, null);
  assert.equal(debug.domains?.ySecondaryManual, null);
});

test("buildRenderDebug domain preview includes axis info for negative values", () => {
  const negativeCapture: CaptureSession = {
    id: "neg-cap",
    filename: "neg-cap.jsonl",
    fileSize: 0,
    tickCount: 3,
    records: [
      { tick: 1, entities: { "0": { derivations: { diff: -12 } } } },
      { tick: 2, entities: { "0": { derivations: { diff: -3 } } } },
      { tick: 3, entities: { "0": { derivations: { diff: 4 } } } },
    ],
    components: [],
    isActive: true,
  };
  const negativeMetric: SelectedMetric = {
    captureId: "neg-cap",
    path: ["0", "derivations", "diff"],
    fullPath: "0.derivations.diff",
    label: "diff",
    color: "#fff",
  };

  const debug = buildRenderDebug({
    captures: [negativeCapture],
    selectedMetrics: [negativeMetric],
    playback: { isPlaying: false, currentTick: 3, speed: 1, totalTicks: 3 },
    windowSize: 3,
    autoScroll: true,
  });

  assert.ok(debug.domains);
  assert.equal(debug.domains?.hasSecondaryAxis, false);
  assert.equal(debug.domains?.primaryMetricCount, 1);
  assert.ok((debug.domains?.yPrimaryAuto[0] ?? 0) < 0);
});
