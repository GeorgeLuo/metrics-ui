import { Play, Pause, Square, SkipBack, SkipForward, Rewind, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
}

const SPEED_OPTIONS = [
  { value: "0.5", label: "0.5x" },
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "5", label: "5x" },
  { value: "10", label: "10x" },
];

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
}: PlaybackControlsProps) {
  const { isPlaying, currentTick, totalTicks, speed } = playbackState;
  const progress = totalTicks > 0 ? (currentTick / totalTicks) * 100 : 0;

  return (
    <div className={cn("flex flex-col gap-3 py-3", disabled && "opacity-50 pointer-events-none")}>
      <div className="flex items-center gap-2">
        <Slider
          value={[currentTick]}
          min={1}
          max={totalTicks || 1}
          step={1}
          onValueChange={([value]) => onSeek(value)}
          className="flex-1"
          disabled={disabled || totalTicks === 0}
          data-testid="slider-playback"
          aria-label="Playback position"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between sm:gap-4">
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onStepBackward}
            disabled={disabled || currentTick <= 1}
            data-testid="button-step-backward"
            aria-label="Step backward"
          >
            <SkipBack className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSeek(Math.max(1, currentTick - 10))}
            disabled={disabled || currentTick <= 1}
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
            disabled={disabled || currentTick >= totalTicks}
            data-testid="button-fast-forward"
            aria-label="Fast forward 10 ticks"
          >
            <FastForward className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onStepForward}
            disabled={disabled || currentTick >= totalTicks}
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
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground hidden sm:inline">Speed:</span>
            <Select
              value={speed.toString()}
              onValueChange={(v) => onSpeedChange(parseFloat(v))}
              disabled={disabled}
            >
              <SelectTrigger
                className="w-16 sm:w-20 h-8"
                data-testid="select-speed"
                aria-label="Playback speed"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEED_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col items-center sm:items-end gap-0.5">
            <span className="font-mono text-xs sm:text-sm" data-testid="text-tick-position">
              {currentTick.toLocaleString()} / {totalTicks.toLocaleString()}
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
