import type { ComponentNode } from "./schema";

function buildTree(
  obj: Record<string, unknown>,
  parentPath: string[],
  parentId: string,
): ComponentNode[] {
  const result: ComponentNode[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = [...parentPath, key];
    const id = parentId ? `${parentId}.${key}` : key;

    let valueType: ComponentNode["valueType"] = "null";
    let children: ComponentNode[] = [];

    if (value === null || value === undefined) {
      valueType = "null";
    } else if (typeof value === "number") {
      valueType = "number";
    } else if (typeof value === "string") {
      valueType = "string";
    } else if (typeof value === "boolean") {
      valueType = "boolean";
    } else if (Array.isArray(value)) {
      valueType = "array";
      if (value.length > 0 && typeof value[0] === "object") {
        children = buildTree(value[0] as Record<string, unknown>, path, id);
      }
    } else if (typeof value === "object") {
      valueType = "object";
      children = buildTree(value as Record<string, unknown>, path, id);
    }

    result.push({
      id,
      label: key,
      path,
      children,
      isLeaf: children.length === 0,
      valueType,
    });
  }

  return result;
}

export function buildComponentTreeFromEntities(
  entities: Record<string, unknown>,
): ComponentNode[] {
  const nodes: ComponentNode[] = [];

  Object.entries(entities).forEach(([entityId, components]) => {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      return;
    }
    const componentTree = buildTree(components as Record<string, unknown>, [entityId], entityId);
    if (componentTree.length === 0) {
      return;
    }
    nodes.push({
      id: entityId,
      label: entityId,
      path: [entityId],
      children: componentTree,
      isLeaf: false,
      valueType: "object",
    });
  });

  return pruneComponentTree(nodes);
}

export function pruneComponentTree(nodes: ComponentNode[]): ComponentNode[] {
  const pruned: ComponentNode[] = [];
  nodes.forEach((node) => {
    const children = pruneComponentTree(node.children);
    const isNumericLeaf = node.isLeaf && node.valueType === "number";
    if (children.length > 0 || isNumericLeaf) {
      pruned.push({
        ...node,
        children,
        isLeaf: children.length === 0,
      });
    }
  });
  return pruned;
}

function mergeValueType(
  existing: ComponentNode["valueType"],
  incoming: ComponentNode["valueType"],
) {
  if (incoming === "null" && existing !== "null") {
    return existing;
  }
  return incoming;
}

export function mergeComponentTrees(
  existing: ComponentNode[],
  incoming: ComponentNode[],
): ComponentNode[] {
  const existingMap = new Map(existing.map((node) => [node.id, node]));
  const merged: ComponentNode[] = [];

  incoming.forEach((node) => {
    const current = existingMap.get(node.id);
    existingMap.delete(node.id);
    if (!current) {
      merged.push(node);
      return;
    }
    const mergedChildren = mergeComponentTrees(current.children, node.children);
    merged.push({
      ...current,
      ...node,
      valueType: mergeValueType(current.valueType, node.valueType),
      children: mergedChildren,
      isLeaf: mergedChildren.length === 0,
    });
  });

  existingMap.forEach((node) => merged.push(node));
  return merged;
}
