import type { ControlCommand, ControlResponse } from "@shared/schema";
import type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";
import { isBenignAbortErrorMessage } from "@/hooks/ws/normalizers";

export function handleEventCommand(
  command: ControlCommand | ControlResponse,
  requestId: string | undefined,
  context: WsCommandDispatchContext,
): boolean {
  switch (command.type) {
    case "derivation_plugins": {
      const payload = (command as ControlResponse).payload as { plugins?: unknown } | undefined;
      const pluginsRaw = payload?.plugins;
      const plugins = Array.isArray(pluginsRaw) ? pluginsRaw : [];
      context.onDerivationPlugins?.(plugins);
      return true;
    }
    case "ui_notice": {
      const payload = (command as ControlResponse).payload as
        | { message?: unknown; context?: unknown }
        | undefined;
      const message =
        typeof payload?.message === "string" && payload.message.trim().length > 0
          ? payload.message.trim()
          : "Notice";
      const contextPayload =
        payload?.context && typeof payload.context === "object" && !Array.isArray(payload.context)
          ? (payload.context as Record<string, unknown>)
          : undefined;
      context.onUiNotice?.({ message, context: contextPayload, requestId });
      return true;
    }
    case "ui_error": {
      const payload = (command as ControlResponse).payload as
        | { context?: unknown }
        | undefined;
      const contextPayload =
        payload?.context && typeof payload.context === "object" && !Array.isArray(payload.context)
          ? (payload.context as Record<string, unknown>)
          : undefined;
      const errorMessage =
        typeof (command as ControlResponse).error === "string"
        && (command as ControlResponse).error!.trim().length > 0
          ? (command as ControlResponse).error!.trim()
          : "UI error";
      if (isBenignAbortErrorMessage(errorMessage)) {
        return true;
      }
      context.onUiError?.({ error: errorMessage, context: contextPayload, requestId });
      return true;
    }
    case "error": {
      const errorMessage =
        typeof (command as ControlResponse).error === "string"
        && (command as ControlResponse).error!.trim().length > 0
          ? (command as ControlResponse).error!.trim()
          : "Server error";
      if (isBenignAbortErrorMessage(errorMessage)) {
        return true;
      }
      context.onUiError?.({ error: errorMessage, requestId });
      return true;
    }
    default:
      return false;
  }
}
