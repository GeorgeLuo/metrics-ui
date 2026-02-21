import { useEffect, useRef, useState } from "react";

const DEFAULT_HINT = "Hover controls for quick guidance.";
const GENERIC_HINTS = {
  input: "Enter a value for this field.",
  toggle: "Toggle this option.",
  action: "Use this control.",
  source: "Set the file path or URL for this capture source.",
  poll: "Set how often this live source is polled.",
  windowStart: "Set the first tick of the visible window.",
  windowEnd: "Set the last tick of the visible window.",
  axisPrimaryMin: "Set the lower bound of the primary Y-axis.",
  axisPrimaryMax: "Set the upper bound of the primary Y-axis.",
  axisSecondaryMin: "Set the lower bound of the secondary Y-axis.",
  axisSecondaryMax: "Set the upper bound of the secondary Y-axis.",
  groupName: "Rename this derivation group.",
  scrub: "Scrub playback to a specific tick.",
  stepBack: "Step playback backward by one tick.",
  stepForward: "Step playback forward by one tick.",
  jumpBack: "Jump playback backward by ten ticks.",
  jumpForward: "Jump playback forward by ten ticks.",
  axis: "Adjust chart axis bounds or assignment.",
  speed: "Change playback speed.",
  clear: "Clear the current selection or view state.",
  close: "Close the current panel.",
  copy: "Copy this content to clipboard.",
  open: "Open details for this item.",
  create: "Create a new item.",
  select: "Select this item for analysis or display.",
  expand: "Expand or collapse this section.",
  mode: "Switch mode for this view.",
  connect: "Connect this session or source.",
  remove: "Remove this item from the current workspace.",
  start: "Start or resume processing.",
  pause: "Pause processing at the current state.",
  stop: "Stop playback and reset to the start.",
  seek: "Jump playback to the selected timeline position.",
  refresh: "Retry and pull the latest available data.",
  reset: "Reset this view to defaults.",
  upload: "Add a new data source to the dashboard.",
  docs: "Open documentation for reference.",
  fullscreen: "Toggle full-screen dashboard view.",
  display: "Show or hide this visual element.",
  derive: "Run a derivation from the selected inputs.",
  nav: "Switch views or open a page.",
  slider: "Adjust this value.",
  interactive: "Use this control to update the view.",
} as const;
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "switch",
  "checkbox",
  "radio",
  "tab",
  "slider",
  "menuitem",
]);

function isLikelyInteractive(element: HTMLElement): boolean {
  if (element.hasAttribute("data-hint")) {
    return true;
  }
  const tag = element.tagName.toLowerCase();
  if (tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea") {
    return true;
  }
  const role = (element.getAttribute("role") || "").toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) {
    return true;
  }
  return element.tabIndex >= 0;
}

const HINT_CONTAINER_HEIGHT_PX = 32;
const HINT_LINE_HEIGHT_PX = 13;
const HINT_LINES = 2;
const HINT_BOTTOM_PAD_PX = 1;
const DEFAULT_HEADSPACE_PX = 7;
const HINT_TEXT_BOX_HEIGHT_PX = HINT_LINE_HEIGHT_PX * HINT_LINES + HINT_BOTTOM_PAD_PX;
const MAX_HEADSPACE_PX = Math.max(0, HINT_CONTAINER_HEIGHT_PX - HINT_TEXT_BOX_HEIGHT_PX);
const HINT_HEADSPACE_PX = Math.min(DEFAULT_HEADSPACE_PX, MAX_HEADSPACE_PX);

function resolveHintFromTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return DEFAULT_HINT;
  }
  const candidate = target.closest<HTMLElement>(
    "[data-hint], [aria-label], [title], button, a, input, select, textarea, [role], [tabindex]",
  );
  if (!candidate || candidate.closest("[data-hint-ignore='true']")) {
    return DEFAULT_HINT;
  }
  if (!isLikelyInteractive(candidate)) {
    return DEFAULT_HINT;
  }
  const tag = candidate.tagName.toLowerCase();
  const role = (candidate.getAttribute("role") || "").toLowerCase();
  const intentText = [
    candidate.getAttribute("data-testid") || "",
    candidate.getAttribute("data-hint") || "",
    candidate.getAttribute("aria-label") || "",
    candidate.getAttribute("title") || "",
    candidate.getAttribute("placeholder") || "",
    candidate.textContent || "",
  ]
    .join(" ")
    .toLowerCase();

  const matches = (pattern: RegExp) => pattern.test(intentText);

  if (matches(/\bcapture file source\b|\blive source\b|\bsource\b/)) {
    return GENERIC_HINTS.source;
  }
  if (matches(/\bpoll(ing)? interval\b|\bpoll seconds\b|\bpoll\b/)) {
    return GENERIC_HINTS.poll;
  }
  if (matches(/\bwindow start\b/)) {
    return GENERIC_HINTS.windowStart;
  }
  if (matches(/\bwindow end\b/)) {
    return GENERIC_HINTS.windowEnd;
  }
  if (matches(/\bprimary axis minimum\b/)) {
    return GENERIC_HINTS.axisPrimaryMin;
  }
  if (matches(/\bprimary axis maximum\b/)) {
    return GENERIC_HINTS.axisPrimaryMax;
  }
  if (matches(/\bsecondary axis minimum\b/)) {
    return GENERIC_HINTS.axisSecondaryMin;
  }
  if (matches(/\bsecondary axis maximum\b/)) {
    return GENERIC_HINTS.axisSecondaryMax;
  }
  if (matches(/\bderivation group name\b/)) {
    return GENERIC_HINTS.groupName;
  }
  if (matches(/\bplayback position\b/)) {
    return GENERIC_HINTS.scrub;
  }
  if (matches(/\bstep backward\b/)) {
    return GENERIC_HINTS.stepBack;
  }
  if (matches(/\bstep forward\b/)) {
    return GENERIC_HINTS.stepForward;
  }
  if (matches(/\brewind\b/)) {
    return GENERIC_HINTS.jumpBack;
  }
  if (matches(/\bfast forward\b/)) {
    return GENERIC_HINTS.jumpForward;
  }
  if (matches(/\b(clear|dismiss)\b/)) {
    return GENERIC_HINTS.clear;
  }
  if (matches(/\b(close|done editing)\b/)) {
    return GENERIC_HINTS.close;
  }
  if (matches(/\b(copy)\b/)) {
    return GENERIC_HINTS.copy;
  }
  if (matches(/\b(view|open|source|details)\b/)) {
    return GENERIC_HINTS.open;
  }
  if (matches(/\b(create|new group|add group)\b/)) {
    return GENERIC_HINTS.create;
  }
  if (matches(/\b(select|deselect)\b/)) {
    return GENERIC_HINTS.select;
  }
  if (matches(/\b(expand|collapse|tree)\b/)) {
    return GENERIC_HINTS.expand;
  }
  if (matches(/\b(mode|theme|light mode|dark mode)\b/)) {
    return GENERIC_HINTS.mode;
  }
  if (matches(/\b(primary axis|secondary axis|\\by2\\b|axis minimum|axis maximum|axis)\\b/)) {
    return GENERIC_HINTS.axis;
  }
  if (matches(/\b(speed|playback speed)\\b/)) {
    return GENERIC_HINTS.speed;
  }
  if (matches(/\b(connect|take over|takeover)\b/)) {
    return GENERIC_HINTS.connect;
  }
  if (matches(/\b(upload|add live|add stream|add source|file)\b/)) {
    return GENERIC_HINTS.upload;
  }
  if (matches(/\b(remove|delete)\b/)) {
    return GENERIC_HINTS.remove;
  }
  if (matches(/\b(play|start|run|resume)\b/)) {
    return GENERIC_HINTS.start;
  }
  if (matches(/\b(pause)\b/)) {
    return GENERIC_HINTS.pause;
  }
  if (matches(/\b(stop)\b/)) {
    return GENERIC_HINTS.stop;
  }
  if (matches(/\b(seek|step|tick|rewind|fast forward|forward|backward)\b/)) {
    return GENERIC_HINTS.seek;
  }
  if (matches(/\b(refresh|retry|reconnect)\b/)) {
    return GENERIC_HINTS.refresh;
  }
  if (matches(/\b(reset|full view|window)\b/)) {
    return GENERIC_HINTS.reset;
  }
  if (matches(/\b(derivation|derive)\b/)) {
    return GENERIC_HINTS.derive;
  }
  if (matches(/\b(fullscreen|full-screen)\b/)) {
    return GENERIC_HINTS.fullscreen;
  }
  if (matches(/\b(show|hide|display|visible|visibility)\b/)) {
    return GENERIC_HINTS.display;
  }
  if (matches(/\b(docs|documentation|raw)\b/)) {
    return GENERIC_HINTS.docs;
  }
  if (matches(/\b(previous|next)\b/)) {
    return GENERIC_HINTS.nav;
  }
  if (tag === "a" || role === "link" || role === "tab") {
    return GENERIC_HINTS.nav;
  }
  if (
    role === "switch" ||
    role === "checkbox" ||
    role === "radio" ||
    tag === "input" && ["checkbox", "radio"].includes((candidate as HTMLInputElement).type)
  ) {
    return GENERIC_HINTS.toggle;
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return GENERIC_HINTS.input;
  }
  if (role === "slider") {
    return GENERIC_HINTS.slider;
  }
  if (tag === "button" || role === "button" || role === "menuitem") {
    return GENERIC_HINTS.action;
  }
  return GENERIC_HINTS.interactive;
}

export function HintingPanel() {
  const [hint, setHint] = useState(DEFAULT_HINT);
  const lastHintRef = useRef(DEFAULT_HINT);

  useEffect(() => {
    const handlePointerOver = (event: MouseEvent) => {
      const next = resolveHintFromTarget(event.target);
      if (lastHintRef.current === next) {
        return;
      }
      lastHintRef.current = next;
      setHint(next);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const next = resolveHintFromTarget(event.target);
      if (lastHintRef.current === next) {
        return;
      }
      lastHintRef.current = next;
      setHint(next);
    };
    window.addEventListener("mouseover", handlePointerOver);
    window.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("mouseover", handlePointerOver);
      window.removeEventListener("focusin", handleFocusIn);
    };
  }, []);

  return (
    <div className="select-none border-t border-border/60" data-testid="hinting-panel">
      <div className="bg-transparent px-2" style={{ height: `${HINT_CONTAINER_HEIGHT_PX}px` }}>
        <div className="h-full px-2">
          <div
            className="h-full min-w-0 flex items-start text-[13px] text-foreground/90"
            data-hint-ignore="true"
            title={hint}
            style={{ paddingTop: `${HINT_HEADSPACE_PX}px` }}
          >
            <span
              className="block flex-1 min-w-0 overflow-hidden break-words"
              style={{
                lineHeight: `${HINT_LINE_HEIGHT_PX}px`,
                maxHeight: `${HINT_TEXT_BOX_HEIGHT_PX}px`,
                paddingBottom: `${HINT_BOTTOM_PAD_PX}px`,
              }}
            >
              {hint}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
