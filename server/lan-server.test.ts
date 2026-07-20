import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";

import {
  PROTOCOL_VERSION,
  type ClientCommand,
  type RoomAccessResponse,
  type ServerMessage,
} from "../src/shared/protocol.ts";
import { createLanServer, type LanServer } from "./lan-server.ts";

class MessageInbox {
  private readonly messages: ServerMessage[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data: RawData) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      for (const notify of this.waiters) notify();
    });
  }

  async waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 2_000) {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    return await new Promise<ServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error("Timed out waiting for WebSocket message."));
      }, timeoutMs);
      const check = () => {
        const message = this.messages.find(predicate);
        if (!message) return;
        clearTimeout(timeout);
        this.waiters.delete(check);
        resolve(message);
      };
      this.waiters.add(check);
    });
  }
}

function readyCommand(commandId: string): ClientCommand {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "ready.set",
    commandId,
    seq: 1,
    roundId: "lobby",
    payload: { ready: true },
  };
}

describe("LAN HTTP and WebSocket server", () => {
  let server: LanServer | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    await server?.close();
    server = null;
  });

  it("connects two HTTP-created players and broadcasts a shared READY countdown", async () => {
    server = createLanServer({ host: "127.0.0.1", port: 0, countdownMs: 200 });
    const address = await server.listen();
    const createResponse = await fetch(`${address.httpUrl}/v1/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "PC" }),
    });
    expect(createResponse.status).toBe(201);
    const host = (await createResponse.json()) as RoomAccessResponse;

    const joinResponse = await fetch(`${address.httpUrl}/v1/rooms/${host.roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Phone" }),
    });
    expect(joinResponse.status).toBe(201);
    const guest = (await joinResponse.json()) as RoomAccessResponse;

    const hostSocket = new WebSocket(host.socketUrl);
    const guestSocket = new WebSocket(guest.socketUrl);
    sockets.push(hostSocket, guestSocket);
    const hostInbox = new MessageInbox(hostSocket);
    const guestInbox = new MessageInbox(guestSocket);
    await Promise.all([once(hostSocket, "open"), once(guestSocket, "open")]);

    await Promise.all([
      hostInbox.waitFor(
        (message) =>
          message.kind === "state.snapshot" &&
          message.state.players.length === 2 &&
          message.state.players.every((player) => player.connected),
      ),
      guestInbox.waitFor(
        (message) =>
          message.kind === "state.snapshot" &&
          message.state.players.length === 2 &&
          message.state.players.every((player) => player.connected),
      ),
    ]);

    hostSocket.send(JSON.stringify(readyCommand("host-ready")));
    guestSocket.send(JSON.stringify(readyCommand("guest-ready")));

    const [hostCountdown, guestCountdown] = await Promise.all([
      hostInbox.waitFor((message) => message.kind === "state.snapshot" && message.state.phase === "countdown"),
      guestInbox.waitFor((message) => message.kind === "state.snapshot" && message.state.phase === "countdown"),
    ]);
    expect(hostCountdown).toMatchObject({ kind: "state.snapshot", state: { roomCode: host.roomCode } });
    expect(guestCountdown).toMatchObject({ kind: "state.snapshot", state: { roomCode: host.roomCode } });

    const [hostPlaying, guestPlaying] = await Promise.all([
      hostInbox.waitFor((message) => message.kind === "state.snapshot" && message.state.phase === "playing"),
      guestInbox.waitFor((message) => message.kind === "state.snapshot" && message.state.phase === "playing"),
    ]);
    expect(hostPlaying).toMatchObject({
      kind: "state.snapshot",
      state: { match: { self: { playerId: host.playerId }, opponent: { playerId: guest.playerId } } },
    });
    expect(guestPlaying).toMatchObject({
      kind: "state.snapshot",
      state: { match: { self: { playerId: guest.playerId }, opponent: { playerId: host.playerId } } },
    });
    expect(JSON.stringify(hostPlaying)).not.toContain('"box"');
    expect(JSON.stringify(hostPlaying)).not.toContain('"seed"');

    hostSocket.send(JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind: "room.leave",
      commandId: "host-leave",
      seq: 2,
      roundId: "round-1",
      payload: {},
    }));
    const guestResult = await guestInbox.waitFor(
      (message) => message.kind === "state.snapshot" && message.state.phase === "result",
    );
    expect(guestResult).toMatchObject({ kind: "state.snapshot", state: { match: { result: "WIN" } } });
  });
});
