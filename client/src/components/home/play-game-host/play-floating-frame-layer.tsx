import { createPortal } from "react-dom";
import type React from "react";
import { SubappFloatingFrame, ViewportFloatingFrame } from "@/components/floating-frame";
import { PlayFloatingFrameMount } from "./floating-frame-mount";
import type { PlayFloatingFrameRecord } from "./types";

type PlayFloatingFrameLayerProps = {
  gameLabel: string;
  containerRef: React.RefObject<HTMLDivElement>;
  frames: PlayFloatingFrameRecord[];
  onCloseFrame: (frameId: string) => void;
};

export function PlayFloatingFrameLayer({
  gameLabel,
  containerRef,
  frames,
  onCloseFrame,
}: PlayFloatingFrameLayerProps) {
  return (
    <>
      {frames.map((frame) => {
        const storageScope = frame.bounds === "viewport" ? "viewport" : "subapp";
        const floatingFrameProps = {
          title: frame.title,
          defaultPosition: frame.defaultPosition ?? { x: 16, y: 16 },
          defaultSize: frame.defaultSize ?? { width: 300, height: 220 },
          dataTestId: `play-floating-frame-${frame.id}`,
          stateStorageKey: `play-floating-frame:${gameLabel}:${storageScope}:${frame.id}`,
          className: "border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-sm",
          headerClassName: "border-b border-border/50 bg-muted/40",
          titleClassName: "text-xs text-foreground",
          dragHandleClassName: "text-muted-foreground hover:text-foreground",
          controlButtonClassName: "text-muted-foreground hover:text-foreground",
          contentClassName: "!p-0 overflow-hidden bg-background text-foreground",
          contentFill: true,
          contentMinHeight: 0,
          dragHint: frame.bounds === "viewport"
            ? `Drag ${frame.title} within the webapp.`
            : `Drag ${frame.title} within the Play area.`,
          minimizable: frame.minimizable ?? true,
          resizable: frame.resizable ?? true,
          minSize: frame.minSize ?? { width: 180, height: 140 },
          resizeHint: `Resize ${frame.title}.`,
          popoutable: frame.popoutable ?? false,
          popoutWindowName: `metrics-ui-play-${frame.id}`,
          popoutWindowTitle: `Metrics UI - ${frame.title}`,
          closeable: frame.closeable ?? false,
          closeHint: `Close ${frame.title}.`,
          onClose: frame.closeable ? () => onCloseFrame(frame.id) : undefined,
        };
        const content = <PlayFloatingFrameMount mount={frame.mount} />;
        if (frame.bounds === "viewport") {
          const viewportFrame = (
            <ViewportFloatingFrame {...floatingFrameProps}>
              {content}
            </ViewportFloatingFrame>
          );
          return typeof document === "undefined"
            ? viewportFrame
            : createPortal(viewportFrame, document.body, frame.id);
        }
        return (
          <SubappFloatingFrame key={frame.id} {...floatingFrameProps} containerRef={containerRef}>
            {content}
          </SubappFloatingFrame>
        );
      })}
    </>
  );
}
