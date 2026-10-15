import walledChaseScenarioDefinition from "./walled-chase.scenario.mjs";

export default {
  ...walledChaseScenarioDefinition,
  id: "wall-escape",
  label: "Wall Escape (No Evader)",
  description: "Walled Chase geometry without an evader, for isolated wall-contact and recovery evaluation.",
  actors: {
    ...walledChaseScenarioDefinition.actors,
    evader: { exists: false },
  },
  runtime: {
    chaserControlSource: "ws",
    programmaticChaserEnabled: false,
  },
};
