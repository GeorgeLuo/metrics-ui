import { useEffect, useRef } from "react";

export function makeFrameMount(): HTMLDivElement {
  const mount = document.createElement("div");
  Object.assign(mount.style, {
    position: "relative",
    width: "100%",
    height: "100%",
    minWidth: "0",
    minHeight: "0",
    overflow: "hidden",
  });
  return mount;
}

export function PlayFloatingFrameMount({ mount }: { mount: HTMLDivElement }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.replaceChildren(mount);
    return () => {
      if (mount.parentElement === container) {
        container.removeChild(mount);
      }
    };
  }, [mount]);

  return <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden" />;
}
