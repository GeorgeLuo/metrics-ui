import defaultScenarioDefinition from "./default.scenario.mjs";

const noEvaderScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "no-evader",
  label: "No Evader",
  description: "Chaser-only setup for validating knowledge acquisition without hiding an evader through runtime debug code.",
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      actionProposals: {
        ...defaultScenarioDefinition.actors.chaser.actionProposals,
        mapDiscovery: true,
        mapRecencyRefresh: true,
        spin: true,
      },
    },
    evader: {
      exists: false,
    },
  },
  runtime: {
    ...defaultScenarioDefinition.runtime,
    programmaticChaserEnabled: true,
  },
};

export default noEvaderScenarioDefinition;
