import { createPortal } from "react-dom";
import type React from "react";
import { SubappFloatingFrame, ViewportFloatingFrame } from "@/components/floating-frame";
import { FloatingFrameMount } from "./floating-frame-mount";
import type { FloatingFrameRegistryFrameRecord } from "./types";

type FloatingFrameRegistryLayerProps = {
  scopeId: string;
  containerRef: React.RefObject<HTMLElement | null>;
  frames: FloatingFrameRegistryFrameRecord[];
  onCloseFrame: (frameId: string) => void;
  dataTestIdPrefix: string;
  storageKeyPrefix: string;
  popoutWindowNamePrefix: string;
  popoutWindowTitlePrefix: string;
  viewportDragScopeLabel: string;
  subappDragScopeLabel: string;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  dragHandleClassName?: string;
  controlButtonClassName?: string;
  contentClassName?: string;
};

export function FloatingFrameRegistryLayer({
  scopeId,
  containerRef,
  frames,
  onCloseFrame,
  dataTestIdPrefix,
  storageKeyPrefix,
  popoutWindowNamePrefix,
  popoutWindowTitlePrefix,
  viewportDragScopeLabel,
  subappDragScopeLabel,
  className,
  headerClassName,
  titleClassName,
  dragHandleClassName,
  controlButtonClassName,
  contentClassName,
}: FloatingFrameRegistryLayerProps) {
  return (
    <>
      {frames.map((frame) => {
        const storageScope = frame.bounds === "viewport" ? "viewport" : "subapp";
        const dragScopeLabel = frame.bounds === "viewport" ? viewportDragScopeLabel : subappDragScopeLabel;
        const frameProps = {
          title: frame.title,
          defaultPosition: frame.defaultPosition ?? { x: 16, y: 16 },
          defaultSize: frame.defaultSize ?? { width: 300, height: 220 },
          dataTestId: `${dataTestIdPrefix}-${frame.id}`,
          stateStorageKey: `${storageKeyPrefix}:${scopeId}:${storageScope}:${frame.id}`,
          className,
          headerClassName,
          titleClassName,
          dragHandleClassName,
          controlButtonClassName,
          contentClassName,
          contentFill: true,
          contentMinHeight: 0,
          dragHint: `Drag ${frame.title} within the ${dragScopeLabel}.`,
          minimizable: frame.minimizable ?? true,
          resizable: frame.resizable ?? true,
          minSize: frame.minSize ?? { width: 180, height: 140 },
          resizeHint: `Resize ${frame.title}.`,
          popoutable: frame.popoutable ?? false,
          popoutWindowName: `${popoutWindowNamePrefix}-${frame.id}`,
          popoutWindowTitle: `${popoutWindowTitlePrefix}${frame.title}`,
          closeable: frame.closeable ?? false,
          closeHint: `Close ${frame.title}.`,
          onClose: frame.closeable ? () => onCloseFrame(frame.id) : undefined,
        };
        const content = <FloatingFrameMount mount={frame.mount} />;
        if (frame.bounds === "viewport") {
          const viewportFrame = (
            <ViewportFloatingFrame key={frame.id} {...frameProps}>
              {content}
            </ViewportFloatingFrame>
          );
          return typeof document === "undefined"
            ? viewportFrame
            : createPortal(viewportFrame, document.body, frame.id);
        }
        return (
          <SubappFloatingFrame key={frame.id} {...frameProps} containerRef={containerRef}>
            {content}
          </SubappFloatingFrame>
        );
      })}
    </>
  );
}
