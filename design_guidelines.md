# Design Guidelines: Metrics Playback Visualization Tool

## Design Approach
**Selected Approach**: Minimal Utility Interface  
**References**: Terminal applications, Bloomberg Terminal, scientific instruments  
**Rationale**: Maximum data density with zero visual noise. The data is the interface.

## Core Design Principles
1. **Pure Function**: Every pixel serves data comprehension
2. **Invisible UI**: Controls recede, metrics dominate
3. **Monochrome**: Black, white, and grayscale only
4. **Sharp Typography**: Tight tracking, no softness

---

## Color System

**Palette**: Pure grayscale only
- Background: Pure white (light) / Near-black (dark)
- Foreground: Near-black (light) / Off-white (dark)
- Accents: Various gray tones for hierarchy
- No colored borders, no shadows, no gradients

**Chart Colors**: Grayscale spectrum for line differentiation

---

## Typography System

**Font Stack**: `Inter` for UI, `JetBrains Mono` for data

**Characteristics**:
- Tight letter-spacing (tracking-tight, tracking-tighter)
- Medium/regular weights preferred
- Small sizes for density
- Monospace for all numerical data

**Hierarchy**:
- Labels: text-xs, text-muted-foreground
- Body: text-sm
- Headers: text-sm font-medium
- Data Values: font-mono

---

## Layout System

**Spacing**: Minimal, consistent
- Use gap-2, gap-3 primarily
- Padding: p-3, p-4 maximum
- No decorative spacing

**Containers**:
- No visible borders on cards
- No rounded corners on major containers
- No shadows
- Use whitespace and subtle background shifts for separation

---

## Component Patterns

### File Upload
- Minimal dashed border in empty state
- Single line display when file loaded
- No decorative icons or status cards

### Component Tree
- Simple indentation hierarchy
- Checkboxes for selection
- No decorative tree lines

### Playback Controls
- Icon buttons only, no labels
- Minimal slider
- Monospace tick counter

### Chart Area
- Clean gridlines
- No border wrapper
- Legend integrated with minimal styling

### HUD Overlay
- Transparent background with blur
- Compact metric readouts
- No decorative borders

---

## Interaction Patterns

**Hover States**: Subtle background shift only
**Active States**: Slightly more pronounced shift
**Focus**: Minimal ring outline
**Transitions**: None or 100ms max

---

## Anti-Patterns (Avoid)

- Colored UI elements (except destructive actions)
- Rounded corners larger than 4px
- Drop shadows
- Gradients
- Decorative icons
- Excessive padding
- Card borders
- Badge styling
- Colored status indicators
