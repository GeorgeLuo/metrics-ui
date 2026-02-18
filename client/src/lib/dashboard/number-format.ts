const DEFAULT_BYTES_PER_PROP = 24;
const DEFAULT_BYTES_PER_POINT = 16;
export const MIN_Y_DOMAIN_SPAN = 1e-6;

export { DEFAULT_BYTES_PER_PROP, DEFAULT_BYTES_PER_POINT };

export function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) {
    return "—";
  }
  let value = bytes as number;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatDomainNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toFixed(0);
  }
  if (abs >= 100) {
    return value.toFixed(1);
  }
  if (abs >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

export function sanitizeDomain(domain: [number, number]): [number, number] {
  let [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 100];
  }
  if (max <= min) {
    max = min + MIN_Y_DOMAIN_SPAN;
  }
  return [min, max];
}
