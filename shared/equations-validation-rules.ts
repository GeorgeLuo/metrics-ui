import katex from "katex";

import type { EquationsHitBoxDefinition } from "./schema";

export type EquationsValidationSeverity = "warning" | "error";

export interface EquationsValidationDiagnostic {
  severity: EquationsValidationSeverity;
  path: string;
  message: string;
  latex?: string;
  ruleId?: string;
}

export type EquationsValidationTextSource =
  | "title"
  | "body"
  | "text_block"
  | "mapping_text";

export type EquationsValidationLatexSource =
  | "math"
  | "mapping_latex"
  | "hitbox_latex";

export type EquationsValidationHitBoxSource =
  | "mapping_hitbox"
  | "context_selected_hitbox";

export interface EquationsValidationTextNode {
  path: string;
  value: string;
  source: EquationsValidationTextSource;
}

export interface EquationsValidationLatexNode {
  path: string;
  latex: string;
  source: EquationsValidationLatexSource;
  displayMode?: boolean;
}

export interface EquationsValidationHitBoxNode {
  path: string;
  hitBox: EquationsHitBoxDefinition;
  source: EquationsValidationHitBoxSource;
}

export interface EquationsValidationRuleReporter {
  addDiagnostic(
    diagnostic: Omit<EquationsValidationDiagnostic, "ruleId">,
  ): void;
}

export interface EquationsValidationRuleVisitor {
  visitText?(
    node: EquationsValidationTextNode,
    reporter: EquationsValidationRuleReporter,
  ): void;
  visitLatex?(
    node: EquationsValidationLatexNode,
    reporter: EquationsValidationRuleReporter,
  ): void;
  visitHitBox?(
    node: EquationsValidationHitBoxNode,
    reporter: EquationsValidationRuleReporter,
  ): void;
}

export interface EquationsValidationRule {
  id: string;
  createVisitor(): EquationsValidationRuleVisitor;
}

const LATEX_COMMAND_PATTERN = /\\[A-Za-z]+/g;

function collectLatexCommands(text: string): string[] {
  const matches = text.match(LATEX_COMMAND_PATTERN) ?? [];
  return [...new Set(matches)];
}

function formatLatexCommandList(commands: string[]): string {
  if (commands.length <= 4) {
    return commands.join(", ");
  }
  return `${commands.slice(0, 4).join(", ")}, ...`;
}

function normalizeKatexErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
}

export const equationsLatexParsesRule: EquationsValidationRule = {
  id: "latex_parses",
  createVisitor() {
    return {
      visitLatex(node, reporter) {
        const trimmed = node.latex.trim();
        if (trimmed.length === 0) {
          return;
        }
        try {
          katex.renderToString(trimmed, {
            displayMode: node.displayMode,
            output: "htmlAndMathml",
            throwOnError: true,
            strict: "ignore",
            trust: false,
          });
        } catch (error) {
          reporter.addDiagnostic({
            severity: "error",
            path: node.path,
            message: normalizeKatexErrorMessage(error),
            latex: trimmed,
          });
        }
      },
    };
  },
};

export const equationsPlainTextHasNoLatexCommandsRule: EquationsValidationRule = {
  id: "plain_text_has_no_latex_commands",
  createVisitor() {
    return {
      visitText(node, reporter) {
        const commands = collectLatexCommands(node.value);
        if (commands.length === 0) {
          return;
        }
        reporter.addDiagnostic({
          severity: "error",
          path: node.path,
          message: `Plain text contains LaTeX command(s) ${formatLatexCommandList(commands)}. Move math into a math block or latex mapping.`,
        });
      },
    };
  },
};

export const equationsHitBoxDefinitionsMatchByIdRule: EquationsValidationRule = {
  id: "hitbox_definitions_match_by_id",
  createVisitor() {
    const registry = new Map<string, { path: string; hitBox: EquationsHitBoxDefinition }>();

    return {
      visitHitBox(node, reporter) {
        const existing = registry.get(node.hitBox.id);
        if (!existing) {
          registry.set(node.hitBox.id, { path: node.path, hitBox: node.hitBox });
          return;
        }
        if (
          existing.hitBox.label !== node.hitBox.label
          || existing.hitBox.sequence !== node.hitBox.sequence
          || existing.hitBox.category !== node.hitBox.category
          || existing.hitBox.latex !== node.hitBox.latex
        ) {
          reporter.addDiagnostic({
            severity: "error",
            path: node.path,
            message: `Hit-box id "${node.hitBox.id}" does not match its earlier definition at ${existing.path}.`,
          });
        }
      },
    };
  },
};

export const DEFAULT_EQUATIONS_VALIDATION_RULES: EquationsValidationRule[] = [
  equationsLatexParsesRule,
  equationsPlainTextHasNoLatexCommandsRule,
  equationsHitBoxDefinitionsMatchByIdRule,
];
