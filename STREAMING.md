# Streaming Logic (Server + UI)

This document summarizes how streaming works in the Metrics UI (server + client).

## Architecture Overview

- **Server (Node/Express + WS)**:
  - Owns capture sources, live stream polling, caching, and component tree extraction.
  - Sends capture events to the frontend over WebSocket.
  - Provides REST endpoints for uploads and series extraction.
- **Client (React UI)**:
  - Maintains capture sessions, selected metrics, playback state, and windowing.
  - Receives capture events (init, append, tick, components, end).
  - Fetches metric series on demand via `/api/series/batch`.

There are two transport lanes:

- **WebSocket control**: capture events + UI control commands.
- **HTTP**: file upload + series extraction + source probing.

## Server: Capture Sources + Live Streaming

### Data Structures

- `liveStreamStates` (per captureId): poll state, byte offset, line offset, last tick, errors, timers.
- `captureSources`: captureId → source path/URL.
- `captureMetadata`: captureId → filename + source.
- `captureStreamModes`: captureId → `"lite"` or `"full"`.
- `captureLastTicks`: captureId → latest tick observed.
- `captureComponentState`: captureId → component tree + last-sent node count.
- **Frame cache** (per captureId):
  - `captureFrameSamples` + `captureFrameTail` store sampled frames and recent tail.
  - Dynamic sampling based on a shared 2GB budget.

### Live Stream Lifecycle

1. `startLiveStream`:
   - Sends `capture_init` to frontend.
   - Registers metadata, sets stream mode to `"lite"`.
   - Clears tick + lite buffers, starts polling.

2. `pollLiveCapture`:
   - Reads from local file or HTTP range source.
   - Parses JSONL lines to frames.
   - Updates component tree + cache.
   - Emits:
     - `capture_append` (full frames) if stream mode is `"full"` **or** no source,
     - otherwise `capture_append` with empty entities (lite tick) and buffers recent frames.
   - Stops after inactivity threshold.

3. `stopLiveStream`:
   - Aborts controller, stops timer, sends `capture_end`.
   - Removes empty capture state if no frames/ticks exist.

### Full vs Lite Stream

- **Lite mode** (default for file-backed live streams):
  - Sends tick-only frames (`{ tick, entities: {} }`) to update UI tick counters.
  - Stores full frames in the cache (sampled + tail).
  - Keeps memory bounded by the cache budget.

- **Full mode**:
  - Streams all frames to frontend via `capture_append`.
  - Used for file uploads and when the UI explicitly requests full mode.

The UI switches stream mode per capture based on selection:
- If a capture has selected metrics **and** does not have a live file source → `"full"`.
- File-backed live sources stay in `"lite"` even when selected to avoid pushing full frames to the UI.

### Series Extraction (HTTP)

Endpoints:

- `POST /api/series`
- `POST /api/series/batch`

Logic:

1. Resolve capture source from `captureSources` or live state.
2. Decide **cache vs full scan**:
   - Cache is used if frames are available and `preferCache` is true.
   - Cache can be **sampled**; sampled cache is treated as partial.
   - While a live stream is active, cache-derived series are **always partial**.
3. If cache is not used, stream the JSONL file and build full series.
4. Response includes:
   - `points`, `lastTick`, `numericCount`
   - `partial: true|false`

The UI uses `partial` to decide whether to refetch later (e.g., after live stream ends).

### Uploads + File Loads

- `POST /api/upload`: receives file, dedupes by hash, registers capture source, starts streaming the capture.
- `POST /api/source/check`: validates file/URL and returns size + modified time.
- `POST /api/source/load`: fully parses a file and returns records + component tree (used by file upload flow).

### WebSocket Command Handling

- `capture_init`, `capture_components`, `capture_append`, `capture_tick`, `capture_end`
  are sent to the frontend as the stream progresses.
- If the frontend is disconnected, capture events are buffered in `pendingCaptureBuffers`.
- `state_sync` is sent on reconnect to announce known capture IDs + last ticks.

Queued commands are held in `queuedAgentCommands` and flushed once a frontend reconnects.

## Client: Capture Store + Playback

### Capture State

Each capture session stores:

- `tickCount`
- `records` (filtered by selected metrics)
- `components` (tree)
- `isActive`

The client keeps:

- `captures` (stateful list)
- `selectedMetrics`
- `playback` (current tick + speed)
- `windowStart` / `windowEnd` / `windowSize`
- `autoScroll`

### Incoming Stream Handling

- `capture_append` frames are buffered in `pendingAppends`.
- Every ~100ms, `flushPendingAppends` merges frames into capture records.

Important behaviors:

- Records are **filtered to selected metrics only** (to keep memory bounded).
- Frames that contain **no selected metrics** are **not stored** (skip empty records).
- Tick counts are updated even when records are filtered.

### Live “Series Refresh” Loop

The UI periodically refetches series for live captures:

- If the capture is live **and** its tick count advanced,
  then `/api/series/batch` is called.
- Results are merged into records via `mergeSeriesIntoCaptures`.
- If results are marked `partial`, they remain eligible for later refetch.

When a live stream ends, the UI forces a full refetch (`preferCache: false`)
to replace partial samples with complete series.

### Selection Logic

When a metric is selected:

- The UI requests series data from the server.
- If the capture is live and still running, it will get partial series first,
  then full series after completion.

When a metric is removed:

- The metric path is removed from all records for that capture.

### Playback + Windowing

- Window range is derived from `windowStart/windowEnd/windowSize`.
- The chart renders only records in the active window.
- Render/debug endpoints use the same windowing logic as the UI.

## Known Failure Modes

- **Gaps in chart**: occurred when empty (tick-only) records were stored.
  Fix: skip empty records during live append.
- **Partial series after live end**: if cached series were treated as complete.
  Fix: mark cache-derived series as `partial` while live.

## Debug/Inspection Hooks

- `simeval ui render-debug` → capture stats + window coverage.
- `simeval ui render-table` → exact values in window range.
- `simeval ui memory-stats` → heap + record/memory estimates.
- `simeval ui check` → discrepancies: null ticks, missing ticks, duplicates.
- `GET /api/debug/captures` → server-side cache + live state per capture.
