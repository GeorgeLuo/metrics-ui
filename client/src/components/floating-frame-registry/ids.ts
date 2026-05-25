export function normalizeFloatingFrameRegistryId(id: string, fallback: string): string {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || fallback;
}
