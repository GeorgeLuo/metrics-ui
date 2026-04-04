import type {
  EquationsFrameGridDocument,
  EquationsPaneContent,
  VisualizationState,
} from "@shared/schema";
import { normalizeEquationsFrameGridDocument } from "@shared/equations-framegrid-document";
import { normalizeEquationsPaneState } from "@shared/equations-pane";
import {
  validateEquationsDerivationDocumentSource,
  validateEquationsFrameGridDocument,
  validateEquationsGlossaryReferenceDocumentSource,
  validateEquationsReferenceSectionsDocumentSource,
  validateEquationsSemanticLayoutSource,
} from "@shared/equations-validation";
import {
  type EquationsTopicFormat,
  type EquationsTopicGroup,
  getEquationsTopicGroupForFormat,
  normalizeEquationsTopicSearchTerms,
  normalizeEquationsTopicTags,
  sortEquationsTopics,
} from "./topic-browser";

type EquationsTopicDefinition = {
  id: string;
  label: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  format: EquationsTopicFormat;
  path: string;
  sortKey: number | null;
  group: EquationsTopicGroup | null;
  tags: string[];
  searchTerms: string[];
};

type EquationsTopicCatalogDefinition = {
  id: string;
  label: string;
  description: string;
  topics: EquationsTopicDefinition[];
};

export type EquationsTopicOption = {
  id: string;
  topicId: string;
  catalogId: string;
  catalogLabel: string;
  label: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  sortKey: number | null;
  group: EquationsTopicGroup | null;
  tags: string[];
  searchTerms: string[];
  format: EquationsTopicFormat;
  payload:
    | { kind: "semantic_layout"; content: EquationsPaneContent }
    | { kind: "derivation"; document: EquationsFrameGridDocument }
    | { kind: "reference_sections"; document: EquationsFrameGridDocument }
    | { kind: "glossary_reference"; document: EquationsFrameGridDocument }
    | { kind: "freeform"; document: EquationsFrameGridDocument };
};

export type EquationsTopicCatalog = {
  id: string;
  label: string;
  description: string;
  topics: EquationsTopicOption[];
};

const contentModules = import.meta.glob(
  "../../../../examples/**/equations-content.*.json",
  { eager: true, import: "default" },
) as Record<string, unknown>;

const documentModules = import.meta.glob(
  "../../../../examples/**/equations-document.*.json",
  { eager: true, import: "default" },
) as Record<string, unknown>;

const catalogModules = import.meta.glob(
  "../../../../examples/**/equations-topic-catalog.json",
  { eager: true, import: "default" },
) as Record<string, unknown>;

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeDescription(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeOptionalSortKey(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function normalizeTopicDefinition(value: unknown): EquationsTopicDefinition | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<EquationsTopicDefinition> & {
    kind?: "content" | "document";
  };
  const id = normalizeNonEmptyString(raw.id);
  const label = normalizeNonEmptyString(raw.label);
  const createdAt = normalizeDateString((raw as { createdAt?: unknown }).createdAt);
  const updatedAt = normalizeDateString((raw as { updatedAt?: unknown }).updatedAt);
  const format: EquationsTopicFormat | null = raw.format === "freeform"
    ? "freeform"
    : raw.format === "derivation"
      ? "derivation"
      : raw.format === "reference_sections"
        ? "reference_sections"
        : raw.format === "glossary_reference"
          ? "glossary_reference"
    : raw.format === "semantic_layout"
      ? "semantic_layout"
      : raw.kind === "document"
        ? "freeform"
        : raw.kind === "content"
          ? "semantic_layout"
          : null;
  const path = normalizeNonEmptyString(raw.path);
  if (!id || !label || !createdAt || !updatedAt || !format || !path) {
    return null;
  }

  return {
    id,
    label,
    description: normalizeDescription(raw.description),
    createdAt,
    updatedAt,
    format,
    path,
    sortKey: normalizeOptionalSortKey((raw as { sortKey?: unknown }).sortKey),
    group: getEquationsTopicGroupForFormat(format),
    tags: normalizeEquationsTopicTags((raw as { tags?: unknown }).tags),
    searchTerms: normalizeEquationsTopicSearchTerms((raw as { searchTerms?: unknown }).searchTerms),
  };
}

function normalizeTopicCatalogDefinition(value: unknown): EquationsTopicCatalogDefinition | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as {
    id?: unknown;
    label?: unknown;
    description?: unknown;
    topics?: unknown;
  };
  const id = normalizeNonEmptyString(raw.id);
  const label = normalizeNonEmptyString(raw.label);
  if (!id || !label || !Array.isArray(raw.topics)) {
    return null;
  }

  const topics = raw.topics
    .map((entry) => normalizeTopicDefinition(entry))
    .filter((entry): entry is EquationsTopicDefinition => entry !== null);

  if (topics.length === 0) {
    return null;
  }

  return {
    id,
    label,
    description: normalizeDescription(raw.description),
    topics,
  };
}

function resolveRelativeModulePath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) {
    return relativePath;
  }

  const segments = basePath.split("/");
  segments.pop();
  relativePath.split("/").forEach((segment) => {
    if (!segment || segment === ".") {
      return;
    }
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      }
      return;
    }
    segments.push(segment);
  });
  return segments.join("/");
}

function normalizeTopicContent(value: unknown): EquationsPaneContent {
  return normalizeEquationsPaneState({ content: value }).content;
}

function normalizeTopicDocument(value: unknown): EquationsFrameGridDocument {
  return normalizeEquationsFrameGridDocument(value);
}

function signatureForContent(content: EquationsPaneContent): string {
  return JSON.stringify(normalizeTopicContent(content));
}

function signatureForDocument(document: EquationsFrameGridDocument): string {
  return JSON.stringify(normalizeTopicDocument(document));
}

function formatValidationSummary(prefix: string, messages: string[]): string {
  return `${prefix}: ${messages.join(" | ")}`;
}

function buildTopicOption(
  catalog: EquationsTopicCatalogDefinition,
  definition: EquationsTopicDefinition,
  manifestPath: string,
): EquationsTopicOption | null {
  const modulePath = resolveRelativeModulePath(manifestPath, definition.path);
  const moduleValue = definition.format === "semantic_layout"
    ? contentModules[modulePath]
    : documentModules[modulePath];
  if (!moduleValue) {
    return null;
  }

  if (definition.format === "semantic_layout") {
    const report = validateEquationsSemanticLayoutSource(moduleValue);
    if (report.status === "error") {
      console.warn(
        formatValidationSummary(
          `[equations-topic-catalog] Skipping semantic layout topic ${catalog.id}:${definition.id}`,
          report.diagnostics.map((entry) => `${entry.path}: ${entry.message}`),
        ),
      );
      return null;
    }

    const content = normalizeTopicContent(moduleValue);
    return {
      id: `${catalog.id}:${definition.id}`,
      topicId: definition.id,
      catalogId: catalog.id,
      catalogLabel: catalog.label,
      label: definition.label,
      description: definition.description,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
      sortKey: definition.sortKey,
      group: definition.group,
      tags: definition.tags,
      searchTerms: definition.searchTerms,
      format: definition.format,
      payload: {
        kind: "semantic_layout",
        content,
      },
    };
  }

  if (definition.format === "derivation") {
    const report = validateEquationsDerivationDocumentSource(moduleValue);
    if (report.status === "error") {
      console.warn(
        formatValidationSummary(
          `[equations-topic-catalog] Skipping derivation topic ${catalog.id}:${definition.id}`,
          report.diagnostics.map((entry) => `${entry.path}: ${entry.message}`),
        ),
      );
      return null;
    }
  }

  if (definition.format === "reference_sections") {
    const report = validateEquationsReferenceSectionsDocumentSource(moduleValue);
    if (report.status === "error") {
      console.warn(
        formatValidationSummary(
          `[equations-topic-catalog] Skipping reference sections topic ${catalog.id}:${definition.id}`,
          report.diagnostics.map((entry) => `${entry.path}: ${entry.message}`),
        ),
      );
      return null;
    }
  }

  if (definition.format === "glossary_reference") {
    const report = validateEquationsGlossaryReferenceDocumentSource(moduleValue);
    if (report.status === "error") {
      console.warn(
        formatValidationSummary(
          `[equations-topic-catalog] Skipping glossary topic ${catalog.id}:${definition.id}`,
          report.diagnostics.map((entry) => `${entry.path}: ${entry.message}`),
        ),
      );
      return null;
    }
  }

  const document = normalizeTopicDocument(moduleValue);
  const documentValidationReport = validateEquationsFrameGridDocument(document);
  if (documentValidationReport.status === "error") {
    console.warn(
      formatValidationSummary(
        `[equations-topic-catalog] Skipping ${definition.format} topic ${catalog.id}:${definition.id}`,
        documentValidationReport.diagnostics.map((entry) => `${entry.path}: ${entry.message}`),
      ),
    );
    return null;
  }

  return {
    id: `${catalog.id}:${definition.id}`,
    topicId: definition.id,
    catalogId: catalog.id,
    catalogLabel: catalog.label,
    label: definition.label,
    description: definition.description,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    sortKey: definition.sortKey,
    group: definition.group,
    tags: definition.tags,
    searchTerms: definition.searchTerms,
    format: definition.format,
    payload: {
      kind: definition.format,
      document,
    },
  };
}

function buildEquationsTopicCatalogs(): EquationsTopicCatalog[] {
  return Object.entries(catalogModules).flatMap<EquationsTopicCatalog>(([manifestPath, manifestValue]) => {
    const catalog = normalizeTopicCatalogDefinition(manifestValue);
    if (!catalog) {
      return [];
    }

    const topics = sortEquationsTopics(catalog.topics
      .map((definition) => buildTopicOption(catalog, definition, manifestPath))
      .filter((option): option is EquationsTopicOption => option !== null));

    if (topics.length === 0) {
      return [];
    }

    return [{
      id: catalog.id,
      label: catalog.label,
      description: catalog.description,
      topics,
    }];
  });
}

export const EQUATIONS_TOPIC_CATALOGS = buildEquationsTopicCatalogs();
export const EQUATIONS_TOPIC_OPTIONS = EQUATIONS_TOPIC_CATALOGS.flatMap((catalog) => catalog.topics);

const catalogById = new Map(
  EQUATIONS_TOPIC_CATALOGS.map((catalog) => [catalog.id, catalog] as const),
);
const topicById = new Map(EQUATIONS_TOPIC_OPTIONS.map((option) => [option.id, option] as const));
const duplicateLegacyTopicIds = new Set<string>();
const topicIdsByLegacyId = new Map<string, string>();
EQUATIONS_TOPIC_OPTIONS.forEach((option) => {
  if (duplicateLegacyTopicIds.has(option.topicId)) {
    return;
  }
  const existing = topicIdsByLegacyId.get(option.topicId);
  if (existing) {
    topicIdsByLegacyId.delete(option.topicId);
    duplicateLegacyTopicIds.add(option.topicId);
    return;
  }
  topicIdsByLegacyId.set(option.topicId, option.id);
});
const contentTopicIdsBySignature = new Map(
  EQUATIONS_TOPIC_OPTIONS.flatMap((option) => option.payload.kind === "semantic_layout"
    ? [[signatureForContent(option.payload.content), option.id] as const]
    : []),
);
const documentTopicIdsBySignature = new Map(
  EQUATIONS_TOPIC_OPTIONS.flatMap((option) => option.payload.kind !== "semantic_layout"
    ? [[signatureForDocument(option.payload.document), option.id] as const]
    : []),
);

export function getEquationsTopicPayloadSignature(option: EquationsTopicOption): string {
  return option.payload.kind === "semantic_layout"
    ? signatureForContent(option.payload.content)
    : signatureForDocument(option.payload.document);
}

export function getDefaultEquationsTopicCatalogId(): string | null {
  return EQUATIONS_TOPIC_CATALOGS[0]?.id ?? null;
}

export function getEquationsTopicCatalogById(id: string): EquationsTopicCatalog | null {
  return catalogById.get(id) ?? null;
}

export function getEquationsTopicOptionsForCatalog(catalogId: string): EquationsTopicOption[] {
  return getEquationsTopicCatalogById(catalogId)?.topics ?? [];
}

export function getEquationsTopicOptionById(id: string): EquationsTopicOption | null {
  const direct = topicById.get(id);
  if (direct) {
    return direct;
  }
  const legacyId = topicIdsByLegacyId.get(id);
  return legacyId ? topicById.get(legacyId) ?? null : null;
}

export function identifyEquationsTopic(
  equationsPane: VisualizationState["equationsPane"],
): string | null {
  if (equationsPane.document) {
    return documentTopicIdsBySignature.get(signatureForDocument(equationsPane.document)) ?? null;
  }
  return contentTopicIdsBySignature.get(signatureForContent(equationsPane.content)) ?? null;
}
