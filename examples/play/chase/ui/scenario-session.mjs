import { resolveChaseScenario } from "../simulation/scenario.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "../scenarios/index.mjs";
import {
  CHASE_RENDERING_PROFILE_OPTIONS,
  normalizeChaseRenderingProfileId,
  normalizeChaseRenderingSeed,
} from "../rendering/profiles.ts";

export function createScenarioDefinitionWithEvaderOverride(scenarioDefinition, evaderExists) {
  const nextDefinition = structuredClone(scenarioDefinition);
  nextDefinition.actors = {
    ...(nextDefinition.actors ?? {}),
    evader: {
      ...(nextDefinition.actors?.evader ?? {}),
      exists: Boolean(evaderExists),
    },
  };
  return nextDefinition;
}

export function createScenarioDefinitionWithRenderingProfileOverride(
  scenarioDefinition,
  renderingProfileId,
  renderingSeed,
) {
  const nextDefinition = structuredClone(scenarioDefinition);
  nextDefinition.rendering = {
    ...(nextDefinition.rendering ?? {}),
    profile: normalizeChaseRenderingProfileId(renderingProfileId),
    seed: normalizeChaseRenderingSeed(renderingSeed),
  };
  return nextDefinition;
}

function getScenarioEvaderExists(scenarioDefinition, dimensions) {
  return resolveChaseScenario(scenarioDefinition, dimensions).actors.evader.exists !== false;
}

function getScenarioRenderingProfileId(scenarioDefinition, dimensions) {
  return resolveChaseScenario(scenarioDefinition, dimensions).rendering.id;
}

function getScenarioRenderingSeed(scenarioDefinition, dimensions) {
  return resolveChaseScenario(scenarioDefinition, dimensions).rendering.seed;
}

function createViewportSpec(scenario) {
  const columns = Number(scenario?.map?.columns);
  const rows = Number(scenario?.map?.rows);
  if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns <= 0 || rows <= 0) {
    return null;
  }
  return {
    frameAspect: [columns, rows],
  };
}

export function createChaseScenarioSession({ columns, rows } = {}) {
  const dimensions = { columns, rows };
  const scenarioOptions = getChaseScenarioOptions();
  let activeScenarioId = DEFAULT_CHASE_SCENARIO_ID;
  let activeScenarioDefinition = getChaseScenarioDefinition(activeScenarioId);
  let evaderExistsOverride = getScenarioEvaderExists(activeScenarioDefinition, dimensions);
  let renderingProfileIdOverride = getScenarioRenderingProfileId(
    activeScenarioDefinition,
    dimensions,
  );
  let renderingSeedOverride = getScenarioRenderingSeed(activeScenarioDefinition, dimensions);

  const buildScenario = () => resolveChaseScenario(
    createScenarioDefinitionWithRenderingProfileOverride(
      createScenarioDefinitionWithEvaderOverride(activeScenarioDefinition, evaderExistsOverride),
      renderingProfileIdOverride,
      renderingSeedOverride,
    ),
    dimensions,
  );

  const loadScenario = (scenarioId) => {
    activeScenarioDefinition = getChaseScenarioDefinition(scenarioId);
    activeScenarioId = activeScenarioDefinition.id ?? DEFAULT_CHASE_SCENARIO_ID;
    evaderExistsOverride = getScenarioEvaderExists(activeScenarioDefinition, dimensions);
    renderingProfileIdOverride = getScenarioRenderingProfileId(
      activeScenarioDefinition,
      dimensions,
    );
    renderingSeedOverride = getScenarioRenderingSeed(activeScenarioDefinition, dimensions);
    return buildScenario();
  };

  const setEvaderExists = (evaderExists) => {
    evaderExistsOverride = Boolean(evaderExists);
    return buildScenario();
  };

  const setRenderingProfile = (renderingProfileId) => {
    renderingProfileIdOverride = normalizeChaseRenderingProfileId(renderingProfileId);
    if (renderingProfileIdOverride === "randomized" && renderingSeedOverride === null) {
      renderingSeedOverride = 0;
    }
    return buildScenario();
  };

  const setRenderingSeed = (renderingSeed) => {
    renderingSeedOverride = normalizeChaseRenderingSeed(renderingSeed, 0);
    return buildScenario();
  };

  return {
    buildScenario,
    loadScenario,
    setEvaderExists,
    setRenderingProfile,
    setRenderingSeed,
    getActiveScenarioId: () => activeScenarioId,
    getSidebarControls(simulationState) {
      return {
        activeScenarioId,
        options: scenarioOptions,
        evaderExists: simulationState?.evaderExists !== false,
        renderingProfileId: simulationState?.renderingProfile?.id
          ?? renderingProfileIdOverride,
        renderingSeed: simulationState?.renderingProfile?.seed
          ?? renderingSeedOverride
          ?? 0,
        renderingProfileOptions: CHASE_RENDERING_PROFILE_OPTIONS,
      };
    },
    getViewportSpec: createViewportSpec,
  };
}
