export type AgentListEntry = {
  client: Record<string, unknown> | null;
  connectedAt: string;
};

/**
 * Registered agent sockets and the `client` description each sent with
 * `register`, so an agent can ask which other agents are attached.
 *
 * The description is the agent's own and is echoed unchanged; anything other
 * than a JSON object is recorded as no description.
 */
export class AgentRegistry<TSocket> {
  private readonly agents = new Map<TSocket, AgentListEntry>();

  add(socket: TSocket, client: unknown, now = new Date()): void {
    const description =
      client !== null && typeof client === "object" && !Array.isArray(client)
        ? (client as Record<string, unknown>)
        : null;
    this.agents.set(socket, { client: description, connectedAt: now.toISOString() });
  }

  delete(socket: TSocket): boolean {
    return this.agents.delete(socket);
  }

  get size(): number {
    return this.agents.size;
  }

  sockets(): IterableIterator<TSocket> {
    return this.agents.keys();
  }

  describe(socket: TSocket): Record<string, unknown> | null {
    return this.agents.get(socket)?.client ?? null;
  }

  /** Every agent other than the requester, oldest connection first. */
  list(requester: TSocket): AgentListEntry[] {
    return Array.from(this.agents)
      .filter(([socket]) => socket !== requester)
      .map(([, entry]) => entry);
  }
}
