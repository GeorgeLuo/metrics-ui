import type { PlayPair } from "@shared/play-catalog";
import type {
  FloatingFrameRegistryFrameHandle,
  FloatingFrameRegistryFrameOptions,
} from "@/components/floating-frame-registry";
import type { PlaySidebarSection } from "@/lib/play/sidebar-sections";

export type PlayFloatingFrameOptions = FloatingFrameRegistryFrameOptions;
export type PlayFloatingFrameHandle = FloatingFrameRegistryFrameHandle;

export type PlayViewportSpec = {
  frameAspect?: PlayPair;
  grid?: PlayPair;
};

export type PlayGameHostProps = {
  gameLabel?: string;
  moduleUrl: string | null;
  columns: number;
  rows: number;
  onViewportSpecChange?: (spec: PlayViewportSpec | null) => void;
  onSidebarSectionsChange?: (sections: PlaySidebarSection[]) => void;
  onSidebarActionHandlerChange?: (handler: ((actionId: string, value?: unknown) => void) | null) => void;
  onDebugSnapshotChange?: (snapshot: unknown) => void;
};

export type PlayGameRuntimeContext = {
  container: HTMLElement;
  columns: number;
  rows: number;
  createFloatingFrame: (options: PlayFloatingFrameOptions) => PlayFloatingFrameHandle;
  setSidebarSections: (sections: unknown) => void;
  setSidebarActionHandler: (actionId: string, handler: ((value?: unknown) => void) | null) => void;
  setDebugSnapshot: (snapshot: unknown) => void;
  setViewportSpec: (spec: PlayViewportSpec | null) => void;
  frames: {
    createFloatingFrame: (options: PlayFloatingFrameOptions) => PlayFloatingFrameHandle;
  };
  sidebar: {
    setSections: (sections: unknown) => void;
    setActionHandler: (actionId: string, handler: ((value?: unknown) => void) | null) => void;
  };
  debug: {
    setSnapshot: (snapshot: unknown) => void;
  };
  viewport: {
    setSpec: (spec: PlayViewportSpec | null) => void;
  };
};

export type PlayGameInstance = {
  dispose?: () => void;
};

export type PlayGameModule = {
  createPlayGame?: (context: PlayGameRuntimeContext) => PlayGameInstance | void;
};
