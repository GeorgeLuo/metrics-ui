import defaultScenarioDefinition from "./default.scenario.mjs";

const walledChaseScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "walled-chase",
  label: "Walled Chase",
  description: "Default two-actor chase with visible perimeter walls around the field and the central obstacle preserved.",
  map: {
    ...defaultScenarioDefinition.map,
    boundaryWalls: true,
  },
};

export default walledChaseScenarioDefinition;
