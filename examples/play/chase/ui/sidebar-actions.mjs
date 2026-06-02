import { createActorActionProposalToggleActionId } from "./sidebar.mjs";
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

export function getSidebarActionIds(actorActionProposalCollections = {}) {
  return createSidebarActionDescriptors({
    getActorActionProposalCollections: () => actorActionProposalCollections,
  }).map((descriptor) => descriptor.id);
}

export function clearSidebarActions(
  setSidebarActionHandler,
  actorActionProposalCollections = {},
  actionIds = null,
) {
  const ids = Array.isArray(actionIds)
    ? actionIds
    : getSidebarActionIds(actorActionProposalCollections);
  ids.forEach((actionId) => {
    setSidebarActionHandler?.(actionId, null);
  });

  Object.entries(actorActionProposalCollections).forEach(([actorId, actionProposals]) => {
    Object.keys(actionProposals ?? {}).forEach((actionProposalId) => {
      setSidebarActionHandler?.(createActorActionProposalToggleActionId(actorId, actionProposalId), null);
    });
  });
}
