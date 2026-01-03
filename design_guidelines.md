# Design Guidelines: Metrics Playback Visualization Tool

## Design Approach
**Selected Approach**: Design System with Dashboard Tool Inspiration  
**References**: Linear (data density + clarity), Grafana (metrics visualization), Vercel Dashboard (modern dev tools)  
**Rationale**: Utility-focused application requiring excellent data readability, consistent patterns, and minimal visual interference with chart content.

## Core Design Principles
1. **Data First**: Visual hierarchy prioritizes chart content and metrics over decorative elements
2. **High Density**: Maximize information display without overwhelming users
3. **Scan-ability**: Clear labeling and consistent spacing for quick metric identification
4. **Functional Clarity**: Every UI element serves a specific purpose in the playback workflow

---

## Typography System

**Font Stack**: `Inter` or `DM Sans` via Google Fonts CDN

**Hierarchy**:
- **Page Title**: text-2xl, font-semibold (e.g., "Metrics Playback")
- **Section Headers**: text-lg, font-medium (e.g., "Component Selection", "Playback Controls")
- **Body/Labels**: text-sm, font-normal (component names, tick labels)
- **Metric Values**: text-base, font-mono (numerical readouts for precision)
- **Help Text**: text-xs, font-normal (hints, tooltips)

---

## Layout System

**Spacing Primitives**: Tailwind units of **2, 4, 8, 12** (e.g., p-4, gap-8, space-y-12)

**Grid Structure**:
- **Main Container**: Full viewport height (h-screen) with flex column
- **Top Bar** (fixed): File upload status, controls - h-16, px-8
- **Content Area** (flex-1): Two-column split
  - **Left Sidebar** (w-80): Component selection tree, scrollable
  - **Right Main** (flex-1): Chart area + playback controls
- **Bottom Controls** (fixed): Playback scrubber and transport - h-20, px-8

**Responsive**: Collapse sidebar to drawer on tablet/mobile (hidden by default, toggle button)

---

## Component Library

### File Upload Zone
- **Initial State**: Dashed border container (h-48), centered text with upload icon
- **Drag Active**: Solid border, slight scale transform
- **Uploaded State**: Compact file info bar showing filename, size, tick count

### Component Selection Panel
- **Tree View**: Hierarchical list with indent levels (pl-4 per level)
- **Checkboxes**: Multi-select with indeterminate states for parent nodes
- **Search Input**: Sticky at top of panel (p-2, rounded input with search icon)
- **Selected Count Badge**: Small pill showing "X components selected"

### Playback Controls
- **Transport Buttons**: Play/Pause (toggle), Stop, Step Forward/Back - icon buttons in horizontal row, gap-2
- **Speed Selector**: Dropdown or button group (0.5x, 1x, 2x, 5x)
- **Scrubber**: Full-width slider with tick markers, current position indicator
- **Time Display**: Monospace text showing "Tick: 142 / 2872 | 2017-02-01 14:00:00"

### Chart Area
- **Container**: Border wrapper with rounded corners, fills remaining vertical space
- **Axes**: Clean lines, minimal gridlines (subtle, not distracting)
- **Legend**: Positioned top-right of chart, small badges with metric names
- **Tooltip**: On hover, shows exact tick + values for all visible series
- **Empty State**: Centered message "Select components to begin plotting"

### Metric HUD Overlay
- **Position**: Top-right corner of chart area (absolute positioning)
- **Content**: Card showing current values for each selected metric
- **Format**: Metric name + current value in monospace font
- **Styling**: Semi-transparent backdrop, compact padding (p-3)

---

## Interaction Patterns

### Upload Flow
1. Drag file or click to browse → File validation
2. Parse completion → Success message + component tree population
3. Auto-expand tree to show all available metrics

### Selection & Playback
1. Check components in tree → Chart initializes with selected series
2. Click Play → Data streams in, chart updates at selected speed
3. Scrub slider → Jump to specific tick instantly
4. Pause/Stop → Freeze current state for inspection

### Dynamic Zoom Behavior
- **Phase 1** (0-50 ticks): X-axis fixed at 0-50, data tracks from left
- **Phase 2** (50+ ticks): Auto-zoom out to fit all data, maintain aspect ratio
- **User Control**: Allow manual zoom/pan via chart library controls (zoom in icon, reset icon)

---

## Accessibility
- All interactive elements keyboard navigable (Tab order: Upload → Tree → Controls → Chart)
- ARIA labels on icon-only buttons ("Play simulation", "Pause playback")
- Focus indicators on all inputs and buttons (ring-2 ring-offset-2)
- High contrast ratios between text and backgrounds (WCAG AA minimum)

---

## Animation Guidelines
**Minimal Use**:
- Smooth chart line drawing as data populates (no bounce/elastic effects)
- Subtle fade-in for tooltips (150ms)
- Transport button state transitions (100ms)
- **No**: Page transitions, loading spinners beyond necessity, decorative motion

---

## Images
**No hero images required** - This is a utility dashboard focused purely on functional UI and data visualization. All visual interest comes from the charts themselves.