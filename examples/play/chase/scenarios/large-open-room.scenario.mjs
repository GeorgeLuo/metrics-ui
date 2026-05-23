import defaultScenarioDefinition from "./default.scenario.mjs";

const SCALE = 1.5;
const COLUMNS = 9 * SCALE;
const ROWS = 6 * SCALE;

const largeOpenRoomScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "large-open-room",
  label: "Large Open Room",
  description: "Open chase setup with no interior obstacles and a 1.5x larger room.",
  map: {
    layout: "large-open-room",
    columns: COLUMNS,
    rows: ROWS,
    obstacles: [],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: { x: defaultScenarioDefinition.actors.chaser.position.x * SCALE, z: 0 },
    },
    evader: {
      ...defaultScenarioDefinition.actors.evader,
      position: { x: defaultScenarioDefinition.actors.evader.position.x * SCALE, z: 0 },
    },
  },
};

export default largeOpenRoomScenarioDefinition;
