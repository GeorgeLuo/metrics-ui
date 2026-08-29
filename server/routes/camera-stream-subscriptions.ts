import type { ControlCommand, ControlResponse } from "@shared/schema";
import type {
  CameraStreamEndedPayload,
  CameraStreamReason,
  CameraStreamResultMessage,
  CameraStreamUnsubscribeCommand,
} from "@shared/play-camera-stream";

export type CameraStreamSocket = {
  readyState?: number;
  send: (data: string) => unknown;
};

type PendingCommand<TSocket extends CameraStreamSocket> = {
  agent: TSocket;
  command: ControlCommand;
  kind: "subscribe" | "unsubscribe";
  subscriptionId?: string;
};

export type CameraStreamAgentCommandResult = {
  forward: boolean;
  response?: ControlResponse;
};

export type CameraStreamSubscriptionRegistryOptions<TSocket extends CameraStreamSocket> = {
  sendToFrontend: (command: CameraStreamUnsubscribeCommand) => boolean;
  isOpen?: (socket: TSocket) => boolean;
  sendToAgent?: (agent: TSocket, message: ControlResponse) => boolean;
};

function defaultIsOpen<TSocket extends CameraStreamSocket>(socket: TSocket): boolean {
  return socket.readyState === 1;
}

function buildUnsupportedResponse(
  command: ControlCommand,
  reason: CameraStreamReason,
): ControlResponse {
  return {
    type: "play_camera_stream_result",
    request_id: command.request_id,
    payload: {
      event: "unsupported",
      cameraStream: {
        supported: false,
        reason,
      },
    },
  };
}

function subscriptionNotFound(
  command: ControlCommand,
): ControlResponse {
  const requested = "subscriptionId" in command ? command.subscriptionId : undefined;
  return buildUnsupportedResponse(command, {
    code: "subscription_not_found",
    message: "Camera stream subscription was not found for this agent.",
    field: "subscriptionId",
    requested,
  });
}

function readSubscriptionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as { subscriptionId?: unknown }).subscriptionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readResultPayload(message: ControlResponse): CameraStreamResultMessage["payload"] | null {
  const payload = message.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const event = (payload as { event?: unknown }).event;
  return event === "subscribed"
    || event === "unsupported"
    || event === "unsubscribed"
    || event === "ended"
    ? payload as CameraStreamResultMessage["payload"]
    : null;
}

/** Routes one camera stream to the agent that owns its subscription. */
export class CameraStreamSubscriptionRegistry<
  TSocket extends CameraStreamSocket,
> {
  private readonly bySubscription = new Map<string, TSocket>();

  private readonly byAgent = new Map<TSocket, string>();

  private readonly pendingByAgent = new Map<TSocket, PendingCommand<TSocket>>();

  private readonly pendingByRequest = new Map<string, PendingCommand<TSocket>>();

  private readonly orphanedRequests = new Set<string>();

  private readonly isOpen: (socket: TSocket) => boolean;

  private readonly sendToFrontend: (command: CameraStreamUnsubscribeCommand) => boolean;

  private readonly sendToAgent: (agent: TSocket, message: ControlResponse) => boolean;

  constructor(options: CameraStreamSubscriptionRegistryOptions<TSocket>) {
    this.isOpen = options.isOpen ?? defaultIsOpen;
    this.sendToFrontend = options.sendToFrontend;
    this.sendToAgent = options.sendToAgent ?? ((agent, message) => {
      try {
        agent.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    });
  }

  private trackPending(pending: PendingCommand<TSocket>): void {
    this.pendingByAgent.set(pending.agent, pending);
    if (pending.command.request_id) {
      this.pendingByRequest.set(pending.command.request_id, pending);
    }
  }

  private clearPending(pending: PendingCommand<TSocket>): void {
    if (this.pendingByAgent.get(pending.agent) === pending) {
      this.pendingByAgent.delete(pending.agent);
    }
    const requestId = pending.command.request_id;
    if (requestId && this.pendingByRequest.get(requestId) === pending) {
      this.pendingByRequest.delete(requestId);
    }
  }

  private clearMapping(agent: TSocket, subscriptionId: string): void {
    if (this.bySubscription.get(subscriptionId) === agent) {
      this.bySubscription.delete(subscriptionId);
    }
    if (this.byAgent.get(agent) === subscriptionId) {
      this.byAgent.delete(agent);
    }
  }

  private sendAgent(agent: TSocket, message: ControlResponse): boolean {
    if (!this.isOpen(agent)) {
      return false;
    }
    return this.sendToAgent(agent, message);
  }

  private sendFrontendUnsubscribe(subscriptionId: string): void {
    this.sendToFrontend({
      type: "play_camera_stream_unsubscribe",
      subscriptionId,
    });
  }

  /** Reserves a valid stream command or returns its immediate agent-local result. */
  handleAgentCommand(
    command: ControlCommand,
    agent: TSocket,
  ): CameraStreamAgentCommandResult {
    if (command.type === "play_camera_stream_subscribe") {
      if (this.byAgent.has(agent) || this.pendingByAgent.has(agent)) {
        return {
          forward: false,
          response: buildUnsupportedResponse(command, {
            code: "already_subscribed",
            message: "This agent already has an active camera stream subscription.",
          }),
        };
      }
      this.trackPending({ agent, command, kind: "subscribe" });
      return { forward: true };
    }

    if (command.type === "play_camera_stream_unsubscribe") {
      const requested = typeof command.subscriptionId === "string"
        ? command.subscriptionId.trim()
        : "";
      const subscriptionId = this.byAgent.get(agent);
      if (!subscriptionId || requested !== subscriptionId || this.pendingByAgent.has(agent)) {
        return { forward: false, response: subscriptionNotFound(command) };
      }
      this.trackPending({
        agent,
        command,
        kind: "unsubscribe",
        subscriptionId,
      });
      return { forward: true };
    }

    return { forward: false };
  }

  /** Releases an agent command when the host cannot forward it to a frontend. */
  cancelAgentCommand(command: ControlCommand, agent: TSocket): void {
    const pending = this.pendingByAgent.get(agent);
    if (pending?.command === command) {
      this.clearPending(pending);
    }
  }

  private findPending(message: ControlResponse): PendingCommand<TSocket> | null {
    if (message.request_id) {
      return this.pendingByRequest.get(message.request_id) ?? null;
    }
    const payload = readResultPayload(message);
    if (!payload) {
      return null;
    }
    for (const pending of this.pendingByAgent.values()) {
      if (
        ((payload.event === "subscribed" || payload.event === "unsupported")
          && pending.kind === "subscribe")
        || ((payload.event === "unsubscribed" || payload.event === "unsupported")
          && pending.kind === "unsubscribe")
      ) {
        return pending;
      }
    }
    return null;
  }

  private handleFrame(message: ControlResponse): boolean {
    const payload = message.payload;
    const subscriptionId = readSubscriptionId(payload);
    if (!subscriptionId) {
      return true;
    }
    const agent = this.bySubscription.get(subscriptionId);
    if (!agent) {
      return true;
    }
    if (!this.isOpen(agent)) {
      this.clearMapping(agent, subscriptionId);
      this.sendFrontendUnsubscribe(subscriptionId);
      return true;
    }
    const sent = this.sendAgent(agent, message);
    if (!sent) {
      this.clearMapping(agent, subscriptionId);
      this.sendFrontendUnsubscribe(subscriptionId);
    }
    return true;
  }

  private handleResult(message: ControlResponse): boolean {
    const payload = readResultPayload(message);
    if (!payload) {
      return true;
    }
    if (payload.event === "ended") {
      const subscriptionId = readSubscriptionId(payload);
      if (subscriptionId) {
        const agent = this.bySubscription.get(subscriptionId);
        if (agent) {
          this.clearMapping(agent, subscriptionId);
          this.sendAgent(agent, message);
        }
      }
      return true;
    }

    const pending = this.findPending(message);
    if (!pending) {
      const orphaned = Boolean(
        message.request_id && this.orphanedRequests.has(message.request_id),
      );
      if (message.request_id && orphaned) {
        this.orphanedRequests.delete(message.request_id);
      }
      if (!message.request_id || orphaned) {
        if (payload.event === "subscribed") {
          const subscriptionId = readSubscriptionId(payload);
          if (subscriptionId) {
            this.sendFrontendUnsubscribe(subscriptionId);
          }
        }
      }
      return true;
    }
    this.clearPending(pending);
    const agent = pending.agent;
    if (payload.event === "subscribed" && pending.kind === "subscribe") {
      const subscriptionId = readSubscriptionId(payload);
      if (subscriptionId && this.isOpen(agent)) {
        this.bySubscription.set(subscriptionId, agent);
        this.byAgent.set(agent, subscriptionId);
      } else if (subscriptionId) {
        this.sendFrontendUnsubscribe(subscriptionId);
      }
    } else if (
      (payload.event === "unsubscribed" || payload.event === "unsupported")
      && pending.kind === "unsubscribe"
      && pending.subscriptionId
    ) {
      this.clearMapping(agent, pending.subscriptionId);
    }
    if (this.isOpen(agent)) {
      const sent = this.sendAgent(agent, message);
      if (!sent && payload.event === "subscribed" && pending.kind === "subscribe") {
        const subscriptionId = readSubscriptionId(payload);
        if (subscriptionId) {
          this.clearMapping(agent, subscriptionId);
          this.sendFrontendUnsubscribe(subscriptionId);
        }
      }
    }
    return true;
  }

  /** Intercepts camera messages before the server's general agent broadcast. */
  handleFrontendMessage(message: ControlResponse): boolean {
    if (message.type === "play_camera_stream_frame") {
      return this.handleFrame(message);
    }
    if (message.type === "play_camera_stream_result") {
      return this.handleResult(message);
    }
    return false;
  }

  /** Ends all active streams when their owning frontend socket disconnects. */
  handleFrontendDisconnect(): void {
    for (const [subscriptionId, agent] of this.bySubscription) {
      const ended: ControlResponse = {
        type: "play_camera_stream_result",
        payload: {
          event: "ended",
          subscriptionId,
          reason: {
            code: "frontend_disconnected",
            message: "Frontend disconnected before the camera stream ended.",
          },
        } satisfies CameraStreamEndedPayload,
      };
      this.sendAgent(agent, ended);
      this.clearMapping(agent, subscriptionId);
    }
    for (const pending of this.pendingByAgent.values()) {
      this.clearPending(pending);
    }
  }

  /** Removes one agent's mapping and asks the frontend to stop encoding. */
  handleAgentDisconnect(agent: TSocket): void {
    const subscriptionId = this.byAgent.get(agent);
    if (subscriptionId) {
      this.clearMapping(agent, subscriptionId);
      this.sendFrontendUnsubscribe(subscriptionId);
    }
    const pending = this.pendingByAgent.get(agent);
    if (pending) {
      const requestId = pending.command.request_id;
      if (requestId) {
        this.orphanedRequests.add(requestId);
      }
      this.clearPending(pending);
    }
  }

  getSubscriptionForAgent(agent: TSocket): string | undefined {
    return this.byAgent.get(agent);
  }

  getAgentForSubscription(subscriptionId: string): TSocket | undefined {
    return this.bySubscription.get(subscriptionId);
  }

  get size(): number {
    return this.bySubscription.size;
  }
}

export function createCameraStreamSubscriptionRegistry<TSocket extends CameraStreamSocket>(
  options: CameraStreamSubscriptionRegistryOptions<TSocket>,
): CameraStreamSubscriptionRegistry<TSocket> {
  return new CameraStreamSubscriptionRegistry(options);
}
