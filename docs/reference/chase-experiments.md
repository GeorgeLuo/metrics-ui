# Chase experiment controls and evidence

These interfaces mutate a loaded simulation only when explicitly commanded. No
policy performance or authenticity claim follows from an internally consistent
export. Evaluator data stays outside camera/controller inputs.

## Begin without incidental movement

Open the explicit experiment URL:

```text
http://localhost:5050/?playScenario=wall-escape&playControl=ws&playPaused=1
```

The explicit experiment entry selects Play before mount, validates the scenario
and source before creating the animation loop, and starts paused. Invalid entry
options fail instead of falling back to Default Chase. Omit these parameters for
ordinary interactive defaults. Stored dashboard restoration cannot override this
explicit entry. The ordinary scenario selector keeps its existing behavior.

For an already loaded game, send `play_game_command` with
`commandId: "prepare-experiment"` and payload
`{scenarioId:"wall-escape", controlSource:"ws", maxFrames:20001}`. This synchronous
transaction pauses, neutralizes WS input, replaces the scene, starts a fresh epoch
and enables baseline-inclusive trace retention. Export wanted old evidence first.
It preserves the current vehicle settings, selected rendering profile, and rendering
seed, including RC indoor and randomized rendering. Verify settings separately.
This is an explicit scene reset, not a read-only preflight or host-memory reset.
An external observe-only session bound to the old epoch must be rebound separately.

## Headless simulator

Chase advances on browser animation frames, which a hidden tab stops. To run the
simulator without a visible window, configured from the start:

```sh
npm run play:chase:headless -- --port 5064 --config examples/play/chase/config/headless/chaser-depth-obstacles-rc-indoor.json
```

The launcher starts its own server on `--port` and opens the Play page in headless
Chrome with a fresh profile, so no stored left-pane state applies. It refuses a
port already in use, because the server accepts one frontend. Chrome comes from
`--chrome`, `CHROME_PATH`, the macOS app, or `google-chrome`/`chromium` on PATH.
When the published `playSidebarSections` match the config and frames advance, it
prints the effective settings and `CHASE_UI_WS_URL=ws://127.0.0.1:<port>/ws/control`,
then runs until interrupted. If Chrome or the server exits, it stops the other and
exits non-zero; a pane that does not match the config within 30 s also exits 1.

The config names the scenario, the chaser control source and left-pane settings:

```json
{
  "scenario": "chaser-depth-obstacles",
  "controlSource": "ws",
  "settings": { "rendering-profile": "rc-indoor", "simulation-fps": 60, "simulation-pause-before-actions": true }
}
```

Settings keys are the action ids listed in `playSidebarSections`. Each value runs
through that id's left-pane handler, in order, after the explicit entry starts
paused; an id without a handler fails before the loop is created. The scenario
comes only from `scenario`, and `scenario-select`, `simulation-reset` and the
`chaser-view`/`evader-view`/`idae-debug` window toggles are rejected. As in the
pane, `"simulation-pause-before-actions": true` turns Playback on; omit it to
start paused.

The launcher carries the config in the page URL as
`playSettings=<URL-encoded JSON>` with `playHeadless=1`. Headless pages skip the
top-down map draw; camera captures and the camera stream render separately and are
unaffected. Change settings on the running page with `play_game_action` as usual.
The launcher runs the server in development mode, so an edit to this checkout
reloads the page, which restarts from frame 0 with the same config.

## Read state and identify the responding game

`play_game_query`, `queryId: "experiment-state"`, returns:

- `identity.frontendInstanceId`: the same per-tab session ID used for WS registration.
- `identity.build`: immutable game-module snapshot digest and scope (`buildManifest` holds the source manifest),
  or null for custom hosts without snapshot metadata.
- `identity.simulationEpoch`, `frameIndex`, `paused`, scenario, evader and source.
- `currentInput`: current non-programmatic latch; `pendingAction`: frozen next
  action; `lastCommittedAction`: most recently applied action, or null at baseline.
- Wall/evader metrics and any exact-frame advancement status.

These three input/action fields are intentionally different. Neutralizing the
latch does not replace an already pending action. Read the pending action before
advancing. Generic dashboard `pause`/`playback.isPlaying` do not pause Chase.

Game command/action/query frontend acknowledgments now carry this identity and
frame, alongside their original request ID and command name. Legacy games without
experiment state retain their original acknowledgment behavior. Capture and trace
queries also carry `experimentIdentity`. Compare expected epoch/instance explicitly;
a server snapshot, tab title or port is not a binding. Ordinary commands remain
backward-compatible; exact advance requires explicit expected identity.

The catalog uses `/api/play/games/chase/snapshots/<digest>/files/...` for game
modules. The server materializes the snapshot before returning the catalog. All
relative game-module imports stay within the retained content-addressed tree;
changed source creates a different digest. The injected entry exports the manifest
used by the actual game host. The digest hashes sorted transformed module sources
before injecting its own manifest (avoiding a circular self-hash). This is a
**game-module capability identity**, not an attestation of the dashboard shell,
external Three library, browser or host. It does not invent a whole-frontend build
fingerprint. Expired snapshots fail with410 instead of serving different bytes;
request a fresh catalog. Up to eight distinct snapshots are retained per catalog
game. Reusing a digest refreshes its retention order; a successful catalog reload
or module redirect prunes games removed from the catalog.

## Exact committed-frame windows

First enable a complete trace with enough retention, pause, and inspect state.
Send `play_game_command`, `commandId:"advance-frames"`, payload:

```json
{"expectedFrontendInstanceId":"frontend-...","expectedSimulationEpoch":"chase-run:...","expectedFrameIndex":0,"frames":30}
```

The acknowledgment accepts the budget; it does not claim completion. The normal
animation loop runs and stops immediately after the Nth committed frame, including
within a multi-step tick. Input remains live during the window; this is not an
implicit neutral/autonomy mode. A pre-existing pending action is the first commit.
Wrong identity/frame, running state, invalid count, incomplete trace or insufficient
retention fail before unpause. Counts are1–20,000. No polling pause overrun is needed.

Poll `experiment-state` for completion, then query `advance-result` for the frozen
completion state and full native trace. Frame0 is baseline, never a committed
action. `cancel-advance` pauses and marks an active window interrupted. External
pause/reset also interrupts it. Query results do not advance the simulation.

## Shared evidence export

`play_game_query`, `queryId:"experiment-evidence"`, payload
`{expectedSimulationEpoch:"chase-run:...", startFrame:1}` returns an asynchronous
`chase_experiment_evidence_v1` result. State, trace and retained records are frozen
before hashing. Baseline0 is separate from committed suffix1…N. It retains original
atomic capture responses/images, preservation/frame identity, SHA-256 of image
bytes, and identity-bound command receipts handed to the WS sender. Retention is
bounded (64 atomic captures /32MiB approximate JSON characters;4,096 receipts);
overflow counters are explicit. Export before reset/prepare clears retention.
Only receipts matching the current frontend and simulation epoch are retained.
An export finishing after preparation keeps its original response/ack identity,
and its old-epoch acknowledgment is excluded from the new run's evidence.
Camera-stream coverage is not synthesized: only requested atomic captures enter
this bundle. It is sampled coverage, not every-frame camera evidence.

Capture start/completion are browser performance.now microsecond brackets, not
physical exposure time. Native trace clocks retain their original domain. Host
retention/delivery timestamps are unavailable to the frontend and remain explicitly
absent; they are never inferred from file mtimes or converted to browser time.
To join already-retained original host records offline:

```sh
node scripts/play-chase-experiment-bundle.mjs browser-export.json host-evidence.json > bundle.json
```

The host file must contain `simulationEpoch`, explicit `clockDomain`, and original
`records` (including original raw captures/receipts/timestamps). The join preserves
records and hashes the original file bytes, labels external provenance unverified,
and rejects an epoch mismatch. It never calls a service. Caller-supplied metadata
is not independent authenticity proof; receipt-to-commit clock mapping remains
unverified. No host/policy implementation changes are required by this format.
