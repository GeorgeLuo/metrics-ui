import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

const PANEL_WIDTH_PX = 280;
const HEADER_RIGHT_MARGIN_PX = 16;
const HEADER_BELOW_OFFSET_PX = 64;
const DEFAULT_HINT = "Hover over a control to see what it does.";
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
  const explicitHint = candidate.getAttribute("data-hint");
  if (explicitHint && explicitHint.trim().length > 0) {
    return explicitHint.trim();
  }
  const ariaLabel = candidate.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim().length > 0) {
    return ariaLabel.trim();
  }
  const title = candidate.getAttribute("title");
  if (title && title.trim().length > 0) {
    return title.trim();
  }
  const text = candidate.textContent?.trim();
  if (text && text.length > 0) {
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }
  return DEFAULT_HINT;
}

export function FloatingElement() {
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, Math.round(window.innerWidth - PANEL_WIDTH_PX - HEADER_RIGHT_MARGIN_PX)),
    y: HEADER_BELOW_OFFSET_PX,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hint, setHint] = useState(DEFAULT_HINT);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const lastHintRef = useRef(DEFAULT_HINT);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setIsDragging(true);
      dragOffsetRef.current = {
        x: event.clientX - position.x,
        y: event.clientY - position.y,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setPosition({
          x: moveEvent.clientX - dragOffsetRef.current.x,
          y: moveEvent.clientY - dragOffsetRef.current.y,
        });
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [position],
  );

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
    <div
      className="fixed z-[80] select-none"
      style={{
        left: position.x,
        top: position.y,
      }}
      data-testid="floating-element"
    >
      <div className="w-[280px] rounded-md border border-border/60 bg-background/85 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground cursor-grab active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            aria-label="Drag hint panel"
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
            data-hint-ignore="true"
          >
            <GripVertical className="h-3 w-3" />
            <span>Hints</span>
          </button>
          <button
            type="button"
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label={isCollapsed ? "Expand hint panel" : "Collapse hint panel"}
            data-testid="button-floating-toggle"
            data-hint-ignore="true"
          >
            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
        <div
          className="mt-1 text-xs text-foreground/90 leading-snug break-words"
          data-hint-ignore="true"
          hidden={isCollapsed}
        >
          {hint}
        </div>
      </div>
    </div>
  );
}
