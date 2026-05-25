export function normalizeRuntimeId(id: string, fallback: string | null): string | null {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || fallback;
}

export function normalizeFrameId(id: string): string {
  return normalizeRuntimeId(id, "frame") ?? "frame";
}

export function normalizeSidebarActionId(id: string): string | null {
  return normalizeRuntimeId(id, null);
}
