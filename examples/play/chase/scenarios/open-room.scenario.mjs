import defaultScenarioDefinition from "./default.scenario.mjs";

const openRoomScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "open-room",
  label: "Open Room",
  description: "Baseline chase setup in an empty room with no interior obstacles.",
  map: {
    layout: "open-room",
    obstacles: [],
  },
};

export default openRoomScenarioDefinition;
