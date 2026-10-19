import type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";
import type { ControlCommand } from "@shared/schema";

/** The retained receipt is the same identity-bound payload handed to the WS sender. */
export function sendPlayAck(context: WsCommandDispatchContext, requestId: string | undefined, command: ControlCommand, respondingState?: { identity?: unknown; frameIndex?: number }) {
  if (!requestId) return;
  let state: { identity?: unknown; frameIndex?: number } | undefined = respondingState;
  try { state ??= context.onPlayGameQuery?.({ queryId: "experiment-state" }) as typeof state; } catch { /* Legacy games have no experiment identity. */ }
  if (!state?.identity) { context.sendAck(requestId, command.type); return; }
  const receipt = { type: "ack" as const, request_id: requestId, payload: { command: command.type,
    identity: state?.identity ?? null, frameIndex: state?.frameIndex ?? null } };
  const sent = context.sendMessage(receipt);
  if (sent && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("metrics-ui:play-receipt", {
    detail: { receipt, request: command, emittedAtUs: Math.round(performance.now() * 1000), clockDomain: "browser-performance.now-microseconds" },
  }));
}
