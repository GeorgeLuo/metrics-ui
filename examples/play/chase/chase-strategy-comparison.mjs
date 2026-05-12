import defaultScenarioDefinition from "./scenarios/default.scenario.mjs";
import { resolveChaseScenario } from "./scenario.mjs";
import {
  createChaseSimulationState,
  stepChaseSimulation,
} from "./simulation.mjs";
import { CHASER_STRATEGY_IDS, EVADER_STRATEGY_IDS } from "./strategy-ids.mjs";

function buildFullStrategyMap(baseMap, overrides = {}, knownIds = []) {
  return Object.fromEntries(
    knownIds.map((strategyId) => [
      strategyId,
      strategyId in overrides
        ? Boolean(overrides[strategyId])
        : Boolean(baseMap?.[strategyId]),
    ]),
  );
}

function cloneVector(vector) {
  return vector ? { ...vector } : null;
}

function createScenarioForStrategyCombination({
  baseScenarioDefinition = defaultScenarioDefinition,
  columns = 9,
  rows = 6,
  chaserStrategies = {},
  evaderStrategies = {},
  programmaticChaserEnabled = true,
} = {}) {
  const scenarioDefinition = structuredClone(baseScenarioDefinition);
  const resolvedScenario = resolveChaseScenario(scenarioDefinition, { columns, rows });
  resolvedScenario.runtime.programmaticChaserEnabled = programmaticChaserEnabled;
  resolvedScenario.actors.chaser.strategies = buildFullStrategyMap(
    resolvedScenario.actors.chaser.strategies,
    chaserStrategies,
    Object.values(CHASER_STRATEGY_IDS),
  );
  resolvedScenario.actors.evader.strategies = buildFullStrategyMap(
    resolvedScenario.actors.evader.strategies,
    evaderStrategies,
    Object.values(EVADER_STRATEGY_IDS),
  );
  return resolvedScenario;
}

export function measureChaseScenarioAsymptote({
  baseScenarioDefinition = defaultScenarioDefinition,
  columns = 9,
  rows = 6,
  totalFrames = 20_000,
  warmupFrames = 2_000,
  chaserStrategies = {},
  evaderStrategies = {},
  programmaticChaserEnabled = true,
  inputProvider = null,
} = {}) {
  const scenario = createScenarioForStrategyCombination({
    baseScenarioDefinition,
    columns,
    rows,
    chaserStrategies,
    evaderStrategies,
    programmaticChaserEnabled,
  });
  const state = createChaseSimulationState({
    scenario,
    columns,
    rows,
  });
  const safeTotalFrames = Math.max(0, Math.floor(Number(totalFrames) || 0));
  const safeWarmupFrames = Math.min(
    Math.max(0, Math.floor(Number(warmupFrames) || 0)),
    safeTotalFrames,
  );
  let touchCountAtWarmupEnd = 0;

  for (let frame = 0; frame < safeTotalFrames; frame += 1) {
    stepChaseSimulation(state, {
      humanInput: typeof inputProvider === "function"
        ? inputProvider({
          frameIndex: state.frameIndex,
          state,
        })
        : null,
    });
    if (state.frameIndex === safeWarmupFrames) {
      touchCountAtWarmupEnd = state.runMetrics.touchCount;
    }
  }

  const measurementFrames = Math.max(0, safeTotalFrames - safeWarmupFrames);
  const measurementTouchCount = state.runMetrics.touchCount - touchCountAtWarmupEnd;
  return {
    scenario,
    totalFrames: safeTotalFrames,
    warmupFrames: safeWarmupFrames,
    measurementFrames,
    totalTouchCount: state.runMetrics.touchCount,
    measurementTouchCount,
    touchesPerThousandFrames: measurementFrames > 0
      ? (measurementTouchCount / measurementFrames) * 1000
      : 0,
    chaserStrategies: { ...scenario.actors.chaser.strategies },
    evaderStrategies: { ...scenario.actors.evader.strategies },
    finalState: {
      frameIndex: state.frameIndex,
      chaserPosition: { ...state.chaserPosition },
      evaderPosition: cloneVector(state.evaderPosition),
      chaserDirection: { ...state.chaserLookDirection },
      evaderDirection: cloneVector(state.evaderDirection),
    },
  };
}

export function compareChaseStrategyCombinations({
  baseScenarioDefinition = defaultScenarioDefinition,
  columns = 9,
  rows = 6,
  totalFrames = 20_000,
  warmupFrames = 2_000,
  combinations = [],
} = {}) {
  return combinations.map((combination, index) => {
    const result = measureChaseScenarioAsymptote({
      baseScenarioDefinition,
      columns,
      rows,
      totalFrames,
      warmupFrames,
      chaserStrategies: combination?.chaserStrategies ?? {},
      evaderStrategies: combination?.evaderStrategies ?? {},
      programmaticChaserEnabled: combination?.programmaticChaserEnabled ?? true,
      inputProvider: combination?.inputProvider ?? null,
    });

    return {
      id: typeof combination?.id === "string" && combination.id.trim()
        ? combination.id.trim()
        : `combination-${index + 1}`,
      label: typeof combination?.label === "string" && combination.label.trim()
        ? combination.label.trim()
        : null,
      ...result,
    };
  });
}

export function probeChaseStrategyComparisonConvergence({
  baseScenarioDefinition = defaultScenarioDefinition,
  columns = 9,
  rows = 6,
  combinations = [],
  frameSets = [2_000, 5_000, 10_000, 20_000, 40_000, 80_000],
  warmupFrames = null,
  warmupRatio = 0.1,
  convergenceThreshold = 0.1,
} = {}) {
  const sortedFrameSets = [...new Set(
    frameSets
      .map((value) => Math.max(0, Math.floor(Number(value) || 0)))
      .filter((value) => value > 0),
  )].sort((left, right) => left - right);
  const samples = [];

  for (const totalFrames of sortedFrameSets) {
    const resolvedWarmupFrames = warmupFrames === null
      ? Math.floor(totalFrames * warmupRatio)
      : Math.min(
        Math.max(0, Math.floor(Number(warmupFrames) || 0)),
        totalFrames,
      );
    const results = compareChaseStrategyCombinations({
      baseScenarioDefinition,
      columns,
      rows,
      totalFrames,
      warmupFrames: resolvedWarmupFrames,
      combinations,
    });
    samples.push({
      totalFrames,
      warmupFrames: resolvedWarmupFrames,
      results,
    });
  }

  const comparisons = [];
  let convergedAtTotalFrames = null;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const deltas = current.results.map((result, resultIndex) => {
      const previousRate = previous.results[resultIndex]?.touchesPerThousandFrames ?? 0;
      const currentRate = result.touchesPerThousandFrames ?? 0;
      return {
        id: result.id,
        previousRate,
        currentRate,
        absoluteDelta: Math.abs(currentRate - previousRate),
      };
    });
    const maxAbsoluteDelta = deltas.reduce(
      (maxDelta, delta) => Math.max(maxDelta, delta.absoluteDelta),
      0,
    );
    const converged = maxAbsoluteDelta <= convergenceThreshold;
    comparisons.push({
      fromTotalFrames: previous.totalFrames,
      toTotalFrames: current.totalFrames,
      maxAbsoluteDelta,
      converged,
      deltas,
    });
    if (converged && convergedAtTotalFrames === null) {
      convergedAtTotalFrames = current.totalFrames;
    }
  }

  return {
    frameSets: sortedFrameSets,
    warmupFrames,
    warmupRatio,
    convergenceThreshold,
    samples,
    comparisons,
    convergedAtTotalFrames,
  };
}
