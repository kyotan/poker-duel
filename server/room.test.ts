import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  normalizeDisplayName,
  normalizeRoomCode,
  parseClientCommand,
  type ClientCommand,
} from "../src/shared/protocol.ts";
import { RoomDirectory, RoomError } from "./room.ts";

class FakeTimer {
  nowMs = 1_000;
  private serial = 0;
  private jobs = new Map<number, { at: number; callback: () => void }>();

  readonly now = () => this.nowMs;

  readonly set = (callback: () => void, delayMs: number) => {
    const id = ++this.serial;
    this.jobs.set(id, { at: this.nowMs + delayMs, callback });
    return id;
  };

  readonly clear = (handle: unknown) => {
    this.jobs.delete(handle as number);
  };

  advance(milliseconds: number) {
    const target = this.nowMs + milliseconds;
    while (true) {
      const next = [...this.jobs.entries()]
        .filter(([, job]) => job.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.jobs.delete(next[0]);
      this.nowMs = next[1].at;
      next[1].callback();
    }
    this.nowMs = target;
  }

  runNextLate(delayMs: number) {
    const next = [...this.jobs.entries()].sort((left, right) => left[1].at - right[1].at)[0];
    if (!next) throw new Error("No timer job is queued.");
    this.jobs.delete(next[0]);
    this.nowMs = next[1].at + delayMs;
    next[1].callback();
  }
}

function tokenFactory() {
  let serial = 0;
  return () => `test-token-${++serial}`;
}

function command(kind: ClientCommand["kind"], seq: number, payload: Record<string, unknown> = {}): ClientCommand {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind,
    commandId: `command-${seq}`,
    seq,
    roundId: "lobby",
    payload,
  } as unknown as ClientCommand;
}

function matchCommand(
  kind: "hand.redraw" | "hand.activate" | "skill.use",
  seq: number,
  payload: Record<string, unknown>,
  roundId: `round-${number}` = "round-1",
): ClientCommand {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind,
    commandId: `match-command-${seq}`,
    seq,
    roundId,
    payload,
  } as unknown as ClientCommand;
}

function rematchCommand(seq: number, roundId: `round-${number}` = "round-1"): ClientCommand {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "rematch.ready",
    commandId: `rematch-command-${seq}`,
    seq,
    roundId,
    payload: { ready: true },
  };
}

function connectedRoom(countdownMs = 5_000) {
  const timer = new FakeTimer();
  const directory = new RoomDirectory({
    countdownMs,
    timer,
    roomCodeFactory: () => "ABC789",
    tokenFactory: tokenFactory(),
    matchSeedFactory: () => "SERVER-RUNTIME-TEST",
  });
  const host = directory.createRoom("Host");
  const guest = directory.joinRoom("abc-789", "Guest");
  directory.consumeSocketTicket(host.roomCode, host.socketTicket);
  directory.consumeSocketTicket(guest.roomCode, guest.socketTicket);
  directory.connect(host.roomCode, host.playerId);
  directory.connect(guest.roomCode, guest.playerId);
  return { directory, timer, host, guest };
}

function playingRoom(countdownMs = 200) {
  const room = connectedRoom(countdownMs);
  room.directory.applyCommand(room.host.roomCode, room.host.playerId, command("ready.set", 1, { ready: true }));
  room.directory.applyCommand(room.guest.roomCode, room.guest.playerId, command("ready.set", 1, { ready: true }));
  room.timer.advance(countdownMs);
  expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.phase).toBe("playing");
  return room;
}

function ensureHostCandidate(
  room: ReturnType<typeof playingRoom>,
  startingSeq = 2,
) {
  let seq = startingSeq;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match;
    if (!match) throw new Error("Match snapshot is missing.");
    const candidate = [...match.self.candidates].sort((left, right) => left.damage - right.damage)[0];
    if (candidate) return { match, candidate, nextSeq: seq };
    const cardIds = match.self.hand?.map((card) => card.id) ?? [];
    const result = room.directory.applyCommand(
      room.host.roomCode,
      room.host.playerId,
      matchCommand("hand.redraw", seq++, { handVersion: match.self.handVersion, cardIds }),
    );
    expect(result.ok).toBe(true);
    room.timer.advance(match.publicConfig.redrawCooldownMs);
  }
  throw new Error("Could not produce a role candidate from deterministic redraws.");
}

describe("LAN lobby protocol", () => {
  it("normalizes room input, display names, and validates commands", () => {
    expect(normalizeRoomCode("abc-789")).toBe("ABC789");
    expect(normalizeRoomCode("https://example.test/game?room=jk-m234")).toBe("JKM234");
    expect(normalizeDisplayName("  Player  ")).toBe("Player");
    expect(normalizeDisplayName(" ")).toBeNull();

    expect(parseClientCommand(command("ready.set", 1, { ready: true })).ok).toBe(true);
    expect(parseClientCommand({ ...command("ready.set", 1), protocolVersion: 99 })).toEqual({
      ok: false,
      reason: "UNSUPPORTED_PROTOCOL",
    });
    expect(parseClientCommand({ ...command("ready.set", 1), payload: { ready: "yes" } })).toEqual({
      ok: false,
      reason: "INVALID_MESSAGE",
    });
  });

  it("creates a room, reserves two seats, and consumes one-time socket tickets", () => {
    const { directory, host, guest } = connectedRoom();
    const snapshot = directory.snapshot(host.roomCode);
    expect(snapshot.state.phase).toBe("waiting_for_ready");
    expect(snapshot.state.players).toEqual([
      expect.objectContaining({ playerId: host.playerId, displayName: "Host", seat: 1, connected: true }),
      expect.objectContaining({ playerId: guest.playerId, displayName: "Guest", seat: 2, connected: true }),
    ]);
    expect(() => directory.consumeSocketTicket(host.roomCode, host.socketTicket)).toThrowError(RoomError);
    expect(() => directory.joinRoom(host.roomCode, "Third")).toThrowError(
      expect.objectContaining({ code: "ROOM_FULL" }),
    );
    directory.dispose();
  });

  it("starts one server-timed countdown after both players become ready", () => {
    const { directory, timer, host, guest } = connectedRoom();
    const phases: string[] = [];
    directory.subscribe((_roomCode, snapshot) => phases.push(snapshot.state.phase));

    expect(directory.applyCommand(host.roomCode, host.playerId, command("ready.set", 1, { ready: true })).ok).toBe(
      true,
    );
    expect(directory.snapshot(host.roomCode).state.phase).toBe("waiting_for_ready");
    expect(directory.applyCommand(guest.roomCode, guest.playerId, command("ready.set", 1, { ready: true })).ok).toBe(
      true,
    );

    const countdown = directory.snapshot(host.roomCode);
    expect(countdown.state.phase).toBe("countdown");
    expect(countdown.state.countdownEndsAt).toBe(6_000);
    timer.advance(4_999);
    expect(directory.snapshot(host.roomCode).state.phase).toBe("countdown");
    timer.advance(1);
    expect(directory.snapshot(host.roomCode).state.phase).toBe("playing");
    expect(phases.at(-1)).toBe("playing");
    directory.dispose();
  });

  it("cancels countdown and clears readiness when a player disconnects", () => {
    const { directory, host, guest } = connectedRoom();
    directory.applyCommand(host.roomCode, host.playerId, command("ready.set", 1, { ready: true }));
    directory.applyCommand(guest.roomCode, guest.playerId, command("ready.set", 1, { ready: true }));
    expect(directory.snapshot(host.roomCode).state.phase).toBe("countdown");

    directory.disconnect(guest.roomCode, guest.playerId);
    const snapshot = directory.snapshot(host.roomCode);
    expect(snapshot.state.phase).toBe("waiting_for_ready");
    expect(snapshot.state.countdownEndsAt).toBeNull();
    expect(snapshot.state.players.every((player) => !player.ready)).toBe(true);
    expect(snapshot.state.players.find((player) => player.playerId === guest.playerId)?.connected).toBe(false);
    directory.dispose();
  });

  it("deduplicates commandId and rejects stale sequence numbers", () => {
    const { directory, host } = connectedRoom();
    const first = command("ready.set", 5, { ready: true });
    expect(directory.applyCommand(host.roomCode, host.playerId, first)).toMatchObject({ ok: true, duplicate: false });
    const version = directory.snapshot(host.roomCode).stateVersion;
    expect(directory.applyCommand(host.roomCode, host.playerId, first)).toMatchObject({ ok: true, duplicate: true });
    expect(directory.snapshot(host.roomCode).stateVersion).toBe(version);
    expect(directory.applyCommand(host.roomCode, host.playerId, command("sync.request", 4))).toMatchObject({
      ok: false,
      reason: "STALE_SEQUENCE",
    });
    directory.dispose();
  });

  it("rotates the resume token before issuing a replacement socket ticket", () => {
    const { directory, host } = connectedRoom();
    directory.disconnect(host.roomCode, host.playerId);
    const resumed = directory.resumeRoom(host.roomCode, host.playerId, host.resumeToken);
    expect(resumed.resumeToken).not.toBe(host.resumeToken);
    expect(directory.consumeSocketTicket(resumed.roomCode, resumed.socketTicket).playerId).toBe(host.playerId);
    expect(() => directory.resumeRoom(host.roomCode, host.playerId, host.resumeToken)).toThrowError(
      expect.objectContaining({ code: "RESUME_DENIED" }),
    );
    directory.dispose();
  });

  it("orients a sanitized visible match for each seat and hides cards during countdown", () => {
    const { directory, timer, host, guest } = connectedRoom(200);
    directory.applyCommand(host.roomCode, host.playerId, command("ready.set", 1, { ready: true }));
    directory.applyCommand(guest.roomCode, guest.playerId, command("ready.set", 1, { ready: true }));

    const hostCountdown = directory.snapshot(host.roomCode, host.playerId);
    const guestCountdown = directory.snapshot(guest.roomCode, guest.playerId);
    expect(hostCountdown.state.match?.self.playerId).toBe(host.playerId);
    expect(hostCountdown.state.match?.opponent.playerId).toBe(guest.playerId);
    expect(guestCountdown.state.match?.self.playerId).toBe(guest.playerId);
    expect(guestCountdown.state.match?.opponent.playerId).toBe(host.playerId);
    expect(hostCountdown.state.match?.self.hand).toBeNull();
    expect(hostCountdown.state.match?.opponent.hand).toBeNull();

    const wire = JSON.stringify(hostCountdown);
    expect(wire).not.toContain('"box"');
    expect(wire).not.toContain('"seed"');
    expect(wire).not.toContain("skillWeights");
    expect(wire).not.toContain("forcedNextSkill");
    expect(wire).not.toContain("resumeToken");

    timer.advance(200);
    const playing = directory.snapshot(host.roomCode, host.playerId).state.match;
    expect(playing?.self.hand).toHaveLength(5);
    expect(playing?.opponent.hand).toHaveLength(5);
    expect(playing?.publicConfig.matchDurationMs).toBe(180_000);
    expect(playing?.matchEndsAt).toBe(playing!.nowMs + 180_000);
    expect(playing?.endReason).toBeNull();
    directory.dispose();
  });

  it("ends a tied round at the server-authoritative three-minute boundary", () => {
    const room = playingRoom(50);
    const started = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(started.matchEndsAt).toBe(started.nowMs + 180_000);

    room.timer.advance(started.publicConfig.matchDurationMs - 1);
    const justBefore = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(justBefore.phase).toBe("playing");
    expect(justBefore.result).toBeNull();

    room.timer.advance(1);
    const hostResult = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    const guestResult = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state.match!;
    expect(hostResult.phase).toBe("result");
    expect(hostResult.nowMs).toBe(hostResult.matchEndsAt);
    expect(hostResult.result).toBe("DRAW");
    expect(guestResult.result).toBe("DRAW");
    expect(hostResult.endReason).toBe("TIME_UP");
    expect(guestResult.endReason).toBe("TIME_UP");
    room.directory.dispose();
  });

  it("clamps a delayed server tick to the match deadline", () => {
    const room = playingRoom(50);
    const started = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    room.timer.advance(started.publicConfig.matchDurationMs - 100);
    room.timer.runNextLate(75);

    const result = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(result.phase).toBe("result");
    expect(result.nowMs).toBe(result.matchEndsAt);
    expect(result.result).toBe("DRAW");
    expect(result.endReason).toBe("TIME_UP");
    room.directory.dispose();
  });

  it("awards the timeout win to the seat with more HP", () => {
    const room = playingRoom(50);
    const prepared = ensureHostCandidate(room);
    expect(
      room.directory.applyCommand(
        room.host.roomCode,
        room.host.playerId,
        matchCommand("hand.activate", prepared.nextSeq, {
          handVersion: prepared.match.self.handVersion,
          candidateId: prepared.candidate.candidateId,
        }),
      ).ok,
    ).toBe(true);
    room.timer.advance(100);

    const damaged = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(damaged.self.hp).toBeGreaterThan(damaged.opponent.hp);
    room.timer.advance(damaged.matchEndsAt! - damaged.nowMs);

    const hostResult = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    const guestResult = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state.match!;
    expect(hostResult.result).toBe("WIN");
    expect(guestResult.result).toBe("LOSE");
    expect(hostResult.endReason).toBe("TIME_UP");
    expect(guestResult.endReason).toBe("TIME_UP");
    room.directory.dispose();
  });

  it("freezes the three-minute deadline while a disconnected player is within grace", () => {
    const room = playingRoom(50);
    const beforePause = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    room.directory.disconnect(room.host.roomCode, room.host.playerId);
    room.timer.advance(10_000);

    const paused = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state.match!;
    expect(paused.nowMs).toBe(beforePause.nowMs);
    expect(paused.matchEndsAt).toBe(beforePause.matchEndsAt);
    expect(paused.result).toBeNull();

    room.directory.connect(room.host.roomCode, room.host.playerId);
    room.timer.advance(paused.matchEndsAt! - paused.nowMs - 1);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.phase).toBe("playing");
    room.timer.advance(1);
    const result = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(result.phase).toBe("result");
    expect(result.result).toBe("DRAW");
    expect(result.endReason).toBe("TIME_UP");
    room.directory.dispose();
  });

  it("accepts an attack immediately but applies its damage exactly once at the 100ms server window", () => {
    const room = playingRoom();
    const { match, candidate, nextSeq } = ensureHostCandidate(room);
    const hpBefore = match.opponent.hp;
    const activation = room.directory.applyCommand(
      room.host.roomCode,
      room.host.playerId,
      matchCommand("hand.activate", nextSeq, {
        handVersion: match.self.handVersion,
        candidateId: candidate.candidateId,
      }),
    );
    expect(activation.ok).toBe(true);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.opponent.hp).toBe(hpBefore);

    room.timer.advance(99);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.opponent.hp).toBe(hpBefore);
    room.timer.advance(1);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.opponent.hp).toBe(
      hpBefore - candidate.damage,
    );
    room.timer.advance(200);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.opponent.hp).toBe(
      hpBefore - candidate.damage,
    );
    room.directory.dispose();
  });

  it("synchronizes redraws in both orientations and rejects a stale hand version", () => {
    const room = playingRoom();
    const before = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    const oldVersion = before.self.handVersion;
    const cardId = before.self.hand![0].id;
    const redraw = matchCommand("hand.redraw", 2, { handVersion: oldVersion, cardIds: [cardId] });
    expect(room.directory.applyCommand(room.host.roomCode, room.host.playerId, redraw).ok).toBe(true);

    const hostView = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    const guestView = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state.match!;
    expect(hostView.self.handVersion).toBe(oldVersion + 1);
    expect(guestView.opponent.handVersion).toBe(hostView.self.handVersion);
    expect(guestView.opponent.hand).toEqual(hostView.self.hand);
    expect(
      room.directory.applyCommand(
        room.host.roomCode,
        room.host.playerId,
        matchCommand("hand.redraw", 3, { handVersion: oldVersion, cardIds: [hostView.self.hand![0].id] }),
      ),
    ).toMatchObject({ ok: false, reason: "STALE_HAND" });
    room.directory.dispose();
  });

  it("awards a dropped skill through a role and consumes it through skill.use", () => {
    const room = playingRoom();
    const prepared = ensureHostCandidate(room);
    const dropInMs = prepared.match.publicConfig.skillIntervalMs;
    room.timer.advance(dropInMs);
    const dropSnapshot = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(dropSnapshot.skillDrop).not.toBeNull();
    const candidate = [...dropSnapshot.self.candidates].sort((left, right) => left.damage - right.damage)[0];
    expect(candidate).toBeDefined();

    expect(
      room.directory.applyCommand(
        room.host.roomCode,
        room.host.playerId,
        matchCommand("hand.activate", prepared.nextSeq, {
          handVersion: dropSnapshot.self.handVersion,
          candidateId: candidate.candidateId,
        }),
      ).ok,
    ).toBe(true);
    room.timer.advance(dropSnapshot.publicConfig.claimWindowMs);
    const claimed = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(claimed.self.skills).toHaveLength(1);
    const skill = claimed.self.skills[0];
    expect(
      room.directory.applyCommand(
        room.host.roomCode,
        room.host.playerId,
        matchCommand("skill.use", prepared.nextSeq + 1, { instanceId: skill.instanceId }),
      ).ok,
    ).toBe(true);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.self.skills).toHaveLength(0);
    room.directory.dispose();
  });

  it("clears the first READY latch and starts a fresh PvP round after both rematch.ready commands", () => {
    const room = playingRoom();
    let hostSeq = 2;
    for (let action = 0; action < 100; action += 1) {
      const match = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
      if (match.phase === "result") break;
      const candidate = [...match.self.candidates].sort((left, right) => left.damage - right.damage)[0];
      if (candidate) {
        expect(
          room.directory.applyCommand(
            room.host.roomCode,
            room.host.playerId,
            matchCommand("hand.activate", hostSeq++, {
              handVersion: match.self.handVersion,
              candidateId: candidate.candidateId,
            }),
          ).ok,
        ).toBe(true);
        room.timer.advance(match.publicConfig.attackCooldownMs);
      } else {
        expect(
          room.directory.applyCommand(
            room.host.roomCode,
            room.host.playerId,
            matchCommand("hand.redraw", hostSeq++, {
              handVersion: match.self.handVersion,
              cardIds: match.self.hand!.map((card) => card.id),
            }),
          ).ok,
        ).toBe(true);
        room.timer.advance(match.publicConfig.redrawCooldownMs);
      }
    }

    const resultState = room.directory.snapshot(room.host.roomCode, room.host.playerId).state;
    expect(resultState.phase).toBe("result");
    expect(resultState.players.every((player) => !player.ready)).toBe(true);
    expect(room.directory.applyCommand(room.host.roomCode, room.host.playerId, rematchCommand(hostSeq++)).ok).toBe(true);
    expect(room.directory.snapshot(room.host.roomCode).state.phase).toBe("result");
    expect(room.directory.applyCommand(room.guest.roomCode, room.guest.playerId, rematchCommand(2)).ok).toBe(true);

    const rematch = room.directory.snapshot(room.host.roomCode, room.host.playerId).state;
    expect(rematch.phase).toBe("countdown");
    expect(rematch.match?.roundId).toBe("round-2");
    expect(rematch.match?.self.hand).toBeNull();
    expect(rematch.players.every((player) => !player.ready)).toBe(true);
    room.directory.dispose();
  });

  it("pauses the match clock and awards a forfeit at the 30-second disconnect boundary", () => {
    const room = playingRoom();
    const before = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    room.directory.disconnect(room.host.roomCode, room.host.playerId);
    expect(room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state.phase).toBe("paused");

    room.timer.advance(29_999);
    const justBefore = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state;
    expect(justBefore.phase).toBe("paused");
    expect(justBefore.match?.nowMs).toBe(before.nowMs);
    expect(justBefore.match?.result).toBeNull();

    room.timer.advance(1);
    const guestResult = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state;
    const hostResult = room.directory.snapshot(room.host.roomCode, room.host.playerId).state;
    expect(guestResult.phase).toBe("result");
    expect(guestResult.match?.result).toBe("WIN");
    expect(hostResult.match?.result).toBe("LOSE");
    room.directory.dispose();
  });

  it("cancels the disconnect deadline and resumes without adding offline wall time", () => {
    const room = playingRoom();
    const before = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    room.directory.disconnect(room.host.roomCode, room.host.playerId);
    room.timer.advance(29_999);
    room.directory.connect(room.host.roomCode, room.host.playerId);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.phase).toBe("playing");

    room.timer.advance(1);
    const resumed = room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match!;
    expect(resumed.phase).toBe("playing");
    expect(resumed.result).toBeNull();
    expect(resumed.nowMs).toBe(before.nowMs);
    room.timer.advance(50);
    expect(room.directory.snapshot(room.host.roomCode, room.host.playerId).state.match?.nowMs).toBe(before.nowMs + 50);
    room.directory.dispose();
  });

  it("treats an explicit leave during play as an immediate forfeit", () => {
    const room = playingRoom();
    const left = room.directory.applyCommand(
      room.host.roomCode,
      room.host.playerId,
      command("room.leave", 2),
    );
    expect(left).toMatchObject({ ok: true, leftRoom: true });

    const guestView = room.directory.snapshot(room.guest.roomCode, room.guest.playerId).state;
    const hostView = room.directory.snapshot(room.host.roomCode, room.host.playerId).state;
    expect(guestView.phase).toBe("result");
    expect(guestView.match?.result).toBe("WIN");
    expect(hostView.match?.result).toBe("LOSE");
    expect(guestView.match?.endReason).toBe("FORFEIT");
    expect(hostView.match?.endReason).toBe("FORFEIT");
    expect(guestView.players.find((player) => player.playerId === room.host.playerId)?.connected).toBe(false);
    expect(() => room.directory.resumeRoom(room.host.roomCode, room.host.playerId, room.host.resumeToken)).toThrowError(
      expect.objectContaining({ code: "RESUME_DENIED" }),
    );
    room.directory.dispose();
  });
});
