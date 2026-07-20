import { describe, expect, it } from "vitest";

import { validateDeckState } from "../game";
import { CPU_SPEED_PRESETS, GameController, getMatchRemainingMs, type GameEvent } from "./GameController";

const pairHand = [
  { suit: "spades", rank: 10 },
  { suit: "hearts", rank: 10 },
  { suit: "diamonds", rank: 3 },
  { suit: "clubs", rank: 7 },
  { suit: "spades", rank: 13 },
] as const;

describe("CPU speed presets", () => {
  it.each([
    { strength: "normal" as const, min: 900, max: 1_400 },
    { strength: "strong" as const, min: 450, max: 800 },
  ])("applies the $strength think-time range before the first action", ({ strength, min, max }) => {
    const controller = new GameController();
    controller.applyConfig(CPU_SPEED_PRESETS[strength]);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "waiting_start",
      config: { cpuThinkMinMs: min, cpuThinkMaxMs: max },
    });

    expect(controller.startMatch()).toBe(true);
    controller.advanceTime(5_000);
    const snapshot = controller.getSnapshot();
    const waitMs = snapshot.nextCpuActionAt - snapshot.nowMs;

    expect(snapshot.phase).toBe("playing");
    expect(waitMs).toBeGreaterThanOrEqual(min);
    expect(waitMs).toBeLessThanOrEqual(max);
  });

  it("keeps a selected preset when starting a rematch", () => {
    const controller = new GameController();
    controller.applyConfig(CPU_SPEED_PRESETS.strong);
    controller.debugReset({ phase: "playing", cpuPaused: true });
    expect(controller.forfeitSide("enemy")).toBe(true);

    controller.rematch();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "waiting_start",
      config: CPU_SPEED_PRESETS.strong,
    });
  });
});

describe("HEAL visual events", () => {
  it("emits the actual recovered HP for a capped heal", () => {
    const controller = new GameController();
    const events: GameEvent[] = [];
    controller.debugReset({
      phase: "playing",
      player: { hp: 90, skills: ["HEAL"] },
      cpuPaused: true,
    });
    controller.subscribeToEvents((event) => events.push(event));

    expect(controller.usePlayerSkill(controller.getSnapshot().player.skills[0].instanceId)).toBe(true);

    expect(controller.getSnapshot().player.hp).toBe(100);
    expect(events.filter((event) => event.type === "healVisual")).toEqual([
      { type: "healVisual", side: "player", amount: 10 },
    ]);
  });

  it("consumes HEAL at full HP without playing a recovery visual", () => {
    const controller = new GameController();
    const events: GameEvent[] = [];
    controller.debugReset({
      phase: "playing",
      player: { hp: 100, skills: ["HEAL"] },
      cpuPaused: true,
    });
    controller.subscribeToEvents((event) => events.push(event));

    expect(controller.usePlayerSkill(controller.getSnapshot().player.skills[0].instanceId)).toBe(true);

    expect(controller.getSnapshot().player.skills).toHaveLength(0);
    expect(events.some((event) => event.type === "healVisual")).toBe(false);
    expect(events.some((event) => event.type === "sound" && event.sound === "noEffect")).toBe(true);
  });
});

describe("PvP controller entry points", () => {
  it("prepares a CPU-free match and accepts redraws from both seats", () => {
    const controller = new GameController();
    controller.preparePvp("lan-room-ABC789");

    expect(controller.getSnapshot().phase).toBe("waiting_start");
    expect(controller.getSnapshot().cpuPaused).toBe(true);
    expect(controller.startMatch()).toBe(true);
    controller.advanceTime(5_000);

    const before = controller.getSnapshot();
    expect(before.phase).toBe("playing");
    expect(controller.redrawSide("player", [before.player.deck.hand[0].id])).toBe(true);
    const afterPlayer = controller.getSnapshot();
    expect(controller.redrawSide("enemy", [afterPlayer.enemy.deck.hand[0].id])).toBe(true);
    const after = controller.getSnapshot();

    expect(after.player.deck.handVersion).toBe(before.player.deck.handVersion + 1);
    expect(after.enemy.deck.handVersion).toBe(before.enemy.deck.handVersion + 1);
    expect(validateDeckState(after.player.deck)).toEqual([]);
    expect(validateDeckState(after.enemy.deck)).toEqual([]);
  });

  it("resolves attacks from both PvP seats in the same 100ms window", () => {
    const controller = new GameController();
    controller.debugReset({
      phase: "playing",
      player: { hp: 100, hand: pairHand },
      enemy: { hp: 100, hand: pairHand },
      cpuPaused: true,
    });
    const before = controller.getSnapshot();
    const playerPair = before.playerCandidates.find((candidate) => candidate.type === "one_pair");
    const enemyPair = before.enemyCandidates.find((candidate) => candidate.type === "one_pair");

    expect(controller.activateSideHand("player", playerPair?.candidateId ?? "missing")).toBe(true);
    expect(controller.getSnapshot().enemy.hp).toBe(100);
    controller.advanceTime(50);
    expect(controller.activateSideHand("enemy", enemyPair?.candidateId ?? "missing")).toBe(true);
    expect(controller.getSnapshot().player.hp).toBe(100);
    controller.advanceTime(49);
    expect(controller.getSnapshot().player.hp).toBe(100);
    expect(controller.getSnapshot().enemy.hp).toBe(100);
    controller.advanceTime(1);

    const after = controller.getSnapshot();
    expect(after.player.hp).toBe(95);
    expect(after.enemy.hp).toBe(95);
    expect(after.activeAttacks).toHaveLength(2);
  });

  it("allows the remote seat to use a stocked skill", () => {
    const controller = new GameController();
    controller.debugReset({
      phase: "playing",
      enemy: { skills: ["STOP"] },
      cpuPaused: true,
    });
    const skill = controller.getSnapshot().enemy.skills[0];

    expect(controller.useSideSkill("enemy", skill.instanceId)).toBe(true);
    const after = controller.getSnapshot();
    expect(after.enemy.skills).toHaveLength(0);
    expect(after.player.stopUntilMs - after.nowMs).toBe(10_000);
  });

  it("ends an active PvP round when a disconnected seat forfeits", () => {
    const controller = new GameController();
    controller.debugReset({ phase: "playing", cpuPaused: true });

    expect(controller.forfeitSide("enemy")).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: "result", result: "WIN", endReason: "FORFEIT" });
    expect(controller.forfeitSide("player")).toBe(false);
  });
});

describe("three-minute match timer", () => {
  it("starts the 180-second limit only when the five-second deal countdown finishes", () => {
    const controller = new GameController();
    controller.preparePvp("timer-boundary-test");

    expect(controller.startMatch()).toBe(true);
    controller.advanceTime(4_999);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "countdown",
      matchStartedAt: null,
      matchEndsAt: null,
    });
    expect(getMatchRemainingMs(controller.getSnapshot())).toBe(0);

    controller.advanceTime(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "playing",
      nowMs: 5_000,
      matchStartedAt: 5_000,
      matchEndsAt: 185_000,
    });
    expect(getMatchRemainingMs(controller.getSnapshot())).toBe(180_000);

    controller.advanceTime(169_999);
    expect(getMatchRemainingMs(controller.getSnapshot())).toBe(10_001);
    controller.advanceTime(1);
    expect(getMatchRemainingMs(controller.getSnapshot())).toBe(10_000);
    expect(controller.getSnapshot().phase).toBe("playing");
  });

  it.each([
    { playerHp: 80, enemyHp: 70, result: "WIN" as const },
    { playerHp: 60, enemyHp: 90, result: "LOSE" as const },
    { playerHp: 75, enemyHp: 75, result: "DRAW" as const },
  ])("uses current HP at time-up: $result", ({ playerHp, enemyHp, result }) => {
    const controller = new GameController();
    controller.applyConfig({ matchDurationMs: 1_000 });
    controller.debugReset({
      phase: "playing",
      player: { hp: playerHp },
      enemy: { hp: enemyHp },
      cpuPaused: true,
    });

    controller.advanceTime(999);
    expect(controller.getSnapshot().phase).toBe("playing");
    expect(getMatchRemainingMs(controller.getSnapshot())).toBe(1);

    controller.advanceTime(1);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "result",
      result,
      endReason: "TIME_UP",
    });
    expect(getMatchRemainingMs(controller.getSnapshot())).toBe(0);
  });

  it("resolves an attack due exactly at the deadline before comparing HP", () => {
    const controller = new GameController();
    controller.applyConfig({ matchDurationMs: 1_000 });
    controller.debugReset({
      phase: "playing",
      player: { hp: 95, hand: pairHand },
      enemy: { hp: 100 },
      cpuPaused: true,
    });
    controller.advanceTime(900);
    const pair = controller.getSnapshot().playerCandidates.find((candidate) => candidate.type === "one_pair");

    expect(controller.activatePlayerHand(pair?.candidateId ?? "missing")).toBe(true);
    controller.advanceTime(100);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "result",
      result: "DRAW",
      endReason: "TIME_UP",
      player: { hp: 95 },
      enemy: { hp: 95 },
    });
  });

  it("keeps a zero-HP finish distinguishable from time-up", () => {
    const controller = new GameController();
    controller.debugReset({
      phase: "playing",
      player: { hp: 100, hand: pairHand },
      enemy: { hp: 5 },
      cpuPaused: true,
    });
    const pair = controller.getSnapshot().playerCandidates.find((candidate) => candidate.type === "one_pair");

    expect(controller.activatePlayerHand(pair?.candidateId ?? "missing")).toBe(true);
    controller.advanceTime(100);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "result",
      result: "WIN",
      endReason: "KO",
      enemy: { hp: 0 },
    });
  });
});
