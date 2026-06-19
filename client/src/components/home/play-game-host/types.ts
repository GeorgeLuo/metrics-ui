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

export type PlayFrontViewSnapshotRequest = {
  actorId?: string;
  width?: number;
  height?: number;
};

export type PlayFrontViewSnapshotHandler = (
  options?: PlayFrontViewSnapshotRequest,
) => unknown;

export type PlayChaserControlInput = {
  motion?: string;
  forward?: boolean;
  reverse?: boolean;
  steering?: number;
};

export type PlayChaserControlHandler = (
  input?: PlayChaserControlInput,
) => unknown;
export type PlaySidebarActionHandler = (
  actionId: string,
  value?: unknown,
) => boolean;

export type PlayGameHostProps = {
  gameLabel?: string;
  moduleUrl: string | null;
  columns: number;
  rows: number;
  onViewportSpecChange?: (spec: PlayViewportSpec | null) => void;
  onSidebarSectionsChange?: (sections: PlaySidebarSection[]) => void;
  onSidebarActionHandlerChange?: (handler: PlaySidebarActionHandler | null) => void;
  onDebugSnapshotChange?: (snapshot: unknown) => void;
  onFrontViewSnapshotHandlerChange?: (handler: PlayFrontViewSnapshotHandler | null) => void;
  onChaserControlHandlerChange?: (handler: PlayChaserControlHandler | null) => void;
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
  getFrontViewSnapshot?: PlayFrontViewSnapshotHandler;
  setChaserControlInput?: PlayChaserControlHandler;
};

export type PlayGameModule = {
  createPlayGame?: (context: PlayGameRuntimeContext) => PlayGameInstance | void;
};
