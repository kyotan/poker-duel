import { evaluateHand } from "./hands";
import { chooseOne, shuffle } from "./random";
import type { Card, CardRank, HandCandidate, PlayerCoreState, RandomSource, SkillInstance } from "./types";

export type CpuDifficulty = "easy" | "normal" | "hard";

export type CpuAction =
  | { readonly type: "activate"; readonly candidate: HandCandidate }
  | { readonly type: "redraw"; readonly cardIds: readonly string[] };

const STRAIGHT_WINDOWS: readonly (readonly CardRank[])[] = [
  [14, 2, 3, 4, 5],
  [2, 3, 4, 5, 6],
  [3, 4, 5, 6, 7],
  [4, 5, 6, 7, 8],
  [5, 6, 7, 8, 9],
  [6, 7, 8, 9, 10],
  [7, 8, 9, 10, 11],
  [8, 9, 10, 11, 12],
  [9, 10, 11, 12, 13],
  [10, 11, 12, 13, 14],
];

function bestCandidate(candidates: readonly HandCandidate[]): HandCandidate {
  return [...candidates].sort((left, right) => {
    if (right.damage !== left.damage) return right.damage - left.damage;
    if (right.cardIds.length !== left.cardIds.length) return right.cardIds.length - left.cardIds.length;
    if ((right.ranks[0] ?? 0) !== (left.ranks[0] ?? 0)) return (right.ranks[0] ?? 0) - (left.ranks[0] ?? 0);
    return left.candidateId.localeCompare(right.candidateId);
  })[0];
}

function bestPotentialKeep(hand: readonly Card[]): Set<string> {
  const possibilities: { cards: Card[]; kindScore: number; high: number }[] = [];

  for (const suit of ["spades", "hearts", "diamonds", "clubs"] as const) {
    const cards = hand.filter((card) => card.suit === suit);
    possibilities.push({ cards, kindScore: 0, high: Math.max(0, ...cards.map((card) => card.rank)) });
  }

  for (const window of STRAIGHT_WINDOWS) {
    const cards = hand.filter((card) => window.includes(card.rank));
    possibilities.push({ cards, kindScore: 1, high: window[window.length - 1] === 5 ? 5 : Math.max(...window) });
  }

  possibilities.sort((left, right) => {
    if (right.cards.length !== left.cards.length) return right.cards.length - left.cards.length;
    if (right.kindScore !== left.kindScore) return right.kindScore - left.kindScore;
    return right.high - left.high;
  });

  const best = possibilities[0];
  if (!best || best.cards.length < 2) return new Set();
  return new Set(best.cards.map((card) => card.id));
}

/** Chooses cards that do not contribute to the best current straight/flush draw. */
export function suggestCpuRedraw(hand: readonly Card[]): string[] {
  const keep = bestPotentialKeep(hand);
  const redraw = hand.filter((card) => !keep.has(card.id)).map((card) => card.id);
  return redraw.length > 0 ? redraw : hand.map((card) => card.id);
}

export function chooseCpuAction(
  hand: readonly Card[],
  random: RandomSource,
  difficulty: CpuDifficulty = "normal",
): CpuAction {
  const candidates = evaluateHand(hand);
  if (candidates.length > 0) {
    if (difficulty === "easy") {
      return { type: "activate", candidate: chooseOne(candidates, random) ?? candidates[0] };
    }
    return { type: "activate", candidate: bestCandidate(candidates) };
  }

  if (difficulty === "easy") {
    const shuffled = shuffle(hand, random);
    const count = 1 + Math.floor(random.next() * hand.length);
    return { type: "redraw", cardIds: shuffled.slice(0, count).map((card) => card.id) };
  }
  return { type: "redraw", cardIds: suggestCpuRedraw(hand) };
}

export interface CpuSkillContext {
  readonly self: PlayerCoreState;
  readonly opponent: PlayerCoreState;
  readonly opponentCandidates?: readonly HandCandidate[];
}

/** A conservative, deterministic skill policy for the first CPU MVP. */
export function chooseCpuSkill(context: CpuSkillContext): SkillInstance | undefined {
  const { self, opponent } = context;
  const byType = (type: SkillInstance["type"]) => self.skills.find((skill) => skill.type === type);

  if (self.hp <= 80) {
    const heal = byType("HEAL");
    if (heal) return heal;
  }

  const opponentCandidates = context.opponentCandidates ?? evaluateHand(opponent.deck.hand);
  if (opponentCandidates.length > 0) {
    const block = byType("BLOCK");
    if (block) return block;
  }

  const stop = byType("STOP");
  if (stop) return stop;

  if (opponentCandidates.some((candidate) => candidate.damage >= 16)) {
    const forcedShuffle = byType("SHUFFLE");
    if (forcedShuffle) return forcedShuffle;
  }
  if (opponent.skills.length > 0) {
    const steal = byType("STEAL");
    if (steal) return steal;
  }
  return undefined;
}
