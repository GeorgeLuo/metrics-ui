# FrameGrid

Reusable proportional frame-and-grid layout module.

## Files
- `frame-grid.types.ts`: public and internal types
- `compute-frame-grid-layout.ts`: pure layout math (`computeFrameGridLayout`, `resolveItemRect`)
- `frame-grid.tsx`: React component API (`FrameGrid`, `FrameGrid.Item`)

## Primary API

```tsx
<FrameGrid spec={spec}>
  <FrameGrid.Item col={0} row={0} colSpan={2} rowSpan={1}>
    <YourContent />
  </FrameGrid.Item>
</FrameGrid>
```

The component validates item bounds and rejects overlapping spans.
