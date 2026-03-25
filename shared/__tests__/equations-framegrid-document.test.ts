import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EQUATIONS_PANE_STATE } from "../equations-pane";
import { mergeEquationsPaneStatePatch } from "../equations-pane";
import {
  buildEquationsFrameGridDocument,
  normalizeEquationsFrameGridDocument,
} from "../equations-framegrid-document";

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

test("buildEquationsFrameGridDocument preserves piecewise rows and branch conditions", () => {
  const state = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    content: {
      workspace: {
        presentation: "piecewise",
        mappings: [
          {
            kind: "latex",
            value: String.raw`\rho`,
            hitBox: {
              id: "density_rho",
              label: "rho",
              sequence: "rho",
              category: "term",
              latex: String.raw`\rho`,
            },
          },
        ],
        piecewiseRows: [
          {
            expression: [
              {
                kind: "latex",
                value: String.raw`\delta`,
                hitBox: {
                  id: "locked_dirac",
                  label: "locked delta",
                  sequence: "delta",
                  category: "branch",
                  latex: String.raw`\delta`,
                },
              },
            ],
            condition: [
              {
                kind: "latex",
                value: String.raw`|\omega| < Kr`,
                hitBox: {
                  id: "locked_condition",
                  label: "locked condition",
                  sequence: "absolute value of omega less than K r",
                  category: "condition",
                  latex: String.raw`|\omega| < Kr`,
                },
              },
            ],
          },
        ],
      },
    },
  });

  const document = buildEquationsFrameGridDocument(state);

  assert.equal(document.items[0]?.presentation, "piecewise");
  assert.equal(document.items[0]?.piecewiseRows?.length, 1);
  assert.equal(document.items[0]?.piecewiseRows?.[0]?.expression[0]?.hitBox?.category, "branch");
  assert.equal(document.items[0]?.piecewiseRows?.[0]?.condition?.[0]?.hitBox?.category, "condition");
});

test("buildEquationsFrameGridDocument preserves freeform blocks", () => {
  const document = buildEquationsFrameGridDocument({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    document: {
      spec: {
        frameAspect: [4, 3],
        frameBorderDiv: [0, 0],
        grid: [1, 1],
        cellBorderDiv: [0, 0],
        fitMode: "contain",
      },
      items: [
        {
          id: "workspace",
          title: "Explanation",
          body: "",
          presentation: "freeform",
          blocks: [
            {
              kind: "text",
              value: "Start from Eq. 5.",
            },
            {
              kind: "mappings",
              mappings: [
                {
                  kind: "latex",
                  value: String.raw`r e^{i\psi}`,
                  hitBox: {
                    id: "order_parameter_complex",
                    label: "complex order parameter",
                    sequence: "r times e to the i psi",
                    category: "term",
                    latex: String.raw`r e^{i\psi}`,
                  },
                },
              ],
            },
          ],
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  });

  assert.equal(document.items[0]?.presentation, "freeform");
  assert.equal(document.items[0]?.blocks?.length, 2);
  assert.equal(document.items[0]?.blocks?.[1]?.kind, "mappings");
});

test("buildEquationsFrameGridDocument preserves split freeform blocks", () => {
  const document = buildEquationsFrameGridDocument({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    document: {
      spec: {
        frameAspect: [4, 3],
        frameBorderDiv: [0, 0],
        grid: [1, 1],
        cellBorderDiv: [0, 0],
        fitMode: "contain",
      },
      items: [
        {
          id: "workspace",
          title: "Parallel walkthrough",
          body: "",
          presentation: "freeform",
          blocks: [
            {
              kind: "split",
              fractions: [2, 3],
              left: [
                {
                  kind: "text",
                  value: "Explain the substitution.",
                },
              ],
              right: [
                {
                  kind: "mappings",
                  mappings: [
                    {
                      kind: "latex",
                      value: String.raw`\rho = \delta(\theta-\theta_*)`,
                      hitBox: {
                        id: "rho_substitution",
                        label: "rho substitution",
                        sequence: "rho equals delta of theta minus theta star",
                        category: "function",
                        latex: String.raw`\rho = \delta(\theta-\theta_*)`,
                      },
                    },
                  ],
                },
              ],
            },
          ],
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  });

  assert.equal(document.items[0]?.presentation, "freeform");
  assert.equal(document.items[0]?.blocks?.[0]?.kind, "split");
  assert.deepEqual(document.items[0]?.blocks?.[0]?.fractions, [2, 3]);
  assert.equal(document.items[0]?.blocks?.[0]?.left[0]?.kind, "text");
  assert.equal(document.items[0]?.blocks?.[0]?.right[0]?.kind, "mappings");
});

test("normalizeEquationsFrameGridDocument expands the parallel walkthrough pattern", () => {
  const document = normalizeEquationsFrameGridDocument({
    pattern: "parallel_walkthrough",
    title: "Walkthrough",
    fractions: [2, 3],
    steps: [
      {
        leftTitle: "Step 1",
        rightTitle: "Equation",
        left: [
          {
            kind: "text",
            value: "Explain the setup.",
          },
        ],
        right: [
          {
            kind: "mappings",
            mappings: [
              {
                kind: "latex",
                value: String.raw`r e^{i\psi}`,
                hitBox: {
                  id: "order_parameter_complex",
                  label: "complex order parameter",
                  sequence: "r times e to the i psi",
                  category: "term",
                  latex: String.raw`r e^{i\psi}`,
                },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(document.spec.grid, [1, 1]);
  assert.equal(document.items.length, 1);
  assert.equal(document.items[0]?.title, "Walkthrough");
  assert.equal(document.items[0]?.presentation, "freeform");
  assert.equal(document.items[0]?.blocks?.[0]?.kind, "split");
  assert.deepEqual(document.items[0]?.blocks?.[0]?.fractions, [2, 3]);
  assert.equal(document.items[0]?.blocks?.[0]?.left[0]?.kind, "text");
  assert.equal(document.items[0]?.blocks?.[0]?.left[1]?.kind, "text");
  assert.equal(document.items[0]?.blocks?.[0]?.right[0]?.kind, "text");
  assert.equal(document.items[0]?.blocks?.[0]?.right[1]?.kind, "mappings");
});

test("normalizeEquationsFrameGridDocument expands parallel walkthrough intro into a header band", () => {
  const document = normalizeEquationsFrameGridDocument({
    pattern: "parallel_walkthrough",
    title: "Walkthrough",
    introTitle: "Why This Progression",
    intro: [
      {
        kind: "text",
        value: "This reduction prepares the next self-consistency step.",
      },
    ],
    steps: [
      {
        left: [
          {
            kind: "text",
            value: "Step text.",
          },
        ],
        right: [
          {
            kind: "math",
            latex: String.raw`r = Kr`,
            displayMode: true,
          },
        ],
      },
    ],
  });

  assert.deepEqual(document.spec.grid, [1, 6]);
  assert.equal(document.items.length, 2);
  assert.equal(document.items[0]?.id, "header");
  assert.equal(document.items[0]?.title, "Why This Progression");
  assert.equal(document.items[0]?.presentation, "freeform");
  assert.equal(document.items[0]?.rowSpan, 1);
  assert.equal(document.items[1]?.id, "workspace");
  assert.equal(document.items[1]?.title, "Walkthrough");
  assert.equal(document.items[1]?.row, 1);
  assert.equal(document.items[1]?.rowSpan, 5);
});
