# Metrics Playback Visualization Tool - Usage Guide

This tool visualizes time-series metrics data from JSONL capture files, with support for remote control via WebSocket.

## Quick Start

### 1. Deploy the Application

**On Replit:**
1. Click the "Run" button to start the development server
2. The application will be available at your Replit URL (e.g., `https://your-project.replit.app`)

**Production Deployment:**
1. Click "Deploy" in Replit to publish to a live URL
2. The application will be accessible at your `.replit.app` domain

### 2. Open the Browser

Navigate to the application URL in a web browser. The visualization interface will load automatically.

### 3. Connect Your Agent

Your simulation agent should connect to the WebSocket control endpoint to automate the visualization.

---

## WebSocket Control API

### Connection

Connect to the WebSocket endpoint at:
```
ws://<host>/ws/control
```

For production (HTTPS):
```
wss://<host>/ws/control
```

### Handshake Protocol

After connecting, send a registration message:
```json
{"type": "register", "role": "agent"}
```

Wait for acknowledgment:
```json
{"type": "ack", "payload": "registered as agent"}
```

---

## Agent Commands

### Upload a Capture File

Use HTTP POST to upload a JSONL capture file:
```bash
curl -X POST -F "file=@capture.jsonl" https://<host>/api/upload
```

Response includes the parsed records and component tree used by the UI.

### Playback Control

| Command | Description |
|---------|-------------|
| `{"type": "play"}` | Start playback |
| `{"type": "pause"}` | Pause playback |
| `{"type": "stop"}` | Stop and reset to tick 1 |
| `{"type": "seek", "tick": 50}` | Jump to specific tick |
| `{"type": "set_speed", "speed": 2}` | Set playback speed (0.25 - 4) |

### Capture Source Control

Capture files are JSONL. The UI can either upload a completed file once or poll a **running capture
file** on an interval and append any new frames. Live mode auto-connects when the source value
changes and retries every 3 seconds until connected. This **does not** start/stop the simulation;
it only reads whatever the capture file has written so far.

| Command | Description |
|---------|-------------|
| `{"type": "live_start", "source": "/path/to/capture.jsonl", "pollIntervalMs": 2000}` | Start polling a capture file |
| `{"type": "live_stop"}` | Stop the active live stream |
| `{"type": "set_source_mode", "mode": "file"}` | Switch UI to File mode |
| `{"type": "set_source_mode", "mode": "live"}` | Switch UI to Live mode |
| `{"type": "set_live_source", "source": "/path/to/capture.jsonl"}` | Set the live source value (auto-connects in Live mode) |

The UI sidebar includes a **Capture Source** selector: **File** (drag-and-drop upload) or **Live**
(path/URL input with auto-connect).

### Metric Selection

| Command | Description |
|---------|-------------|
| `{"type": "select_metric", "captureId": "abc123", "path": ["entity", "component", "metric"]}` | Select a metric to display on chart |
| `{"type": "deselect_metric", "captureId": "abc123", "fullPath": "entity.component.metric"}` | Remove a metric from chart |
| `{"type": "clear_selection"}` | Clear all selected metrics |

### Capture Control

| Command | Description |
|---------|-------------|
| `{"type": "toggle_capture", "captureId": "abc123"}` | Toggle capture active/inactive |
| `{"type": "get_state"}` | Request current visualization state |

---

## WebSocket Capture Streaming

You can push capture records over the control socket (mirrors **File** mode). Live polling is
controlled via `live_start` / `live_stop` (mirrors **Live** mode).

```json
{"type": "capture_init", "captureId": "live-1", "filename": "evaluation-stream"}
{"type": "capture_append", "captureId": "live-1", "frame": {"tick": 1, "entityId": "player", "componentId": "position", "value": {"x": 0, "y": 0}}}
{"type": "capture_end", "captureId": "live-1"}
```

Live streams and loaded captures can be displayed together. They share a common tick axis.

---

## Capture Source API (HTTP)

These endpoints are used by the UI (and can be called directly):

```
POST /api/source/check
POST /api/live/start
POST /api/live/stop
GET  /api/live/status
```

Example live start payload:

```json
{
  "source": "/path/to/capture.jsonl",
  "pollIntervalMs": 2000,
  "captureId": "live-1",
  "filename": "live-evaluation.jsonl"
}
```

---

## State Updates

When the visualization state changes, your agent receives state updates:

```json
{
  "type": "state_update",
  "payload": {
    "captures": [
      {
        "id": "abc123",
        "filename": "capture.jsonl",
        "isActive": true,
        "tickCount": 1000
      }
    ],
    "selectedMetrics": [
      {
        "captureId": "abc123",
        "path": ["entity", "component", "metric"],
        "fullPath": "entity.component.metric"
      }
    ],
    "playback": {
      "isPlaying": false,
      "currentTick": 1,
      "speed": 1,
      "totalTicks": 1000
    }
  }
}
```

---

## JSONL Data Format

Each line in your capture file should be a JSON object. The CLI stream uses this record format:

```json
{"tick": 1, "entityId": "player", "componentId": "position", "value": {"x": 0, "y": 0}}
{"tick": 2, "entityId": "player", "componentId": "position", "value": {"x": 1, "y": 0}}
```

**Required fields:**
- `tick`: Integer tick number (1-based)
- `entityId`: Entity identifier string
- `componentId`: Component identifier string
- `value`: Component payload

The UI will also accept the older frame format (`{ tick, entities }`) and normalize it into the
record shape internally.

---

## Complete Agent Workflow Example

```javascript
const WebSocket = require('ws');

async function main() {
  let didSelect = false;
  // 1. Connect to WebSocket
  const ws = new WebSocket('wss://your-app.replit.app/ws/control');
  
  ws.on('open', () => {
    // 2. Register as agent
    ws.send(JSON.stringify({ type: 'register', role: 'agent' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'ack') {
      // 3. Request current captures so we can select one
      ws.send(JSON.stringify({ type: 'get_state' }));
    }
    
    if (msg.type === 'state_update') {
      if (didSelect) {
        return;
      }
      const firstCapture = msg.payload.captures?.[0];
      if (!firstCapture) {
        return;
      }
      didSelect = true;

      // 4. Select metrics to display
      ws.send(JSON.stringify({
        type: 'select_metric',
        captureId: firstCapture.id,
        path: ['player', 'position', 'x']
      }));
      
      // 5. Start playback
      ws.send(JSON.stringify({ type: 'play' }));
    }
  });
}

main();
```

---

## Testing the WebSocket API

Run the included test script to validate your setup:

```bash
npx tsx scripts/test-websocket-control.ts
```

Expected output:
```
[PASS] Agent Registration
[PASS] Frontend Registration
[PASS] Agent to Frontend Command
[PASS] State Update Broadcast
[PASS] Multiple Agents Broadcast
```
