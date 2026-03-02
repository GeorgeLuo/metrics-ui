import { useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DerivationGroup } from "@shared/schema";
import { normalizeDerivationGroups } from "@/lib/dashboard/derivation-utils";
import {
  DASHBOARD_STORAGE_KEYS,
  readStorageJson,
  readStorageString,
} from "@/lib/dashboard/storage";

export type DerivationPluginOutput = { key: string; label?: string };

export type DerivationPluginRecord = {
  id: string;
  name: string;
  description?: string;
  minInputs: number;
  maxInputs: number | null;
  outputs: DerivationPluginOutput[];
  uploadedAt: string;
  valid: boolean;
  error: string | null;
};

export type DerivationPluginSourceResponse = {
  pluginId: string;
  name: string;
  filename: string;
  bytes: number;
  truncated: boolean;
  source: string;
};

export type DerivationDragState = {
  groupId: string;
  fromIndex: number;
} | null;

export type DerivationDropState = {
  groupId: string;
  targetIndex: number;
  position: "before" | "after";
} | null;

type UseDerivationGroupsResult = {
  derivationGroups: DerivationGroup[];
  setDerivationGroups: Dispatch<SetStateAction<DerivationGroup[]>>;
  derivationPlugins: DerivationPluginRecord[];
  setDerivationPlugins: Dispatch<SetStateAction<DerivationPluginRecord[]>>;
  derivationPluginsError: string | null;
  setDerivationPluginsError: Dispatch<SetStateAction<string | null>>;
  isDerivationPluginSourceOpen: boolean;
  setIsDerivationPluginSourceOpen: Dispatch<SetStateAction<boolean>>;
  derivationPluginSource: DerivationPluginSourceResponse | null;
  setDerivationPluginSource: Dispatch<SetStateAction<DerivationPluginSourceResponse | null>>;
  derivationPluginSourceLoading: boolean;
  setDerivationPluginSourceLoading: Dispatch<SetStateAction<boolean>>;
  derivationPluginSourceError: string | null;
  setDerivationPluginSourceError: Dispatch<SetStateAction<string | null>>;
  isDerivationPluginSourceCopied: boolean;
  setIsDerivationPluginSourceCopied: Dispatch<SetStateAction<boolean>>;
  derivationPluginCopyResetTimerRef: MutableRefObject<number | null>;
  derivationPluginFileRef: MutableRefObject<HTMLInputElement | null>;
  activeDerivationGroupId: string;
  setActiveDerivationGroupId: Dispatch<SetStateAction<string>>;
  displayDerivationGroupId: string;
  setDisplayDerivationGroupId: Dispatch<SetStateAction<string>>;
  focusedDerivationGroupNameId: string;
  setFocusedDerivationGroupNameId: Dispatch<SetStateAction<string>>;
  derivationGroupNameDrafts: Record<string, string>;
  setDerivationGroupNameDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  derivationDragState: DerivationDragState;
  setDerivationDragState: Dispatch<SetStateAction<DerivationDragState>>;
  derivationDropState: DerivationDropState;
  setDerivationDropState: Dispatch<SetStateAction<DerivationDropState>>;
};

export function useDerivationGroups(): UseDerivationGroupsResult {
  const [derivationGroups, setDerivationGroups] = useState<DerivationGroup[]>(() => {
    const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.derivationGroups);
    return normalizeDerivationGroups(parsed);
  });
  const [derivationPlugins, setDerivationPlugins] = useState<DerivationPluginRecord[]>([]);
  const [derivationPluginsError, setDerivationPluginsError] = useState<string | null>(null);
  const [isDerivationPluginSourceOpen, setIsDerivationPluginSourceOpen] = useState(false);
  const [derivationPluginSource, setDerivationPluginSource] =
    useState<DerivationPluginSourceResponse | null>(null);
  const [derivationPluginSourceLoading, setDerivationPluginSourceLoading] = useState(false);
  const [derivationPluginSourceError, setDerivationPluginSourceError] = useState<string | null>(null);
  const [isDerivationPluginSourceCopied, setIsDerivationPluginSourceCopied] = useState(false);
  const derivationPluginCopyResetTimerRef = useRef<number | null>(null);
  const derivationPluginFileRef = useRef<HTMLInputElement | null>(null);
  const [activeDerivationGroupId, setActiveDerivationGroupId] = useState<string>(() => {
    return readStorageString(DASHBOARD_STORAGE_KEYS.activeDerivationGroupId) ?? "";
  });
  const [displayDerivationGroupId, setDisplayDerivationGroupId] = useState<string>(() => {
    return readStorageString(DASHBOARD_STORAGE_KEYS.displayDerivationGroupId) ?? "";
  });
  const [focusedDerivationGroupNameId, setFocusedDerivationGroupNameId] = useState<string>("");
  const [derivationGroupNameDrafts, setDerivationGroupNameDrafts] = useState<Record<string, string>>(
    {},
  );
  const [derivationDragState, setDerivationDragState] = useState<DerivationDragState>(null);
  const [derivationDropState, setDerivationDropState] = useState<DerivationDropState>(null);

  return {
    derivationGroups,
    setDerivationGroups,
    derivationPlugins,
    setDerivationPlugins,
    derivationPluginsError,
    setDerivationPluginsError,
    isDerivationPluginSourceOpen,
    setIsDerivationPluginSourceOpen,
    derivationPluginSource,
    setDerivationPluginSource,
    derivationPluginSourceLoading,
    setDerivationPluginSourceLoading,
    derivationPluginSourceError,
    setDerivationPluginSourceError,
    isDerivationPluginSourceCopied,
    setIsDerivationPluginSourceCopied,
    derivationPluginCopyResetTimerRef,
    derivationPluginFileRef,
    activeDerivationGroupId,
    setActiveDerivationGroupId,
    displayDerivationGroupId,
    setDisplayDerivationGroupId,
    focusedDerivationGroupNameId,
    setFocusedDerivationGroupNameId,
    derivationGroupNameDrafts,
    setDerivationGroupNameDrafts,
    derivationDragState,
    setDerivationDragState,
    derivationDropState,
    setDerivationDropState,
  };
}
