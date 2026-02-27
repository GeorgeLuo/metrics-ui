import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square, SkipBack, SkipForward, Rewind, FastForward, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { PlaybackState } from "@shared/schema";
import { cn } from "@/lib/utils";

interface PlaybackControlsProps {
  playbackState: PlaybackState;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  currentTime: string;
  disabled: boolean;
  seekDisabled?: boolean;
  onOpenMiniPlayer?: () => void;
}

const MIN_SPEED = 0.05;
const MAX_SPEED = 100;
const INLINE_EDIT_BASE_CLASS =
  "h-auto p-0 text-xs sm:text-sm font-mono text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0";
const INLINE_EDIT_NUMERIC_CLASS =
  `${INLINE_EDIT_BASE_CLASS} text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

function normalizeSpeedValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

function formatSpeedValue(value: number): string {
  const normalized = normalizeSpeedValue(value);
  return Number(normalized.toFixed(3)).toString();
}

export function PlaybackControls({
  playbackState,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  onStepForward,
  onStepBackward,
  currentTime,
  disabled,
  seekDisabled = false,
  onOpenMiniPlayer,
}: PlaybackControlsProps) {
  const { isPlaying, currentTick, totalTicks, speed } = playbackState;
  const [scrubTick, setScrubTick] = useState(currentTick);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [speedInput, setSpeedInput] = useState(() => formatSpeedValue(speed));
  const scrubTickRef = useRef(currentTick);
  const scrubRafRef = useRef<number | null>(null);
  const speedInputFocusedRef = useRef(false);

  useEffect(() => {
    if (!isScrubbing) {
      setScrubTick(currentTick);
      scrubTickRef.current = currentTick;
    }
  }, [currentTick, isScrubbing]);

  useEffect(() => {
    return () => {
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!speedInputFocusedRef.current) {
      setSpeedInput(formatSpeedValue(speed));
    }
  }, [speed]);

  const commitSpeedInput = () => {
    const parsed = Number.parseFloat(speedInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSpeedInput(formatSpeedValue(speed));
      return;
    }
    const normalized = normalizeSpeedValue(parsed);
    onSpeedChange(normalized);
    setSpeedInput(formatSpeedValue(normalized));
  };

  const displayTick = isScrubbing ? scrubTick : currentTick;

  return (
    <div className={cn("flex flex-col gap-3 py-3", disabled && "opacity-50 pointer-events-none")}>
      <div className="flex items-center gap-2">
        <Slider
          value={[displayTick]}
          min={1}
          max={totalTicks || 1}
          step={1}
          onValueChange={([value]) => {
            if (disabled || seekDisabled || totalTicks === 0) {
              return;
            }
            const next = Math.min(Math.max(1, value), totalTicks || 1);
            setIsScrubbing(true);
            setScrubTick(next);
            scrubTickRef.current = next;
            if (scrubRafRef.current === null) {
              scrubRafRef.current = requestAnimationFrame(() => {
                scrubRafRef.current = null;
                onSeek(scrubTickRef.current);
              });
            }
          }}
          onValueCommit={([value]) => {
            if (seekDisabled) {
              setIsScrubbing(false);
              return;
            }
            const next = Math.min(Math.max(1, value), totalTicks || 1);
            setIsScrubbing(false);
            onSeek(next);
          }}
          className="flex-1"
          disabled={disabled || seekDisabled || totalTicks === 0}
          data-testid="slider-playback"
          aria-label="Playback position"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between sm:gap-4">
        <div className="flex items-center gap-1 shrink-0">
          {onOpenMiniPlayer ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMiniPlayer}
              data-testid="button-mini-popout"
              title="Pop out mini player"
              aria-label="Pop out mini player"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={onStepBackward}
            disabled={disabled || seekDisabled || currentTick <= 1}
            data-testid="button-step-backward"
            aria-label="Step backward"
          >
            <SkipBack className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeek(Math.max(1, currentTick - 10))}
            disabled={disabled || seekDisabled || currentTick <= 1}
            data-testid="button-rewind"
            aria-label="Rewind 10 ticks"
          >
            <Rewind className="w-4 h-4" />
          </Button>

          {isPlaying ? (
            <Button
              variant="default"
              size="icon"
              onClick={onPause}
              disabled={disabled}
              data-testid="button-pause"
              aria-label="Pause playback"
            >
              <Pause className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={onPlay}
              disabled={disabled || currentTick >= totalTicks}
              data-testid="button-play"
              aria-label="Play simulation"
            >
              <Play className="w-4 h-4" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeek(Math.min(totalTicks, currentTick + 10))}
            disabled={disabled || seekDisabled || currentTick >= totalTicks}
            data-testid="button-fast-forward"
            aria-label="Fast forward 10 ticks"
          >
            <FastForward className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onStepForward}
            disabled={disabled || seekDisabled || currentTick >= totalTicks}
            data-testid="button-step-forward"
            aria-label="Step forward"
          >
            <SkipForward className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onStop}
            disabled={disabled}
            data-testid="button-stop"
            aria-label="Stop and reset"
          >
            <Square className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
          <div className="flex items-center gap-0.5 text-sm">
            <input
              type="text"
              inputMode="decimal"
              value={speedInput}
              onChange={(event) => setSpeedInput(event.target.value)}
              onFocus={() => {
                speedInputFocusedRef.current = true;
              }}
              onBlur={() => {
                speedInputFocusedRef.current = false;
                commitSpeedInput();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  speedInputFocusedRef.current = false;
                  setSpeedInput(formatSpeedValue(speed));
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              disabled={disabled}
              className={INLINE_EDIT_NUMERIC_CLASS}
              style={{ width: `${Math.max(speedInput.length, 1)}ch` }}
              data-testid="select-speed"
              aria-label="Playback speed"
            />
            <span className="text-muted-foreground text-xs sm:text-sm">x</span>
          </div>

          <div className="flex flex-col items-center sm:items-end gap-0.5">
            <span className="font-mono text-xs sm:text-sm" data-testid="text-tick-position">
              {displayTick.toLocaleString()} / {totalTicks.toLocaleString()}
            </span>
            <span className="font-mono text-xs text-muted-foreground hidden sm:block" data-testid="text-current-time">
              {currentTime}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
