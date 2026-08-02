type SendableWebSocket = Pick<WebSocket, "readyState" | "send">;

type SendControlSocketMessageOptions = {
  activeSocket: SendableWebSocket | null;
  responseSocket?: SendableWebSocket | null;
  isRegistered: boolean;
  isResponse: boolean;
  serializedMessage: string;
};

/**
 * Sends a control message through the socket that owns the current command.
 *
 * A response socket takes precedence over the latest active socket because a
 * reconnect or HMR transition can replace the active reference while an older
 * registered socket is still dispatching an inbound command.
 */
export function sendControlSocketMessage({
  activeSocket,
  responseSocket,
  isRegistered,
  isResponse,
  serializedMessage,
}: SendControlSocketMessageOptions): boolean {
  const socket = responseSocket ?? activeSocket;
  if (socket?.readyState !== WebSocket.OPEN || (!isRegistered && !isResponse)) {
    return false;
  }
  socket.send(serializedMessage);
  return true;
}
