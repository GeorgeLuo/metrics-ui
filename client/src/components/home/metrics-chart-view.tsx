import { MetricsChart } from "@/components/metrics-chart";
import type { Annotation, CaptureSession, DataPoint, SelectedMetric, SubtitleOverlay } from "@shared/schema";

export type ChartViewProps = {
  data: DataPoint[];
  selectedMetrics: SelectedMetric[];
  currentTick: number;
  windowStart: number;
  windowEnd: number;
  resetViewVersion: number;
  isAutoScroll: boolean;
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  captures: CaptureSession[];
  highlightedMetricKey: string | null;
  yPrimaryDomain: [number, number] | null;
  ySecondaryDomain: [number, number] | null;
  onYPrimaryDomainChange: (value: [number, number] | null) => void;
  onYSecondaryDomainChange: (value: [number, number] | null) => void;
  onDomainChange: (domain: { yPrimary: [number, number]; ySecondary: [number, number] }) => void;
  onWindowRangeChange: (startTick: number, endTick: number) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onAddAnnotation: (annotation: Annotation) => void;
  onRemoveAnnotation: (options: { id?: string; tick?: number }) => void;
};

type MetricsChartViewProps = {
  chart: ChartViewProps;
  compact?: boolean;
  eagerResize?: boolean;
};

export function MetricsChartView({ chart, compact = false, eagerResize = false }: MetricsChartViewProps) {
  return (
    <MetricsChart
      data={chart.data}
      selectedMetrics={chart.selectedMetrics}
      currentTick={chart.currentTick}
      windowStart={chart.windowStart}
      windowEnd={chart.windowEnd}
      resetViewVersion={chart.resetViewVersion}
      isAutoScroll={chart.isAutoScroll}
      annotations={chart.annotations}
      subtitles={chart.subtitles}
      captures={chart.captures}
      highlightedMetricKey={chart.highlightedMetricKey}
      yPrimaryDomain={chart.yPrimaryDomain}
      ySecondaryDomain={chart.ySecondaryDomain}
      onYPrimaryDomainChange={chart.onYPrimaryDomainChange}
      onYSecondaryDomainChange={chart.onYSecondaryDomainChange}
      onDomainChange={chart.onDomainChange}
      onWindowRangeChange={chart.onWindowRangeChange}
      onSizeChange={chart.onSizeChange}
      onAddAnnotation={chart.onAddAnnotation}
      onRemoveAnnotation={chart.onRemoveAnnotation}
      compact={compact}
      eagerResize={eagerResize}
    />
  );
}
