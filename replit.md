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
1. User uploads JSONL file via drag-and-drop or file picker
2. Server parses JSONL records containing tick, entityId, componentId, and value
3. Frontend builds component tree from parsed data structure
4. User selects metrics from tree for visualization
5. Playback controls navigate through tick-based timeline
6. Charts and HUD display real-time metric values at current tick

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