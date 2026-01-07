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

Use HTTP POST to upload JSONL files:
```bash
curl -X POST -F "file=@capture.jsonl" https://<host>/api/upload
```

Response:
```json
{
  "id": "abc123",
  "filename": "capture.jsonl",
  "tickCount": 1000,
  "components": [...]
}
```

### Playback Control

| Command | Description |
|---------|-------------|
| `{"type": "play"}` | Start playback |
| `{"type": "pause"}` | Pause playback |
| `{"type": "stop"}` | Stop and reset to tick 1 |
| `{"type": "seek", "tick": 50}` | Jump to specific tick |
| `{"type": "set_speed", "speed": 2}` | Set playback speed (0.25 - 4) |

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

Each line in your capture file should be a JSON object:

```json
{"tick": 1, "entityId": "player", "componentId": "position", "value": {"x": 0, "y": 0}}
{"tick": 1, "entityId": "player", "componentId": "velocity", "value": {"dx": 1, "dy": 0}}
{"tick": 2, "entityId": "player", "componentId": "position", "value": {"x": 1, "y": 0}}
```

**Required fields:**
- `tick`: Integer tick number (1-based)
- `entityId`: String identifier for the entity
- `componentId`: String identifier for the component
- `value`: Object with metric values (numeric values will be charted)

---

## Complete Agent Workflow Example

```javascript
const WebSocket = require('ws');

async function main() {
  // 1. Upload capture file via HTTP
  const formData = new FormData();
  formData.append('file', fs.createReadStream('simulation.jsonl'));
  const uploadRes = await fetch('https://your-app.replit.app/api/upload', {
    method: 'POST',
    body: formData
  });
  const capture = await uploadRes.json();
  console.log('Uploaded:', capture.id);

  // 2. Connect to WebSocket
  const ws = new WebSocket('wss://your-app.replit.app/ws/control');
  
  ws.on('open', () => {
    // 3. Register as agent
    ws.send(JSON.stringify({ type: 'register', role: 'agent' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'ack') {
      // 4. Select metrics to display
      ws.send(JSON.stringify({
        type: 'select_metric',
        captureId: capture.id,
        path: ['player', 'position', 'x']
      }));
      
      // 5. Start playback
      ws.send(JSON.stringify({ type: 'play' }));
    }
    
    if (msg.type === 'state_update') {
      console.log('State:', msg.payload.playback.currentTick);
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
