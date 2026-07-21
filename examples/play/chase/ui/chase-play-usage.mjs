import { CHASE_PLAY_COMMAND_IDS } from "./chase-play-commands.mjs";
import { CHASE_PLAY_QUERY_IDS } from "./chase-play-queries.mjs";

export function buildChasePlayUsage() {
  return {
    game: {
      id: "chase",
      label: "Chase",
      description: "Vehicle chase simulator with timeline controls, scenario reset, front-view snapshots, and WS chaser control.",
    },
    setup: [
      {
        label: "Open the Play sub-app",
        command: "simeval ui subapp --app play --ui ws://localhost:5050/ws/control",
      },
      {
        label: "Confirm the loaded game usage",
        command: "simeval ui play-game-usage --ui ws://localhost:5050/ws/control",
      },
      {
        label: "Give the external WS client control of the chaser",
        command: "simeval ui play-chaser-source --source ws --ui ws://localhost:5050/ws/control",
      },
    ],
    cli: [
      {
        group: "Game and timeline",
        commands: [
          {
            command: "simeval ui subapp --app play",
            description: "Switch the frontend to the Play sub-app so the active game can load.",
          },
          {
            command: "simeval ui play",
            description: "Start the UI playback timeline.",
          },
          {
            command: "simeval ui pause",
            description: "Pause the UI playback timeline.",
          },
          {
            command: "simeval ui stop",
            description: "Stop playback and seek to the start.",
          },
          {
            command: "simeval ui seek --tick 0",
            description: "Seek the shared UI timeline.",
          },
        ],
      },
      {
        group: "Chaser control",
        commands: [
          {
            command: "simeval ui play-chaser-source --source ws",
            description: "Set the chaser control source to the WS latched-input controller.",
          },
          {
            command: "simeval ui play-chaser-control --motion forward --steering -0.35",
            description: "Latch forward motion and right steering until another chaser-control command changes it.",
          },
          {
            command: "simeval ui play-chaser-control --motion none --steering 0",
            description: "Latch idle throttle and centered steering.",
          },
        ],
      },
      {
        group: "Rendering variation",
        commands: [
          {
            command: "simeval ui play-game-action --action-id rendering-profile --value '\"randomized\"'",
            description: "Select the seeded RC indoor variation profile for the current Chase session.",
          },
          {
            command: "simeval ui play-game-action --action-id rendering-seed --value 17",
            description: "Set the bounded visual variation seed, then reset or capture the same reproducible scene.",
          },
        ],
      },
      {
        group: "Observation and debugging",
        commands: [
          {
            command: "simeval ui state",
            description: "Read the frontend state, including active sub-app and playback timeline.",
          },
          {
            command: "simeval ui play-debug --summary",
            description: "Read a compact Chase debug summary from the active game.",
          },
          {
            command: "simeval ui play-front-view-snapshot --actor chaser --out-dir /tmp/chase-snapshot",
            description: "Write a rendered chaser front-view image and metadata snapshot.",
          },
          {
            command: `simeval ui trace --request-id chase-evaluation-1 --send '{"type":"play_game_query","request_id":"chase-evaluation-1","queryId":"${CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE}","payload":{"actorId":"chaser"}}'`,
            description: "Request one same-state camera artifact and separately labeled evaluator shadow without advancing playback.",
          },
        ],
      },
    ],
    wireCommands: [
      {
        commandId: CHASE_PLAY_COMMAND_IDS.SET_CHASER_CONTROL_SOURCE,
        summary: "Select the chaser controller for the current frontend session.",
        payload: {
          source: "programmatic|keyboard|ws",
        },
        cliAlias: "simeval ui play-chaser-source --source ws",
      },
      {
        commandId: CHASE_PLAY_COMMAND_IDS.SET_CHASER_INPUT,
        summary: "Set latched WS chaser vehicle input. Values persist until changed.",
        payload: {
          motion: "forward|reverse|backward|backwards|idle|none|stop|stopped",
          forward: "boolean",
          reverse: "boolean",
          steering: "number from -1 to 1; negative steers right, positive steers left",
        },
        cliAlias: "simeval ui play-chaser-control --motion forward --steering -0.35",
      },
    ],
    protocol: {
      envelopeType: "play_game_command",
      queryEnvelopeType: "play_game_query",
      queryResponseType: "play_game_query_result",
      evaluationCaptureQueryId: CHASE_PLAY_QUERY_IDS.ATOMIC_EVALUATION_CAPTURE,
      usageQueryType: "get_play_game_usage",
      usageResponseType: "play_game_usage",
    },
    notes: [
      "This usage is returned by the loaded Play game. It requires an active frontend session with the Play sub-app loaded.",
      "With the default play catalog, Chase is the active game. If multiple games are added later, select the Chase game before using these commands.",
      "Timeline commands are shell-level UI controls; chaser commands are game-level commands routed through the generic play_game_command envelope.",
      "Read-only game data uses the generic play_game_query envelope. Unsupported query IDs fail explicitly instead of returning an empty result.",
    ],
  };
}
