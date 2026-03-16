import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EQUATIONS_PANE_STATE } from "../equations-pane";
import { mergeEquationsPaneStatePatch } from "../equations-pane";
import { buildEquationsFrameGridDocument } from "../equations-framegrid-document";

test("buildEquationsFrameGridDocument returns the default 2x3 layout", () => {
  const document = buildEquationsFrameGridDocument(DEFAULT_EQUATIONS_PANE_STATE);

  assert.deepEqual(document.spec.grid, [2, 3]);
  assert.equal(document.items.length, 4);
  assert.equal(document.items[0]?.id, "workspace");
  assert.equal(document.items[0]?.title, "LaTeX Form");
  assert.equal(document.items[0]?.math, undefined);
  assert.equal(document.items[0]?.rowSpan, 3);
  assert.equal(document.items[3]?.id, "footer");
});

test("buildEquationsFrameGridDocument returns a single workspace item for a 1x1 grid", () => {
  const document = buildEquationsFrameGridDocument({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    dimensions: {
      ...DEFAULT_EQUATIONS_PANE_STATE.dimensions,
      grid: [1, 1],
      workspace: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      details: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      notes: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      footer: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
    },
  });

  assert.deepEqual(document.spec.grid, [1, 1]);
  assert.equal(document.items.length, 1);
  assert.equal(document.items[0]?.id, "workspace");
  assert.equal(document.items[0]?.title, "LaTeX Form");
  assert.equal(document.items[0]?.math, undefined);
});

test("buildEquationsFrameGridDocument prefers explicit cells when present", () => {
  const document = buildEquationsFrameGridDocument({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    dimensions: {
      ...DEFAULT_EQUATIONS_PANE_STATE.dimensions,
      grid: [2, 1],
    },
    cells: [
      {
        id: "left",
        title: "",
        body: "A",
        col: 0,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
      },
      {
        id: "right",
        title: "",
        body: "B",
        col: 1,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
      },
    ],
  });

  assert.deepEqual(document.spec.grid, [2, 1]);
  assert.equal(document.items.length, 2);
  assert.equal(document.items[0]?.id, "left");
  assert.equal(document.items[1]?.body, "B");
});

test("buildEquationsFrameGridDocument returns injected document unchanged", () => {
  const document = buildEquationsFrameGridDocument({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    document: {
      spec: {
        frameAspect: [1, 1],
        frameBorderDiv: [12, 12],
        grid: [1, 2],
        cellBorderDiv: [8, 8],
        fitMode: "cover",
      },
      items: [
        {
          id: "top",
          title: "",
          body: "T",
          mappings: [
            {
              kind: "text",
              value: "mapped",
              hitBox: {
                id: "mapped-term",
                label: "mapped term",
                sequence: "mapped term",
                category: "term",
                latex: "x",
              },
            },
          ],
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        {
          id: "bottom",
          title: "",
          body: "B",
          col: 0,
          row: 1,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  });

  assert.deepEqual(document.spec.grid, [1, 2]);
  assert.equal(document.spec.fitMode, "cover");
  assert.equal(document.items[0]?.mappings?.[0]?.hitBox?.id, "mapped-term");
  assert.equal(document.items[1]?.id, "bottom");
});

test("buildEquationsFrameGridDocument preserves math expressions on explicit items", () => {
  const document = buildEquationsFrameGridDocument({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    document: {
      spec: {
        frameAspect: [16, 9],
        frameBorderDiv: [0, 0],
        grid: [1, 1],
        cellBorderDiv: [0, 0],
        fitMode: "contain",
      },
      items: [
        {
          id: "workspace",
          title: "",
          body: "",
          math: {
            kind: "latex",
            latex: String.raw`\dot{\theta}_{i} = \omega_{i}`,
            displayMode: true,
          },
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  });

  assert.equal(document.items[0]?.math?.kind, "latex");
  assert.equal(document.items[0]?.math?.displayMode, true);
});

test("buildEquationsFrameGridDocument keeps the core layout when content mappings are provided", () => {
  const state = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    content: {
      workspace: {
        mappings: [
          {
            kind: "latex",
            value: String.raw`\dot{\theta}_{i}`,
            hitBox: {
              id: "theta_dot_i",
              label: "theta dot i",
              sequence: "angle [of] i dot",
              category: "term",
              latex: String.raw`\dot{\theta}_{i}`,
            },
          },
        ],
      },
      details: {
        mappings: [
          {
            kind: "text",
            value: "angle [of] i dot",
            hitBox: {
              id: "theta_dot_i",
              label: "theta dot i",
              sequence: "angle [of] i dot",
              category: "term",
              latex: String.raw`\dot{\theta}_{i}`,
            },
          },
        ],
      },
    },
  });

  const document = buildEquationsFrameGridDocument(state);

  assert.deepEqual(document.spec.grid, [2, 3]);
  assert.equal(document.items.length, 4);
  assert.equal(document.items[0]?.id, "workspace");
  assert.equal(document.items[0]?.rowSpan, 3);
  assert.equal(document.items[0]?.mappings?.[0]?.hitBox?.id, "theta_dot_i");
  assert.equal(document.items[1]?.id, "details");
  assert.equal(document.items[1]?.mappings?.[0]?.kind, "text");
});
