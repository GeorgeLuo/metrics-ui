import test from "node:test";
import assert from "node:assert/strict";

import {
  validateEquationsDerivationDocumentSource,
  validateEquationsGlossaryReferenceDocumentSource,
  validateEquationsPaneStatePatchInput,
  validateEquationsReferenceSectionsDocumentSource,
  validateEquationsSemanticLayoutSource,
} from "../equations-validation";

test("validateEquationsPaneStatePatchInput reports malformed latex as an error", () => {
  const report = validateEquationsPaneStatePatchInput(
    {
      content: {
        workspace: {
          math: {
            kind: "latex",
            latex: String.raw`\frac{1}{`,
            displayMode: true,
          },
        },
      },
    },
    { replace: true },
  );

  assert.equal(report.status, "error");
  assert.equal(report.errorCount, 1);
  assert.match(report.diagnostics[0]?.path ?? "", /content\.workspace\.math\.latex/);
});

test("validateEquationsPaneStatePatchInput errors when plain text contains latex commands", () => {
  const report = validateEquationsPaneStatePatchInput(
    {
      document: {
        pattern: "parallel_walkthrough",
        title: "Topic",
        steps: [
          {
            leftTitle: String.raw`\psi and \theta`,
            rightTitle: "Eq. 10",
            left: [
              {
                kind: "text",
                value: String.raw`\omega labels the oscillator family.`,
              },
            ],
            right: [
              {
                kind: "math",
                latex: String.raw`e^{i(\theta-\psi)}`,
                displayMode: true,
              },
            ],
          },
        ],
      },
    },
    { replace: true },
  );

  assert.equal(report.status, "error");
  assert.equal(report.errorCount, 2);
  assert.equal(report.warningCount, 0);
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.path.includes("document.items[0].blocks[0].left[0].value")
      && entry.message.includes(String.raw`\psi`),
    ),
  );
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.path.includes("document.items[0].blocks[0].left[1].value")
      && entry.message.includes(String.raw`\omega`),
    ),
  );
});

test("validateEquationsPaneStatePatchInput errors on mismatched hit-box definitions", () => {
  const report = validateEquationsPaneStatePatchInput(
    {
      content: {
        workspace: {
          mappings: [
            {
              kind: "latex",
              value: "r",
              hitBox: {
                id: "shared-id",
                label: "order parameter",
                sequence: "r",
                category: "term",
                latex: "r",
              },
            },
          ],
        },
        details: {
          mappings: [
            {
              kind: "text",
              value: "order parameter",
              hitBox: {
                id: "shared-id",
                label: "different label",
                sequence: "r",
                category: "term",
                latex: "r",
              },
            },
          ],
        },
      },
    },
    { replace: true },
  );

  assert.equal(report.status, "error");
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.ruleId === "hitbox_definitions_match_by_id"
      && entry.message.includes(`shared-id`),
    ),
  );
});

test("validateEquationsSemanticLayoutSource requires explicit four-slot structure", () => {
  const report = validateEquationsSemanticLayoutSource({
    workspace: {
      title: "Equation",
      mappings: [{ kind: "latex", value: "r" }],
    },
    details: {
      title: "Literal",
      body: "Literal text.",
    },
    notes: {
      title: "Meaning",
      body: "Meaning text.",
    },
  });

  assert.equal(report.status, "error");
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.ruleId === "semantic_layout_slot_required"
      && entry.path === "content.footer",
    ),
  );
});

test("validateEquationsSemanticLayoutSource accepts a complete four-slot structure", () => {
  const report = validateEquationsSemanticLayoutSource({
    workspace: {
      title: "Equation",
      mappings: [{ kind: "latex", value: "r" }],
    },
    details: {
      title: "Literal",
      body: "Literal text.",
    },
    notes: {
      title: "Meaning",
      body: "Meaning text.",
    },
    footer: {
      title: "Concept",
      body: "Concept text.",
    },
  });

  assert.notEqual(report.status, "error");
});

test("validateEquationsDerivationDocumentSource requires intro and steps", () => {
  const report = validateEquationsDerivationDocumentSource({
    pattern: "parallel_walkthrough",
    title: "Derivation",
    steps: [],
  });

  assert.equal(report.status, "error");
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.ruleId === "derivation_header_required",
    ),
  );
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.ruleId === "derivation_steps_required",
    ),
  );
});

test("validateEquationsDerivationDocumentSource accepts header plus body derivations", () => {
  const report = validateEquationsDerivationDocumentSource({
    pattern: "parallel_walkthrough",
    title: "Derivation",
    intro: [
      {
        kind: "text",
        value: "Header text.",
      },
    ],
    steps: [
      {
        leftTitle: "Step 1",
        rightTitle: "Eq. A",
        left: [
          {
            kind: "text",
            value: "Transform A into B.",
          },
        ],
        right: [
          {
            kind: "math",
            latex: "A=B",
            displayMode: true,
          },
        ],
      },
    ],
  });

  assert.notEqual(report.status, "error");
});

test("validateEquationsReferenceSectionsDocumentSource requires sections", () => {
  const report = validateEquationsReferenceSectionsDocumentSource({
    pattern: "reference_sections",
    title: "Reference",
    sections: [],
  });

  assert.equal(report.status, "error");
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.ruleId === "reference_sections_required",
    ),
  );
});

test("validateEquationsReferenceSectionsDocumentSource accepts structured sections", () => {
  const report = validateEquationsReferenceSectionsDocumentSource({
    pattern: "reference_sections",
    title: "Reference",
    intro: [
      {
        kind: "text",
        value: "Header text.",
      },
    ],
    sections: [
      {
        title: "Section 1",
        content: [
          {
            kind: "text",
            value: "Body text.",
          },
        ],
        referenceTitle: "Formula",
        reference: [
          {
            kind: "math",
            latex: "r = 0",
            displayMode: true,
          },
        ],
      },
    ],
  });

  assert.notEqual(report.status, "error");
});

test("validateEquationsGlossaryReferenceDocumentSource requires entries", () => {
  const report = validateEquationsGlossaryReferenceDocumentSource({
    pattern: "glossary_reference",
    title: "Glossary",
    entries: [],
  });

  assert.equal(report.status, "error");
  assert.ok(
    report.diagnostics.some((entry) =>
      entry.ruleId === "glossary_entries_required",
    ),
  );
});

test("validateEquationsGlossaryReferenceDocumentSource accepts glossary entries", () => {
  const report = validateEquationsGlossaryReferenceDocumentSource({
    pattern: "glossary_reference",
    title: "Glossary",
    entries: [
      {
        term: "r",
        body: [
          {
            kind: "text",
            value: "Order parameter magnitude.",
          },
        ],
        reference: [
          {
            kind: "mappings",
            mappings: [
              {
                kind: "latex",
                value: "r",
              },
            ],
          },
        ],
      },
    ],
  });

  assert.notEqual(report.status, "error");
});

test("validateEquationsGlossaryReferenceDocumentSource accepts topic reference blocks", () => {
  const report = validateEquationsGlossaryReferenceDocumentSource({
    pattern: "glossary_reference",
    title: "Glossary",
    entries: [
      {
        term: "Eq. 10",
        body: [
          {
            kind: "text",
            value: "Canonical equation surface.",
          },
        ],
        reference: [
          {
            kind: "topic_reference",
            topicId: "kuramoto-eq10",
            slot: "workspace",
          },
        ],
      },
    ],
  });

  assert.notEqual(report.status, "error");
});
