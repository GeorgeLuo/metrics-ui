import type { VisualizationFrameState } from "./schema";

type NormalizeVisualizationFrameStateOptions = {
  fallback?: VisualizationFrameState | null;
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function cloneVisualizationFrameState(
  frame: VisualizationFrameState,
): VisualizationFrameState {
  return {
    mode: frame.mode,
    ...(typeof frame.pluginId === "string" ? { pluginId: frame.pluginId } : {}),
    ...(typeof frame.name === "string" ? { name: frame.name } : {}),
    ...(typeof frame.captureId === "string" ? { captureId: frame.captureId } : {}),
    ...(typeof frame.updatedAt === "string" ? { updatedAt: frame.updatedAt } : {}),
  };
}

export function normalizeVisualizationFrameState(
  value: unknown,
  options?: NormalizeVisualizationFrameStateOptions,
): VisualizationFrameState | null {
  if (!value || typeof value !== "object") {
    return options?.fallback ?? null;
  }

  const raw = value as Partial<VisualizationFrameState>;
  const mode: VisualizationFrameState["mode"] = raw.mode === "plugin" ? "plugin" : "builtin";
  const next: VisualizationFrameState = { mode };
  const pluginId = normalizeOptionalString(raw.pluginId);
  const name = normalizeOptionalString(raw.name);
  const captureId = normalizeOptionalString(raw.captureId);
  const updatedAt = normalizeOptionalString(raw.updatedAt);

  if (mode === "plugin" && pluginId) {
    next.pluginId = pluginId;
  }
  if (name) {
    next.name = name;
  }
  if (captureId) {
    next.captureId = captureId;
  }
  if (updatedAt) {
    next.updatedAt = updatedAt;
  }

  return next;
}
