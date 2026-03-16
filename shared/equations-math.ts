import type { EquationsMathExpression } from "./schema";

export function cloneEquationsMathExpression(
  expression: EquationsMathExpression,
): EquationsMathExpression {
  return {
    kind: "latex",
    latex: expression.latex,
    ...(typeof expression.displayMode === "boolean" ? { displayMode: expression.displayMode } : {}),
  };
}

export function normalizeEquationsMathExpression(
  value: unknown,
): EquationsMathExpression | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Partial<EquationsMathExpression>;
  const displayMode = typeof raw.displayMode === "boolean" ? raw.displayMode : undefined;

  if (raw.kind === "latex" && typeof raw.latex === "string" && raw.latex.trim().length > 0) {
    return {
      kind: "latex",
      latex: raw.latex,
      ...(displayMode !== undefined ? { displayMode } : {}),
    };
  }

  return undefined;
}

export function resolveEquationsMathExpression(
  expression: EquationsMathExpression | null | undefined,
): { latex: string; displayMode: boolean } | null {
  if (!expression || expression.latex.trim().length === 0) {
    return null;
  }

  return {
    latex: expression.latex,
    displayMode: expression.displayMode ?? true,
  };
}
