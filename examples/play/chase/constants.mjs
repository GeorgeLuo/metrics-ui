export const manifest = {
  id: "chase",
  label: "Chase",
  description: "An overhead chase field: I moves the blue chaser forward while A/D steer left and right.",
  frameAspect: [9, 6],
  grid: [9, 6],
};

export const CAR_WIDTH = 0.24;
export const CAR_LENGTH = 0.46;
export const CAR_HEIGHT = 0.14;
export const CAR_BOUND_RADIUS = Math.hypot(CAR_WIDTH, CAR_LENGTH) / 2;
export const DEFAULT_CHASER_SPEED_UNITS_PER_SECOND = 2.2;
export const DEFAULT_TARGET_SPEED_UNITS_PER_SECOND = 2.8;
export const DEFAULT_TARGET_SPEED_ESTIMATE_UNITS_PER_SECOND = 2.4;
export const DEFAULT_CAR_SPEED_UNITS_PER_SECOND = DEFAULT_CHASER_SPEED_UNITS_PER_SECOND;
export const DEFAULT_CAR_TURN_RATE_RADIANS_PER_SECOND = Math.PI * 1.15;

export const FORWARD_CONTROL_CODES = new Set(["KeyI"]);
export const LEFT_CONTROL_CODES = new Set(["KeyA"]);
export const RIGHT_CONTROL_CODES = new Set(["KeyD"]);
export const CONTROL_CODES = new Set([
  ...FORWARD_CONTROL_CODES,
  ...LEFT_CONTROL_CODES,
  ...RIGHT_CONTROL_CODES,
]);

export const CHASER_AUTOPILOT_ACTION_ID = "chaser-autopilot";
export const CHASER_SPEED_ACTION_ID = "chaser-speed";
export const TARGET_SPEED_ACTION_ID = "target-speed";
export const VEHICLE_TURN_RATE_ACTION_ID = "vehicle-turn-rate";
export const VEHICLE_FOV_ACTION_ID = "vehicle-fov";
export const TARGET_PROJECTION_DEBUG_ACTION_ID = "target-projection-debug";
export const TARGET_PROJECTION_HORIZON_ACTION_ID = "target-projection-horizon";
export const TARGET_PROJECTION_RATE_ACTION_ID = "target-projection-rate";

export const CHASER_AUTOPILOT_STEERING_DEADZONE_RADIANS = 0.08;
export const CHASER_AUTOPILOT_DEFAULT_SEARCH_STEERING = 1;
export const CHASER_AUTOPILOT_SEARCH_LEAD_RADIANS = Math.PI / 4;
export const ASSUMED_GAME_FRAMES_PER_SECOND = 60;
export const DEFAULT_TARGET_PROJECTION_HORIZON_FRAMES = 120;
export const DEFAULT_TARGET_PROJECTION_SAMPLES_PER_SECOND = 3;
export const MAX_TARGET_PROJECTION_HORIZON_FRAMES = 600;
export const MAX_TARGET_PROJECTION_SAMPLES_PER_SECOND = 12;
export const TARGET_ESTIMATE_MIN_MOVE_DISTANCE = 0.02;
export const TARGET_SPEED_ESTIMATE_ALPHA = 0.35;
export const TARGET_SPEED_ESTIMATE_MAX_UNITS_PER_SECOND = 12;
export const TARGET_PREDICTION_CONSENSUS_THRESHOLD = 0.72;
export const TARGET_PREDICTION_KURAMOTO_COUPLING = 1.4;
export const TARGET_PREDICTION_KURAMOTO_ITERATIONS = 16;
export const TARGET_PREDICTION_WALL_AVOIDANCE_WEIGHT = 2.6;
export const TARGET_PREDICTION_WALL_AVOIDANCE_MAX_BLEND = 0.65;
export const TARGET_PROJECTION_COLOR = 0xf43f5e;
export const TARGET_PREDICTION_MAX_UNOBSERVED_SECONDS = 1.25;
export const TARGET_PROJECTION_VALIDATION_LOOKAHEAD_SECONDS = 0.6;
export const TARGET_PROJECTION_INVALIDATION_DISTANCE = 0.55;

export const DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS = Math.PI / 3;
export const FIELD_OF_VIEW_SEGMENTS = 28;
export const CHASER_VIEW_CAMERA_HEIGHT = 0.42;
export const CHASER_VIEW_LOOK_DISTANCE = 3;
export const CHASER_VIEW_MAX_DISTANCE = 9;
export const FIELD_OF_VIEW_DISTANCE = CHASER_VIEW_MAX_DISTANCE;

export const WALL_AVOID_DISTANCE = 0.8;
export const MOVEMENT_CONSENSUS_COUPLING = 1.25;
export const MOVEMENT_CONSENSUS_ITERATIONS = 12;
export const MOVEMENT_GOAL_WEIGHT = 1.35;
export const MOVEMENT_WALL_AVOID_WEIGHT = 2.2;
export const MOVEMENT_WALL_FOLLOW_WEIGHT = 1.8;
export const MOVEMENT_WALL_UNSTICK_WEIGHT = 5.5;
export const MOVEMENT_WALL_MIN_OUTWARD_DOT = 0.04;
export const WALL_APPROACH_RESOLUTION_FRAMES = 30;
export const WALL_HIT_DISTANCE = 0.005;
export const WALL_AVOIDANCE_DETECTION_MIN_APPROACHES = 3;
export const EDGE_LOCK_EPSILON = 0.04;
export const OBSTACLE_PRISM_HEIGHT = 0.62;
export const CENTER_OBSTACLE_SIZE_RATIO = 0.28;

export const CHASE_SETTINGS_STORAGE_KEY = "metrics-ui-play-chase-settings";
export const CHASE_RUNTIME_SETTINGS_KEY = "__metricsUiPlayChaseSettings";
