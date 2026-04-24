import {
  CAR_BOUND_RADIUS,
  CENTER_OBSTACLE_SIZE_RATIO,
  WALL_AVOID_DISTANCE,
} from "./constants.mjs";
import { normalizeVector } from "./math.mjs";

export function getFieldObstacleLayout(columns, rows) {
  const centerObstacleSize = Math.min(columns, rows) * CENTER_OBSTACLE_SIZE_RATIO;
  return {
    walls: [
      {
        id: "center-square",
        x: 0,
        z: 0,
        width: centerObstacleSize,
        depth: centerObstacleSize,
      },
    ],
  };
}

export function getWallBounds(wall, padding = 0) {
  return {
    minX: wall.x - wall.width / 2 - padding,
    maxX: wall.x + wall.width / 2 + padding,
    minZ: wall.z - wall.depth / 2 - padding,
    maxZ: wall.z + wall.depth / 2 + padding,
  };
}

function isPositionInsideBounds(position, bounds) {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.z >= bounds.minZ
    && position.z <= bounds.maxZ;
}

function doesLineSegmentIntersectBounds(startPosition, endPosition, bounds) {
  const directionX = endPosition.x - startPosition.x;
  const directionZ = endPosition.z - startPosition.z;
  let tMin = 0;
  let tMax = 1;

  const applySlab = (start, direction, min, max) => {
    if (direction === 0) {
      return start >= min && start <= max;
    }
    const first = (min - start) / direction;
    const second = (max - start) / direction;
    tMin = Math.max(tMin, Math.min(first, second));
    tMax = Math.min(tMax, Math.max(first, second));
    return tMin <= tMax;
  };

  return applySlab(startPosition.x, directionX, bounds.minX, bounds.maxX)
    && applySlab(startPosition.z, directionZ, bounds.minZ, bounds.maxZ)
    && tMax > 0
    && tMin < 1;
}

export function isLineOfSightBlockedByObstacles(startPosition, endPosition, obstacles) {
  return obstacles.walls.some((wall) =>
    doesLineSegmentIntersectBounds(startPosition, endPosition, getWallBounds(wall)),
  );
}

export function getGroundBounds(columns, rows) {
  const halfWidth = columns / 2;
  const halfDepth = rows / 2;
  return {
    minX: -halfWidth + CAR_BOUND_RADIUS,
    maxX: halfWidth - CAR_BOUND_RADIUS,
    minZ: -halfDepth + CAR_BOUND_RADIUS,
    maxZ: halfDepth - CAR_BOUND_RADIUS,
  };
}

export function getBoundaryWallPressure(position, columns, rows) {
  const bounds = getGroundBounds(columns, rows);
  const distances = [
    { wall: "left", distance: position.x - bounds.minX, direction: { x: 1, z: 0 } },
    { wall: "right", distance: bounds.maxX - position.x, direction: { x: -1, z: 0 } },
    { wall: "bottom", distance: position.z - bounds.minZ, direction: { x: 0, z: 1 } },
    { wall: "top", distance: bounds.maxZ - position.z, direction: { x: 0, z: -1 } },
  ];
  const nearest = distances.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
  const pressure = distances.reduce((sum, entry) => {
    const amount = Math.max(0, 1 - entry.distance / WALL_AVOID_DISTANCE);
    return {
      x: sum.x + entry.direction.x * amount,
      z: sum.z + entry.direction.z * amount,
    };
  }, { x: 0, z: 0 });
  const magnitude = Math.hypot(pressure.x, pressure.z);
  return {
    active: magnitude > 0.001,
    nearestWall: nearest.wall,
    nearestDistance: nearest.distance,
    direction: normalizeVector(pressure.x, pressure.z),
    magnitude,
  };
}

function getWallPressureVector(pressure) {
  return {
    x: pressure.direction.x * pressure.magnitude,
    z: pressure.direction.z * pressure.magnitude,
  };
}

function getDistanceToBounds(position, bounds) {
  const nearestX = Math.min(bounds.maxX, Math.max(bounds.minX, position.x));
  const nearestZ = Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z));
  const inside = isPositionInsideBounds(position, bounds);
  if (!inside) {
    return {
      distance: Math.hypot(position.x - nearestX, position.z - nearestZ),
      direction: normalizeVector(position.x - nearestX, position.z - nearestZ),
    };
  }

  const distances = [
    { distance: Math.abs(position.x - bounds.minX), direction: { x: -1, z: 0 } },
    { distance: Math.abs(bounds.maxX - position.x), direction: { x: 1, z: 0 } },
    { distance: Math.abs(position.z - bounds.minZ), direction: { x: 0, z: -1 } },
    { distance: Math.abs(bounds.maxZ - position.z), direction: { x: 0, z: 1 } },
  ].sort((first, second) => first.distance - second.distance);
  return {
    distance: 0,
    direction: distances[0].direction,
  };
}

export function getObstacleWallPressure(position, obstacles) {
  const walls = Array.isArray(obstacles?.walls) ? obstacles.walls : [];
  let nearest = {
    wall: "none",
    distance: Number.POSITIVE_INFINITY,
  };
  const pressure = walls.reduce((sum, wall, index) => {
    const distanceToWall = getDistanceToBounds(position, getWallBounds(wall));
    if (distanceToWall.distance < nearest.distance) {
      nearest = {
        wall: wall.id ?? `obstacle-${index + 1}`,
        distance: distanceToWall.distance,
      };
    }
    const amount = Math.max(0, 1 - distanceToWall.distance / WALL_AVOID_DISTANCE);
    return {
      x: sum.x + distanceToWall.direction.x * amount,
      z: sum.z + distanceToWall.direction.z * amount,
    };
  }, { x: 0, z: 0 });
  const magnitude = Math.hypot(pressure.x, pressure.z);
  return {
    active: magnitude > 0.001,
    nearestWall: nearest.wall,
    nearestDistance: Number.isFinite(nearest.distance) ? nearest.distance : null,
    direction: normalizeVector(pressure.x, pressure.z),
    magnitude,
  };
}

export function getWorldWallPressure(position, columns, rows, obstacles) {
  const boundaryPressure = getBoundaryWallPressure(position, columns, rows);
  const obstaclePressure = getObstacleWallPressure(position, obstacles);
  const boundaryVector = getWallPressureVector(boundaryPressure);
  const obstacleVector = getWallPressureVector(obstaclePressure);
  const pressure = {
    x: boundaryVector.x + obstacleVector.x,
    z: boundaryVector.z + obstacleVector.z,
  };
  const nearestIsObstacle = obstaclePressure.nearestDistance !== null
    && obstaclePressure.nearestDistance < boundaryPressure.nearestDistance;
  const magnitude = Math.hypot(pressure.x, pressure.z);

  return {
    active: magnitude > 0.001,
    nearestWall: nearestIsObstacle ? obstaclePressure.nearestWall : boundaryPressure.nearestWall,
    nearestDistance: nearestIsObstacle
      ? obstaclePressure.nearestDistance
      : boundaryPressure.nearestDistance,
    direction: normalizeVector(pressure.x, pressure.z),
    magnitude,
  };
}

export function clampPosition(position, columns, rows) {
  const bounds = getGroundBounds(columns, rows);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z)),
  };
}

function resolveWallCollision(position, previousPosition, columns, rows, wall) {
  const bounds = getWallBounds(wall, CAR_BOUND_RADIUS);
  if (
    !isPositionInsideBounds(position, bounds)
    && !doesLineSegmentIntersectBounds(previousPosition, position, bounds)
  ) {
    return position;
  }

  let resolved = { ...position };
  if (previousPosition.x <= bounds.minX) {
    resolved.x = bounds.minX;
  } else if (previousPosition.x >= bounds.maxX) {
    resolved.x = bounds.maxX;
  } else if (previousPosition.z <= bounds.minZ) {
    resolved.z = bounds.minZ;
  } else if (previousPosition.z >= bounds.maxZ) {
    resolved.z = bounds.maxZ;
  } else {
    const distances = [
      { axis: "x", value: bounds.minX, distance: Math.abs(position.x - bounds.minX) },
      { axis: "x", value: bounds.maxX, distance: Math.abs(position.x - bounds.maxX) },
      { axis: "z", value: bounds.minZ, distance: Math.abs(position.z - bounds.minZ) },
      { axis: "z", value: bounds.maxZ, distance: Math.abs(position.z - bounds.maxZ) },
    ].sort((first, second) => first.distance - second.distance);
    const nearestEdge = distances[0];
    resolved = {
      ...resolved,
      [nearestEdge.axis]: nearestEdge.value,
    };
  }

  return clampPosition(resolved, columns, rows);
}

export function resolveObstacleCollisions(position, previousPosition, columns, rows, obstacles) {
  let resolved = clampPosition(position, columns, rows);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    for (const wall of obstacles.walls) {
      resolved = resolveWallCollision(resolved, previousPosition, columns, rows, wall);
    }
  }

  return resolved;
}
