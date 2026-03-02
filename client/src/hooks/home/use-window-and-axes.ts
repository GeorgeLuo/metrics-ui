import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PlaybackState } from "@shared/schema";
import {
  formatDomainNumber,
  MIN_Y_DOMAIN_SPAN,
  sanitizeDomain,
} from "@/lib/dashboard/number-format";

type WindowAndAxesOptions = {
  playbackState: PlaybackState;
  setPlaybackState: Dispatch<SetStateAction<PlaybackState>>;
  initialWindowSize?: number;
};

type WindowAndAxesResult = {
  windowSize: number;
  setWindowSize: Dispatch<SetStateAction<number>>;
  windowStart: number;
  setWindowStart: Dispatch<SetStateAction<number>>;
  windowEnd: number;
  setWindowEnd: Dispatch<SetStateAction<number>>;
  isWindowed: boolean;
  setIsWindowed: Dispatch<SetStateAction<boolean>>;
  resetViewVersion: number;
  setResetViewVersion: Dispatch<SetStateAction<number>>;
  windowStartInput: string;
  setWindowStartInput: Dispatch<SetStateAction<string>>;
  windowEndInput: string;
  setWindowEndInput: Dispatch<SetStateAction<string>>;
  manualYPrimaryDomain: [number, number] | null;
  setManualYPrimaryDomain: Dispatch<SetStateAction<[number, number] | null>>;
  manualYSecondaryDomain: [number, number] | null;
  setManualYSecondaryDomain: Dispatch<SetStateAction<[number, number] | null>>;
  resolvedYPrimaryDomain: [number, number];
  setResolvedYPrimaryDomain: Dispatch<SetStateAction<[number, number]>>;
  resolvedYSecondaryDomain: [number, number];
  setResolvedYSecondaryDomain: Dispatch<SetStateAction<[number, number]>>;
  yPrimaryMinInput: string;
  setYPrimaryMinInput: Dispatch<SetStateAction<string>>;
  yPrimaryMaxInput: string;
  setYPrimaryMaxInput: Dispatch<SetStateAction<string>>;
  ySecondaryMinInput: string;
  setYSecondaryMinInput: Dispatch<SetStateAction<string>>;
  ySecondaryMaxInput: string;
  setYSecondaryMaxInput: Dispatch<SetStateAction<string>>;
  isAutoScroll: boolean;
  setIsAutoScroll: Dispatch<SetStateAction<boolean>>;
  windowStartEditingRef: MutableRefObject<boolean>;
  windowEndEditingRef: MutableRefObject<boolean>;
  yPrimaryMinEditingRef: MutableRefObject<boolean>;
  yPrimaryMaxEditingRef: MutableRefObject<boolean>;
  ySecondaryMinEditingRef: MutableRefObject<boolean>;
  ySecondaryMaxEditingRef: MutableRefObject<boolean>;
  applyWindowRange: (startTick: number, endTick: number) => { start: number; end: number };
  handleWindowSizeChange: (size: number) => void;
  handleWindowStartChange: (startTick: number) => void;
  handleWindowEndChange: (endTick: number) => void;
  handleWindowRangeChange: (startTick: number, endTick: number) => void;
  commitWindowStartInput: (rawValue: string) => void;
  commitWindowEndInput: (rawValue: string) => void;
  handleChartDomainChange: (domain: { yPrimary: [number, number]; ySecondary: [number, number] }) => void;
  commitYPrimaryBoundary: (boundary: "min" | "max", rawValue: string) => void;
  commitYSecondaryBoundary: (boundary: "min" | "max", rawValue: string) => void;
  handleYPrimaryRangeChange: (min: number, max: number) => void;
  handleYSecondaryRangeChange: (min: number, max: number) => void;
  handleResetWindow: () => void;
  handleAutoScrollChange: (enabled: boolean) => void;
};

export function useWindowAndAxes({
  playbackState,
  setPlaybackState,
  initialWindowSize = 50,
}: WindowAndAxesOptions): WindowAndAxesResult {
  const [windowSize, setWindowSize] = useState(initialWindowSize);
  const [windowStart, setWindowStart] = useState(1);
  const [windowEnd, setWindowEnd] = useState(initialWindowSize);
  const [isWindowed, setIsWindowed] = useState(false);
  const [resetViewVersion, setResetViewVersion] = useState(0);
  const [windowStartInput, setWindowStartInput] = useState(String(windowStart));
  const [windowEndInput, setWindowEndInput] = useState(String(windowEnd));
  const [manualYPrimaryDomain, setManualYPrimaryDomain] = useState<[number, number] | null>(null);
  const [manualYSecondaryDomain, setManualYSecondaryDomain] = useState<[number, number] | null>(null);
  const [resolvedYPrimaryDomain, setResolvedYPrimaryDomain] = useState<[number, number]>([0, 100]);
  const [resolvedYSecondaryDomain, setResolvedYSecondaryDomain] = useState<[number, number]>([0, 100]);
  const [yPrimaryMinInput, setYPrimaryMinInput] = useState("0");
  const [yPrimaryMaxInput, setYPrimaryMaxInput] = useState("100");
  const [ySecondaryMinInput, setYSecondaryMinInput] = useState("0");
  const [ySecondaryMaxInput, setYSecondaryMaxInput] = useState("100");
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  const windowStartEditingRef = useRef(false);
  const windowEndEditingRef = useRef(false);
  const yPrimaryMinEditingRef = useRef(false);
  const yPrimaryMaxEditingRef = useRef(false);
  const ySecondaryMinEditingRef = useRef(false);
  const ySecondaryMaxEditingRef = useRef(false);

  useEffect(() => {
    if (!windowStartEditingRef.current) {
      setWindowStartInput(String(windowStart));
    }
  }, [windowStart]);

  useEffect(() => {
    if (!windowEndEditingRef.current) {
      setWindowEndInput(String(windowEnd));
    }
  }, [windowEnd]);

  useEffect(() => {
    if (!yPrimaryMinEditingRef.current) {
      setYPrimaryMinInput(formatDomainNumber(resolvedYPrimaryDomain[0]));
    }
    if (!yPrimaryMaxEditingRef.current) {
      setYPrimaryMaxInput(formatDomainNumber(resolvedYPrimaryDomain[1]));
    }
  }, [resolvedYPrimaryDomain]);

  useEffect(() => {
    if (!ySecondaryMinEditingRef.current) {
      setYSecondaryMinInput(formatDomainNumber(resolvedYSecondaryDomain[0]));
    }
    if (!ySecondaryMaxEditingRef.current) {
      setYSecondaryMaxInput(formatDomainNumber(resolvedYSecondaryDomain[1]));
    }
  }, [resolvedYSecondaryDomain]);

  const applyWindowRange = useCallback(
    (startTick: number, endTick: number) => {
      const maxTick = Math.max(1, playbackState.totalTicks || 1);
      let start = Number.isFinite(startTick) ? Math.floor(startTick) : 1;
      let end = Number.isFinite(endTick) ? Math.floor(endTick) : 1;
      start = Math.max(1, start);
      end = Math.max(1, end);
      if (end > maxTick) {
        end = maxTick;
      }
      if (start > end) {
        start = end;
      }
      setWindowStart(start);
      setWindowEnd(end);
      setPlaybackState((prev) => ({
        ...prev,
        currentTick: end,
      }));
      return { start, end };
    },
    [playbackState.totalTicks, setPlaybackState],
  );

  const handleWindowSizeChange = useCallback(
    (size: number) => {
      if (!Number.isFinite(size) || size <= 0) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      const safeSize = Math.max(1, Math.floor(size));
      setWindowSize(safeSize);
      setIsAutoScroll(false);
      setIsWindowed(true);
      const end = isAutoScroll ? playbackState.currentTick : windowEnd;
      applyWindowRange(end - safeSize + 1, end);
    },
    [applyWindowRange, isAutoScroll, playbackState.currentTick, setPlaybackState, windowEnd],
  );

  const handleWindowStartChange = useCallback(
    (startTick: number) => {
      if (!Number.isFinite(startTick)) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      setIsAutoScroll(false);
      setIsWindowed(true);
      const start = Math.max(1, Math.floor(startTick));
      const end = start + windowSize - 1;
      applyWindowRange(start, end);
    },
    [applyWindowRange, setPlaybackState, windowSize],
  );

  const handleWindowEndChange = useCallback(
    (endTick: number) => {
      if (!Number.isFinite(endTick)) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      setIsAutoScroll(false);
      setIsWindowed(true);
      const end = Math.max(1, Math.floor(endTick));
      const start = end - windowSize + 1;
      applyWindowRange(start, end);
    },
    [applyWindowRange, setPlaybackState, windowSize],
  );

  const handleWindowRangeChange = useCallback(
    (startTick: number, endTick: number) => {
      if (!Number.isFinite(startTick) && !Number.isFinite(endTick)) {
        return;
      }
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      setIsAutoScroll(false);
      setIsWindowed(true);
      const window = applyWindowRange(startTick, endTick);
      setWindowSize(Math.max(1, window.end - window.start + 1));
    },
    [applyWindowRange, setPlaybackState],
  );

  const commitWindowStartInput = useCallback(
    (rawValue: string) => {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        setWindowStartInput(String(windowStart));
        return;
      }
      handleWindowStartChange(parsed);
    },
    [handleWindowStartChange, windowStart],
  );

  const commitWindowEndInput = useCallback(
    (rawValue: string) => {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        setWindowEndInput(String(windowEnd));
        return;
      }
      handleWindowEndChange(parsed);
    },
    [handleWindowEndChange, windowEnd],
  );

  const handleChartDomainChange = useCallback(
    (domain: { yPrimary: [number, number]; ySecondary: [number, number] }) => {
      const nextPrimary = sanitizeDomain(domain.yPrimary);
      const nextSecondary = sanitizeDomain(domain.ySecondary);
      setResolvedYPrimaryDomain((prev) =>
        prev[0] === nextPrimary[0] && prev[1] === nextPrimary[1] ? prev : nextPrimary,
      );
      setResolvedYSecondaryDomain((prev) =>
        prev[0] === nextSecondary[0] && prev[1] === nextSecondary[1] ? prev : nextSecondary,
      );
    },
    [],
  );

  const commitYPrimaryBoundary = useCallback(
    (boundary: "min" | "max", rawValue: string) => {
      const parsed = Number(rawValue);
      const source = sanitizeDomain(manualYPrimaryDomain ?? resolvedYPrimaryDomain);
      if (!Number.isFinite(parsed)) {
        if (boundary === "min") {
          setYPrimaryMinInput(formatDomainNumber(source[0]));
        } else {
          setYPrimaryMaxInput(formatDomainNumber(source[1]));
        }
        return;
      }
      let [nextMin, nextMax] = source;
      if (boundary === "min") {
        nextMin = parsed;
        if (nextMin >= nextMax) {
          nextMin = nextMax - MIN_Y_DOMAIN_SPAN;
        }
      } else {
        nextMax = parsed;
        if (nextMax <= nextMin) {
          nextMax = nextMin + MIN_Y_DOMAIN_SPAN;
        }
      }
      setManualYPrimaryDomain([nextMin, nextMax]);
    },
    [manualYPrimaryDomain, resolvedYPrimaryDomain],
  );

  const commitYSecondaryBoundary = useCallback(
    (boundary: "min" | "max", rawValue: string) => {
      const parsed = Number(rawValue);
      const source = sanitizeDomain(manualYSecondaryDomain ?? resolvedYSecondaryDomain);
      if (!Number.isFinite(parsed)) {
        if (boundary === "min") {
          setYSecondaryMinInput(formatDomainNumber(source[0]));
        } else {
          setYSecondaryMaxInput(formatDomainNumber(source[1]));
        }
        return;
      }
      let [nextMin, nextMax] = source;
      if (boundary === "min") {
        nextMin = parsed;
        if (nextMin >= nextMax) {
          nextMin = nextMax - MIN_Y_DOMAIN_SPAN;
        }
      } else {
        nextMax = parsed;
        if (nextMax <= nextMin) {
          nextMax = nextMin + MIN_Y_DOMAIN_SPAN;
        }
      }
      setManualYSecondaryDomain([nextMin, nextMax]);
    },
    [manualYSecondaryDomain, resolvedYSecondaryDomain],
  );

  const handleYPrimaryRangeChange = useCallback((min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return;
    }
    setManualYPrimaryDomain([min, max]);
  }, []);

  const handleYSecondaryRangeChange = useCallback((min: number, max: number) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return;
    }
    setManualYSecondaryDomain([min, max]);
  }, []);

  const handleResetWindow = useCallback(() => {
    const end = Math.max(1, playbackState.totalTicks || playbackState.currentTick);
    setIsAutoScroll(true);
    setIsWindowed(false);
    setManualYPrimaryDomain(null);
    setManualYSecondaryDomain(null);
    setResetViewVersion((prev) => prev + 1);
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: true,
      currentTick: end,
    }));
    setWindowStart(1);
    setWindowEnd(end);
    setWindowSize(end);
  }, [playbackState.currentTick, playbackState.totalTicks, setPlaybackState]);

  const handleAutoScrollChange = useCallback(
    (enabled: boolean) => {
      const nextEnabled = Boolean(enabled);
      setIsAutoScroll(nextEnabled);
      if (nextEnabled) {
        setIsWindowed(false);
      }
      if (!enabled) {
        setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
      }
    },
    [setPlaybackState],
  );

  useLayoutEffect(() => {
    if (!isAutoScroll) {
      return;
    }
    const end = Math.max(1, playbackState.currentTick);
    const start = Math.max(1, Math.min(windowStart, end));
    const size = Math.max(1, end - start + 1);
    if (windowStart !== start) {
      setWindowStart(start);
    }
    if (windowEnd !== end) {
      setWindowEnd(end);
    }
    if (windowSize !== size) {
      setWindowSize(size);
    }
  }, [isAutoScroll, playbackState.currentTick, windowEnd, windowSize, windowStart]);

  return {
    windowSize,
    setWindowSize,
    windowStart,
    setWindowStart,
    windowEnd,
    setWindowEnd,
    isWindowed,
    setIsWindowed,
    resetViewVersion,
    setResetViewVersion,
    windowStartInput,
    setWindowStartInput,
    windowEndInput,
    setWindowEndInput,
    manualYPrimaryDomain,
    setManualYPrimaryDomain,
    manualYSecondaryDomain,
    setManualYSecondaryDomain,
    resolvedYPrimaryDomain,
    setResolvedYPrimaryDomain,
    resolvedYSecondaryDomain,
    setResolvedYSecondaryDomain,
    yPrimaryMinInput,
    setYPrimaryMinInput,
    yPrimaryMaxInput,
    setYPrimaryMaxInput,
    ySecondaryMinInput,
    setYSecondaryMinInput,
    ySecondaryMaxInput,
    setYSecondaryMaxInput,
    isAutoScroll,
    setIsAutoScroll,
    windowStartEditingRef,
    windowEndEditingRef,
    yPrimaryMinEditingRef,
    yPrimaryMaxEditingRef,
    ySecondaryMinEditingRef,
    ySecondaryMaxEditingRef,
    applyWindowRange,
    handleWindowSizeChange,
    handleWindowStartChange,
    handleWindowEndChange,
    handleWindowRangeChange,
    commitWindowStartInput,
    commitWindowEndInput,
    handleChartDomainChange,
    commitYPrimaryBoundary,
    commitYSecondaryBoundary,
    handleYPrimaryRangeChange,
    handleYSecondaryRangeChange,
    handleResetWindow,
    handleAutoScrollChange,
  };
}
