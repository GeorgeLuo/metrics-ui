import type { ControlCommand, ControlResponse } from "@shared/schema";
import type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";
import { handleEventCommand } from "@/hooks/ws/handlers/events";
import { handleInteractionCommand } from "@/hooks/ws/handlers/interaction";
import { handleQueryCommand } from "@/hooks/ws/handlers/query";

export type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";

export function dispatchWsCommand(
  command: ControlCommand | ControlResponse,
  context: WsCommandDispatchContext,
) {
  const requestId = "request_id" in command ? command.request_id : undefined;
  if (handleInteractionCommand(command, requestId, context)) {
    return;
  }
  if (handleQueryCommand(command, requestId, context)) {
    return;
  }
  handleEventCommand(command, requestId, context);
}
