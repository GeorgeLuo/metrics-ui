import { PlaybackControls } from "@/components/playback-controls";
import { ConnectionLockOverlay } from "@/components/home/connection-lock-overlay";
import { MetricsChartView, type ChartViewProps } from "@/components/home/metrics-chart-view";
import type { PlaybackState } from "@shared/schema";

type MiniModeViewProps = {
  chart: ChartViewProps;
  playbackState: PlaybackState;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onResetWindow: () => void;
  seekDisabled: boolean;
  disabled: boolean;
  isLoading: boolean;
  loadingCount: number;
  connectionLock: {
    message: string;
    closeCode: number;
    closeReason: string;
  } | null;
  onTakeoverDashboard: () => void;
  onRetryConnection: () => void;
};

type MiniProjectionContentProps = {
  chart: ChartViewProps;
};

export function MiniProjectionContent({ chart }: MiniProjectionContentProps) {
  return (
    <div className="h-full w-full pr-3 box-border">
      <MetricsChartView chart={chart} compact eagerResize />
    </div>
  );
}

export function MiniModeView({
  chart,
  playbackState,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  onStepForward,
  onStepBackward,
  onResetWindow,
  seekDisabled,
  disabled,
  isLoading,
  loadingCount,
  connectionLock,
  onTakeoverDashboard,
  onRetryConnection,
}: MiniModeViewProps) {
  return (
    <>
      <ConnectionLockOverlay
        lock={connectionLock}
        onTakeover={onTakeoverDashboard}
        onRetry={onRetryConnection}
      />
      <div className="h-screen w-full bg-background overflow-hidden">
        <div className="group/mini relative h-full w-full">
          <div className="h-full w-full">
            <MetricsChartView chart={chart} />
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 opacity-0 transition-opacity duration-150 ease-linear group-hover/mini:opacity-100 group-hover/mini:pointer-events-auto group-focus-within/mini:opacity-100 group-focus-within/mini:pointer-events-auto"
            data-testid="mini-player-overlay"
          >
            <div className="px-2 pb-2 pt-10 bg-gradient-to-t from-background/60 via-background/20 to-transparent">
              <div className="pointer-events-auto">
                <PlaybackControls
                  playbackState={playbackState}
                  onPlay={onPlay}
                  onPause={onPause}
                  onStop={onStop}
                  onSeek={onSeek}
                  onSpeedChange={onSpeedChange}
                  onStepForward={onStepForward}
                  onStepBackward={onStepBackward}
                  onResetWindow={onResetWindow}
                  currentTime=""
                  disabled={disabled}
                  seekDisabled={seekDisabled}
                />
                <div
                  className="pt-1 text-[10px] text-foreground/60 text-right"
                  data-testid="mini-loading-status"
                >
                  {isLoading ? `Loading ${loadingCount}` : "Stable"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
