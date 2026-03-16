import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EQUATIONS_PANE_STATE,
  mergeEquationsPaneStatePatch,
  normalizeEquationsPaneState,
} from "../equations-pane";

test("normalizeEquationsPaneState falls back to defaults", () => {
  assert.deepEqual(normalizeEquationsPaneState(null), DEFAULT_EQUATIONS_PANE_STATE);
  assert.deepEqual(normalizeEquationsPaneState({ content: { workspace: { title: "A" } } }), {
    ...DEFAULT_EQUATIONS_PANE_STATE,
    content: {
      ...DEFAULT_EQUATIONS_PANE_STATE.content,
      workspace: {
        ...DEFAULT_EQUATIONS_PANE_STATE.content.workspace,
        title: "A",
      },
    },
  });
});

test("mergeEquationsPaneStatePatch applies partial content and dimensions", () => {
  const next = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    content: {
      workspace: {
        title: "Solver",
        body: "f(x) = x^2 + 1",
        math: null,
      },
      footer: {
        body: "patched",
      },
    },
    dimensions: {
      frameAspect: [4, 3],
      workspace: {
        colSpan: 3,
      },
      notes: {
        rowSpan: 2,
      },
    },
  });

  assert.equal(next.content.workspace.title, "Solver");
  assert.equal(next.content.workspace.body, "f(x) = x^2 + 1");
  assert.equal(next.content.workspace.math, undefined);
  assert.equal(next.content.footer.body, "patched");
  assert.deepEqual(next.dimensions.frameAspect, [4, 3]);
  assert.equal(next.dimensions.workspace.colSpan, 3);
  assert.equal(next.dimensions.notes.rowSpan, 2);
  assert.equal(next.dimensions.notes.col, DEFAULT_EQUATIONS_PANE_STATE.dimensions.notes.col);
});

test("mergeEquationsPaneStatePatch replace resets unspecified fields", () => {
  const mutated = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    content: {
      workspace: {
        title: "Mutated",
      },
    },
    dimensions: {
      footer: {
        rowSpan: 1,
      },
    },
  });

  const reset = mergeEquationsPaneStatePatch(
    mutated,
    {
      content: {
        details: {
          body: "Only this survives",
        },
      },
    },
    { replace: true },
  );

  assert.equal(reset.content.workspace.title, DEFAULT_EQUATIONS_PANE_STATE.content.workspace.title);
  assert.equal(reset.content.details.body, "Only this survives");
  assert.equal(reset.dimensions.footer.rowSpan, DEFAULT_EQUATIONS_PANE_STATE.dimensions.footer.rowSpan);
});

test("mergeEquationsPaneStatePatch replaces cells when provided", () => {
  const next = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    dimensions: {
      grid: [2, 1],
    },
    cells: [
      {
        id: "a",
        col: 0,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
        title: "",
        body: "test",
      },
      {
        id: "b",
        col: 1,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
        title: "",
        body: "test",
      },
    ],
  });

  assert.equal(next.cells.length, 2);
  assert.equal(next.cells[0]?.body, "test");
  assert.equal(next.cells[1]?.col, 1);
});

test("mergeEquationsPaneStatePatch filters out cells outside the grid", () => {
  const next = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    dimensions: {
      grid: [2, 2],
    },
    cells: [
      {
        id: "ok",
        col: 1,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
        title: "",
        body: "test",
      },
      {
        id: "skip",
        col: 2,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
        title: "",
        body: "bad",
      },
    ],
  });

  assert.equal(next.cells.length, 1);
  assert.equal(next.cells[0]?.id, "ok");
});

test("mergeEquationsPaneStatePatch accepts a framegrid document", () => {
  const next = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    document: {
      spec: {
        frameAspect: [4, 3],
        frameBorderDiv: [18, 18],
        grid: [2, 1],
        cellBorderDiv: [10, 10],
        fitMode: "contain",
      },
      items: [
        {
          id: "left",
          title: "A",
          body: "",
          math: {
            kind: "latex",
            latex: String.raw`\dot{\theta}_{i} = \omega_{i}`,
            displayMode: true,
          },
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
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
        {
          id: "right",
          title: "B",
          body: "beta",
          col: 1,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  });

  assert.deepEqual(next.dimensions.frameAspect, [4, 3]);
  assert.deepEqual(next.dimensions.grid, [2, 1]);
  assert.equal(next.cells.length, 2);
  assert.equal(next.cells[0]?.id, "left");
  assert.equal(next.cells[0]?.math?.kind, "latex");
  assert.equal(next.cells[0]?.mappings?.[0]?.hitBox?.id, "theta_dot_i");
  assert.equal(next.document?.spec.cellBorderDiv[0], 10);
});

test("mergeEquationsPaneStatePatch preserves equations context", () => {
  const next = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, {
    context: {
      selectedHitBox: {
        itemId: "workspace",
        hitBox: {
          id: "omega_i",
          label: "omega_i",
          sequence: "omega_i",
          category: "term",
          latex: String.raw`\omega_{i}`,
        },
      },
    },
  });

  assert.equal(next.context.selectedHitBox?.itemId, "workspace");
  assert.equal(next.context.selectedHitBox?.hitBox.id, "omega_i");
  assert.equal(next.context.selectedHitBox?.hitBox.latex, String.raw`\omega_{i}`);
});
