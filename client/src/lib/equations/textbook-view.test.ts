import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EQUATIONS_PANE_STATE } from "@shared/equations-pane";
import type { EquationsTopicOption } from "./topic-catalog";
import { buildEquationsTextbookPane, buildEquationsTextbookTopicDocuments } from "./textbook-view";

const semanticTopic: EquationsTopicOption = {
  id: "topic-b",
  topicId: "topic-b",
  catalogId: "catalog",
  catalogLabel: "Catalog",
  label: "Equation B",
  description: "",
  createdAt: "2026-04-01",
  updatedAt: "2026-04-01",
  sortKey: 20,
  group: "equation",
  tags: [],
  searchTerms: [],
  format: "semantic_layout",
  payload: {
    kind: "semantic_layout",
    content: {
      workspace: { title: "LaTeX Form", body: "x=1" },
      details: { title: "Literal Form", body: "literal" },
      notes: { title: "Meaning", body: "meaning" },
      footer: { title: "Concept", body: "concept" },
    },
  },
};

const documentTopic: EquationsTopicOption = {
  id: "topic-a",
  topicId: "topic-a",
  catalogId: "catalog",
  catalogLabel: "Catalog",
  label: "Derivation A",
  description: "",
  createdAt: "2026-04-01",
  updatedAt: "2026-04-01",
  sortKey: 10,
  group: "derivation",
  tags: [],
  searchTerms: [],
  format: "derivation",
  payload: {
    kind: "derivation",
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
          title: "Reference",
          body: "",
          presentation: "freeform",
          blocks: [
            {
              kind: "text",
              value: "Derivation body",
            },
          ],
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  },
};

test("buildEquationsTextbookTopicDocuments orders topics canonically and preserves topic framegrids", () => {
  const documents = buildEquationsTextbookTopicDocuments([semanticTopic, documentTopic]);

  assert.equal(documents.length, 2);
  assert.equal(documents[0]?.topic.id, "topic-a");
  assert.equal(documents[0]?.document.items[0]?.blocks?.[0]?.kind, "text");
  assert.equal(documents[1]?.topic.id, "topic-b");
  assert.equal(documents[1]?.document.items.length, 4);
  assert.equal(documents[1]?.document.items[0]?.id, "workspace");
});

test("buildEquationsTextbookPane overlays the textbook document onto an existing pane", () => {
  const pane = buildEquationsTextbookPane({
    ...DEFAULT_EQUATIONS_PANE_STATE,
    viewMode: "textbook",
    topicSourceId: "topic-b",
  }, [semanticTopic, documentTopic]);

  assert.equal(pane.viewMode, "textbook");
  assert.equal(pane.topicSourceId, "topic-b");
  assert.equal(pane.document?.items[0]?.title, "Textbook View");
  assert.equal(pane.cells.length, 1);
});
