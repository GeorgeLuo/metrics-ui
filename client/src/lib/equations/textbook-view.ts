import type {
  EquationsFrameGridDocument,
  EquationsPaneState,
} from "@shared/schema";
import {
  DEFAULT_EQUATIONS_PANE_STATE,
  mergeEquationsPaneStatePatch,
} from "@shared/equations-pane";
import { buildEquationsFrameGridDocument } from "@shared/equations-framegrid-document";
import type { EquationsTopicOption } from "./topic-catalog";
import { sortEquationsTopics } from "./topic-browser";

export function getEquationsTextbookTopicAnchorId(topicId: string): string {
  return `textbook-topic-${topicId}`;
}

export type EquationsTextbookTopicDocument = {
  topic: EquationsTopicOption;
  document: EquationsFrameGridDocument;
};

export function buildEquationsTopicDocument(
  topic: EquationsTopicOption,
): EquationsFrameGridDocument {
  if (topic.payload.kind !== "semantic_layout") {
    return topic.payload.document;
  }

  const pane = mergeEquationsPaneStatePatch(
    DEFAULT_EQUATIONS_PANE_STATE,
    {
      topicSourceId: topic.id,
      content: topic.payload.content,
    },
    { replace: true },
  );

  return buildEquationsFrameGridDocument(pane);
}

export function buildEquationsTextbookTopicDocuments(
  topicOptions: EquationsTopicOption[],
): EquationsTextbookTopicDocument[] {
  return sortEquationsTopics(topicOptions).map((topic) => ({
    topic,
    document: buildEquationsTopicDocument(topic),
  }));
}

export function buildEquationsTextbookPane(
  base: EquationsPaneState,
  topicOptions: EquationsTopicOption[],
): EquationsPaneState {
  return mergeEquationsPaneStatePatch(base, {
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
          title: "Textbook View",
          body: "",
          presentation: "freeform",
          blocks: [],
          col: 0,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
        },
      ],
    },
  });
}
