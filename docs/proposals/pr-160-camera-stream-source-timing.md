# Proposal: Camera stream source timing (PR #160 follow-up)

Parent: [#160](https://github.com/GeorgeLuo/metrics-ui/pull/160) (`codex/camera-stream-contract`)
Issue: [#152](https://github.com/GeorgeLuo/metrics-ui/issues/152)
Comments: [source clock](https://github.com/GeorgeLuo/metrics-ui/pull/160#issuecomment-5459627278), [agreement](https://github.com/GeorgeLuo/metrics-ui/pull/160#issuecomment-5459648363)

This is an additive contract on the landed stream. It is not a milestone. Implementation
must target `codex/camera-stream-contract` after this proposal is accepted.

## Review question

Can every camera-stream JPEG carry a capture-time `sourceTimestampUs` (and a
send-time `publishedAtUs`) so a consumer can pace source-faithful 1× replay, and
can subscribe select `dropPolicy: "none"` so sampled frames are queued instead
of latest-frame dropped?

Ready for a later implementer only if they can fill the locked types, clocks,
drop policy, files, and tests below without choosing a different clock or
inventing lossless buffering.

## Operator want

- **Want:** Auto-driving can schedule
  `replayStart + (sourceTimestampUs - firstSourceTimestampUs)` and tell
  processing lag from source interval. Strict consumer mode can request that
  Metrics UI not latest-frame-drop sampled frames.
- **Reject if:** Replay pacing uses Metrics UI send/publish time; timestamps
  come from `Date.now()`; evaluator data appears on frames; one-shot capture
  changes; unbounded queues; live 10–30 FPS claims.

## Locked decisions

| Decision | Locked value | Forbidden |
| --- | --- | --- |
| Source clock | `sourceTimestampUs`: integer µs from `Math.round(performance.now() * 1000)` **immediately after** successful JPEG `capture()` for that frame | Unix `Date.now()`, WS send time, `frameIndex * dt` as a substitute |
| Publish clock | `publishedAtUs`: integer µs from the same `performance.now` origin **immediately before** the frontend `sendMessage` of that frame | Using `publishedAtUs` for replay pacing |
| Where they appear | Every `play_camera_stream_frame` payload **and** the subscribe result `frame` | Optional-only source timestamp; omitting them on the first frame |
| Default drop policy | `"latest-frame"` — current behavior, unchanged if the field is omitted | Changing default to no-drop |
| No-drop policy | Subscribe `dropPolicy: "none"`: still sample with `maxRateHz`; do **not** replace an in-flight/pending sampled frame; FIFO queue of already-sampled frames, cap **8**; overflow ends the stream | Unbounded lossless buffer, binary WS, raising `maxRateHz` above 30 |
| Consumer modes | Strict vs 1× real-time skipping is **not** implemented here. This repo only supplies clocks + producer drop policy | Auto-driving workbench, SimEval CLI |
| Sampling vs drop | `maxRateHz` still skips unsampled simulation frames (Chase default render is 60 FPS; stream max 30 Hz). Those skips still increment `droppedFrameCount` | Treating `maxRateHz` sampling as a bug; emitting 60 Hz |
| Privilege | Image-only sensor; no evaluator; no play/pause/reset/control | Reusing atomic evaluation capture |

## Wire additions

### Subscribe (additive fields)

Existing subscribe fields stay. Add:

```json
{
  "type": "play_camera_stream_subscribe",
  "request_id": "stream-sub-1",
  "actorId": "chaser",
  "cameraId": "front_camera",
  "dropPolicy": "none"
}
```

`dropPolicy` omitted → `"latest-frame"`. Present and not `"latest-frame"` or
`"none"` → `drop_policy_invalid`, no image, no subscription.

### Frame payload (additive fields)

```json
{
  "type": "play_camera_stream_frame",
  "payload": {
    "subscriptionId": "chase-cam:…",
    "actorId": "chaser",
    "cameraId": "front_camera",
    "frameIdentity": {
      "gameId": "chase",
      "simulationEpoch": "chase-run:…",
      "frameIndex": 104
    },
    "sourceTimestampUs": 123456789,
    "publishedAtUs": 123458001,
    "playback": { "advanced": false },
    "droppedFrameCount": 2,
    "sensor": { "image": { "contentType": "image/jpeg", "rendererId": "…", "width": 320, "height": 240, "dataUrl": "data:image/jpeg;base64,…" } }
  }
}
```

Same two fields on `play_camera_stream_result` `event: "subscribed"` `.frame`.

Invariants:

- Both timestamps are integers, finite, `>= 0`.
- `publishedAtUs >= sourceTimestampUs` on a sent frame.
- Later delivered frame in one subscription: `sourceTimestampUs` is `>=` the
  previous delivered frame’s `sourceTimestampUs`.
- Frames still **must not** include `request_id` or `evaluator`.

### Capability (`protocol.cameraStream`)

Keep current fields. Add:

```json
{
  "timingFields": ["sourceTimestampUs", "publishedAtUs"],
  "sourceTimestampClock": "performance.now-microseconds-at-jpeg-capture",
  "publishedAtClock": "performance.now-microseconds-at-ws-send",
  "dropPolicies": ["latest-frame", "none"],
  "defaults": {
    "width": 320,
    "height": 240,
    "quality": 0.6,
    "maxRateHz": 15,
    "dropPolicy": "latest-frame"
  },
  "queueBound": 8
}
```

Leave `backpressure: "latest-frame"` as the default policy name so existing
clients keep working.

## Clock placement (do not invent another)

1. **Source.** After `capture()` returns a valid JPEG, set
   `sourceTimestampUs = Math.round(nowMs() * 1000)` where `nowMs` is
   `performance.now` (injectable in tests, same helper the runtime already uses).
   Do this for the subscribe first frame and for every later sampled frame.
2. **Publish.** In `emitMessage` / send path, copy the frame and set
   `publishedAtUs` immediately before `current.emit(...)`. Queued frames get
   `publishedAtUs` at actual send, not at enqueue.
3. **Builder.** `buildChaseCameraStreamFrame` requires `sourceTimestampUs`.
   Missing / non-integer / negative → do not emit a frame. Subscribe path:
   `source_timestamp_invalid` unsupported, no subscription. Active stream:
   `ended` with `source_timestamp_invalid`, no image.
4. **Stamp helper.** Add `stampCameraStreamFramePublished(frame, publishedAtUs)`
   in `evaluation/camera-stream.ts`. Invalid publish stamp: same fail-closed
   codes as source.

Do not pass chase-loop rAF time as a substitute for post-capture time. Loop
`onSimulationFrame` may stay as it is (`frameIndex`, `simulationEpoch`).

## `dropPolicy: "none"` (producer)

`maxRateHz` sampling is unchanged in both policies.

| Event | `"latest-frame"` (default) | `"none"` |
| --- | --- | --- |
| `frameIndex` unchanged (paused) | No emit, not a drop | Same |
| `frameIndex` changed but inside `maxRateHz` interval | `droppedFrameCount += 1`, no emit | Same |
| Send in flight, another sampled frame ready | Replace single pending frame, `droppedFrameCount += 1` | Append to FIFO; `droppedFrameCount` unchanged |
| FIFO length would exceed 8 | n/a | End stream: `event: "ended"`, `code: "backpressure_overflow"`, no image |

Do not grow `server/routes.ts` for this. Registry already forwards whole
`play_camera_stream_frame` JSON; it must not strip the new fields. Add a
registry test that a frame with timestamps reaches only the mapped agent with
those fields intact.

New reason code: `backpressure_overflow` and `drop_policy_invalid` and
`source_timestamp_invalid`. Add them to `CameraStreamReasonCode`.

## Non-goals

- Auto-driving strict/1× scheduler, deadline metrics, or workbench UI.
- Changing `maxRateHz` bounds or default 15 Hz.
- PNG/SVG/binary frames, evaluator on the stream, one-shot capture changes.
- Unbounded queues, persistent disk buffering.
- Using `publishedAtUs` as the replay clock.
- Live FPS evidence, Milestone 004, or retargeting #160.

## Implementation sequence

1. Types in `shared/play-camera-stream.ts` (`sourceTimestampUs`,
   `publishedAtUs`, `dropPolicy`, new reason codes, capability fields).
2. `buildChaseCameraStreamFrame` + `stampCameraStreamFramePublished` +
   `resolveChaseCameraStreamRequest` (`dropPolicy`) in
   `examples/play/chase/evaluation/camera-stream.ts`.
3. Tests in `examples/play/chase/chase-camera-stream-regression.test.mjs`
   (cases below) until green.
4. Runtime queue/clocks in `examples/play/chase/ui/camera-stream-runtime.mjs`.
   Keep `capture()` JPEG path; stamp source after capture, publish at send.
5. Advertise capability via `buildChaseCameraStreamCapability` /
   `chase-play-usage.mjs`.
6. `USAGE.md` bullets next to the existing subscribe/unsubscribe lines.
7. Registry pass-through test in
   `server/routes/camera-stream-subscriptions.test.ts` only if the forward
   path currently clones a field subset (today it should forward the message
   object; prove timestamps survive).
8. `npm run play:chase:regress` and `npm exec -- tsc --noEmit --pretty false`.

Do not restructure Play host, `home.tsx`, or `server/routes.ts` unless a
timestamp field is being stripped (then add the two keys only).

## Tests (grep-able)

1. Capability includes `timingFields`, both clocks, `dropPolicies`,
   `defaults.dropPolicy: "latest-frame"`, `queueBound: 8`.
2. Subscribe success frame has integer `sourceTimestampUs` and, after stamp,
   `publishedAtUs >= sourceTimestampUs`; no `evaluator`.
3. Two sampled frames: `sourceTimestampUs` is monotonic non-decreasing.
4. Builder rejects missing / `1.5` / `-1` / `"now"` source timestamp
   (`source_timestamp_invalid`, no frame).
5. `dropPolicy` omitted resolves to `"latest-frame"`.
6. `dropPolicy: "lossy"` or `123` → `drop_policy_invalid`, no subscribe.
7. Latest-frame: in-flight send + new sampled frame replaces pending and
   increments `droppedFrameCount` (existing behavior preserved).
8. `dropPolicy: "none"`: in-flight send + new sampled frame queues; both
   frames emit in order; `droppedFrameCount` does not increase for the queue.
9. `dropPolicy: "none"`: 9th queued sampled frame ends with
   `backpressure_overflow` and no image.
10. `maxRateHz` skip still increments `droppedFrameCount` under `"none"`.
11. `publishedAtUs` on a queued frame is taken at send, not enqueue (inject
    `now`).
12. Atomic `play_game_query` / `atomic-evaluation-capture` still returns
    evaluator (existing regression).

## File impact (implementation PR only)

| Path | Change |
| --- | --- |
| `shared/play-camera-stream.ts` | Frame timing fields, dropPolicy, reason codes, capability |
| `examples/play/chase/evaluation/camera-stream.ts` | Require/stamp timestamps; parse dropPolicy |
| `examples/play/chase/ui/camera-stream-runtime.mjs` | Capture clock, publish clock, FIFO when `"none"` |
| `examples/play/chase/chase-camera-stream-regression.test.mjs` | Cases 1–12 |
| `examples/play/chase/ui/chase-play-usage.mjs` | Pass-through of new capability fields |
| `USAGE.md` | Document clocks and `dropPolicy` |
| `server/routes/camera-stream-subscriptions.test.ts` | Timestamp pass-through if needed |
| `shared/schema.ts` | Only if subscribe command type must list `dropPolicy` |

Do not modify `atomic-capture.ts` or `passive-observation.ts` reason codes
except importing fingerprints as today.

## Validation

```sh
npm run play:chase:regress
npm exec -- tsc --noEmit --pretty false
```

No live Chase recapture. Parent #160 tests must stay green.

## Handoff

After this proposal PR is reviewed on `codex/camera-stream-contract`, a lower
coding model implements **only** this document on a sibling branch also
targeting `codex/camera-stream-contract` (or stacked on the proposal merge
commit). It must not retarget `main` and must not merge #160.
