import defaultScenarioDefinition from "./default.scenario.mjs";

const DIVIDER_WIDTH = 0.35;
const FIELD_DEPTH = 6;
const DOORWAY_GAP_DEPTH = 1.5;
const DIVIDER_SEGMENT_DEPTH = (FIELD_DEPTH - DOORWAY_GAP_DEPTH) / 2;
const DIVIDER_SEGMENT_CENTER_OFFSET = DOORWAY_GAP_DEPTH / 2 + DIVIDER_SEGMENT_DEPTH / 2;

const twoRoomsScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "two-rooms",
  label: "Two Rooms",
  description: "Chase setup with a central divider splitting the field into left and right rooms with a doorway gap.",
  map: {
    layout: "two-rooms-vertical-divider-gap",
    obstacles: [
      {
        id: "center-divider-bottom",
        x: 0,
        z: -DIVIDER_SEGMENT_CENTER_OFFSET,
        width: DIVIDER_WIDTH,
        depth: DIVIDER_SEGMENT_DEPTH,
      },
      {
        id: "center-divider-top",
        x: 0,
        z: DIVIDER_SEGMENT_CENTER_OFFSET,
        width: DIVIDER_WIDTH,
        depth: DIVIDER_SEGMENT_DEPTH,
      },
    ],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: { x: -3.42, z: 0 },
      direction: { x: 1, z: 0 },
    },
    evader: {
      ...defaultScenarioDefinition.actors.evader,
      position: { x: 2.25, z: 0 },
      direction: { x: -1, z: 0.4 },
    },
  },
};

export default twoRoomsScenarioDefinition;
