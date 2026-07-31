import type { ControlCommand, ControlResponse } from "@shared/schema";
import {
  buildFrontendDisconnectedResponse,
  buildFrontendUnresponsiveResponse,
} from "./frontend-command-routing.ts";

type PendingRequest<TFrontend, TAgent> = {
  command: ControlCommand;
  frontend: TFrontend;
  agent: TAgent;
  timer: ReturnType<typeof setTimeout>;
  respond: (response: ControlResponse) => void;
};

/**
 * Tracks response-required commands while they are owned by a frontend socket.
 *
 * Request IDs correlate frontend responses with the originating agent. The
 * tracker does not route successful responses; it only cancels failure timers
 * and reports bounded delivery failures.
 */
export class FrontendRequestTracker<TFrontend, TAgent> {
  private readonly pending = new Set<PendingRequest<TFrontend, TAgent>>();

  constructor(private readonly timeoutMs: number) {}

  track({
    command,
    frontend,
    agent,
    respond,
  }: {
    command: ControlCommand;
    frontend: TFrontend;
    agent: TAgent;
    respond: (response: ControlResponse) => void;
  }): void {
    if (!command.request_id) {
      return;
    }
    let entry: PendingRequest<TFrontend, TAgent>;
    const timer = setTimeout(() => {
      this.pending.delete(entry);
      respond(buildFrontendUnresponsiveResponse(command, this.timeoutMs));
    }, this.timeoutMs);
    timer.unref?.();
    entry = { command, frontend, agent, respond, timer };
    this.pending.add(entry);
  }

  resolve(frontend: TFrontend, response: ControlResponse): void {
    if (!response.request_id) {
      return;
    }
    for (const entry of this.pending) {
      if (
        entry.frontend === frontend
        && entry.command.request_id === response.request_id
      ) {
        clearTimeout(entry.timer);
        this.pending.delete(entry);
      }
    }
  }

  failFrontend(frontend: TFrontend): void {
    for (const entry of this.pending) {
      if (entry.frontend === frontend) {
        clearTimeout(entry.timer);
        this.pending.delete(entry);
        entry.respond(buildFrontendDisconnectedResponse(entry.command));
      }
    }
  }

  removeAgent(agent: TAgent): void {
    for (const entry of this.pending) {
      if (entry.agent === agent) {
        clearTimeout(entry.timer);
        this.pending.delete(entry);
      }
    }
  }
}
