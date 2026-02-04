import { useState, useMemo, memo } from "react";
import { ChevronRight, ChevronDown, Search, Hash, Type, Braces, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
}

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

interface TreeNodeProps {
  node: ComponentNode;
  level: number;
  captureId: string;
  selectedMetrics: SelectedMetric[];
  metricCoverage?: Record<
    string,
    { numericCount: number; total: number; lastTick: number | null }
  >;
  onToggle: (node: ComponentNode, checked: boolean) => void;
  expandedNodes: Set<string>;
  onExpand: (nodeId: string) => void;
  searchQuery: string;
}

function TreeNode({
  node,
  level,
  captureId,
  selectedMetrics,
  metricCoverage,
  onToggle,
  expandedNodes,
  onExpand,
  searchQuery,
}: TreeNodeProps) {
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedMetrics.some((m) => m.fullPath === node.id && m.captureId === captureId);
  const selectedMetric = selectedMetrics.find((m) => m.fullPath === node.id && m.captureId === captureId);
  const hasChildren = node.children.length > 0;
  const coverageEntry = metricCoverage?.[node.id];
  const hasCoverage = Boolean(selectedMetric && coverageEntry && coverageEntry.total > 0);
  const isMissing = hasCoverage && coverageEntry?.numericCount === 0;
  const isSparse =
    hasCoverage &&
    coverageEntry?.numericCount !== undefined &&
    coverageEntry.numericCount > 0 &&
    coverageEntry.numericCount < coverageEntry.total;

  const matchesSearch =
    searchQuery === "" ||
    node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.id.toLowerCase().includes(searchQuery.toLowerCase());

  const hasMatchingDescendant = useMemo(() => {
    if (searchQuery === "") return true;
    const checkDescendants = (n: ComponentNode): boolean => {
      if (n.label.toLowerCase().includes(searchQuery.toLowerCase())) return true;
      return n.children.some(checkDescendants);
    };
    return checkDescendants(node);
  }, [node, searchQuery]);

  if (!matchesSearch && !hasMatchingDescendant) {
    return null;
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-1 px-2 group",
          "hover:bg-muted/40 cursor-pointer",
          isSelected && "bg-primary/10"
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

        {node.isLeaf && node.valueType === "number" && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggle(node, !!checked)}
            data-testid={`checkbox-${captureId}-${node.id}`}
            aria-label={`Select ${node.label}`}
          />
        )}

        <span
          className={cn(
            "flex-1 text-xs truncate",
            isSelected ? "font-medium" : "text-foreground/90"
          )}
        >
          {node.label}
        </span>

        {isMissing && (
          <Badge
            variant="destructive"
            className="h-4 px-1.5 text-[10px] leading-4"
            data-testid={`badge-no-data-${captureId}-${node.id}`}
          >
            0/{coverageEntry?.total ?? 0}
          </Badge>
        )}
        {!isMissing && isSparse && (
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] leading-4"
            data-testid={`badge-sparse-${captureId}-${node.id}`}
          >
            {coverageEntry?.numericCount ?? 0}/{coverageEntry?.total ?? 0}
          </Badge>
        )}

        {selectedMetric && (
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: selectedMetric.color }}
          />
        )}

        <span className="sr-only">{getValueTypeIcon(node.valueType)}</span>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              captureId={captureId}
              selectedMetrics={selectedMetrics}
              onToggle={onToggle}
              expandedNodes={expandedNodes}
              onExpand={onExpand}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
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
}: ComponentTreeProps) {
  const MAX_ROOT_NODES = 200;
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());

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

  const shouldTruncate = searchQuery === "" && components.length > MAX_ROOT_NODES;
  const visibleNodes = shouldTruncate ? components.slice(0, MAX_ROOT_NODES) : components;

  return (
    <div>
      <div className="px-2 pb-1">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 h-7 text-xs"
            data-testid={`input-search-${captureId}`}
          />
        </div>
      </div>
      <div>
        {visibleNodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            captureId={captureId}
            selectedMetrics={selectedMetrics}
            metricCoverage={metricCoverage}
            onToggle={handleToggle}
            expandedNodes={expandedNodes}
            onExpand={handleExpand}
            searchQuery={searchQuery}
          />
        ))}
      </div>
      {shouldTruncate && (
        <div className="px-2 pt-1 text-[10px] text-muted-foreground">
          Showing first {MAX_ROOT_NODES} of {components.length}. Use search to narrow.
        </div>
      )}
    </div>
  );
}

export const ComponentTree = memo(ComponentTreeBase);
