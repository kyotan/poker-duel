import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  PROTOCOL_VERSION,
  normalizeRoomCode,
  parseClientCommand,
  type ApiErrorCode,
  type ApiErrorResponse,
  type CommandAcceptedMessage,
  type CommandRejectedMessage,
  type RoomWelcomeMessage,
  type ServerMessage,
} from "../src/shared/protocol.ts";
import { RoomDirectory, RoomError, withSocketUrl } from "./room.ts";

const MAX_BODY_BYTES = 16 * 1024;

interface RequestBody {
  readonly displayName?: unknown;
  readonly playerId?: unknown;
  readonly resumeToken?: unknown;
}

export interface LanServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly countdownMs?: number;
  readonly directory?: RoomDirectory;
}

export interface LanServerAddress {
  readonly host: string;
  readonly port: number;
  readonly httpUrl: string;
}

export interface LanServer {
  readonly directory: RoomDirectory;
  listen(): Promise<LanServerAddress>;
  close(): Promise<void>;
}

interface SocketIdentity {
  readonly roomCode: string;
  readonly playerId: string;
}

class InvalidJsonError extends Error {}

function setCommonHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  setCommonHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendApiError(response: ServerResponse, status: number, code: ApiErrorCode) {
  const body: ApiErrorResponse = { error: { code } };
  sendJson(response, status, body);
}

async function readBody(request: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new InvalidJsonError();
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidJsonError();
    return value as RequestBody;
  } catch (error) {
    if (error instanceof InvalidJsonError) throw error;
    throw new InvalidJsonError();
  }
}

function roomErrorStatus(error: RoomError) {
  switch (error.code) {
    case "INVALID_NAME":
    case "INVALID_ROOM_CODE":
      return 400;
    case "ROOM_NOT_FOUND":
      return 404;
    case "ROOM_FULL":
      return 409;
    case "RESUME_DENIED":
      return 401;
    default:
      return 500;
  }
}

function roomErrorCode(error: RoomError): ApiErrorCode {
  switch (error.code) {
    case "INVALID_NAME":
    case "INVALID_ROOM_CODE":
    case "ROOM_NOT_FOUND":
    case "ROOM_FULL":
    case "RESUME_DENIED":
      return error.code;
    default:
      return "INTERNAL_ERROR";
  }
}

function websocketUrl(request: IncomingMessage, roomCode: string, socketTicket: string) {
  const forwarded = request.headers["x-forwarded-proto"];
  const forwardedProtocol = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "wss" : "ws";
  const host = request.headers.host ?? "127.0.0.1:8787";
  return `${protocol}://${host}/v1/rooms/${encodeURIComponent(roomCode)}/socket?ticket=${encodeURIComponent(socketTicket)}`;
}

function rawUpgradeError(socket: import("node:stream").Duplex, status: number, statusText: string) {
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createLanServer(options: LanServerOptions = {}): LanServer {
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 8787;
  const directory = options.directory ?? new RoomDirectory({ countdownMs: options.countdownMs });
  const sockets = new Map<string, Map<string, WebSocket>>();
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });
  let listening = false;

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const broadcast = (roomCode: string) => {
    const roomSockets = sockets.get(roomCode);
    if (!roomSockets) return;
    for (const [playerId, socket] of roomSockets) {
      send(socket, directory.snapshot(roomCode, playerId));
    }
  };

  const unsubscribe = directory.subscribe(broadcast);

  const httpServer: HttpServer = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "OPTIONS") {
      setCommonHeaders(response);
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname.endsWith("/socket")) {
      sendJson(response, 426, { error: { code: "UPGRADE_REQUIRED" } });
      return;
    }
    if (request.method !== "POST") {
      sendApiError(response, 404, "ROOM_NOT_FOUND");
      return;
    }

    try {
      const body = await readBody(request);
      let credentials;
      if (requestUrl.pathname === "/v1/rooms") {
        credentials = directory.createRoom(typeof body.displayName === "string" ? body.displayName : "");
      } else {
        const match = requestUrl.pathname.match(/^\/v1\/rooms\/([^/]+)\/(join|resume)$/);
        if (!match) {
          sendApiError(response, 404, "ROOM_NOT_FOUND");
          return;
        }
        const roomCode = decodeURIComponent(match[1]);
        if (match[2] === "join") {
          credentials = directory.joinRoom(roomCode, typeof body.displayName === "string" ? body.displayName : "");
        } else {
          credentials = directory.resumeRoom(
            roomCode,
            typeof body.playerId === "string" ? body.playerId : "",
            typeof body.resumeToken === "string" ? body.resumeToken : "",
          );
        }
      }
      const socketUrl = websocketUrl(request, credentials.roomCode, credentials.socketTicket);
      sendJson(response, 201, withSocketUrl(credentials, socketUrl));
    } catch (error) {
      if (error instanceof InvalidJsonError) {
        sendApiError(response, 400, "INVALID_JSON");
      } else if (error instanceof RoomError) {
        sendApiError(response, roomErrorStatus(error), roomErrorCode(error));
      } else {
        sendApiError(response, 500, "INTERNAL_ERROR");
      }
    }
  });

  httpServer.on("upgrade", (request, socket, head) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      rawUpgradeError(socket, 400, "Bad Request");
      return;
    }
    const match = requestUrl.pathname.match(/^\/v1\/rooms\/([^/]+)\/socket$/);
    const ticket = requestUrl.searchParams.get("ticket");
    if (!match || !ticket) {
      rawUpgradeError(socket, 404, "Not Found");
      return;
    }

    let identity: SocketIdentity;
    try {
      identity = directory.consumeSocketTicket(decodeURIComponent(match[1]), ticket);
    } catch {
      rawUpgradeError(socket, 401, "Unauthorized");
      return;
    }

    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request, identity);
    });
  });

  webSockets.on("connection", (socket: WebSocket, _request: IncomingMessage, identity: SocketIdentity) => {
    const roomCode = normalizeRoomCode(identity.roomCode);
    let roomSockets = sockets.get(roomCode);
    if (!roomSockets) {
      roomSockets = new Map();
      sockets.set(roomCode, roomSockets);
    }
    if (roomSockets.has(identity.playerId)) {
      socket.close(1008, "ALREADY_CONNECTED");
      return;
    }
    roomSockets.set(identity.playerId, socket);

    const welcome: RoomWelcomeMessage = {
      protocolVersion: PROTOCOL_VERSION,
      kind: "room.welcome",
      roomCode,
      playerId: identity.playerId,
    };
    send(socket, welcome);
    try {
      directory.connect(roomCode, identity.playerId);
    } catch {
      roomSockets.delete(identity.playerId);
      socket.close(1008, "CONNECTION_DENIED");
      return;
    }

    socket.on("message", (data: RawData, isBinary: boolean) => {
      let raw: unknown;
      if (!isBinary) {
        try {
          raw = JSON.parse(data.toString());
        } catch {
          raw = null;
        }
      }
      const parsed = parseClientCommand(raw);
      if (!parsed.ok) {
        const rejected: CommandRejectedMessage = {
          protocolVersion: PROTOCOL_VERSION,
          kind: "command.rejected",
          commandId:
            typeof raw === "object" && raw !== null && "commandId" in raw && typeof raw.commandId === "string"
              ? raw.commandId
              : null,
          stateVersion: directory.snapshot(roomCode).stateVersion,
          reason: parsed.reason,
        };
        send(socket, rejected);
        return;
      }

      const result = directory.applyCommand(roomCode, identity.playerId, parsed.command);
      if (result.ok) {
        const accepted: CommandAcceptedMessage = {
          protocolVersion: PROTOCOL_VERSION,
          kind: "command.accepted",
          commandId: parsed.command.commandId,
          stateVersion: result.stateVersion,
          duplicate: result.duplicate,
        };
        send(socket, accepted);
        if (parsed.command.kind === "sync.request") send(socket, directory.snapshot(roomCode, identity.playerId));
        if (result.leftRoom) socket.close(1000, "LEFT_ROOM");
      } else {
        const rejected: CommandRejectedMessage = {
          protocolVersion: PROTOCOL_VERSION,
          kind: "command.rejected",
          commandId: parsed.command.commandId,
          stateVersion: result.stateVersion,
          reason: result.reason ?? "INVALID_MESSAGE",
        };
        send(socket, rejected);
      }
    });

    socket.on("close", () => {
      const currentRoomSockets = sockets.get(roomCode);
      if (!currentRoomSockets || currentRoomSockets.get(identity.playerId) !== socket) return;
      currentRoomSockets.delete(identity.playerId);
      if (currentRoomSockets.size === 0) sockets.delete(roomCode);
      directory.disconnect(roomCode, identity.playerId);
    });
  });

  return {
    directory,
    async listen() {
      if (listening) throw new Error("LAN server is already listening.");
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          resolve();
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, host);
      });
      listening = true;
      const address = httpServer.address() as AddressInfo;
      const visibleHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      return { host, port: address.port, httpUrl: `http://${visibleHost}:${address.port}` };
    },
    async close() {
      unsubscribe();
      for (const socket of webSockets.clients) socket.terminate();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      if (listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
      listening = false;
      directory.dispose();
    },
  };
}
