export type EquationsTopicGroup =
  | "equation"
  | "derivation"
  | "reference"
  | "glossary"
  | "freeform";

export type EquationsTopicFormat =
  | "semantic_layout"
  | "derivation"
  | "reference_sections"
  | "glossary_reference"
  | "freeform";

export type EquationsTopicOrderingScheme = "canonical" | "types";

export const EQUATIONS_TOPIC_GROUP_LABELS: Record<EquationsTopicGroup, string> = {
  equation: "Equation",
  derivation: "Derivation",
  reference: "Reference",
  glossary: "Glossary",
  freeform: "Freeform",
};

const GROUP_ORDER: EquationsTopicGroup[] = [
  "equation",
  "derivation",
  "reference",
  "glossary",
  "freeform",
];

const GROUP_RANK = new Map(
  GROUP_ORDER.map((group, index) => [group, index] as const),
);

export type EquationsTopicBrowseMetadata = {
  label: string;
  description: string;
  sortKey: number | null;
  group: EquationsTopicGroup | null;
  tags: string[];
  searchTerms: string[];
};

export type EquationsTopicGroupBucket<T extends EquationsTopicBrowseMetadata> = {
  group: EquationsTopicGroup | null;
  label: string | null;
  topics: T[];
};

export function getEquationsTopicGroupForFormat(format: EquationsTopicFormat): EquationsTopicGroup {
  switch (format) {
    case "semantic_layout":
      return "equation";
    case "derivation":
      return "derivation";
    case "reference_sections":
      return "reference";
    case "glossary_reference":
      return "glossary";
    case "freeform":
      return "freeform";
  }
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEquationsTopicGroup(value: unknown): EquationsTopicGroup | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized in EQUATIONS_TOPIC_GROUP_LABELS
    ? normalized as EquationsTopicGroup
    : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }
    const normalized = normalizeToken(entry);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    next.push(normalized);
  });
  return next;
}

export function normalizeEquationsTopicTags(value: unknown): string[] {
  return normalizeStringList(value);
}

export function normalizeEquationsTopicSearchTerms(value: unknown): string[] {
  return normalizeStringList(value);
}

export function getEquationsTopicGroupLabel(group: EquationsTopicGroup | null): string | null {
  return group ? EQUATIONS_TOPIC_GROUP_LABELS[group] : null;
}

export function compareEquationsTopicMetadata(
  left: EquationsTopicBrowseMetadata,
  right: EquationsTopicBrowseMetadata,
): number {
  if (left.sortKey !== right.sortKey) {
    if (left.sortKey === null) {
      return 1;
    }
    if (right.sortKey === null) {
      return -1;
    }
    return left.sortKey - right.sortKey;
  }

  if (left.group !== right.group) {
    const leftRank = left.group ? GROUP_RANK.get(left.group) ?? GROUP_ORDER.length : GROUP_ORDER.length;
    const rightRank = right.group ? GROUP_RANK.get(right.group) ?? GROUP_ORDER.length : GROUP_ORDER.length;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
  }

  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
}

export function sortEquationsTopics<T extends EquationsTopicBrowseMetadata>(topics: T[]): T[] {
  return [...topics].sort(compareEquationsTopicMetadata);
}

function buildTopicSearchHaystack(topic: EquationsTopicBrowseMetadata): string {
  const groupLabel = getEquationsTopicGroupLabel(topic.group);
  return [
    topic.label,
    topic.description,
    groupLabel ?? "",
    ...topic.tags,
    ...topic.searchTerms,
  ]
    .join(" ")
    .toLowerCase();
}

export function filterEquationsTopics<T extends EquationsTopicBrowseMetadata>(
  topics: T[],
  query: string,
): T[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return topics;
  }

  return topics.filter((topic) => {
    const haystack = buildTopicSearchHaystack(topic);
    return tokens.every((token) => haystack.includes(token));
  });
}

export function groupEquationsTopics<T extends EquationsTopicBrowseMetadata>(
  topics: T[],
): EquationsTopicGroupBucket<T>[] {
  const buckets = new Map<EquationsTopicGroup | null, T[]>();
  topics.forEach((topic) => {
    const key = topic.group ?? null;
    const current = buckets.get(key);
    if (current) {
      current.push(topic);
      return;
    }
    buckets.set(key, [topic]);
  });

  return [...buckets.entries()]
    .sort(([left], [right]) => {
      const leftRank = left ? GROUP_RANK.get(left) ?? GROUP_ORDER.length : GROUP_ORDER.length;
      const rightRank = right ? GROUP_RANK.get(right) ?? GROUP_ORDER.length : GROUP_ORDER.length;
      return leftRank - rightRank;
    })
    .map(([group, entries]) => ({
      group,
      label: group ? getEquationsTopicGroupLabel(group) ?? "Other" : "Other",
      topics: entries,
    }));
}

export function organizeEquationsTopics<T extends EquationsTopicBrowseMetadata>(
  topics: T[],
  orderingScheme: EquationsTopicOrderingScheme,
): EquationsTopicGroupBucket<T>[] {
  if (orderingScheme === "types") {
    return groupEquationsTopics(topics);
  }

  return [{
    group: null,
    label: null,
    topics,
  }];
}
