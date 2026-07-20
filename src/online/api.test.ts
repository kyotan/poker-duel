import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoomAccessResponse, RoomState, StateSnapshotMessage } from "../shared/protocol";
import { OnlineLobbySession, formatRoomCode, isValidRoomCode, normalizeRoomCode } from "./api";

type SocketListener = (event: { data?: string }) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | null = null;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor(readonly url: string) {
    FakeWebSocket.latest = this;
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) {
    this.sent.push(value);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  receive(value: unknown) {
    this.dispatch("message", { data: JSON.stringify(value) });
  }

  close() {
    this.readyState = 3;
    this.dispatch("close", {});
  }

  private dispatch(type: string, event: { data?: string }) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

afterEach(() => {
  FakeWebSocket.latest = null;
  vi.unstubAllGlobals();
});

describe("online room codes", () => {
  it("normalizes spaces, hyphens, and lowercase letters", () => {
    expect(normalizeRoomCode("abc-789")).toBe("ABC789");
    expect(formatRoomCode("abc789")).toBe("ABC 789");
  });

  it("extracts a code from an invite URL", () => {
    expect(normalizeRoomCode("https://example.test/game/?room=JKM234")).toBe("JKM234");
  });

  it("rejects ambiguous and malformed room codes", () => {
    expect(isValidRoomCode("ABC789")).toBe(true);
    expect(isValidRoomCode("ABC780")).toBe(false);
    expect(isValidRoomCode("ABC78")).toBe(false);
  });
});

describe("OnlineLobbySession match commands", () => {
  it("tracks authoritative metadata and sends commands for the active round", () => {
    vi.stubGlobal("window", {
      location: { hostname: "127.0.0.1", protocol: "http:", href: "http://127.0.0.1:5174/" },
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const access: RoomAccessResponse = {
      protocolVersion: 1,
      roomCode: "ABC789",
      playerId: "p1",
      displayName: "Alice",
      socketTicket: "ticket",
      resumeToken: "resume-secret",
      socketUrl: "ws://127.0.0.1:8787/v1/socket?ticket=ticket",
    };
    const session = new OnlineLobbySession(access);
    const socket = FakeWebSocket.latest!;
    socket.open();
    expect(session.setReady(true)).toBe(true);

    const room: RoomState = {
      roomCode: "ABC789",
      phase: "playing",
      countdownEndsAt: null,
      players: [
        { playerId: "p1", displayName: "Alice", seat: 1, connected: true, ready: true },
        { playerId: "p2", displayName: "Bob", seat: 2, connected: true, ready: true },
      ],
      match: {
        roundId: "round-1",
        phase: "playing",
        nowMs: 8_000,
        countdownEndsAt: null,
        matchEndsAt: 180_000,
        self: {
          playerId: "p1", displayName: "Alice", connected: true, hp: 100, handVersion: 7,
          hand: [], handCount: 5, candidates: [], skills: [], stopUntilMs: 0, blockUntilMs: 0,
          shuffleLockUntilMs: 0, actionCooldownUntilMs: 0, skillCooldownUntilMs: 0,
        },
        opponent: {
          playerId: "p2", displayName: "Bob", connected: true, hp: 100, handVersion: 4,
          hand: [], handCount: 5, candidates: [], skills: [], stopUntilMs: 0, blockUntilMs: 0,
          shuffleLockUntilMs: 0, actionCooldownUntilMs: 0, skillCooldownUntilMs: 0,
        },
        skillDrop: null,
        activeAttacks: [],
        result: null,
        endReason: null,
        publicConfig: {
          countdownMs: 5_000, matchDurationMs: 180_000, attackCooldownMs: 1_200, redrawCooldownMs: 800,
          skillIntervalMs: 15_000, skillVisibleMs: 10_000, claimWindowMs: 150,
          healAmount: 20, stopDurationMs: 10_000, blockDurationMs: 5_000,
          shuffleLockMs: 800, skillCooldownMs: 1_000,
        },
      },
    };
    const message: StateSnapshotMessage = {
      protocolVersion: 1,
      kind: "state.snapshot",
      serverNowMs: 123_456,
      stateVersion: 12,
      state: room,
    };
    socket.receive(message);

    expect(session.getSnapshot()).toMatchObject({ serverNowMs: 123_456, stateVersion: 12, room });
    expect(session.redraw(7, ["c1", "c2"])).toBe(true);
    expect(session.activate(7, "pair-2")).toBe(true);
    expect(session.useSkill("skill-1")).toBe(true);
    expect(session.setRematchReady(true)).toBe(true);
    expect(session.requestSync()).toBe(true);

    const commands = socket.sent.map((value) => JSON.parse(value) as {
      kind: string;
      seq: number;
      roundId: string;
      payload: unknown;
    });
    expect(commands.map(({ kind, roundId }) => ({ kind, roundId }))).toEqual([
      { kind: "ready.set", roundId: "lobby" },
      { kind: "hand.redraw", roundId: "round-1" },
      { kind: "hand.activate", roundId: "round-1" },
      { kind: "skill.use", roundId: "round-1" },
      { kind: "rematch.ready", roundId: "round-1" },
      { kind: "sync.request", roundId: "round-1" },
    ]);
    expect(commands.map((command) => command.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(commands[1]?.payload).toEqual({ handVersion: 7, cardIds: ["c1", "c2"] });

    session.leave();
  });
});
