# @georgeluo/metrics-ui

Metrics UI server and dashboard for SimEval captures, live file streams, derivations, and visualization plugins.

## Install

```bash
npm install -g @georgeluo/metrics-ui
```

## Run

```bash
metrics-ui serve --host 127.0.0.1 --port 5050
```

Optional storage paths:

```bash
metrics-ui serve \
  --data-root /path/to/metrics-ui \
  --upload-root /path/to/metrics-ui/uploads \
  --capture-sources-file /path/to/metrics-ui/capture-sources.json \
  --dashboard-state-file /path/to/metrics-ui/dashboard-state.json
```

Then open:

- `http://127.0.0.1:5050`
- WebSocket control: `ws://127.0.0.1:5050/ws/control`

## Docs

See [USAGE.md](./USAGE.md) for HTTP/WS protocol details and example automation flows.
