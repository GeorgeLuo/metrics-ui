import test from "node:test";
import assert from "node:assert/strict";

import {
  compareEquationsTopicMetadata,
  filterEquationsTopics,
  getEquationsTopicGroupLabel,
  getEquationsTopicGroupForFormat,
  groupEquationsTopics,
  normalizeEquationsTopicGroup,
  normalizeEquationsTopicSearchTerms,
  normalizeEquationsTopicTags,
  organizeEquationsTopics,
  sortEquationsTopics,
  sortEquationsTopicsByOrderingScheme,
  type EquationsTopicBrowseMetadata,
} from "./topic-browser";

test("normalize topic metadata helpers trim and dedupe", () => {
  assert.equal(normalizeEquationsTopicGroup(" derivation "), "derivation");
  assert.equal(normalizeEquationsTopicGroup("cheatsheet"), null);
  assert.equal(normalizeEquationsTopicGroup("unknown"), null);
  assert.deepEqual(
    normalizeEquationsTopicTags([" Lorentzian ", "lorentzian", "Gamma", 1]),
    ["lorentzian", "gamma"],
  );
  assert.deepEqual(
    normalizeEquationsTopicSearchTerms([" Eq 13 ", "eq 13", "gamma "]),
    ["eq 13", "gamma"],
  );
  assert.equal(getEquationsTopicGroupLabel("glossary"), "Glossary");
  assert.equal(getEquationsTopicGroupForFormat("reference_sections"), "reference");
  assert.equal(getEquationsTopicGroupForFormat("glossary_reference"), "glossary");
});

test("compare and sort topics prefer sortKey before label", () => {
  const topics: EquationsTopicBrowseMetadata[] = [
    {
      label: "Equation 13",
      description: "",
      createdAt: "2026-03-26",
      updatedAt: "2026-04-02",
      sortKey: 140,
      group: "equation",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Equation 5",
      description: "",
      createdAt: "2026-03-25",
      updatedAt: "2026-04-02",
      sortKey: 50,
      group: "equation",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Identities Cheatsheet",
      description: "",
      createdAt: "2026-03-27",
      updatedAt: "2026-04-03",
      sortKey: 960,
      group: "reference",
      tags: [],
      searchTerms: [],
    },
  ];

  assert.ok(compareEquationsTopicMetadata(topics[1], topics[0]) < 0);
  assert.deepEqual(sortEquationsTopics(topics).map((topic) => topic.label), [
    "Equation 5",
    "Equation 13",
    "Identities Cheatsheet",
  ]);
});

test("filter topics matches against label, description, group, tags, and search terms", () => {
  const topics = [
    {
      label: "Equation 13",
      description: "Lorentzian choice for the frequency distribution.",
      createdAt: "2026-03-26",
      updatedAt: "2026-04-02",
      sortKey: 140,
      group: "equation",
      tags: ["lorentzian", "gamma"],
      searchTerms: ["eq 13", "g omega"],
    },
    {
      label: "Eq. 13 -> Eq. 14",
      description: "Near-threshold asymptotic derivation.",
      createdAt: "2026-03-27",
      updatedAt: "2026-04-02",
      sortKey: 150,
      group: "derivation",
      tags: ["asymptotic", "lorentzian"],
      searchTerms: ["square root law"],
    },
  ] satisfies EquationsTopicBrowseMetadata[];

  assert.deepEqual(filterEquationsTopics(topics, "lorentzian").map((topic) => topic.label), [
    "Equation 13",
    "Eq. 13 -> Eq. 14",
  ]);
  assert.deepEqual(filterEquationsTopics(topics, "derivation").map((topic) => topic.label), [
    "Eq. 13 -> Eq. 14",
  ]);
  assert.deepEqual(filterEquationsTopics(topics, "square root").map((topic) => topic.label), [
    "Eq. 13 -> Eq. 14",
  ]);
});

test("group topics buckets them by standard group order", () => {
  const topics = [
    {
      label: "Eq. 10 Addendum: Variables",
      description: "",
      createdAt: "2026-03-25",
      updatedAt: "2026-04-03",
      sortKey: 105,
      group: "glossary",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Equation 13",
      description: "",
      createdAt: "2026-03-26",
      updatedAt: "2026-04-02",
      sortKey: 140,
      group: "equation",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Identities Cheatsheet",
      description: "",
      createdAt: "2026-03-27",
      updatedAt: "2026-04-03",
      sortKey: 960,
      group: "reference",
      tags: [],
      searchTerms: [],
    },
  ] satisfies EquationsTopicBrowseMetadata[];

  assert.deepEqual(
    groupEquationsTopics(sortEquationsTopics(topics)).map((bucket) => ({
      label: bucket.label,
      topics: bucket.topics.map((topic) => topic.label),
    })),
    [
      { label: "Equation", topics: ["Equation 13"] },
      { label: "Reference", topics: ["Identities Cheatsheet"] },
      { label: "Glossary", topics: ["Eq. 10 Addendum: Variables"] },
    ],
  );
});

test("organize topics keeps canonical order flat by default", () => {
  const topics = [
    {
      label: "Equation 13",
      description: "",
      createdAt: "2026-03-26",
      updatedAt: "2026-04-02",
      sortKey: 140,
      group: "equation",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Eq. 13 -> Eq. 14",
      description: "",
      createdAt: "2026-03-27",
      updatedAt: "2026-04-02",
      sortKey: 150,
      group: "derivation",
      tags: [],
      searchTerms: [],
    },
  ] satisfies EquationsTopicBrowseMetadata[];

  assert.deepEqual(
    organizeEquationsTopics(sortEquationsTopics(topics), "canonical"),
    [{
      group: null,
      label: null,
      topics: sortEquationsTopics(topics),
    }],
  );
});

test("date orderings sort newest created or updated topics first", () => {
  const topics = [
    {
      label: "Equation 13",
      description: "",
      createdAt: "2026-03-26",
      updatedAt: "2026-04-02",
      sortKey: 140,
      group: "equation",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Eq. 10 Addendum: Variables",
      description: "",
      createdAt: "2026-03-25",
      updatedAt: "2026-04-03",
      sortKey: 105,
      group: "glossary",
      tags: [],
      searchTerms: [],
    },
    {
      label: "Equation 17",
      description: "",
      createdAt: "2026-04-02",
      updatedAt: "2026-04-02",
      sortKey: 180,
      group: "equation",
      tags: [],
      searchTerms: [],
    },
  ] satisfies EquationsTopicBrowseMetadata[];

  assert.deepEqual(
    sortEquationsTopicsByOrderingScheme(topics, "created_at").map((topic) => topic.label),
    ["Equation 17", "Equation 13", "Eq. 10 Addendum: Variables"],
  );
  assert.deepEqual(
    sortEquationsTopicsByOrderingScheme(topics, "updated_at").map((topic) => topic.label),
    ["Eq. 10 Addendum: Variables", "Equation 13", "Equation 17"],
  );
  assert.deepEqual(
    organizeEquationsTopics(topics, "updated_at"),
    [{
      group: null,
      label: null,
      topics: sortEquationsTopicsByOrderingScheme(topics, "updated_at"),
    }],
  );
});
