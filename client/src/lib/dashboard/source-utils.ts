export function isDerivedCaptureSource(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("derive://") || trimmed.startsWith("derive:/");
}
