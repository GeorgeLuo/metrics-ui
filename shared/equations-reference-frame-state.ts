import type { EquationsReferenceFrameState } from "./schema";

type NormalizeEquationsReferenceFrameStateOptions = {
  fallback?: EquationsReferenceFrameState | null;
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function cloneEquationsReferenceFrameState(
  frame: EquationsReferenceFrameState,
): EquationsReferenceFrameState {
  return {
    topicId: frame.topicId,
    ...(typeof frame.itemId === "string" ? { itemId: frame.itemId } : {}),
    ...(typeof frame.anchorId === "string" ? { anchorId: frame.anchorId } : {}),
    ...(typeof frame.title === "string" ? { title: frame.title } : {}),
    ...(typeof frame.updatedAt === "string" ? { updatedAt: frame.updatedAt } : {}),
  };
}

export function normalizeEquationsReferenceFrameState(
  value: unknown,
  options?: NormalizeEquationsReferenceFrameStateOptions,
): EquationsReferenceFrameState | null {
  if (!value || typeof value !== "object") {
    return options?.fallback ?? null;
  }

  const raw = value as Partial<EquationsReferenceFrameState>;
  const topicId = normalizeOptionalString(raw.topicId);
  if (!topicId) {
    return options?.fallback ?? null;
  }

  const next: EquationsReferenceFrameState = { topicId };
  const itemId = normalizeOptionalString(raw.itemId);
  const anchorId = normalizeOptionalString(raw.anchorId);
  const title = normalizeOptionalString(raw.title);
  const updatedAt = normalizeOptionalString(raw.updatedAt);

  if (itemId) {
    next.itemId = itemId;
  }
  if (anchorId) {
    next.anchorId = anchorId;
  }
  if (title) {
    next.title = title;
  }
  if (updatedAt) {
    next.updatedAt = updatedAt;
  }

  return next;
}
