export type PlaySidebarSectionRow =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "value";
      label: string;
      value: string;
    }
  | {
      kind: "editableValue";
      id: string;
      label: string;
      value: string;
      suffix?: string;
      hint?: string;
    }
  | {
      kind: "list";
      label?: string;
      items: string[];
    }
  | {
      kind: "toggle";
      id: string;
      label: string;
      enabled: boolean;
      enabledLabel?: string;
      disabledLabel?: string;
      hint?: string;
    };

export type PlaySidebarSection = {
  id: string;
  title: string;
  hint?: string;
  rows: PlaySidebarSectionRow[];
};

const MAX_SECTIONS = 8;
const MAX_ROWS_PER_SECTION = 24;
const MAX_LIST_ITEMS = 12;
const MAX_TEXT_LENGTH = 160;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeId(value: unknown): string | null {
  const text = normalizeText(value, 80);
  if (!text) {
    return null;
  }
  const id = text.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || null;
}

function normalizeRow(value: unknown): PlaySidebarSectionRow | null {
  if (typeof value === "string") {
    const text = normalizeText(value);
    return text ? { kind: "text", text } : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const label = normalizeText(record.label, 80);
  if (record.kind === "editableValue" || record.kind === "editable-value") {
    const id = normalizeId(record.id ?? record.actionId);
    const rowValue = normalizeText(record.value, 80);
    if (id && label && rowValue) {
      const suffix = normalizeText(record.suffix, 40);
      const hint = normalizeText(record.hint);
      return {
        kind: "editableValue",
        id,
        label,
        value: rowValue,
        ...(suffix ? { suffix } : {}),
        ...(hint ? { hint } : {}),
      };
    }
  }

  if (record.kind === "toggle") {
    const id = normalizeId(record.id ?? record.actionId);
    if (id && label) {
      const enabledLabel = normalizeText(record.enabledLabel, 40);
      const disabledLabel = normalizeText(record.disabledLabel, 40);
      const hint = normalizeText(record.hint);
      return {
        kind: "toggle",
        id,
        label,
        enabled: Boolean(record.enabled),
        ...(enabledLabel ? { enabledLabel } : {}),
        ...(disabledLabel ? { disabledLabel } : {}),
        ...(hint ? { hint } : {}),
      };
    }
  }

  const rowValue = normalizeText(record.value);
  if ((record.kind === "value" || record.kind === "kv" || rowValue) && label && rowValue) {
    return { kind: "value", label, value: rowValue };
  }

  if (record.kind === "list" || Array.isArray(record.items)) {
    const items = Array.isArray(record.items)
      ? record.items.flatMap((item) => {
        const text = normalizeText(item);
        return text ? [text] : [];
      }).slice(0, MAX_LIST_ITEMS)
      : [];
    if (items.length > 0) {
      return {
        kind: "list",
        ...(label ? { label } : {}),
        items,
      };
    }
  }

  const text = normalizeText(record.text);
  return text ? { kind: "text", text } : null;
}

function normalizeSection(value: unknown): PlaySidebarSection | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeId(record.id);
  const title = normalizeText(record.title, 80);
  if (!id || !title) {
    return null;
  }

  const rows = Array.isArray(record.rows)
    ? record.rows.flatMap((row) => {
      const normalized = normalizeRow(row);
      return normalized ? [normalized] : [];
    }).slice(0, MAX_ROWS_PER_SECTION)
    : [];
  if (rows.length === 0) {
    return null;
  }

  const hint = normalizeText(record.hint);
  return {
    id,
    title,
    ...(hint ? { hint } : {}),
    rows,
  };
}

export function normalizePlaySidebarSections(value: unknown): PlaySidebarSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((section) => {
    const normalized = normalizeSection(section);
    return normalized ? [normalized] : [];
  }).slice(0, MAX_SECTIONS);
}
