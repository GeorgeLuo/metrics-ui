import defaultScenarioDefinition from "./default.scenario.mjs";

// Approximation from runs/world_sketch/two-box-motion-5-20260609-110159.
const CELL_UNITS = 0.2;
const GRID_COLUMNS = 39;
const GRID_ROWS = 31;
const COLUMNS = Number((GRID_COLUMNS * CELL_UNITS).toFixed(1));
const ROWS = Number((GRID_ROWS * CELL_UNITS).toFixed(1));

function roundWorldUnit(value) {
  return Number(value.toFixed(3));
}

function gridToWorld(column, row) {
  return {
    x: roundWorldUnit((column - GRID_COLUMNS / 2) * CELL_UNITS),
    z: roundWorldUnit((GRID_ROWS / 2 - row) * CELL_UNITS),
  };
}

const cameraPosition = gridToWorld(19.5, 30.1);
const leftBoxPosition = gridToWorld(13.8, 14.8);
const rightBoxPosition = gridToWorld(27.1, 13.5);

const piracerRoomSketchScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "piracer-room-sketch",
  label: "PiRacer Room Sketch",
  description: "Approximate room reconstructed from the PiRacer two-box camera burst, with rotated box obstacles.",
  map: {
    layout: "piracer-room-sketch-two-boxes",
    columns: COLUMNS,
    rows: ROWS,
    obstacles: [
      {
        id: "left-cardboard-box",
        x: leftBoxPosition.x,
        z: leftBoxPosition.z,
        width: roundWorldUnit(6.2 * CELL_UNITS),
        depth: roundWorldUnit(4.5 * CELL_UNITS),
        rotationDegrees: -4,
      },
      {
        id: "right-cardboard-box",
        x: rightBoxPosition.x,
        z: rightBoxPosition.z,
        width: roundWorldUnit(6.8 * CELL_UNITS),
        depth: roundWorldUnit(4.3 * CELL_UNITS),
        rotationDegrees: 4,
      },
    ],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: cameraPosition,
      direction: { x: 0, z: 1 },
      actionProposals: {
        ...defaultScenarioDefinition.actors.chaser.actionProposals,
        evaderPredictionPursuit: false,
        lineOfSightPursuit: false,
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
    chaserControlSource: "keyboard",
  },
  vehicleSettings: {
    ...defaultScenarioDefinition.vehicleSettings,
    fieldOfViewDegrees: 86,
  },
};

export default piracerRoomSketchScenarioDefinition;
