import { describe, expect, it } from "vitest";

import type { GameEvent } from "../controller/GameController";
import type {
  PublicMatchConfig,
  RoomState,
  VisibleMatchSnapshot,
} from "../shared/protocol";
import type { LobbyClientSnapshot, OnlineLobbySession } from "./api";
import { PvpGameController } from "./PvpGameController";

const publicConfig: PublicMatchConfig = {
  countdownMs: 5_000,
  matchDurationMs: 180_000,
  attackCooldownMs: 1_200,
  redrawCooldownMs: 800,
  skillIntervalMs: 15_000,
  skillVisibleMs: 10_000,
  claimWindowMs: 150,
  healAmount: 20,
  stopDurationMs: 10_000,
  blockDurationMs: 5_000,
  shuffleLockMs: 800,
  skillCooldownMs: 1_000,
};

function matchFixture(patch: Partial<VisibleMatchSnapshot> = {}): VisibleMatchSnapshot {
  return {
    roundId: "round-1",
    phase: "playing",
    nowMs: 10_000,
    countdownEndsAt: null,
    matchEndsAt: 180_000,
    self: {
      playerId: "p1",
      displayName: "Alice",
      connected: true,
      hp: 100,
      handVersion: 3,
      hand: [
        { id: "p1-h2", suit: "hearts", rank: 2 },
        { id: "p1-d2", suit: "diamonds", rank: 2 },
        { id: "p1-c7", suit: "clubs", rank: 7 },
        { id: "p1-s9", suit: "spades", rank: 9 },
        { id: "p1-h13", suit: "hearts", rank: 13 },
      ],
      handCount: 5,
      candidates: [{
        candidateId: "pair-2",
        type: "one_pair",
        cardIds: ["p1-h2", "p1-d2"],
        ranks: [2],
        damage: 8,
      }],
      skills: [{ instanceId: "heal-1", type: "HEAL" }],
      stopUntilMs: 0,
      blockUntilMs: 0,
      shuffleLockUntilMs: 0,
      actionCooldownUntilMs: 0,
      skillCooldownUntilMs: 0,
    },
    opponent: {
      playerId: "p2",
      displayName: "Bob",
      connected: true,
      hp: 100,
      handVersion: 2,
      hand: [
        { id: "p2-s3", suit: "spades", rank: 3 },
        { id: "p2-h4", suit: "hearts", rank: 4 },
        { id: "p2-d5", suit: "diamonds", rank: 5 },
        { id: "p2-c6", suit: "clubs", rank: 6 },
        { id: "p2-s7", suit: "spades", rank: 7 },
      ],
      handCount: 5,
      candidates: [],
      skills: [],
      stopUntilMs: 0,
      blockUntilMs: 0,
      shuffleLockUntilMs: 0,
      actionCooldownUntilMs: 0,
      skillCooldownUntilMs: 0,
    },
    skillDrop: null,
    activeAttacks: [],
    result: null,
    endReason: null,
    publicConfig,
    ...patch,
  };
}

function roomFixture(match: VisibleMatchSnapshot | null): RoomState {
  return {
    roomCode: "ABC789",
    phase: match?.phase === "result" ? "result" : match ? "playing" : "waiting_for_ready",
    players: [
      { playerId: "p1", displayName: "Alice", seat: 1, connected: true, ready: true },
      { playerId: "p2", displayName: "Bob", seat: 2, connected: true, ready: true },
    ],
    countdownEndsAt: null,
    match,
  };
}

class FakeSession {
  readonly roomCode = "ABC789";
  readonly localDisplayName = "Alice";
  readonly calls: Array<{ kind: string; args: unknown[] }> = [];
  private listeners = new Set<() => void>();
  private snapshot: LobbyClientSnapshot;

  constructor(match: VisibleMatchSnapshot | null = matchFixture()) {
    this.snapshot = {
      connection: "connected",
      room: roomFixture(match),
      localPlayerId: "p1",
      errorCode: null,
      serverNowMs: 1_000_000,
      stateVersion: 4,
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  redraw(handVersion: number, cardIds: readonly string[]) {
    this.calls.push({ kind: "redraw", args: [handVersion, [...cardIds]] });
    return true;
  }

  activate(handVersion: number, candidateId: string) {
    this.calls.push({ kind: "activate", args: [handVersion, candidateId] });
    return true;
  }

  useSkill(instanceId: string) {
    this.calls.push({ kind: "skill", args: [instanceId] });
    return true;
  }

  setRematchReady(ready: boolean) {
    this.calls.push({ kind: "rematch", args: [ready] });
    return true;
  }

  leave() {
    this.calls.push({ kind: "leave", args: [] });
  }

  push(match: VisibleMatchSnapshot, patch: Partial<LobbyClientSnapshot> = {}) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      room: roomFixture(match),
      stateVersion: patch.stateVersion ?? this.snapshot.stateVersion + 1,
    };
    this.listeners.forEach((listener) => listener());
  }
}

function controllerFor(session: FakeSession) {
  return new PvpGameController(session as unknown as OnlineLobbySession);
}

describe("PvpGameController", () => {
  it("projects only public seat-oriented match state", () => {
    const session = new FakeSession();
    const controller = controllerFor(session);
    const state = controller.getSnapshot();

    expect(state.player.playerId).toBe("p1");
    expect(state.enemy.playerId).toBe("p2");
    expect(state.player.deck.hand[0]).toMatchObject({ id: "p1-h2", suit: "hearts", rank: 2 });
    expect(state.player.deck.box).toEqual([]);
    expect(state.enemy.deck.box).toEqual([]);
    expect(state.playerCandidates[0]).toMatchObject({ candidateId: "pair-2", damage: 8 });
    expect(state.config.seed).toBe("LAN-PVP-PUBLIC-VIEW");
    expect(state.config.matchDurationMs).toBe(180_000);
    expect(state.matchStartedAt).toBe(0);
    expect(state.matchEndsAt).toBe(180_000);
    expect(controller.localDisplayName).toBe("Alice");
    expect(controller.opponentDisplayName).toBe("Bob");
    expect(controller.connection).toBe("connected");
    expect(controller.opponentConnected).toBe(true);
    expect(controller.roomCode).toBe("ABC789");
  });

  it("uses identifier-only card backs while countdown hands are hidden", () => {
    const hiddenMatch = matchFixture({
      phase: "countdown",
      nowMs: 0,
      countdownEndsAt: 5_000,
      self: { ...matchFixture().self, hand: null, candidates: [] },
      opponent: { ...matchFixture().opponent, hand: null, candidates: [] },
    });
    const controller = controllerFor(new FakeSession(hiddenMatch));
    const state = controller.getSnapshot();
    const text = JSON.parse(controller.renderText()) as {
      player: { hand: Array<Record<string, unknown>> };
      enemy: { hand: Array<Record<string, unknown>> };
    };

    expect(state.player.deck.hand).toHaveLength(5);
    expect(state.player.deck.hand.every((card) => card.id.startsWith("hidden-"))).toBe(true);
    expect(state.player.deck.box).toEqual([]);
    expect(text.player.hand).toHaveLength(5);
    expect(text.player.hand.every((card) => card.faceUp === false && !("rank" in card) && !("suit" in card))).toBe(true);
    expect(text.enemy.hand.every((card) => !("rank" in card) && !("suit" in card))).toBe(true);
  });

  it("keeps selection local and sends versioned authoritative commands", () => {
    const session = new FakeSession();
    const controller = controllerFor(session);

    expect(controller.toggleCard("p1-h2")).toBe(true);
    expect(controller.discardSelected()).toBe(true);
    expect(controller.activatePlayerHand("pair-2")).toBe(true);
    expect(controller.usePlayerSkill("heal-1")).toBe(true);
    controller.rematch();

    expect(session.calls).toEqual([
      { kind: "redraw", args: [3, ["p1-h2"]] },
      { kind: "activate", args: [3, "pair-2"] },
      { kind: "skill", args: ["heal-1"] },
      { kind: "rematch", args: [true] },
    ]);

    const next = matchFixture({
      self: {
        ...matchFixture().self,
        handVersion: 4,
        hand: matchFixture().self.hand?.map((card, index) => index === 0
          ? { id: "p1-c10", suit: "clubs", rank: 10 }
          : card) ?? null,
      },
    });
    session.push(next);
    expect(controller.getSnapshot().selectedCardIds).toEqual([]);
  });

  it("emits each network attack, skill drop, and result event once", () => {
    const session = new FakeSession();
    const controller = controllerFor(session);
    const events: GameEvent[] = [];
    controller.subscribeToEvents((event) => events.push(event));

    const next = matchFixture({
      activeAttacks: [{
        id: "attack-9",
        source: "opponent",
        cards: [matchFixture().opponent.hand![0]],
        damage: 12,
        startedAt: 10_050,
        blocked: false,
      }],
      skillDrop: {
        id: "drop-3",
        type: "BLOCK",
        appearedAt: 10_050,
        expiresAt: 20_050,
        claimResolveAt: null,
        claimants: [],
      },
      result: "LOSE",
      endReason: "TIME_UP",
      phase: "result",
    });
    session.push(next);
    session.push(next);

    expect(events.filter((event) => event.type === "attackSound")).toEqual([{
      type: "attackSound",
      side: "enemy",
      cardCount: 1,
      damage: 12,
      blocked: false,
    }]);
    expect(events.filter((event) => event.type === "sound" && event.sound === "skillDrop")).toHaveLength(1);
    expect(events.filter((event) => event.type === "matchResult")).toEqual([{ type: "matchResult", result: "LOSE" }]);
    expect(controller.getSnapshot().endReason).toBe("TIME_UP");
  });

  it("emits the actual HEAL visual amount from an authoritative update", () => {
    const base = matchFixture();
    const before = matchFixture({
      self: { ...base.self, hp: 90, skills: [{ instanceId: "heal-1", type: "HEAL" }] },
    });
    const session = new FakeSession(before);
    const controller = controllerFor(session);
    const events: GameEvent[] = [];
    controller.subscribeToEvents((event) => events.push(event));

    session.push(matchFixture({
      self: {
        ...before.self,
        hp: 100,
        skills: [],
        skillCooldownUntilMs: before.nowMs + 1_000,
      },
    }));

    expect(events.filter((event) => event.type === "healVisual")).toEqual([
      { type: "healVisual", side: "player", amount: 10 },
    ]);
    expect(events.some((event) => event.type === "sound" && event.sound === "heal")).toBe(true);
  });

  it("does not emit a HEAL visual when the skill is consumed at full HP", () => {
    const before = matchFixture();
    const session = new FakeSession(before);
    const controller = controllerFor(session);
    const events: GameEvent[] = [];
    controller.subscribeToEvents((event) => events.push(event));

    session.push(matchFixture({
      self: {
        ...before.self,
        hp: 100,
        skills: [],
        skillCooldownUntilMs: before.nowMs + 1_000,
      },
    }));

    expect(events.some((event) => event.type === "healVisual")).toBe(false);
    expect(events.some((event) => event.type === "sound" && event.sound === "noEffect")).toBe(true);
  });

  it("reports LAN state and disposes the owned session once", () => {
    const session = new FakeSession();
    const controller = controllerFor(session);
    const text = JSON.parse(controller.renderText()) as Record<string, unknown>;
    expect(text).toMatchObject({
      mode: "lan-pvp",
      roomCode: "ABC789",
      connection: "connected",
      stateVersion: 4,
      serverNowMs: 1_000_000,
      matchRemainingMs: 170_000,
      endReason: null,
    });

    controller.dispose();
    controller.dispose();
    expect(session.calls.filter((call) => call.kind === "leave")).toHaveLength(1);
  });
});
