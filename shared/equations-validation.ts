import {
  DEFAULT_EQUATIONS_PANE_STATE,
  mergeEquationsPaneStatePatch,
  normalizeEquationsPaneState,
} from "./equations-pane";
import type {
  EquationsFrameGridDocument,
  EquationsFrameGridItem,
  EquationsHitBoxDefinition,
  EquationsMappingEntry,
  EquationsPaneCard,
  EquationsPaneCardBlock,
  EquationsPaneContent,
  EquationsPaneState,
  EquationsPaneStatePatch,
  EquationsPiecewiseRow,
} from "./schema";
import { normalizeEquationsFrameGridDocument } from "./equations-framegrid-document";
import {
  DEFAULT_EQUATIONS_VALIDATION_RULES,
  type EquationsValidationDiagnostic,
  type EquationsValidationHitBoxNode,
  type EquationsValidationHitBoxSource,
  type EquationsValidationLatexNode,
  type EquationsValidationLatexSource,
  type EquationsValidationRule,
  type EquationsValidationRuleReporter,
  type EquationsValidationTextNode,
  type EquationsValidationTextSource,
} from "./equations-validation-rules";

export type {
  EquationsValidationDiagnostic,
  EquationsValidationHitBoxNode,
  EquationsValidationHitBoxSource,
  EquationsValidationLatexNode,
  EquationsValidationLatexSource,
  EquationsValidationRule,
  EquationsValidationRuleReporter,
  EquationsValidationTextNode,
  EquationsValidationTextSource,
} from "./equations-validation-rules";

export interface EquationsValidationReport {
  status: "ok" | "warn" | "error";
  errorCount: number;
  warningCount: number;
  diagnostics: EquationsValidationDiagnostic[];
}

type SemanticLayoutSlotKey = keyof EquationsPaneContent;

const SEMANTIC_LAYOUT_SLOT_KEYS: SemanticLayoutSlotKey[] = [
  "workspace",
  "details",
  "notes",
  "footer",
];

type ActiveRuleVisitor = {
  id: string;
  visitText?: (node: EquationsValidationTextNode, reporter: EquationsValidationRuleReporter) => void;
  visitLatex?: (node: EquationsValidationLatexNode, reporter: EquationsValidationRuleReporter) => void;
  visitHitBox?: (node: EquationsValidationHitBoxNode, reporter: EquationsValidationRuleReporter) => void;
};

function buildValidationReport(
  diagnostics: EquationsValidationDiagnostic[],
): EquationsValidationReport {
  const errorCount = diagnostics.filter((entry) => entry.severity === "error").length;
  const warningCount = diagnostics.filter((entry) => entry.severity === "warning").length;
  return {
    status: errorCount > 0 ? "error" : warningCount > 0 ? "warn" : "ok",
    errorCount,
    warningCount,
    diagnostics,
  };
}

function createActiveRuleVisitors(rules: EquationsValidationRule[]): ActiveRuleVisitor[] {
  return rules.map((rule) => {
    const visitor = rule.createVisitor();
    return {
      id: rule.id,
      visitText: visitor.visitText,
      visitLatex: visitor.visitLatex,
      visitHitBox: visitor.visitHitBox,
    };
  });
}

function createRuleReporter(
  ruleId: string,
  diagnostics: EquationsValidationDiagnostic[],
): EquationsValidationRuleReporter {
  return {
    addDiagnostic(diagnostic) {
      diagnostics.push({
        ...diagnostic,
        ruleId,
      });
    },
  };
}

function applyTextRules(
  node: EquationsValidationTextNode,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  rules.forEach((rule) => {
    rule.visitText?.(node, createRuleReporter(rule.id, diagnostics));
  });
}

function applyLatexRules(
  node: EquationsValidationLatexNode,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  rules.forEach((rule) => {
    rule.visitLatex?.(node, createRuleReporter(rule.id, diagnostics));
  });
}

function applyHitBoxRules(
  node: EquationsValidationHitBoxNode,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  rules.forEach((rule) => {
    rule.visitHitBox?.(node, createRuleReporter(rule.id, diagnostics));
  });
}

function validateText(
  value: string,
  path: string,
  source: EquationsValidationTextSource,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  applyTextRules({ value, path, source }, rules, diagnostics);
}

function validateLatex(
  latex: string,
  path: string,
  source: EquationsValidationLatexSource,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
  displayMode?: boolean,
) {
  applyLatexRules({ latex, path, source, displayMode }, rules, diagnostics);
}

function validateHitBox(
  hitBox: EquationsHitBoxDefinition,
  path: string,
  source: EquationsValidationHitBoxSource,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  applyHitBoxRules({ hitBox, path, source }, rules, diagnostics);
  validateLatex(hitBox.latex, `${path}.latex`, "hitbox_latex", rules, diagnostics, false);
}

function validateMappings(
  mappings: EquationsMappingEntry[],
  path: string,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  mappings.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (entry.kind === "latex") {
      validateLatex(
        entry.value,
        `${entryPath}.value`,
        "mapping_latex",
        rules,
        diagnostics,
        entry.displayMode ?? false,
      );
    } else {
      validateText(entry.value, `${entryPath}.value`, "mapping_text", rules, diagnostics);
    }
    if (entry.hitBox) {
      validateHitBox(entry.hitBox, `${entryPath}.hitBox`, "mapping_hitbox", rules, diagnostics);
    }
  });
}

function validatePiecewiseRows(
  rows: EquationsPiecewiseRow[],
  path: string,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  rows.forEach((row, index) => {
    validateMappings(row.expression, `${path}[${index}].expression`, rules, diagnostics);
    if (Array.isArray(row.condition)) {
      validateMappings(row.condition, `${path}[${index}].condition`, rules, diagnostics);
    }
  });
}

function validateBlocks(
  blocks: EquationsPaneCardBlock[],
  path: string,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  blocks.forEach((block, index) => {
    const blockPath = `${path}[${index}]`;
    if (block.kind === "text") {
      validateText(block.value, `${blockPath}.value`, "text_block", rules, diagnostics);
      if (typeof block.visualizationLabel === "string") {
        validateText(block.visualizationLabel, `${blockPath}.visualizationLabel`, "text_block", rules, diagnostics);
      }
      return;
    }
    if (block.kind === "math") {
      validateLatex(
        block.latex,
        `${blockPath}.latex`,
        "math",
        rules,
        diagnostics,
        block.displayMode ?? true,
      );
      return;
    }
    if (block.kind === "topic_reference") {
      validateText(block.topicId, `${blockPath}.topicId`, "text_block", rules, diagnostics);
      return;
    }
    if (block.kind === "mappings") {
      validateMappings(block.mappings, `${blockPath}.mappings`, rules, diagnostics);
      return;
    }
    validateBlocks(block.left, `${blockPath}.left`, rules, diagnostics);
    validateBlocks(block.right, `${blockPath}.right`, rules, diagnostics);
  });
}

function validateCard(
  card: Pick<EquationsPaneCard, "title" | "body" | "math" | "mappings" | "piecewiseRows" | "blocks">,
  path: string,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  validateText(card.title, `${path}.title`, "title", rules, diagnostics);
  validateText(card.body, `${path}.body`, "body", rules, diagnostics);
  if (card.math) {
    validateLatex(
      card.math.latex,
      `${path}.math.latex`,
      "math",
      rules,
      diagnostics,
      card.math.displayMode,
    );
  }
  if (Array.isArray(card.mappings)) {
    validateMappings(card.mappings, `${path}.mappings`, rules, diagnostics);
  }
  if (Array.isArray(card.piecewiseRows)) {
    validatePiecewiseRows(card.piecewiseRows, `${path}.piecewiseRows`, rules, diagnostics);
  }
  if (Array.isArray(card.blocks)) {
    validateBlocks(card.blocks, `${path}.blocks`, rules, diagnostics);
  }
}

function validateDocumentItems(
  items: EquationsFrameGridItem[],
  path: string,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  items.forEach((item, index) => {
    validateCard(item, `${path}[${index}]`, rules, diagnostics);
  });
}

function validateContentSlots(
  content: EquationsPaneContent,
  path: string,
  rules: ActiveRuleVisitor[],
  diagnostics: EquationsValidationDiagnostic[],
) {
  validateCard(content.workspace, `${path}.workspace`, rules, diagnostics);
  validateCard(content.details, `${path}.details`, rules, diagnostics);
  validateCard(content.notes, `${path}.notes`, rules, diagnostics);
  validateCard(content.footer, `${path}.footer`, rules, diagnostics);
}

export function validateEquationsPaneState(
  state: EquationsPaneState,
  options?: { rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const diagnostics: EquationsValidationDiagnostic[] = [];
  const rules = createActiveRuleVisitors(options?.rules ?? DEFAULT_EQUATIONS_VALIDATION_RULES);

  if (state.document) {
    validateDocumentItems(state.document.items, "document.items", rules, diagnostics);
  } else if (state.cells.length > 0) {
    validateDocumentItems(state.cells, "cells", rules, diagnostics);
  } else {
    validateContentSlots(state.content, "content", rules, diagnostics);
  }

  if (state.context.selectedHitBox) {
    validateHitBox(
      state.context.selectedHitBox.hitBox,
      "context.selectedHitBox.hitBox",
      "context_selected_hitbox",
      rules,
      diagnostics,
    );
  }
  if (state.context.selectedTextHighlight) {
    if (
      !Number.isInteger(state.context.selectedTextHighlight.startOffset)
      || state.context.selectedTextHighlight.startOffset < 0
    ) {
      diagnostics.push({
        severity: "error",
        ruleId: "invalid_highlight_offset",
        path: "context.selectedTextHighlight.startOffset",
        message: "Selected text highlight startOffset must be a non-negative integer.",
      });
    }
    if (
      !Number.isInteger(state.context.selectedTextHighlight.endOffset)
      || state.context.selectedTextHighlight.endOffset < 0
    ) {
      diagnostics.push({
        severity: "error",
        ruleId: "invalid_highlight_offset",
        path: "context.selectedTextHighlight.endOffset",
        message: "Selected text highlight endOffset must be a non-negative integer.",
      });
    }
    if (state.context.selectedTextHighlight.endOffset < state.context.selectedTextHighlight.startOffset) {
      diagnostics.push({
        severity: "error",
        ruleId: "invalid_highlight_offset",
        path: "context.selectedTextHighlight.endOffset",
        message: "Selected text highlight endOffset must be greater than or equal to startOffset.",
      });
    }
    validateText(
      state.context.selectedTextHighlight.text,
      "context.selectedTextHighlight.text",
      "body",
      rules,
      diagnostics,
    );
    if (typeof state.context.selectedTextHighlight.contextBefore === "string") {
      validateText(
        state.context.selectedTextHighlight.contextBefore,
        "context.selectedTextHighlight.contextBefore",
        "body",
        rules,
        diagnostics,
      );
    }
    if (typeof state.context.selectedTextHighlight.contextAfter === "string") {
      validateText(
        state.context.selectedTextHighlight.contextAfter,
        "context.selectedTextHighlight.contextAfter",
        "body",
        rules,
        diagnostics,
      );
    }
  }

  return buildValidationReport(diagnostics);
}

export function validateEquationsPaneStatePatchInput(
  value: EquationsPaneStatePatch | null | undefined,
  options?: { replace?: boolean; rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const state = mergeEquationsPaneStatePatch(DEFAULT_EQUATIONS_PANE_STATE, value, {
    replace: options?.replace,
  });
  return validateEquationsPaneState(state, { rules: options?.rules });
}

export function validateEquationsFrameGridDocument(
  document: EquationsFrameGridDocument,
  options?: { rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const diagnostics: EquationsValidationDiagnostic[] = [];
  const rules = createActiveRuleVisitors(options?.rules ?? DEFAULT_EQUATIONS_VALIDATION_RULES);
  validateDocumentItems(document.items, "document.items", rules, diagnostics);
  return buildValidationReport(diagnostics);
}

export function validateEquationsSemanticLayoutSource(
  value: unknown,
  options?: { rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const diagnostics: EquationsValidationDiagnostic[] = [];
  const rules = createActiveRuleVisitors(options?.rules ?? DEFAULT_EQUATIONS_VALIDATION_RULES);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      ruleId: "semantic_layout_source_shape",
      path: "content",
      message: "Semantic layout topics must be objects with workspace, details, notes, and footer slots.",
    });
    return buildValidationReport(diagnostics);
  }

  const raw = value as Partial<Record<SemanticLayoutSlotKey, unknown>>;
  let hasStructuralError = false;
  SEMANTIC_LAYOUT_SLOT_KEYS.forEach((slotKey) => {
    const slotValue = raw[slotKey];
    if (!slotValue || typeof slotValue !== "object" || Array.isArray(slotValue)) {
      hasStructuralError = true;
      diagnostics.push({
        severity: "error",
        ruleId: "semantic_layout_slot_required",
        path: `content.${slotKey}`,
        message: `Semantic layout topics must explicitly define the ${slotKey} slot.`,
      });
    }
  });

  if (!hasStructuralError) {
    const content = normalizeEquationsPaneState({ content: value }).content;
    validateContentSlots(content, "content", rules, diagnostics);
  }

  return buildValidationReport(diagnostics);
}

export function validateEquationsDerivationDocumentSource(
  value: unknown,
  options?: { rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const diagnostics: EquationsValidationDiagnostic[] = [];
  const rules = createActiveRuleVisitors(options?.rules ?? DEFAULT_EQUATIONS_VALIDATION_RULES);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      ruleId: "derivation_source_shape",
      path: "document",
      message: "Derivation topics must be document objects with a header section and a body section.",
    });
    return buildValidationReport(diagnostics);
  }

  const raw = value as {
    pattern?: unknown;
    intro?: unknown;
    steps?: unknown;
  };
  if (raw.pattern !== "parallel_walkthrough") {
    diagnostics.push({
      severity: "error",
      ruleId: "derivation_pattern_required",
      path: "document.pattern",
      message: "Derivation topics must use the parallel_walkthrough document pattern.",
    });
  }
  if (!Array.isArray(raw.intro) || raw.intro.length === 0) {
    diagnostics.push({
      severity: "error",
      ruleId: "derivation_header_required",
      path: "document.intro",
      message: "Derivation topics must define a non-empty header intro section.",
    });
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    diagnostics.push({
      severity: "error",
      ruleId: "derivation_steps_required",
      path: "document.steps",
      message: "Derivation topics must define at least one derivation step in the body.",
    });
  }

  const document = normalizeEquationsFrameGridDocument(value);
  if (
    document.items.length !== 2
    || document.items[0]?.id !== "header"
    || document.items[1]?.id !== "workspace"
  ) {
    diagnostics.push({
      severity: "error",
      ruleId: "derivation_document_layout",
      path: "document.items",
      message: "Derivation topics must normalize to exactly a header item followed by a workspace item.",
    });
  } else {
    validateDocumentItems(document.items, "document.items", rules, diagnostics);
  }

  return buildValidationReport(diagnostics);
}

export function validateEquationsReferenceSectionsDocumentSource(
  value: unknown,
  options?: { rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const diagnostics: EquationsValidationDiagnostic[] = [];
  const rules = createActiveRuleVisitors(options?.rules ?? DEFAULT_EQUATIONS_VALIDATION_RULES);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      ruleId: "reference_sections_source_shape",
      path: "document",
      message: "Reference section topics must be document objects with a sections array.",
    });
    return buildValidationReport(diagnostics);
  }

  const raw = value as {
    pattern?: unknown;
    intro?: unknown;
    sections?: unknown;
  };
  if (raw.pattern !== "reference_sections") {
    diagnostics.push({
      severity: "error",
      ruleId: "reference_sections_pattern_required",
      path: "document.pattern",
      message: "Reference section topics must use the reference_sections document pattern.",
    });
  }
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    diagnostics.push({
      severity: "error",
      ruleId: "reference_sections_required",
      path: "document.sections",
      message: "Reference section topics must define at least one section.",
    });
  } else {
    raw.sections.forEach((section, index) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        diagnostics.push({
          severity: "error",
          ruleId: "reference_section_shape",
          path: `document.sections[${index}]`,
          message: "Each reference section must be an object with title and content.",
        });
        return;
      }
      const rawSection = section as { title?: unknown; content?: unknown };
      if (typeof rawSection.title !== "string" || rawSection.title.trim().length === 0) {
        diagnostics.push({
          severity: "error",
          ruleId: "reference_section_title_required",
          path: `document.sections[${index}].title`,
          message: "Each reference section must define a non-empty title.",
        });
      }
      if (!Array.isArray(rawSection.content) || rawSection.content.length === 0) {
        diagnostics.push({
          severity: "error",
          ruleId: "reference_section_content_required",
          path: `document.sections[${index}].content`,
          message: "Each reference section must define non-empty content blocks.",
        });
      }
    });
  }

  const document = normalizeEquationsFrameGridDocument(value);
  const hasIntro = Array.isArray(raw.intro) && raw.intro.length > 0;
  const expectedItemCount = hasIntro ? 2 : 1;
  if (
    document.items.length !== expectedItemCount
    || (hasIntro && document.items[0]?.id !== "header")
    || document.items[expectedItemCount - 1]?.id !== "workspace"
  ) {
    diagnostics.push({
      severity: "error",
      ruleId: "reference_sections_document_layout",
      path: "document.items",
      message: "Reference section topics must normalize to a workspace item with an optional header item.",
    });
  } else {
    validateDocumentItems(document.items, "document.items", rules, diagnostics);
  }

  return buildValidationReport(diagnostics);
}

export function validateEquationsGlossaryReferenceDocumentSource(
  value: unknown,
  options?: { rules?: EquationsValidationRule[] },
): EquationsValidationReport {
  const diagnostics: EquationsValidationDiagnostic[] = [];
  const rules = createActiveRuleVisitors(options?.rules ?? DEFAULT_EQUATIONS_VALIDATION_RULES);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      ruleId: "glossary_reference_source_shape",
      path: "document",
      message: "Glossary topics must be document objects with an entries array.",
    });
    return buildValidationReport(diagnostics);
  }

  const raw = value as {
    pattern?: unknown;
    intro?: unknown;
    entries?: unknown;
  };
  if (raw.pattern !== "glossary_reference") {
    diagnostics.push({
      severity: "error",
      ruleId: "glossary_reference_pattern_required",
      path: "document.pattern",
      message: "Glossary topics must use the glossary_reference document pattern.",
    });
  }
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    diagnostics.push({
      severity: "error",
      ruleId: "glossary_entries_required",
      path: "document.entries",
      message: "Glossary topics must define at least one glossary entry.",
    });
  } else {
    raw.entries.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        diagnostics.push({
          severity: "error",
          ruleId: "glossary_entry_shape",
          path: `document.entries[${index}]`,
          message: "Each glossary entry must be an object with term and body.",
        });
        return;
      }
      const rawEntry = entry as { term?: unknown; body?: unknown };
      if (typeof rawEntry.term !== "string" || rawEntry.term.trim().length === 0) {
        diagnostics.push({
          severity: "error",
          ruleId: "glossary_entry_term_required",
          path: `document.entries[${index}].term`,
          message: "Each glossary entry must define a non-empty term.",
        });
      }
      if (!Array.isArray(rawEntry.body) || rawEntry.body.length === 0) {
        diagnostics.push({
          severity: "error",
          ruleId: "glossary_entry_body_required",
          path: `document.entries[${index}].body`,
          message: "Each glossary entry must define non-empty body blocks.",
        });
      }
    });
  }

  const document = normalizeEquationsFrameGridDocument(value);
  const hasIntro = Array.isArray(raw.intro) && raw.intro.length > 0;
  const expectedItemCount = hasIntro ? 2 : 1;
  if (
    document.items.length !== expectedItemCount
    || (hasIntro && document.items[0]?.id !== "header")
    || document.items[expectedItemCount - 1]?.id !== "workspace"
  ) {
    diagnostics.push({
      severity: "error",
      ruleId: "glossary_reference_document_layout",
      path: "document.items",
      message: "Glossary topics must normalize to a workspace item with an optional header item.",
    });
  } else {
    validateDocumentItems(document.items, "document.items", rules, diagnostics);
  }

  return buildValidationReport(diagnostics);
}
