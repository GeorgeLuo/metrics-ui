export const SIDEBAR_SECTION_STACK_CLASS = "flex flex-col gap-2 px-2 py-2";
export const SIDEBAR_SECTION_TIGHT_STACK_CLASS = "flex flex-col gap-1 px-2 py-2";
export const SIDEBAR_BODY_TEXT_CLASS = "text-xs text-muted-foreground";
export const SIDEBAR_MUTED_COPY_CLASS = "text-[11px] leading-relaxed text-muted-foreground";
export const SIDEBAR_MICRO_COPY_CLASS = "text-[10px] leading-snug text-muted-foreground";
export const SIDEBAR_SECTION_KICKER_CLASS =
  "text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80";
export const SIDEBAR_DETAIL_TEXT_CLASS = "text-[11px] text-muted-foreground";
export const SIDEBAR_ERROR_TEXT_CLASS = "text-xs text-destructive";
export const SIDEBAR_MONO_VALUE_TEXT_CLASS = "font-mono text-foreground";
export const SIDEBAR_MONO_MUTED_TEXT_CLASS = "font-mono text-[10px] text-muted-foreground";
export const SIDEBAR_MINIMAL_SELECT_TRIGGER_CLASS =
  "h-6 px-2 py-1 text-xs bg-transparent border-border/50 shadow-none focus:ring-0 focus:ring-offset-0";

export function getSidebarSelectableItemClass(active: boolean): string {
  return [
    "w-full rounded-md border px-2 py-1.5 text-left text-[11px] leading-snug transition-colors",
    active
      ? "border-border bg-accent/45 text-foreground"
      : "border-border/60 bg-background/35 text-muted-foreground hover:bg-accent/18 hover:text-foreground",
  ].join(" ");
}

export function getSidebarCardClass(options?: { subdued?: boolean }): string {
  return [
    "rounded-md border px-2 py-2",
    options?.subdued
      ? "border-border/40 bg-background/20"
      : "border-border/60 bg-background/35",
  ].join(" ");
}

export function getSidebarDotButtonClass(
  tone: "yellow" | "red",
  options?: { active?: boolean; shape?: "circle" | "square" },
): string {
  const shapeClass = options?.shape === "square" ? "rounded-sm" : "rounded-full";
  if (tone === "red") {
    return [
      "h-3 w-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30",
      shapeClass,
      "bg-red-500/50 hover:bg-red-500",
    ].join(" ");
  }

  return [
    "h-3 w-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30",
    shapeClass,
    options?.active
      ? "bg-yellow-400/90 hover:bg-yellow-400"
      : "bg-yellow-400/20 hover:bg-yellow-400/30",
  ].join(" ");
}
