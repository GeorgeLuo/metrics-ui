import { createActorStrategyToggleActionId } from "./sidebar.mjs";
import { createSidebarActionDescriptors } from "./sidebar-action-descriptors.mjs";

export function registerSidebarActions(context) {
  const { setSidebarActionHandler } = context;
  if (typeof setSidebarActionHandler !== "function") {
    return [];
  }

  const descriptors = createSidebarActionDescriptors(context);
  descriptors.forEach((descriptor) => {
    setSidebarActionHandler(descriptor.id, descriptor.handler);
  });
  return descriptors.map((descriptor) => descriptor.id);
}

export function getSidebarActionIds(actorStrategyCollections = {}) {
  return createSidebarActionDescriptors({
    getActorStrategyCollections: () => actorStrategyCollections,
  }).map((descriptor) => descriptor.id);
}

export function clearSidebarActions(
  setSidebarActionHandler,
  actorStrategyCollections = {},
  actionIds = null,
) {
  const ids = Array.isArray(actionIds)
    ? actionIds
    : getSidebarActionIds(actorStrategyCollections);
  ids.forEach((actionId) => {
    setSidebarActionHandler?.(actionId, null);
  });

  Object.entries(actorStrategyCollections).forEach(([actorId, strategies]) => {
    Object.keys(strategies ?? {}).forEach((strategyId) => {
      setSidebarActionHandler?.(createActorStrategyToggleActionId(actorId, strategyId), null);
    });
  });
}
