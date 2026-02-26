import { useState, useMemo, memo, useRef, useLayoutEffect } from "react";
import { ChevronRight, ChevronDown, Hash, Type, Braces, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { ComponentNode, SelectedMetric } from "@shared/schema";
import { cn } from "@/lib/utils";

const METRIC_COLORS = [
  "#E4572E",
  "#17B890",
  "#4C78A8",
  "#F2C14E",
  "#2E86AB",
  "#F25F5C",
  "#70C1B3",
  "#9C755F",
  "#3D5A80",
  "#C44536",
  "#8AC926",
  "#FFB703",
];

const TREE_ROW_HEIGHT = 24;
const TREE_OVERSCAN_ROWS = 10;
const INLINE_EDIT_BASE_CLASS =
  "h-auto p-0 text-xs md:text-xs font-mono text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0";
const INLINE_EDIT_TEXT_CLASS = `${INLINE_EDIT_BASE_CLASS} text-left`;
const INLINE_EDIT_EMPTY_CLASS = "rounded-sm bg-muted/40 px-1";

interface ComponentTreeProps {
  captureId: string;
  components: ComponentNode[];
  selectedMetrics: SelectedMetric[];
  metricCoverage?: Record<
    string,
    { numericCount: number; total: number; lastTick: number | null }
  >;
  onSelectionChange: (metrics: SelectedMetric[]) => void;
  colorOffset?: number;
  isVisible?: boolean;
}

type FlatTreeRow = {
  node: ComponentNode;
  level: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

function getValueTypeIcon(type: ComponentNode["valueType"]) {
  switch (type) {
    case "number":
      return <Hash className="w-3 h-3" />;
    case "string":
      return <Type className="w-3 h-3" />;
    case "object":
      return <Braces className="w-3 h-3" />;
    case "array":
      return <List className="w-3 h-3" />;
    default:
      return null;
  }
}

function buildVisibleRows(
  components: ComponentNode[],
  expandedNodes: Set<string>,
  searchQuery: string,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  const query = searchQuery.trim().toLowerCase();

  if (!query) {
    const walk = (node: ComponentNode, level: number) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = hasChildren && expandedNodes.has(node.id);
      rows.push({ node, level, hasChildren, isExpanded });
      if (isExpanded) {
        node.children.forEach((child) => walk(child, level + 1));
      }
    };

    components.forEach((node) => walk(node, 0));
    return rows;
  }

  const matchMap = new Map<string, boolean>();

  const fillMatches = (node: ComponentNode): boolean => {
    const selfMatch =
      node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query);
    let childMatch = false;
    node.children.forEach((child) => {
      if (fillMatches(child)) {
        childMatch = true;
      }
    });
    const matches = selfMatch || childMatch;
    matchMap.set(node.id, matches);
    return matches;
  };

  components.forEach((node) => {
    fillMatches(node);
  });

  const walkFiltered = (node: ComponentNode, level: number) => {
    if (!matchMap.get(node.id)) {
      return;
    }

    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expandedNodes.has(node.id);
    rows.push({ node, level, hasChildren, isExpanded });

    if (isExpanded) {
      node.children.forEach((child) => walkFiltered(child, level + 1));
    }
  };

  components.forEach((node) => walkFiltered(node, 0));
  return rows;
}

interface TreeRowProps {
  row: FlatTreeRow;
  captureId: string;
  selectedMetricByPath: Map<string, SelectedMetric>;
  metricCoverage?: Record<
    string,
    { numericCount: number; total: number; lastTick: number | null }
  >;
  onToggle: (node: ComponentNode, checked: boolean) => void;
  onExpand: (nodeId: string) => void;
}

function TreeRow({
  row,
  captureId,
  selectedMetricByPath,
  metricCoverage,
  onToggle,
  onExpand,
}: TreeRowProps) {
  const { node, level, hasChildren, isExpanded } = row;
  const selectedMetric = selectedMetricByPath.get(node.id);
  const isSelected = Boolean(selectedMetric);
  const coverageEntry = selectedMetric ? metricCoverage?.[node.id] : undefined;
  const hasCoverage = Boolean(coverageEntry && coverageEntry.total > 0);
  const isMissing = hasCoverage && coverageEntry?.numericCount === 0;
  const isSparse =
    hasCoverage
    && coverageEntry?.numericCount !== undefined
    && coverageEntry.numericCount > 0
    && coverageEntry.numericCount < coverageEntry.total;

  return (
    <div
      className={cn(
        "flex h-6 items-center gap-2 px-2 group",
        "hover:bg-muted/40",
        isSelected && "bg-primary/10",
      )}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      data-testid={`tree-node-${captureId}-${node.id}`}
    >
      {hasChildren ? (
        <button
          onClick={() => onExpand(node.id)}
          className="p-0.5 -m-0.5 hover:bg-muted rounded"
          data-testid={`button-expand-${node.id}`}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </button>
      ) : (
        <span className="w-3" />
      )}

      {node.isLeaf && node.valueType === "number" ? (
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggle(node, !!checked)}
          data-testid={`checkbox-${captureId}-${node.id}`}
          aria-label={`Select ${node.label}`}
        />
      ) : null}

      <span
        className={cn(
          "flex-1 text-xs truncate",
          isSelected ? "font-medium" : "text-foreground/90",
        )}
      >
        {node.label}
      </span>

      {isMissing ? (
        <Badge
          variant="destructive"
          className="h-4 px-1.5 text-[10px] leading-4"
          data-testid={`badge-no-data-${captureId}-${node.id}`}
        >
          0/{coverageEntry?.total ?? 0}
        </Badge>
      ) : null}

      {!isMissing && isSparse ? (
        <Badge
          variant="secondary"
          className="h-4 px-1.5 text-[10px] leading-4"
          data-testid={`badge-sparse-${captureId}-${node.id}`}
        >
          {coverageEntry?.numericCount ?? 0}/{coverageEntry?.total ?? 0}
        </Badge>
      ) : null}

      {selectedMetric ? (
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: selectedMetric.color }}
        />
      ) : null}

      <span className="sr-only">{getValueTypeIcon(node.valueType)}</span>
    </div>
  );
}

function ComponentTreeBase({
  captureId,
  components,
  selectedMetrics,
  metricCoverage,
  onSelectionChange,
  colorOffset = 0,
  isVisible = true,
}: ComponentTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(224);

  const selectedMetricByPath = useMemo(() => {
    const map = new Map<string, SelectedMetric>();
    selectedMetrics.forEach((metric) => {
      map.set(metric.fullPath, metric);
    });
    return map;
  }, [selectedMetrics]);

  const visibleRows = useMemo(
    () => buildVisibleRows(components, expandedNodes, searchQuery),
    [components, expandedNodes, searchQuery],
  );

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      setViewportHeight(element.clientHeight || 224);
    };

    updateHeight();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateHeight();
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useLayoutEffect(() => {
    const maxScrollTop = Math.max(0, visibleRows.length * TREE_ROW_HEIGHT - viewportHeight);
    if (scrollTop > maxScrollTop) {
      setScrollTop(maxScrollTop);
    }
  }, [scrollTop, viewportHeight, visibleRows.length]);

  useLayoutEffect(() => {
    if (!isVisible && scrollTop !== 0) {
      setScrollTop(0);
    }
  }, [isVisible, scrollTop]);

  useLayoutEffect(() => {
    if (!isVisible) {
      return;
    }
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const syncScrollTop = () => {
      const domScrollTop = element.scrollTop;
      setScrollTop((prev) => (prev === domScrollTop ? prev : domScrollTop));
    };
    syncScrollTop();
    const raf = window.requestAnimationFrame(syncScrollTop);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [isVisible, visibleRows.length]);

  const handleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleToggle = (node: ComponentNode, checked: boolean) => {
    if (checked) {
      const colorIndex = (selectedMetrics.length + colorOffset) % METRIC_COLORS.length;
      const newMetric: SelectedMetric = {
        captureId,
        path: node.path,
        fullPath: node.id,
        label: node.label,
        color: METRIC_COLORS[colorIndex],
      };
      onSelectionChange([...selectedMetrics, newMetric]);
    } else {
      onSelectionChange(selectedMetrics.filter((m) => !(m.fullPath === node.id && m.captureId === captureId)));
    }
  };

  if (components.length === 0) {
    return null;
  }

  if (!isVisible) {
    return null;
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN_ROWS);
  const endIndex = Math.min(
    visibleRows.length,
    Math.ceil((scrollTop + viewportHeight) / TREE_ROW_HEIGHT) + TREE_OVERSCAN_ROWS,
  );
  const topSpacerHeight = startIndex * TREE_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (visibleRows.length - endIndex) * TREE_ROW_HEIGHT);
  const isSearchBlank = searchQuery.trim().length === 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="px-2 pb-1">
        <Input
          type="search"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={`${INLINE_EDIT_TEXT_CLASS} w-full ${isSearchBlank ? INLINE_EDIT_EMPTY_CLASS : ""}`}
          data-testid={`input-search-${captureId}`}
        />
      </div>
      <div
        ref={viewportRef}
        className="max-h-56 overflow-y-auto overscroll-contain"
        data-tree-scroll="true"
        style={{ contain: "layout" }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
      >
        {visibleRows.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">No matching components</div>
        ) : (
          <>
            {topSpacerHeight > 0 ? <div style={{ height: topSpacerHeight }} /> : null}
            {visibleRows.slice(startIndex, endIndex).map((row) => (
              <TreeRow
                key={row.node.id}
                row={row}
                captureId={captureId}
                selectedMetricByPath={selectedMetricByPath}
                metricCoverage={metricCoverage}
                onToggle={handleToggle}
                onExpand={handleExpand}
              />
            ))}
            {bottomSpacerHeight > 0 ? <div style={{ height: bottomSpacerHeight }} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function areComponentTreePropsEqual(
  prev: Readonly<ComponentTreeProps>,
  next: Readonly<ComponentTreeProps>,
) {
  if (
    prev.captureId !== next.captureId
    || prev.colorOffset !== next.colorOffset
    || prev.onSelectionChange !== next.onSelectionChange
  ) {
    return false;
  }

  const prevVisible = prev.isVisible ?? true;
  const nextVisible = next.isVisible ?? true;

  if (!prevVisible && !nextVisible) {
    return true;
  }

  return (
    prevVisible === nextVisible
    && prev.components === next.components
    && prev.selectedMetrics === next.selectedMetrics
    && prev.metricCoverage === next.metricCoverage
  );
}

export const ComponentTree = memo(ComponentTreeBase, areComponentTreePropsEqual);
