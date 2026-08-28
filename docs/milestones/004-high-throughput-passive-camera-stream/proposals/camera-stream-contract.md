# Proposal: Camera stream contract

| Field | Value |
| --- | --- |
| Milestone | 004 High-Throughput Passive Camera Stream |
| Frontier | Camera stream contract |
| Proposal branch | `m004/camera-stream-contract-proposal` |
| Implementation branch | `m004/camera-stream-contract` |
| Exit criteria | M004-01, M004-02, M004-03, M004-04, M004-05, M004-06 |
| Review kind | Deterministic invariant closure |

## Review Kind

Deterministic invariant closure

## Review Question

Can a WS agent subscribe to a read-only Chase camera stream that pairs each
image with `gameId + simulationEpoch + frameIndex`, never mutates the session,
never includes evaluator facts, and fail-closes without a sensor artifact on
unsupported, disconnect, or session-identity drift?

This proposal is ready for implementation only if a later implementer can follow
the locked wire types, file list, and tests below without choosing transport
shape, backpressure policy, image format, or privilege boundaries.

## Operator Want

- **Want:** A perception client can `play_camera_stream_subscribe` on the
  existing `/ws/control` socket and receive pushed Chase `front_camera` JPEG
  frames tagged with `simulationEpoch` and `frameIndex`, then
  `play_camera_stream_unsubscribe`, without polling `get_play_debug` or
  `atomic-evaluation-capture` per frame.
- **Reject if:** Implementation reuses `play_game_query` /
  `atomic-evaluation-capture` as the stream, includes evaluator data on a
  frame, mutates playback/control, broadcasts frames to every agent, or claims
  measured 10–30 FPS in this unit.

## Evidence rendering

- Derived HTML: skip
- Skip reason: This unit mints no sealed per-run evidence record. Live FPS
  artifacts belong to the later Live throughput evidence unit.

## Proposed Contract

### Locked decisions (do not reopen during implementation)

| Decision | Locked value | Forbidden alternative |
| --- | --- | --- |
| Transport | New host commands `play_camera_stream_subscribe` / `play_camera_stream_unsubscribe` and push event `play_camera_stream_frame` on the existing JSON WebSocket | `play_game_query` polling, batched one-shot capture, `play_game_command` (ack-only), binary WS frames |
| Routing | Dedicated server subscription registry; frames go only to the subscribing agent | `broadcastToAgents` for frame payloads |
| Backpressure | Latest-frame-only, one pending outbound frame per subscription, `droppedFrameCount` on later frames | Lossless queues, unbounded buffers |
| Image | `image/jpeg` data URL only; default 320×240, quality 0.6, `maxRateHz` 15 | PNG/SVG on the stream, default 640×480 PNG, changing one-shot PNG |
| Privilege | Stream `sensor.image` only; no `evaluator` key | Reusing `AtomicEvaluationCapture` as the frame body |
| One-shot | `atomic-evaluation-capture` and `protocol.passiveObservation` stay byte-compatible | Redirecting one-shot through the stream, deleting query id |
| Subscriptions | One active stream per agent socket | Fan-out, multi-camera, replacing in place |
| Tick hook | Optional `onSimulationFrame` on `createChaseLoop`, after `stepChaseSimulation` and `sceneView.renderFrame` | Capturing from `get_play_debug` or the atomic-capture builder |
| FPS proof | Out of this unit (M004-07) | Recording live FPS, changing Automa, adding SimEval CLI |

### Why not `play_game_query`

The current auto-driving path is `get_state` + `get_play_debug` +
`play_game_query("atomic-evaluation-capture")`. `play_game_query` is a
frontend-required request/response (`FRONTEND_RESPONSE_TIMEOUT_MS` is 3000 ms).
Issue #152 measured ~0.96 FPS at a 0.5 s CLI interval. A stream that still
pulls that query cannot satisfy the milestone. The one-shot query remains for
diagnostics and evaluation bundles.

`get_state` is already answered from the server snapshot and is not the
bottleneck. Do not add per-frame `get_state` or `get_play_debug` to the stream
path.

### Public capability (`get_play_game_usage`)

Keep `protocol.passiveObservation` unchanged. Add `protocol.cameraStream`:

```json
{
  "supported": true,
  "subscribeType": "play_camera_stream_subscribe",
  "unsubscribeType": "play_camera_stream_unsubscribe",
  "frameType": "play_camera_stream_frame",
  "resultType": "play_camera_stream_result",
  "actors": ["chaser", "evader"],
  "cameras": ["front_camera"],
  "imageFormat": "image/jpeg",
  "defaults": {
    "width": 320,
    "height": 240,
    "quality": 0.6,
    "maxRateHz": 15
  },
  "bounds": {
    "width": [80, 640],
    "height": [60, 480],
    "quality": [0.4, 0.9],
    "maxRateHz": [1, 30]
  },
  "backpressure": "latest-frame",
  "oneShotQueryId": "atomic-evaluation-capture",
  "identityFields": ["gameId", "simulationEpoch", "frameIndex"],
  "sessionIdentityFields": ["gameId", "scenarioId", "simulationEpoch", "actorId", "cameraId"]
}
```

When Chase has no evader, `actors` is `["chaser"]` (same rule as
`buildChasePassiveObservationCapability`).

### Wire commands

Agent → frontend (frontend-required; same `FrontendRequestTracker` as
`play_game_query`):

```json
{
  "type": "play_camera_stream_subscribe",
  "request_id": "stream-sub-1",
  "actorId": "chaser",
  "cameraId": "front_camera",
  "width": 320,
  "height": 240,
  "imageFormat": "image/jpeg",
  "quality": 0.6,
  "maxRateHz": 15
}
```

Omitted `actorId` defaults to `"chaser"`. Omitted `cameraId` defaults to
`"front_camera"`. Omitted numeric fields use capability defaults. Present but
malformed actor/camera values must not be coerced (same pattern as
`chase-play-queries.mjs`).

```json
{
  "type": "play_camera_stream_unsubscribe",
  "request_id": "stream-unsub-1",
  "subscriptionId": "chase-cam:<uuid>"
}
```

### Wire results

Subscribe/unsubscribe/unsupported/ended use one result type. Frames use a
separate type and **must not** include `request_id` (a frame `request_id` would
resolve a pending subscribe in `FrontendRequestTracker`).

Successful subscribe (includes the first frame so the client need not wait for
the next simulation step):

```json
{
  "type": "play_camera_stream_result",
  "request_id": "stream-sub-1",
  "payload": {
    "event": "subscribed",
    "subscriptionId": "chase-cam:<uuid>",
    "cameraStream": { "supported": true },
    "playback": { "advanced": false },
    "preservation": {
      "preserved": true,
      "before": { "...fingerprint...": true },
      "after": { "...same fingerprint...": true }
    },
    "frame": { "...CameraStreamFrame payload without event envelope...": true }
  }
}
```

The subscribe `before`/`after` fingerprints must be equal. Building the first
frame must not play, pause, reset, change scenario, or apply control. Compare
the full passive-observation fingerprint for this one-shot subscribe receipt,
including `frameIndex`.

Unsupported subscribe (no `subscriptionId`, no `frame`, no `sensor`):

```json
{
  "type": "play_camera_stream_result",
  "request_id": "stream-sub-1",
  "payload": {
    "event": "unsupported",
    "cameraStream": {
      "supported": false,
      "reason": {
        "code": "actor_unavailable",
        "message": "Requested actor is not available.",
        "field": "actorId",
        "requested": "evader",
        "available": ["chaser"]
      }
    }
  }
}
```

Host-missing frontend uses the existing structured error builder, with
`command: "play_camera_stream_subscribe"` (or unsubscribe) instead of inventing
a timeout-only failure.

Push frame:

```json
{
  "type": "play_camera_stream_frame",
  "payload": {
    "subscriptionId": "chase-cam:<uuid>",
    "actorId": "chaser",
    "cameraId": "front_camera",
    "frameIdentity": {
      "gameId": "chase",
      "simulationEpoch": "chase-run:…",
      "frameIndex": 104
    },
    "playback": { "advanced": false },
    "droppedFrameCount": 2,
    "sensor": {
      "image": {
        "contentType": "image/jpeg",
        "rendererId": "chase-actor-view-threejs-v1",
        "width": 320,
        "height": 240,
        "dataUrl": "data:image/jpeg;base64,…"
      }
    }
  }
}
```

`sensor` must contain only `image`. The object must not have an `evaluator`
property. `droppedFrameCount` is cumulative since subscribe (integer ≥ 0).
`playback.advanced` is always `false` and means the stream path did not advance
playback; the simulation may still advance on its own loop.

Ended (no image):

```json
{
  "type": "play_camera_stream_result",
  "payload": {
    "event": "ended",
    "subscriptionId": "chase-cam:<uuid>",
    "reason": {
      "code": "frontend_disconnected",
      "message": "Frontend disconnected before the camera stream ended."
    }
  }
}
```

Unsubscribe success: `event: "unsubscribed"` with the `subscriptionId` and no
frame.

### Locked reason codes

| Code | When | Image present |
| --- | --- | --- |
| `actor_invalid` / `camera_invalid` | Present non-string / empty target | No |
| `actor_unavailable` / `camera_unavailable` | Target not in capability lists | No |
| `image_format_unsupported` | `imageFormat` present and not `image/jpeg` | No |
| `image_dimension_invalid` | width/height present and not a finite number | No |
| `max_rate_invalid` | `maxRateHz` present and not a finite number | No |
| `quality_invalid` | `quality` present and not a finite number | No |
| `already_subscribed` | Agent already has an active subscription | No |
| `subscription_not_found` | Unsubscribe id unknown to this agent | No |
| `session_fingerprint_unavailable` | Cannot read required session identity | No |
| `capture_unavailable` | `captureActorView` returned null/threw | No |
| `capture_identity_mismatch` | First-frame identity ≠ subscribe fingerprint | No |
| `session_identity_changed` | `gameId`, `scenarioId`, `simulationEpoch`, `actorId`, or `cameraId` changed after subscribe | No; end the stream |
| `frontend_not_connected` / `frontend_unresponsive` / `frontend_disconnected` | Existing host failures | No |

Out-of-range but finite width/height/quality/`maxRateHz` **clamp** to bounds
after they pass the finite-number check. Integers for width/height/`maxRateHz`
via `Math.round`. Do not fail-closed on a width of 10000; clamp to 640.

### Session identity vs one-shot preservation

Reuse `buildChasePassiveObservationFingerprint` for the subscribe receipt.

After subscribe, **do not** fail-closed when `frameIndex`, `playback.phase`,
`pendingAction`, `controlSource`, or `controlInput` change. Those are operator
or simulation motion. Fail-closed and `event: "ended"` with
`session_identity_changed` only when one of
`gameId | scenarioId | simulationEpoch | actorId | cameraId` changes (reset,
scenario load, or actor loss).

The stream path itself must not call play, pause, stop, seek, scenario load,
reset, or chaser control. Prove that with the builder: subscribe/frame builders
take snapshots and return values; they do not receive those mutators.

### Latest-frame and rate

Own this in Chase runtime, not the server.

- Emit a frame only when `frameIndex` changes, plus exactly one first frame on
  subscribe (even if paused).
- While paused with a stable `frameIndex`, emit nothing (not a drop).
- `maxRateHz` skips additional changed frames that arrive sooner than
  `1000 / maxRateHz` ms after the last *sent* frame; each skip adds 1 to
  `droppedFrameCount`.
- If a previous `sendMessage` of a frame has not completed / a newer frame is
  ready, replace the pending frame and add 1 to `droppedFrameCount`. Never
  queue more than one pending frame.

Default `maxRateHz` is 15. This unit does not prove 10–30 FPS live.

### Server registry

Add `server/routes/camera-stream-subscriptions.ts` (do not grow
`server/routes.ts` with the registry implementation).

Responsibilities:

1. Map `subscriptionId → agent WebSocket` and `agent → subscriptionId`.
2. On subscribe command from an agent: if that agent already has a
   subscription, respond `already_subscribed` **without** forwarding to the
   frontend. Otherwise mark frontend-required, track `request_id`, forward
   subscribe to the frontend.
3. On successful `event: "subscribed"` from the frontend, store the mapping
   using `payload.subscriptionId`, then send that result **only** to the
   originating agent (not `broadcastToAgents`).
4. On `play_camera_stream_frame` from the frontend: **intercept before**
   `broadcastToAgents` in the frontend message branch of `server/routes.ts`.
   Forward only to the mapped agent. If the agent socket is not `OPEN`, drop
   the mapping and tell the frontend to unsubscribe (no tracker if the original
   request is gone).
5. On frontend disconnect: send `event: "ended"` /
   `frontend_disconnected` to mapped agents; clear mappings.
6. On agent disconnect: clear that agent's mapping; if frontend is up, send
   `play_camera_stream_unsubscribe` with the `subscriptionId` so encoding
   stops.
7. Unsubscribe request/response stays frontend-required and agent-specific.

`play_camera_stream_frame` and `play_camera_stream_result` with `event: "ended"`
must not be passed to `broadcastToAgents`. Other frontend messages keep current
broadcast behavior.

### Chase runtime wiring

1. New owner `examples/play/chase/evaluation/camera-stream.ts` with the
   builders named in File Impact. Import fingerprint helpers from
   `passive-observation.ts`. Do not copy fingerprint code.
2. `createChaseLoop({ onSimulationFrame })` calls `onSimulationFrame({
   frameIndex, simulationEpoch })` after stepping and `renderFrame`. When the
   callback is omitted, behavior is unchanged.
3. `createPlayGame` holds at most one local subscription record. Subscribe
   captures the first JPEG via existing `sceneView.captureActorView` /
   equivalent capture renderer with `contentType: "image/jpeg"` and `quality`.
   Do not call `buildAtomicEvaluationCaptureFromSnapshot` on the stream path.
4. Extend actor-view `capture()` with optional `quality`. Call
   `domElement.toDataURL(contentType, quality)` only when
   `contentType === "image/jpeg"`. Default `capture()` remains PNG for one-shot
   and front-view snapshot.
5. Export `handleCameraStreamSubscribe` / `handleCameraStreamUnsubscribe` on
   the Play game instance (result objects, not booleans). Wire them through
   Play host the same way as `handleQuery`: a thin callback from `home.tsx` /
   `use-websocket-control.ts` into a new WS handler file
   `client/src/hooks/ws/handlers/camera-stream.ts`. Register that handler in
   `command-dispatch.ts` **before** the generic event handler.
6. `dispose()` of the game must end any active subscription (frontend stops
   encoding; if an agent is still mapped, server sends `ended`).

### Schema and lint

`shared/schema.ts` is already at the file-size-lint ceiling (1000). Add the
command/response **names** to the `ControlCommand` / `ControlResponse` unions.
Put payload types in `shared/play-camera-stream.ts` and import them. Do not
redesign unrelated schema. Add the command names to
`shared/protocol-utils.ts` capabilities and to
`client/src/hooks/ws/constants.ts` `RESPONSE_TYPES`.

Add both command types to `FRONTEND_RESPONSE_REQUIRED_COMMANDS` in
`server/routes/frontend-command-routing.ts`.

### USAGE.md

Document the three message types next to the existing `play_game_query`
atomic-capture paragraph. State: stream is JPEG latest-frame-only; one-shot
capture remains; evaluator is not on the stream; missing frontend fails with
the existing structured codes.

### Tests the implementer must add

New file `examples/play/chase/chase-camera-stream-regression.test.mjs`, and
register it in `package.json` `play:chase:regress` next to the other Chase
tests. Also extend `server/routes/frontend-command-routing.test.ts`,
`server/routes/frontend-request-tracker.test.ts` if needed, and add
`server/routes/camera-stream-subscriptions.test.ts`.

Required cases (name them so the review can grep):

1. Capability advertises stream types, JPEG defaults/bounds, and
   `oneShotQueryId: "atomic-evaluation-capture"`.
2. Subscribe defaults actor/camera and returns equal before/after
   fingerprints, `playback.advanced === false`, a JPEG `dataUrl`, and **no**
   `evaluator` key.
3. Subscribe does not call play/pause/reset/control mutators (pass spies that
   must stay at zero calls).
4. Malformed actor/camera types fail closed with `actor_invalid` /
   `camera_invalid` and no frame.
5. Unknown actor/camera fail closed with `*_unavailable` and no capture call.
6. `imageFormat: "image/png"` → `image_format_unsupported`, no frame.
7. Second subscribe on the same agent → `already_subscribed`; first
   subscription remains.
8. Unsubscribe unknown id → `subscription_not_found`.
9. After subscribe, `frameIndex` change emits a `play_camera_stream_frame`
   with the new index and same `simulationEpoch`.
10. Stable `frameIndex` (paused) emits no additional frame and does not
    increment `droppedFrameCount`.
11. Faster than `maxRateHz` increments `droppedFrameCount` and keeps the
    latest frame only (`selectLatestCameraStreamFrame`).
12. Epoch change after subscribe ends the stream with
    `session_identity_changed` and no image.
13. Control input / pause-phase change after subscribe does **not** end the
    stream.
14. Frontend missing: `requiresFrontendResponse(subscribe) === true` and
    `buildFrontendUnavailableResponse` includes the subscribe command type.
15. Registry forwards a frame only to the mapped agent, never to a second
    agent.
16. Agent disconnect removes the mapping.
17. Frontend disconnect emits `ended` / `frontend_disconnected` to the
    subscriber.
18. Existing `handleChasePlayQuery` atomic capture still returns evaluator
    plus `protocol.passiveObservation` (regression; do not weaken M002 tests).
19. Actor-view PNG capture without `quality` still uses `toDataURL(contentType)`
    (one-shot unchanged). JPEG capture passes quality through.

Do not add a live browser FPS test in this unit.

### Implementation sequence (follow in order)

1. Pure builders + regression tests in
   `examples/play/chase/evaluation/camera-stream.ts` and
   `chase-camera-stream-regression.test.mjs`. Keep tests red only until the
   builder exists; do not start WS work first.
2. Schema/protocol/constants/frontend-required command set.
3. Server registry module + intercept in `server/routes.ts` frontend branch.
4. WS handler + Play host callback wiring.
5. `createChaseLoop` hook + runtime subscribe state + JPEG `quality` on capture.
6. Usage/USAGE.md.
7. Run Validation Plan commands. If `shared/schema.ts` lint fails, finish the
   extraction to `shared/play-camera-stream.ts` rather than raising the lint
   ceiling.

Once the accepted tests are green, one collapse of two shapes in the same owner
is allowed. Do not change this contract during that collapse.

## Ownership

Primary enforcement owner: `examples/play/chase/evaluation/camera-stream.ts`
(subscribe result, frame payload, fail-closed reasons, latest-frame selector,
session-identity comparison).

Required transport adapter, not a second review question: WS subscription
registry in `server/routes/camera-stream-subscriptions.ts` plus the
`server/routes.ts` intercept that prevents `broadcastToAgents` from sending
frames. If the builder says unsupported, the host must not attach an image. If
the registry cannot map a subscriber, it must not broadcast.

## Affected Paths

- Agent subscribe/unsubscribe on `/ws/control` with a connected Play/Chase
  frontend.
- Frontend encode/send of JPEG frames from the Chase loop.
- Server forward-only registry.
- Chase usage advertisement.
- Compatibility path: existing `play_game_query` /
  `atomic-evaluation-capture`.

Regular usage does not include binary sockets, multiple cameras, or Automa
client changes.

## Trust And Authority Model

| Claim | Kind | Authority | Not claimed |
| --- | --- | --- | --- |
| Frame image belongs to `gameId + simulationEpoch + frameIndex` | Consistency | Chase `simulationEpochOwner.current()` and `simulationState.frameIndex` at capture time; builder rejects mismatch on subscribe | Physical-camera authenticity |
| Stream does not mutate session | Provenance | Builders and runtime subscribe/unsubscribe receive no play/pause/reset/control functions; tests spy those mutators | Operator may still pause or steer on other paths |
| Sensor payload contains no evaluator facts | Consistency | Frame type has `sensor.image` only; tests assert `'evaluator' in frame === false` | One-shot capture still has evaluator, off this path |
| Unsupported/ended has no image | Fail-closed | Builder returns reason-only objects; host must not attach `sensor` | Timeouts already owned by `FrontendRequestTracker` |
| Frames reach only the subscriber | Routing integrity | Registry map; intercept before `broadcastToAgents` | Confidentiality against a compromised frontend |
| Latest-frame drops are counted | Consistency | `droppedFrameCount` on the next sent frame | Lossless delivery |

Trusted inputs: Chase simulation state, capture renderer pixels, existing
passive-observation fingerprint fields.

Untrusted inputs: agent payload fields, extra keys, a second agent socket,
malformed types.

Same-user mutation is in the model: the operator may pause or change latched
input while a stream runs. That is allowed. Same-user **reset / scenario load /
epoch change** ends the stream.

Excluded adversaries: compromising the browser frontend, forging simulation
state inside Chase, or network-level WS injection beyond the existing control
socket trust.

## Evidence Topology And Capture Strategy

| Claim | Raw evidence | Verifier in this unit | Live capture |
| --- | --- | --- | --- |
| Identity pairing | Builder inputs + output `frameIdentity` | Deterministic tests 2, 9, 12 | Not required |
| No mutation | Spy of mutators around subscribe/frame | Test 3 | Not required |
| No evaluator | Frame object shape | Tests 2, 18 | Not required |
| Fail-closed | Reason codes + absence of `sensor`/`frame` | Tests 4–8, 12, 14 | Not required |
| Subscriber-only routing | Registry unit tests with fake sockets | Tests 15–17 | Not required |
| One-shot compatibility | Existing M002 tests plus test 18 | `play:chase:regress` | Not required |
| 10–30 FPS | Out of scope | None | Later evidence unit; not ready until this implementation is accepted |

Canonical live-artifact capture for M004-07 must not start in this
implementation. Capture-readiness for that later unit: accepted stream
implementation on the milestone branch, Play tab foregrounded, JPEG stream
subscribed.

## Adversarial Matrix

| Case | Required result |
| --- | --- |
| Subscribe with omitted actor/camera | Defaults chaser / `front_camera`; success if available |
| `actorId: 123` or `cameraId: null` | `actor_invalid` / `camera_invalid`; no capture |
| Evader requested while `evaderExists === false` | `actor_unavailable`; no capture |
| `cameraId: "rear_camera"` | `camera_unavailable`; no capture |
| `imageFormat: "image/png"` | `image_format_unsupported`; no capture |
| Width 10000 | Clamp to 640; still JPEG |
| `maxRateHz: 0.2` after finite check | Clamp to 1 |
| Second subscribe, same agent | `already_subscribed`; original stream continues |
| Two agents subscribe | Two independent subscriptions and frame maps |
| Frame message includes `request_id` | Forbidden by contract; builder omits it; host tests assert absence |
| Frontend message branch still broadcasts frames | Reject; intercept before `broadcastToAgents` |
| Subscribe path calls `buildAtomicEvaluationCaptureFromSnapshot` | Reject |
| Frame object has `evaluator` | Reject |
| Epoch change mid-stream | `ended` / `session_identity_changed`; no image |
| Steering change mid-stream | Stream continues |
| Pause mid-stream | No extra frames while `frameIndex` is stable; stream remains subscribed |
| Frontend gone at subscribe | Existing `frontend_not_connected` structured error |
| Frontend disconnect mid-stream | `ended` / `frontend_disconnected` |
| Agent disconnect mid-stream | Mapping removed; frontend encoding stops |
| `atomic-evaluation-capture` after stream lands | Unchanged query id, image + evaluator + preservation |
| Implementation records live FPS and marks M004-07 Met | Reject; wrong unit |
| Implementation changes 003 or vehicle dynamics | Reject |

Every row has a named test above or is a review reject of an out-of-scope diff.

## External Assumptions

- A connected Play frontend with Chase loaded owns capture, as with M002.
- Chase advances on browser animation frames; a backgrounded tab can stall
  emission. That is residual for M004-07, not a fail of this contract.
- Auto-driving issue #152 consumption (switching Automa off the pull path) is
  out of this repository.
- GitHub issue #150 is already satisfied by M002 PR #151.
- `FrontendRequestTracker` and `requiresFrontendResponse` remain the host
  timeout/disconnect mechanism for subscribe/unsubscribe.

## Non-Goals

- Measuring or claiming 10–30 FPS (M004-07).
- Changing `atomic-evaluation-capture` semantics or
  `protocol.passiveObservation`.
- Putting evaluator shadow or control reference on stream frames.
- VLM / Milestone 003 observation interpretation.
- Vehicle behavior, scenario, or renderer-profile changes.
- Binary WebSocket frames, PNG/SVG stream formats, lossless buffering.
- Multi-camera, multi-subscription-per-agent, or dashboard UI for the stream.
- SimEval CLI flags, Automa adapters, or closing GitHub issue #150.
- Raising file-size-lint ceilings to avoid extracting stream types.

## File Impact

### Proposal PR only

| Path | Change |
| --- | --- |
| `docs/milestones/004-high-throughput-passive-camera-stream/proposals/camera-stream-contract.md` | This contract |
| `docs/milestones/004-high-throughput-passive-camera-stream/plan.md` / `plan.html` | Select Camera stream contract as current in `proposal_in_review`; remaining path `Live throughput evidence` → `Milestone closeout` |

### Expected implementation PR

| Path | Change |
| --- | --- |
| `examples/play/chase/evaluation/camera-stream.ts` | **Create.** Builders, types, reason codes, latest-frame helper, session-identity diff |
| `examples/play/chase/chase-camera-stream-regression.test.mjs` | **Create.** Cases 1–13, 18–19 |
| `examples/play/chase/ui/chase-play-usage.mjs` | Advertise `protocol.cameraStream` |
| `examples/play/chase/ui/chase-loop.mjs` | Optional `onSimulationFrame` after step+render |
| `examples/play/chase/ui/runtime.mjs` | One local subscription; JPEG capture; loop hook; dispose ends stream |
| `examples/play/chase/ui/actor-view-controller.mjs` | Optional JPEG `quality` for `toDataURL`; PNG default unchanged |
| `examples/play/chase/ui/chase-play-queries.mjs` | No stream in this file |
| `shared/play-camera-stream.ts` | **Create.** Payload types |
| `shared/schema.ts` | Add the three message type names to the unions |
| `shared/protocol-utils.ts` | Advertise commands/responses |
| `shared/__tests__/protocol-utils.test.ts` | Assert new command/response names |
| `server/routes/camera-stream-subscriptions.ts` | **Create.** Registry |
| `server/routes/camera-stream-subscriptions.test.ts` | **Create.** Cases 15–17 |
| `server/routes/frontend-command-routing.ts` | Mark subscribe/unsubscribe frontend-required |
| `server/routes/frontend-command-routing.test.ts` | Case 14 |
| `server/routes.ts` | Intercept frame/ended before `broadcastToAgents`; wire registry on register/close |
| `client/src/hooks/ws/handlers/camera-stream.ts` | **Create.** Subscribe/unsubscribe dispatch |
| `client/src/hooks/ws/command-dispatch.ts` | Register the handler |
| `client/src/hooks/ws/constants.ts` | Response types |
| `client/src/hooks/ws/dispatch-context.ts` | Callbacks |
| `client/src/hooks/use-websocket-control.ts` | Thread callbacks |
| `client/src/components/home/play-game-host/types.ts` | `handleCameraStreamSubscribe` / `Unsubscribe` on the instance |
| `client/src/components/home/play-game-host/use-play-game-module.ts` | Set the new handlers |
| `client/src/pages/home.tsx` | Thin forward only; no Play redesign |
| `USAGE.md` | Stream usage next to one-shot capture |
| `package.json` | Add the new test file to `play:chase:regress` |

Do not modify `examples/play/chase/evaluation/atomic-capture.ts` public
exports, `passive-observation.ts` reason codes (import only), Milestone 003
files, or M002 evidence bytes.

If `home.tsx` file-size-lint fails, extract only the new stream callback into
the existing play-host module rather than refactoring the home page.

## Validation Plan

### Proposal PR

```sh
python3 docs/milestones/workflow.py validate \
  docs/milestones/004-high-throughput-passive-camera-stream/plan.md
python3 docs/render_markdown.py --check
PYTHONPATH=. python3 -m unittest discover -s tests/docs
python3 docs/milestones/workflow.py validate-pr \
  --base-ref milestone/004-high-throughput-passive-camera-stream \
  --head-ref m004/camera-stream-contract-proposal \
  --base-sha <merge-base> \
  --head-sha <head> \
  --pr-body-file <path-to-pr-body>
```

Review confirms proposal-only paths, one invariant question, locked push
transport, and no product code.

### Implementation PR

```sh
npm run play:chase:regress
npm exec -- tsc
python3 docs/milestones/workflow.py validate \
  docs/milestones/004-high-throughput-passive-camera-stream/plan.md
python3 docs/render_markdown.py --check
```

Record exact command results at the implementation head. Existing M002 Chase
tests must stay green. No live FPS capture.

## Expected Handoff

```json
{
  "schema": "milestone_handoff_template_v1",
  "outcome": "advance",
  "result": "Accepted",
  "durable_evidence": "Accepted camera-stream subscribe/unsubscribe/frame contract, fail-closed unsupported and identity-drift endings, JPEG latest-frame builder, subscriber-only WS registry, and unchanged atomic-evaluation-capture in PR #{pr}",
  "criterion_updates": {
    "M004-01": {
      "status": "Met",
      "evidence": "protocol.cameraStream advertised on Chase usage in PR #{pr}"
    },
    "M004-02": {
      "status": "Met",
      "evidence": "Subscribe/unsubscribe request-response and structured unsupported results in PR #{pr}"
    },
    "M004-03": {
      "status": "Met",
      "evidence": "Frames pair JPEG image with gameId+simulationEpoch+frameIndex; mutator spies stay zero in PR #{pr}"
    },
    "M004-04": {
      "status": "Met",
      "evidence": "Stream frames have sensor.image only and no evaluator key in PR #{pr}"
    },
    "M004-05": {
      "status": "Met",
      "evidence": "Latest-frame droppedFrameCount, unsubscribe, and disconnect ended events in PR #{pr}"
    },
    "M004-06": {
      "status": "Met",
      "evidence": "atomic-evaluation-capture and protocol.passiveObservation remain available in PR #{pr}"
    }
  },
  "risk_remove": [],
  "risk_upsert": [],
  "next_frontier": {
    "state": "none",
    "reason": "Remaining work-order nodes stay on the map; current returns to idle.",
    "revisit_when": "The next proposal selects Live throughput evidence from the work order."
  }
}
```

### Sequence after this proposal merges

1. Accept this proposal with an exact-head contract review, merge it to
   `milestone/004-high-throughput-passive-camera-stream`, and run
   `python3 docs/milestones/workflow.py accept-proposal`.
2. Status must report `ready_for_implementation` before any product branch.
3. A lower-capability implementer starts `m004/camera-stream-contract` and
   implements **only** this document, in the numbered sequence above.
4. Do not start Live throughput evidence until this implementation is accepted
   and current is idle.
