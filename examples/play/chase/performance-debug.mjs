const DEFAULT_SAMPLE_LIMIT = 600;
const DEFAULT_SLOW_FRAME_THRESHOLD_MS = 24;

function roundMs(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return 0;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * ratio)),
  );
  return sortedValues[index];
}

function summarize(values) {
  const cleanValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((first, second) => first - second);
  if (cleanValues.length === 0) {
    return {
      count: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }

  const total = cleanValues.reduce((sum, value) => sum + value, 0);
  return {
    count: cleanValues.length,
    meanMs: roundMs(total / cleanValues.length),
    p50Ms: roundMs(percentile(cleanValues, 0.5)),
    p95Ms: roundMs(percentile(cleanValues, 0.95)),
    p99Ms: roundMs(percentile(cleanValues, 0.99)),
    maxMs: roundMs(cleanValues.at(-1)),
  };
}

function getTopSegment(sample) {
  const segmentEntries = Object.entries(sample?.segments ?? {});
  if (segmentEntries.length === 0) {
    return { name: "none", ms: 0 };
  }
  const [name, ms] = segmentEntries.reduce((best, entry) =>
    Number(entry[1]) > Number(best[1]) ? entry : best);
  return {
    name,
    ms: roundMs(Number(ms) || 0),
  };
}

function cloneSample(sample) {
  const topSegment = getTopSegment(sample);
  return {
    frameIndex: Number(sample?.frameIndex) || 0,
    timestampMs: roundMs(Number(sample?.timestampMs) || 0),
    elapsedMs: roundMs(Number(sample?.elapsedMs) || 0),
    totalTickMs: roundMs(Number(sample?.totalTickMs) || 0),
    stepMs: roundMs(Number(sample?.stepMs) || 0),
    stepsThisTick: Number(sample?.stepsThisTick) || 0,
    catchupSteps: Math.max(0, Number(sample?.stepsThisTick) - 1 || 0),
    frameDurationMs: roundMs(Number(sample?.frameDurationMs) || 0),
    accumulatedMsAfterStep: roundMs(Number(sample?.accumulatedMsAfterStep) || 0),
    overVisualBudget: Boolean(sample?.overVisualBudget),
    overSimulationBudget: Boolean(sample?.overSimulationBudget),
    topSegment,
    segments: Object.fromEntries(
      Object.entries(sample?.segments ?? {}).map(([key, value]) => [key, roundMs(Number(value) || 0)]),
    ),
    visible: {
      idaeDebug: Boolean(sample?.visible?.idaeDebug),
      chaserView: Boolean(sample?.visible?.chaserView),
      evaderView: Boolean(sample?.visible?.evaderView),
    },
  };
}

function getSlowSamples(samples, thresholdMs) {
  return samples
    .filter((sample) => Number(sample.totalTickMs) >= thresholdMs || sample.stepsThisTick > 1)
    .slice(-12)
    .map(cloneSample);
}

function getCauseCounts(samples, thresholdMs) {
  return samples.reduce((counts, sample) => {
    if (sample.stepsThisTick > 1) {
      counts.catchup += 1;
    }
    if (sample.totalTickMs >= thresholdMs) {
      counts.slowTick += 1;
      const topSegment = getTopSegment(sample).name;
      counts.byTopSegment[topSegment] = (counts.byTopSegment[topSegment] ?? 0) + 1;
    }
    if (sample.elapsedMs >= thresholdMs) {
      counts.rafGap += 1;
    }
    return counts;
  }, {
    catchup: 0,
    slowTick: 0,
    rafGap: 0,
    byTopSegment: {},
  });
}

function publishWindowDebug(snapshot) {
  if (typeof window === "undefined") {
    return;
  }
  window.__metricsUiPlayChasePerformance = snapshot;
}

export function createChasePerformanceTracker({
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
  slowFrameThresholdMs = DEFAULT_SLOW_FRAME_THRESHOLD_MS,
} = {}) {
  const samples = [];
  let snapshot = {
    generatedAt: new Date().toISOString(),
    sampleCount: 0,
    latest: null,
    summary: {},
    slowSamples: [],
    suspectedCauses: getCauseCounts([], slowFrameThresholdMs),
  };

  const trimSamples = () => {
    while (samples.length > sampleLimit) {
      samples.shift();
    }
  };

  const buildSnapshot = () => {
    const totalTickValues = samples.map((sample) => sample.totalTickMs);
    const elapsedValues = samples.map((sample) => sample.elapsedMs);
    const stepValues = samples.map((sample) => sample.stepMs);
    const renderValues = samples.map((sample) => sample.segments.mainRenderMs);
    const debugValues = samples.map((sample) => sample.segments.idaeDebugMs);
    const sidebarValues = samples.map((sample) => sample.segments.sidebarMs);
    const projectionValues = samples.map((sample) => sample.segments.projectionDisplayMs);

    return {
      generatedAt: new Date().toISOString(),
      sampleWindow: sampleLimit,
      slowFrameThresholdMs,
      sampleCount: samples.length,
      latest: samples.length > 0 ? cloneSample(samples.at(-1)) : null,
      summary: {
        totalTick: summarize(totalTickValues),
        rafGap: summarize(elapsedValues),
        simulationStep: summarize(stepValues),
        mainRender: summarize(renderValues),
        idaeDebug: summarize(debugValues),
        sidebar: summarize(sidebarValues),
        projectionDisplay: summarize(projectionValues),
        catchupTickCount: samples.filter((sample) => sample.stepsThisTick > 1).length,
        overVisualBudgetCount: samples.filter((sample) => sample.overVisualBudget).length,
        overSimulationBudgetCount: samples.filter((sample) => sample.overSimulationBudget).length,
      },
      suspectedCauses: getCauseCounts(samples, slowFrameThresholdMs),
      slowSamples: getSlowSamples(samples, slowFrameThresholdMs),
    };
  };

  return {
    recordTick(sample = {}) {
      const normalizedSample = {
        ...sample,
        segments: {
          projectionDisplayMs: Number(sample?.segments?.projectionDisplayMs) || 0,
          idaeDebugMs: Number(sample?.segments?.idaeDebugMs) || 0,
          sidebarMs: Number(sample?.segments?.sidebarMs) || 0,
          sceneSyncMs: Number(sample?.segments?.sceneSyncMs) || 0,
          mainRenderMs: Number(sample?.segments?.mainRenderMs) || 0,
          chaserViewRenderMs: Number(sample?.segments?.chaserViewRenderMs) || 0,
          evaderViewRenderMs: Number(sample?.segments?.evaderViewRenderMs) || 0,
        },
      };
      samples.push(normalizedSample);
      trimSamples();
      snapshot = buildSnapshot();
      publishWindowDebug(snapshot);
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
    reset() {
      samples.length = 0;
      snapshot = buildSnapshot();
      publishWindowDebug(snapshot);
      return snapshot;
    },
  };
}
