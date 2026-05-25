export type PlayPair = [number, number];

export type PlayGameCatalogModuleField = "moduleFile" | "moduleUrl";

export type PlayGameCatalogEntry = {
  id: string;
  label: string;
  description?: string;
  frameAspect: PlayPair;
  grid: PlayPair;
  moduleFile?: string;
  moduleUrl?: string;
};

export const DEFAULT_PLAY_GRID: PlayPair = [9, 6];

type NormalizePlayGameCatalogOptions = {
  fallbackGrid?: PlayPair;
  moduleField?: PlayGameCatalogModuleField;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizePlayPair(value: unknown, fallback: PlayPair): PlayPair {
  if (!Array.isArray(value) || value.length < 2) {
    return fallback;
  }
  const first = Number(value[0]);
  const second = Number(value[1]);
  return Number.isFinite(first) && Number.isFinite(second) && first > 0 && second > 0
    ? [first, second]
    : fallback;
}

function normalizePlayGameEntry(
  value: unknown,
  options: Required<NormalizePlayGameCatalogOptions>,
): PlayGameCatalogEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeText(record.id);
  const modulePath = normalizeText(record[options.moduleField]);
  if (!id || !modulePath) {
    return null;
  }

  const label = normalizeText(record.label) ?? id;
  const frameAspect = normalizePlayPair(record.frameAspect, options.fallbackGrid);
  const grid = normalizePlayPair(record.grid, frameAspect);
  const description = normalizeText(record.description);
  const entry: PlayGameCatalogEntry = {
    id,
    label,
    ...(description ? { description } : {}),
    frameAspect,
    grid,
  };
  entry[options.moduleField] = modulePath;
  return entry;
}

export function normalizePlayGameCatalog(
  payload: unknown,
  options: NormalizePlayGameCatalogOptions = {},
): PlayGameCatalogEntry[] {
  const normalizedOptions = {
    fallbackGrid: options.fallbackGrid ?? DEFAULT_PLAY_GRID,
    moduleField: options.moduleField ?? "moduleUrl",
  } satisfies Required<NormalizePlayGameCatalogOptions>;
  const record = asRecord(payload);
  const rawGames = Array.isArray(record?.games) ? record.games : [];
  return rawGames.flatMap((game) => {
    const entry = normalizePlayGameEntry(game, normalizedOptions);
    return entry ? [entry] : [];
  });
}
