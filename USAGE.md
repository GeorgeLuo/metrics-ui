# Metrics UI - What It Is and How It Works

This site visualizes simulation or evaluation **capture files**. You upload a JSONL capture (or point at a capture file that is still being written), select numeric metrics, and play them back over time with charts and controls. It does **not** run simulations; it only displays captured data.

---

## Browser Usage (Human Workflow)

1. **Open the site** in a browser.
2. Choose a capture source:
   - **File**: drag-and-drop a completed JSONL capture.
   - **Live**: add one or more live streams, each with a local path or URL to a JSONL file that is still being written.
3. **Select metrics** from the component tree (only numeric leaf values are chartable).
4. **Use playback controls** to play, pause, seek, or change speed.
5. **Window the timeline** by dragging across the chart to select a range. The selection preview appears in the tooltip.
   - Dragging a window **pauses playback** and **turns off auto-scroll** so the view stays locked.
   - Press **Play** to resume; auto-scroll turns back on and the window expands to the right.
   - Use the **reset window** button (refresh icon in the header) to show the full range again.

The UI shows multiple captures at once; they share a common tick axis.

---

## Capture File Format (JSONL)

Each line is a JSON object. Two formats are accepted.

### Record Format (preferred)

```json
{"tick":1,"entityId":"player","componentId":"position","value":{"x":0,"y":0}}
{"tick":2,"entityId":"player","componentId":"position","value":{"x":1,"y":0}}
```

Required fields:
- `tick` (number, 1-based)
- `entityId` (string)
- `componentId` (string)
- `value` (any JSON value)

### Frame Format (accepted)

```json
{"tick":1,"entities":{"player":{"position":{"x":0,"y":0}}}}
```

The UI normalizes frame format into record format internally.

---

## Uploading (File Mode)

Upload a completed capture file:

```bash
curl -X POST -F "file=@capture.jsonl" http://<host>/api/upload
```

---

## Live Streams (Live Mode)

Live means the UI polls a capture file that is still being written. It does not control the simulation.

UI behavior:
- When the live source value changes, the UI attempts to connect.
- If the file is unavailable, the UI retries every 3 seconds while the source is unchanged.
- Multiple live streams can run at the same time; each stream has its own source, polling interval, and captureId.

API notes:
- `GET /api/live/status` returns a `streams` array when any live streams are running.
- `POST /api/live/stop` accepts an optional `captureId` to stop a single stream.

---

## Server Shutdown

Gracefully stop the UI server (closes live streams and WebSocket sessions):

```
POST /api/shutdown
```

Response:
```json
{"success": true, "shuttingDown": true}
```

---

## Everything Above via WebSocket (Agent-Driven Control)

Anything the browser can do can be driven over WebSocket. The server relays agent commands to the active UI session.

### Windowing + Auto-Scroll Semantics

- `set_window_start`, `set_window_end`, `set_window_size`, and `set_window_range` **pause playback** and **disable auto-scroll**.
- `set_auto_scroll true` anchors the **left edge** of the window and expands the right edge as ticks advance.
- `play` re-enables auto-scroll if it was off (using the current `windowEnd` as the starting point).

### Agent Discovery

If an agent only knows the site URL, it can `curl` the root and find control details in headers:

- `X-Metrics-UI-Agent-WS: /ws/control`
- `X-Metrics-UI-Agent-Docs: /USAGE.md`
- `X-Metrics-UI-Agent-Register: {"type":"register","role":"agent"}`

The HTML also includes an `AGENT` comment with the same pointers.

### Endpoint

```
ws://<host>/ws/control
```

Use `wss://` if the site is served over HTTPS.

### Registration

```json
{"type":"register","role":"agent"}
```

### Capabilities and State

```json
{"type":"hello","request_id":"1"}
{"type":"get_state","request_id":"2"}
```

### Core Commands

Playback:
- `{"type":"play"}`
- `{"type":"pause"}`
- `{"type":"stop"}`
- `{"type":"seek","tick":50}`
- `{"type":"set_speed","speed":2}`

Metric selection:
- `{"type":"select_metric","captureId":"abc","path":["entity","component","metric"]}`
- `{"type":"deselect_metric","captureId":"abc","fullPath":"entity.component.metric"}`
- `{"type":"clear_selection"}`
- `{"type":"get_metric_coverage","captureId":"abc"}` (numeric coverage for selected metrics)

Selecting a metric emits a `metric_coverage` payload for that metric. If the metric has no numeric values, the UI also emits `ui_error` (and `error`) so agents can detect invalid selections immediately.

Capture control:
- `{"type":"toggle_capture","captureId":"abc"}`
- `{"type":"query_components","captureId":"abc","search":"pressure","limit":200}`

Capture source (UI mode):
- `{"type":"set_source_mode","mode":"file"}`
- `{"type":"set_source_mode","mode":"live"}`
- `{"type":"set_live_source","source":"/path/to/capture.jsonl","captureId":"live-a"}`

Live polling:
- `{"type":"live_start","source":"/path/to/capture.jsonl","pollIntervalMs":2000,"captureId":"live-a"}`
- `{"type":"live_start","source":"/path/to/other.jsonl","pollIntervalMs":2000,"captureId":"live-b"}`
- `{"type":"live_stop","captureId":"live-a"}`
- `{"type":"live_stop"}` (stop all)

Capture streaming (push records over WS):
- `{"type":"capture_init","captureId":"live-1","filename":"evaluation-stream"}`
- `{"type":"capture_components","captureId":"live-1","components":[...]}` (optional component tree metadata)
- `{"type":"capture_append","captureId":"live-1","frame":{...}}`
- `{"type":"capture_end","captureId":"live-1"}`

### Supported Commands (auto)
<!-- WS:COMMANDS:START -->
- `hello`
- `get_state`
- `list_captures`
- `toggle_capture`
- `remove_capture`
- `select_metric`
- `deselect_metric`
- `clear_selection`
- `clear_captures`
- `play`
- `pause`
- `stop`
- `seek`
- `set_speed`
- `set_window_size`
- `set_window_start`
- `set_window_end`
- `set_window_range`
- `set_auto_scroll`
- `set_fullscreen`
- `add_annotation`
- `remove_annotation`
- `clear_annotations`
- `jump_annotation`
- `add_subtitle`
- `remove_subtitle`
- `clear_subtitles`
- `set_source_mode`
- `set_live_source`
- `live_start`
- `live_stop`
- `capture_init`
- `capture_components`
- `capture_append`
- `capture_end`
- `get_display_snapshot`
- `get_series_window`
- `query_components`
- `get_render_table`
- `get_memory_stats`
- `get_metric_coverage`
<!-- WS:COMMANDS:END -->

### Responses

Common responses include:
- `ack`
- `error`
- `state_update`
- `capabilities`
- `components_list`
- `display_snapshot`
- `series_window`
- `render_table`
- `memory_stats`
- `metric_coverage`

`display_snapshot` includes `metricCoverage` for selected metrics (numeric count, total frames, last tick).

### Supported Responses (auto)
<!-- WS:RESPONSES:START -->
- `ack`
- `error`
- `state_update`
- `capabilities`
- `display_snapshot`
- `series_window`
- `components_list`
- `render_table`
- `ui_notice`
- `ui_error`
- `memory_stats`
- `metric_coverage`
<!-- WS:RESPONSES:END -->

### Minimal Agent Flow Example

```javascript
const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:5000/ws/control");

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "register", role: "agent" }));
  ws.send(JSON.stringify({ type: "get_state" }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type !== "state_update") return;
  const capture = msg.payload.captures?.[0];
  if (!capture) return;

  ws.send(JSON.stringify({
    type: "select_metric",
    captureId: capture.id,
    path: ["1", "highmix.metrics", "shift_capacity_pressure", "overall"]
  }));
  ws.send(JSON.stringify({ type: "play" }));
});
```
