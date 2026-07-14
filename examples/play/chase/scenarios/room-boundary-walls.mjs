export const ROOM_BOUNDARY_WALL_HEIGHT = 2.4;
export const ROOM_BOUNDARY_WALL_THICKNESS = 0.18;

/** Creates visible perimeter geometry backed by the simulator's field boundary. */
export function createRoomBoundaryWalls(
  columns,
  rows,
  {
    height = ROOM_BOUNDARY_WALL_HEIGHT,
    thickness = ROOM_BOUNDARY_WALL_THICKNESS,
  } = {},
) {
  const halfColumns = columns / 2;
  const halfRows = rows / 2;

  return [
    {
      id: "room-wall-north",
      x: 0,
      z: -halfRows,
      width: columns + thickness,
      depth: thickness,
      height,
      boundary: true,
    },
    {
      id: "room-wall-south",
      x: 0,
      z: halfRows,
      width: columns + thickness,
      depth: thickness,
      height,
      boundary: true,
    },
    {
      id: "room-wall-west",
      x: -halfColumns,
      z: 0,
      width: thickness,
      depth: rows + thickness,
      height,
      boundary: true,
    },
    {
      id: "room-wall-east",
      x: halfColumns,
      z: 0,
      width: thickness,
      depth: rows + thickness,
      height,
      boundary: true,
    },
  ];
}
