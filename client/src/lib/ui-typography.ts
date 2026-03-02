export const UI_TEXT_SIZE = {
  sm: "text-sm",
  xs: "text-xs",
  micro: "text-[11px]",
} as const;

export const UI_TEXT_ROLE = {
  panelHeader: UI_TEXT_SIZE.sm,
  panelBody: UI_TEXT_SIZE.xs,
  menuItem: UI_TEXT_SIZE.xs,
  compactMeta: UI_TEXT_SIZE.micro,
} as const;
