import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKILL_WEIGHTS,
  SeededRandom,
  addSkillToStock,
  cardId,
  chooseCpuAction,
  chooseCpuSkill,
  createDeckState,
  createPlayerState,
  createSkill,
  evaluateHand,
  redrawCards,
  resolveHandActivation,
  resolveRedraw,
  resolveSimultaneousDamage,
  resolveSkillUse,
  validateDeckState,
  type Card,
  type CardRank,
  type RandomSource,
  type Suit,
} from "./index";

function makeCard(ownerId: string, suit: Suit, rank: CardRank): Card {
  return { id: cardId(ownerId, suit, rank), ownerId, suit, rank };
}

function makeHand(ownerId: string, entries: readonly [Suit, CardRank][]): Card[] {
  return entries.map(([suit, rank]) => makeCard(ownerId, suit, rank));
}

class SequenceRandom implements RandomSource {
  private index = 0;

  constructor(private readonly values: readonly number[]) {}

  next(): number {
    const result = this.values[Math.min(this.index, this.values.length - 1)] ?? 0;
    this.index += 1;
    return result;
  }
}

describe("seeded cards", () => {
  it("deals reproducibly and keeps each player's 52 cards independent", () => {
    const first = createDeckState("player", new SeededRandom("match-42"));
    const replay = createDeckState("player", new SeededRandom("match-42"));
    const enemy = createDeckState("enemy", new SeededRandom("match-42"));

    expect(first.hand.map((card) => card.id)).toEqual(replay.hand.map((card) => card.id));
    expect(validateDeckState(first)).toEqual([]);
    expect(validateDeckState(enemy)).toEqual([]);
    expect(new Set([...first.hand, ...first.box].map((card) => card.id)).size).toBe(52);
    expect(new Set([...enemy.hand, ...enemy.box].map((card) => card.id)).size).toBe(52);
    expect(first.hand[0].id).not.toBe(enemy.hand[0].id);
  });

  it("returns, shuffles once, refills, and permits an immediate redraw of the same card", () => {
    const initial = createDeckState("player", new SeededRandom(7));
    const returnedId = initial.hand[0].id;
    // First Fisher-Yates sample moves the returned final element to index 0;
    // all remaining samples leave their elements in place.
    const random = new SequenceRandom([0, ...Array.from({ length: 46 }, () => 0.999_999)]);
    const update = redrawCards(initial, [returnedId], random);

    expect(update.drawnCards[0].id).toBe(returnedId);
    expect(update.state.hand).toHaveLength(5);
    expect(update.state.box).toHaveLength(47);
    expect(update.state.handVersion).toBe(initial.handVersion + 1);
    expect(validateDeckState(update.state)).toEqual([]);
  });
});

describe("role enumeration", () => {
  it("returns two distinct pairs and their two-pair candidate", () => {
    const hand = makeHand("p", [
      ["spades", 10],
      ["diamonds", 10],
      ["clubs", 8],
      ["hearts", 8],
      ["spades", 13],
    ]);
    const candidates = evaluateHand(hand);

    expect(candidates.map((entry) => entry.type)).toEqual(["one_pair", "one_pair", "two_pair"]);
    expect(candidates.map((entry) => entry.label)).toEqual(["PAIR 10", "PAIR 8", "TWO PAIR 10/8"]);
    expect(candidates.map((entry) => entry.damage)).toEqual([5, 5, 12]);
    expect(new Set(candidates.map((entry) => entry.candidateId)).size).toBe(3);
  });

  it("enumerates each physical pair inside a full house", () => {
    const hand = makeHand("p", [
      ["spades", 14],
      ["hearts", 14],
      ["diamonds", 14],
      ["spades", 13],
      ["hearts", 13],
    ]);
    const candidates = evaluateHand(hand);

    expect(candidates.filter((entry) => entry.label === "PAIR A")).toHaveLength(3);
    expect(candidates.filter((entry) => entry.label === "PAIR K")).toHaveLength(1);
    expect(candidates.filter((entry) => entry.type === "two_pair")).toHaveLength(3);
    expect(candidates.filter((entry) => entry.type === "three_of_a_kind")).toHaveLength(1);
    expect(candidates.filter((entry) => entry.type === "full_house")).toHaveLength(1);
  });

  it("lists straight, flush, straight flush, and royal flush together", () => {
    const hand = makeHand("p", [
      ["spades", 10],
      ["spades", 11],
      ["spades", 12],
      ["spades", 13],
      ["spades", 14],
    ]);
    const candidates = evaluateHand(hand);

    expect(candidates.map((entry) => entry.type)).toEqual([
      "straight",
      "flush",
      "straight_flush",
      "royal_flush",
    ]);
    expect(candidates.map((entry) => entry.damage)).toEqual([22, 26, 75, 100]);
  });

  it("accepts A-2-3-4-5 but not a wrapped Q-K-A-2-3 straight", () => {
    const wheel = makeHand("p", [
      ["spades", 14],
      ["hearts", 2],
      ["diamonds", 3],
      ["clubs", 4],
      ["spades", 5],
    ]);
    const wrapped = makeHand("p", [
      ["spades", 12],
      ["hearts", 13],
      ["diamonds", 14],
      ["clubs", 2],
      ["spades", 3],
    ]);

    expect(evaluateHand(wheel).some((entry) => entry.type === "straight")).toBe(true);
    expect(evaluateHand(wrapped).some((entry) => entry.type === "straight")).toBe(false);
  });
});

describe("skills", () => {
  it("uses the five-skill default draw distribution", () => {
    expect(DEFAULT_SKILL_WEIGHTS).toEqual({
      HEAL: 42,
      SHUFFLE: 35,
      STEAL: 15,
      BLOCK: 5,
      STOP: 3,
    });
    expect(Object.values(DEFAULT_SKILL_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it("consumes HEAL at full HP and reports no effect", () => {
    const actor = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("HEAL", "heal-1")],
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)));
    const result = resolveSkillUse({ actor, target, skillInstanceId: "heal-1", nowMs: 1_000, random: new SeededRandom(3) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effect).toBe("NO_EFFECT");
    expect(result.actor.hp).toBe(100);
    expect(result.actor.skills).toHaveLength(0);
  });

  it("refreshes STOP to now + 10 seconds instead of stacking", () => {
    const actor = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("STOP", "stop-1")],
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)), { stopUntilMs: 20_000 });
    const result = resolveSkillUse({ actor, target, skillInstanceId: "stop-1", nowMs: 15_000, random: new SeededRandom(3) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.stopUntilMs).toBe(25_000);
  });

  it("activates BLOCK on its owner for exactly five seconds", () => {
    const actor = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("BLOCK", "block-1")],
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)));
    const result = resolveSkillUse({ actor, target, skillInstanceId: "block-1", nowMs: 7_000, random: new SeededRandom(3) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effect).toBe("BLOCKED");
    expect(result.actor.blockUntilMs).toBe(12_000);
    expect(result.target).toBe(target);
    expect(result.actor.skills).toHaveLength(0);
  });

  it("refreshes BLOCK to now + 5 seconds instead of stacking", () => {
    const actor = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("BLOCK", "block-1")],
      blockUntilMs: 30_000,
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)));
    const result = resolveSkillUse({ actor, target, skillInstanceId: "block-1", nowMs: 10_000, random: new SeededRandom(3) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actor.blockUntilMs).toBe(15_000);
  });

  it("does not stop hand activation, redraw, or stocked skill use while BLOCK is active", () => {
    const base = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      blockUntilMs: 20_000,
      skills: [createSkill("HEAL", "heal-1")],
      hp: 60,
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)));
    const pairHand = makeHand("p", [
      ["spades", 10],
      ["hearts", 10],
      ["diamonds", 3],
      ["clubs", 7],
      ["spades", 13],
    ]);
    const pairIds = new Set(pairHand.map((card) => card.id));
    const attacker = {
      ...base,
      deck: {
        ...base.deck,
        hand: pairHand,
        box: [...base.deck.hand, ...base.deck.box].filter((card) => !pairIds.has(card.id)),
      },
    };
    const candidate = evaluateHand(attacker.deck.hand).find((entry) => entry.type === "one_pair");
    const attack = resolveHandActivation({
      actor: attacker,
      target,
      candidateId: candidate?.candidateId ?? "missing",
      nowMs: 10_000,
      random: new SeededRandom(3),
    });
    const redraw = resolveRedraw({
      player: base,
      cardIds: [base.deck.hand[0].id],
      nowMs: 10_000,
      random: new SeededRandom(4),
    });

    expect(attack.ok).toBe(true);
    expect(redraw.ok).toBe(true);
    const skill = resolveSkillUse({
      actor: base,
      target,
      skillInstanceId: "heal-1",
      nowMs: 10_000,
      random: new SeededRandom(5),
    });
    expect(skill.ok).toBe(true);
    if (!skill.ok) return;
    expect(skill.effect).toBe("HEALED");
    expect(skill.actor.hp).toBe(80);
    expect(skill.actor.blockUntilMs).toBe(20_000);
  });

  it("atomically replaces all five target cards with SHUFFLE", () => {
    const actor = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("SHUFFLE", "shuffle-1")],
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)));
    const result = resolveSkillUse({ actor, target, skillInstanceId: "shuffle-1", nowMs: 5_000, random: new SeededRandom(3) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effect).toBe("SHUFFLED");
    expect(result.target.deck.handVersion).toBe(target.deck.handVersion + 1);
    expect(result.target.shuffleLockUntilMs).toBe(5_800);
    expect(validateDeckState(result.target.deck)).toEqual([]);
  });

  it("moves one random enemy skill into the slot freed by STEAL", () => {
    const actor = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("HEAL", "own-heal"), createSkill("STOP", "own-stop"), createSkill("STEAL", "steal-1")],
    });
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)), {
      skills: [createSkill("SHUFFLE", "enemy-shuffle")],
    });
    const result = resolveSkillUse({ actor, target, skillInstanceId: "steal-1", nowMs: 1_000, random: new SeededRandom(3) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effect).toBe("STOLEN");
    expect(result.actor.skills.map((skill) => skill.instanceId)).toContain("enemy-shuffle");
    expect(result.actor.skills).toHaveLength(3);
    expect(result.target.skills).toHaveLength(0);
  });

  it("discards a newly acquired skill when all three slots are full", () => {
    const player = createPlayerState("p", createDeckState("p", new SeededRandom(1)), {
      skills: [createSkill("HEAL", "1"), createSkill("HEAL", "2"), createSkill("STOP", "3")],
    });
    const result = addSkillToStock(player, createSkill("STEAL", "4"));

    expect(result.added).toBe(false);
    expect(result.player).toBe(player);
  });
});

describe("authoritative hand actions", () => {
  it("validates a candidate, applies its total damage once, and cycles only its cards", () => {
    const baseActor = createPlayerState("p", createDeckState("p", new SeededRandom(1)));
    const pairHand = makeHand("p", [
      ["spades", 10],
      ["hearts", 10],
      ["diamonds", 3],
      ["clubs", 7],
      ["spades", 13],
    ]);
    const pairIds = new Set(pairHand.map((card) => card.id));
    const actor = {
      ...baseActor,
      deck: {
        ...baseActor.deck,
        hand: pairHand,
        box: [...baseActor.deck.hand, ...baseActor.deck.box].filter((card) => !pairIds.has(card.id)),
      },
    };
    const target = createPlayerState("e", createDeckState("e", new SeededRandom(2)));
    const candidate = evaluateHand(actor.deck.hand).find((entry) => entry.type === "one_pair");
    expect(candidate).toBeDefined();

    const result = resolveHandActivation({
      actor,
      target,
      candidateId: candidate?.candidateId ?? "missing",
      nowMs: 10_000,
      random: new SeededRandom(4),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.damage).toBe(5);
    expect(result.target.hp).toBe(95);
    expect(result.returnedCardIds).toHaveLength(2);
    expect(result.actor.deck.hand).toHaveLength(5);
    expect(result.actor.actionCooldownUntilMs).toBe(11_200);
    expect(validateDeckState(result.actor.deck)).toEqual([]);
  });

  it("rejects redraw during STOP without mutating cards", () => {
    const player = createPlayerState("p", createDeckState("p", new SeededRandom(1)), { stopUntilMs: 20_000 });
    const result = resolveRedraw({
      player,
      cardIds: [player.deck.hand[0].id],
      nowMs: 15_000,
      random: new SeededRandom(2),
    });

    expect(result).toEqual({ ok: false, reason: "STOP", player });
  });

  it("declares a draw when both players reach zero in one damage window", () => {
    const first = createPlayerState("p", createDeckState("p", new SeededRandom(1)), { hp: 5 });
    const second = createPlayerState("e", createDeckState("e", new SeededRandom(2)), { hp: 12 });
    const result = resolveSimultaneousDamage(first, second, 12, 5);

    expect(result.first.hp).toBe(0);
    expect(result.second.hp).toBe(0);
    expect(result.outcome).toEqual({ status: "draw" });
  });
});

describe("CPU helpers", () => {
  it("normal CPU activates the maximum-damage candidate", () => {
    const hand = makeHand("cpu", [
      ["hearts", 10],
      ["hearts", 11],
      ["hearts", 12],
      ["hearts", 13],
      ["hearts", 14],
    ]);
    const action = chooseCpuAction(hand, new SeededRandom(1), "normal");

    expect(action.type).toBe("activate");
    if (action.type === "activate") expect(action.candidate.type).toBe("royal_flush");
  });

  it("normal CPU keeps four cards toward a straight when no role exists", () => {
    const hand = makeHand("cpu", [
      ["spades", 2],
      ["hearts", 3],
      ["diamonds", 4],
      ["clubs", 5],
      ["spades", 13],
    ]);
    const action = chooseCpuAction(hand, new SeededRandom(1), "normal");

    expect(action.type).toBe("redraw");
    if (action.type === "redraw") expect(action.cardIds).toEqual([cardId("cpu", "spades", 13)]);
  });

  it("uses BLOCK when the opponent has an attack candidate", () => {
    const self = createPlayerState("cpu", createDeckState("cpu", new SeededRandom(1)), {
      skills: [createSkill("BLOCK", "block-1")],
    });
    const opponent = createPlayerState("player", createDeckState("player", new SeededRandom(2)));
    const threat = evaluateHand(makeHand("player", [
      ["spades", 10],
      ["hearts", 10],
      ["diamonds", 3],
      ["clubs", 7],
      ["spades", 13],
    ]));

    expect(chooseCpuSkill({ self, opponent, opponentCandidates: threat })?.type).toBe("BLOCK");
  });
});
