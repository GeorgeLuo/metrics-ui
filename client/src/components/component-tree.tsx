import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Search, Hash, Type, Braces, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ComponentNode, SelectedMetric } from "@shared/schema";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

interface ComponentTreeProps {
  components: ComponentNode[];
  selectedMetrics: SelectedMetric[];
  onSelectionChange: (metrics: SelectedMetric[]) => void;
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
  selectedMetrics: SelectedMetric[];
  onToggle: (node: ComponentNode, checked: boolean) => void;
  expandedNodes: Set<string>;
  onExpand: (nodeId: string) => void;
  searchQuery: string;
}

function TreeNode({
  node,
  level,
  selectedMetrics,
  onToggle,
  expandedNodes,
  onExpand,
  searchQuery,
}: TreeNodeProps) {
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedMetrics.some((m) => m.fullPath === node.id);
  const selectedMetric = selectedMetrics.find((m) => m.fullPath === node.id);
  const hasChildren = node.children.length > 0;

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
          "flex items-center gap-2 py-1.5 px-2 rounded-md group transition-colors",
          "hover-elevate cursor-pointer",
          isSelected && "bg-primary/10"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        data-testid={`tree-node-${node.id}`}
      >
        {hasChildren ? (
          <button
            onClick={() => onExpand(node.id)}
            className="p-0.5 -m-0.5 hover:bg-muted rounded"
            data-testid={`button-expand-${node.id}`}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        {node.isLeaf && node.valueType === "number" && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggle(node, !!checked)}
            data-testid={`checkbox-${node.id}`}
            aria-label={`Select ${node.label}`}
          />
        )}

        <span
          className={cn(
            "flex-1 text-sm truncate",
            isSelected ? "font-medium" : "text-foreground/90"
          )}
        >
          {node.label}
        </span>

        {selectedMetric && (
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: selectedMetric.color }}
          />
        )}

        <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          {getValueTypeIcon(node.valueType)}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
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

export function ComponentTree({
  components,
  selectedMetrics,
  onSelectionChange,
}: ComponentTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const expanded = new Set<string>();
    const expandAll = (nodes: ComponentNode[]) => {
      nodes.forEach((n) => {
        expanded.add(n.id);
        expandAll(n.children);
      });
    };
    expandAll(components);
    return expanded;
  });

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
      const colorIndex = selectedMetrics.length % CHART_COLORS.length;
      const newMetric: SelectedMetric = {
        path: node.path,
        fullPath: node.id,
        label: node.label,
        color: CHART_COLORS[colorIndex],
      };
      onSelectionChange([...selectedMetrics, newMetric]);
    } else {
      onSelectionChange(selectedMetrics.filter((m) => m.fullPath !== node.id));
    }
  };

  if (components.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Braces className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">No components available</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Upload a capture file to see components
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search-components"
          />
        </div>
        {selectedMetrics.length > 0 && (
          <div className="mt-2">
            <Badge variant="secondary" className="text-xs">
              {selectedMetrics.length} selected
            </Badge>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {components.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              level={0}
              selectedMetrics={selectedMetrics}
              onToggle={handleToggle}
              expandedNodes={expandedNodes}
              onExpand={handleExpand}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
