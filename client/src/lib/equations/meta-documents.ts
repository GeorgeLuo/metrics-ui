import type {
  EquationsFrameGridDocument,
  VisualizationState,
} from "@shared/schema";
import { normalizeEquationsFrameGridDocument } from "@shared/equations-framegrid-document";
import {
  validateEquationsFrameGridDocument,
  validateEquationsReferenceSectionsDocumentSource,
} from "@shared/equations-validation";

type EquationsMetaDocumentDefinition = {
  id: string;
  label: string;
  description: string;
  format: "reference_sections";
  path: string;
};

export type EquationsMetaDocumentOption = {
  id: string;
  label: string;
  description: string;
  document: EquationsFrameGridDocument;
};

const metaDocumentModules = import.meta.glob(
  "../../../../examples/**/equations-document.meta.*.json",
  { eager: true, import: "default" },
) as Record<string, unknown>;

const metaDocumentDefinitions: EquationsMetaDocumentDefinition[] = [
  {
    id: "topic-authoring-guidance",
    label: "Guidance",
    description: "Canonical topic-format and derivation authoring guidance.",
    format: "reference_sections",
    path: "../../../../examples/meta/equations-document.meta.topic-authoring-guidance.json",
  },
];

function normalizeMetaDocument(value: unknown): EquationsFrameGridDocument {
  return normalizeEquationsFrameGridDocument(value);
}

function signatureForDocument(document: EquationsFrameGridDocument): string {
  return JSON.stringify(normalizeMetaDocument(document));
}

function buildMetaDocumentOption(
  definition: EquationsMetaDocumentDefinition,
): EquationsMetaDocumentOption | null {
  const moduleValue = metaDocumentModules[definition.path];
  if (!moduleValue) {
    return null;
  }

  const sourceValidation = validateEquationsReferenceSectionsDocumentSource(moduleValue);
  if (sourceValidation.status === "error") {
    console.warn(
      `[equations-meta-documents] Skipping ${definition.id}: ${sourceValidation.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join(" | ")}`,
    );
    return null;
  }

  const document = normalizeMetaDocument(moduleValue);
  const documentValidation = validateEquationsFrameGridDocument(document);
  if (documentValidation.status === "error") {
    console.warn(
      `[equations-meta-documents] Skipping ${definition.id}: ${documentValidation.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join(" | ")}`,
    );
    return null;
  }

  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    document,
  };
}

export const EQUATIONS_META_DOCUMENTS = metaDocumentDefinitions
  .map((definition) => buildMetaDocumentOption(definition))
  .filter((entry): entry is EquationsMetaDocumentOption => entry !== null);

const metaDocumentById = new Map(
  EQUATIONS_META_DOCUMENTS.map((entry) => [entry.id, entry] as const),
);

const metaDocumentIdsBySignature = new Map(
  EQUATIONS_META_DOCUMENTS.map((entry) => [signatureForDocument(entry.document), entry.id] as const),
);

export function getEquationsMetaDocumentById(id: string): EquationsMetaDocumentOption | null {
  return metaDocumentById.get(id) ?? null;
}

export function identifyEquationsMetaDocument(
  equationsPane: VisualizationState["equationsPane"],
): string | null {
  if (!equationsPane.document) {
    return null;
  }
  return metaDocumentIdsBySignature.get(signatureForDocument(equationsPane.document)) ?? null;
}
