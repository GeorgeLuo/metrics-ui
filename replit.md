# Metrics Playback Visualization Tool

## Overview

A data visualization application for uploading and playing back captured metrics data streams. Users upload JSONL files containing time-series metrics data, select components to visualize from a hierarchical tree, and control playback with transport controls while viewing dynamic charts with real-time metric values.

The application follows a utility-focused design approach inspired by Linear, Grafana, and Vercel Dashboard, prioritizing data readability and functional clarity over decorative elements.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite with custom development plugins for Replit integration
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, React hooks for local state
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Charts**: Recharts for metrics visualization

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **File Handling**: Multer for multipart file uploads (100MB limit, memory storage)
- **Data Format**: JSONL (JSON Lines) parsing for streaming metrics data

### Project Structure
```
client/           # React frontend application
  src/
    components/   # UI components including shadcn/ui
    pages/        # Route page components
    hooks/        # Custom React hooks
    lib/          # Utilities and query client
server/           # Express backend
shared/           # Shared TypeScript types and schemas
```

### Key Design Patterns
- **Monorepo Structure**: Unified client/server codebase with shared types
- **Path Aliases**: `@/` for client src, `@shared/` for shared modules
- **Schema Validation**: Zod schemas for type-safe data validation
- **Component Composition**: Radix UI primitives wrapped with Tailwind styling

### Data Flow
1. User uploads multiple JSONL files via drag-and-drop or file picker (capture library)
2. Server parses JSONL frame records containing tick and entities maps
3. Frontend builds component tree from parsed data structure for each capture
4. User toggles captures active/inactive and selects metrics from per-capture trees
5. Playback controls navigate through synchronized tick-based timeline
6. Charts overlay data from multiple captures with distinct styling (solid/dashed lines)
7. HUD displays real-time metric values at current tick with capture prefixes

### Multi-File Comparison
- **CaptureSession**: Each uploaded file becomes a capture with id, filename, tickCount, records, components, isActive
- **Capture Library**: Sidebar shows loaded captures with checkboxes to toggle active/inactive and delete buttons
- **Synchronized Playback**: Timeline uses maximum tick count from active captures
- **Distinct Styling**: Alternating solid/dashed lines for visual distinction between captures
- **Data Keys**: Format `{captureId}_{sanitizedPath}` to avoid collisions between captures

## External Dependencies

### Database
- **PostgreSQL**: Configured via Drizzle ORM (schema in `shared/schema.ts`)
- **Drizzle Kit**: Database migrations and schema management
- **Connection**: `DATABASE_URL` environment variable required

### Key NPM Packages
- **UI**: Full shadcn/ui component set (Radix primitives, class-variance-authority)
- **Data**: TanStack React Query, Zod validation, drizzle-orm
- **Visualization**: Recharts, date-fns
- **Server**: Express, Multer, connect-pg-simple for sessions

### Fonts
- DM Sans (primary), Fira Code/Geist Mono (monospace) via Google Fonts CDN

### WebSocket Control API
The visualization can be controlled remotely by external agents via WebSocket at `/ws/control`.

**Connection Flow:**
1. Connect to `ws://<host>/ws/control`
2. Send registration: `{type: "register", role: "frontend" | "agent"}`
3. Receive acknowledgment: `{type: "ack", payload: "registered as ..."}`

**Agent Commands (sent to frontend):**
- `{type: "get_state"}` - Request current visualization state
- `{type: "play"}` / `{type: "pause"}` / `{type: "stop"}` - Playback control
- `{type: "seek", tick: number}` - Jump to specific tick
- `{type: "set_speed", speed: number}` - Set playback speed
- `{type: "toggle_capture", captureId: string}` - Toggle capture active/inactive
- `{type: "select_metric", captureId: string, path: string[]}` - Select a metric
- `{type: "deselect_metric", captureId: string, fullPath: string}` - Deselect a metric
- `{type: "clear_selection"}` - Clear all selected metrics

**State Updates (broadcast from frontend to agents):**
- `{type: "state_update", payload: VisualizationState}` - Full state snapshot

**Testing:**
Run `npx tsx scripts/test-websocket-control.ts` to validate the WebSocket control flow.

## Documentation

Usage documentation is available in multiple formats:
- **USAGE.md**: Source markdown file at project root
- **Static file**: `GET /USAGE.md` returns the raw markdown content
- **API endpoint**: `GET /api/docs` returns `{content: "..."}`
- **Web UI**: Navigate to `/docs` to view rendered documentation

The web UI fetches from the API endpoint, ensuring documentation stays in sync with the source file.
