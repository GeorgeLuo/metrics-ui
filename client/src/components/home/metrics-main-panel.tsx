import { useRef } from "react";
import { ViewportFloatingFrame } from "@/components/floating-frame";
import {
  InjectedVisualization,
  type InjectedVisualizationDebug,
} from "@/components/injected-visualization";
import { MetricsHUD } from "@/components/metrics-hud";
import { PlaybackControls } from "@/components/playback-controls";
import { MetricsChartView, type ChartViewProps } from "@/components/home/metrics-chart-view";
import type {
  CaptureSession,
  DataPoint,
  PlaybackState,
  SelectedMetric,
  VisualizationFrameState,
} from "@shared/schema";

type MetricsMainPanelProps = {
  chart: ChartViewProps;
  currentData: DataPoint | null;
  activeMetrics: SelectedMetric[];
  playbackState: PlaybackState;
  captures: CaptureSession[];
  isHudVisible: boolean;
  activeDerivationGroupName: string;
  analysisKeys: Set<string>;
  onToggleAnalysisMetric: (metric: SelectedMetric) => void;
  onToggleMetricAxis: (metric: SelectedMetric) => void;
  isMetricOnSecondaryAxis: (metric: SelectedMetric) => boolean;
  onDeselectMetric: (captureId: string, fullPath: string) => void;
  onHoverMetric: (metricKey: string | null) => void;
  highlightedMetricKey: string | null;
  visualizationFrame: VisualizationFrameState;
  visualizationCapture: CaptureSession | null;
  onVisualizationDebugChange: (debug: InjectedVisualizationDebug) => void;
  onVisualizationPopoutChange: (poppedOut: boolean) => void;
  visualizationDockRequestToken: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onResetWindow: () => void;
  onOpenMiniPlayer: () => void;
  seekDisabled: boolean;
};

export function MetricsMainPanel({
  chart,
  currentData,
  activeMetrics,
  playbackState,
  captures,
  isHudVisible,
  activeDerivationGroupName,
  analysisKeys,
  onToggleAnalysisMetric,
  onToggleMetricAxis,
  isMetricOnSecondaryAxis,
  onDeselectMetric,
  onHoverMetric,
  highlightedMetricKey,
  visualizationFrame,
  visualizationCapture,
  onVisualizationDebugChange,
  onVisualizationPopoutChange,
  visualizationDockRequestToken,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  onStepForward,
  onStepBackward,
  onResetWindow,
  onOpenMiniPlayer,
  seekDisabled,
}: MetricsMainPanelProps) {
  const contentAreaRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="flex-1 flex flex-col px-4 pt-4 pb-1 gap-4 overflow-hidden min-h-0">
      <div ref={contentAreaRef} className="relative flex-1 min-h-0">
        <MetricsChartView chart={chart} />
        <MetricsHUD
          currentData={currentData}
          selectedMetrics={activeMetrics}
          currentTick={playbackState.currentTick}
          captures={captures}
          isVisible={isHudVisible}
          activeDerivationGroupName={activeDerivationGroupName}
          analysisKeys={analysisKeys}
          onToggleAnalysisMetric={onToggleAnalysisMetric}
          onToggleMetricAxis={onToggleMetricAxis}
          isMetricOnSecondaryAxis={isMetricOnSecondaryAxis}
          onDeselectMetric={onDeselectMetric}
          onHoverMetric={onHoverMetric}
          highlightedMetricKey={highlightedMetricKey}
          containerRef={contentAreaRef}
        />
        <ViewportFloatingFrame
          title="Visualization Frame"
          className="w-[360px] h-[320px]"
          contentClassName="!px-2 !py-2"
          dataTestId="visualization-floating-frame"
          popoutable
          popoutWindowName="metrics-ui-visualization-frame"
          popoutWindowTitle="Metrics UI - Visualization Frame"
          contentFill
          onPopoutChange={onVisualizationPopoutChange}
          dockRequestToken={visualizationDockRequestToken}
        >
          <InjectedVisualization
            frame={visualizationFrame}
            capture={visualizationCapture}
            currentTick={playbackState.currentTick}
            onDebugChange={onVisualizationDebugChange}
          />
        </ViewportFloatingFrame>
      </div>

      <div className="shrink-0">
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
          disabled={captures.length === 0}
          seekDisabled={seekDisabled}
          onOpenMiniPlayer={onOpenMiniPlayer}
        />
      </div>
    </main>
  );
}
