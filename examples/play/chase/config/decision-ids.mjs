export const CHASER_ACTION_PROPOSAL_IDS = Object.freeze({
  EVADER_PREDICTION_PURSUIT: "evaderPredictionPursuit",
  LINE_OF_SIGHT_PURSUIT: "lineOfSightPursuit",
  MAP_DISCOVERY: "mapDiscovery",
  MAP_RECENCY_REFRESH: "mapRecencyRefresh",
  SPIN: "spin",
});

export const CHASER_MOTIVE_IDS = Object.freeze({
  CHASE: "chase",
  KNOWLEDGE_ACQUISITION: "knowledgeAcquisition",
});

export const CHASER_CHASE_MOTIVE_ACTION_PROPOSAL_IDS = Object.freeze([
  CHASER_ACTION_PROPOSAL_IDS.EVADER_PREDICTION_PURSUIT,
  CHASER_ACTION_PROPOSAL_IDS.LINE_OF_SIGHT_PURSUIT,
]);

export const CHASER_KNOWLEDGE_MOTIVE_ACTION_PROPOSAL_IDS = Object.freeze([
  CHASER_ACTION_PROPOSAL_IDS.MAP_DISCOVERY,
  CHASER_ACTION_PROPOSAL_IDS.MAP_RECENCY_REFRESH,
  CHASER_ACTION_PROPOSAL_IDS.SPIN,
]);

export const CHASER_ACTION_PROPOSAL_MOTIVE_GROUPS = Object.freeze([
  Object.freeze({
    id: CHASER_MOTIVE_IDS.CHASE,
    label: "Chase",
    actionProposalIds: CHASER_CHASE_MOTIVE_ACTION_PROPOSAL_IDS,
  }),
  Object.freeze({
    id: CHASER_MOTIVE_IDS.KNOWLEDGE_ACQUISITION,
    label: "Knowledge acquisition",
    actionProposalIds: CHASER_KNOWLEDGE_MOTIVE_ACTION_PROPOSAL_IDS,
  }),
]);

export const CHASER_PATTERN_IDS = Object.freeze({
  CONTINUANCE: "continuance",
  WALL_AVOIDANCE: "wallAvoidance",
});

export const EVADER_ACTION_PROPOSAL_IDS = Object.freeze({
  DEFAULT_ROAM: "defaultRoam",
  EVADE_ON_SIGHT: "evadeOnSight",
});
