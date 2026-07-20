import { RANK_LABELS } from "./cards";
import type { Card, CardRank, HandCandidate, HandType } from "./types";

export const HAND_DAMAGE: Readonly<Record<HandType, number>> = {
  one_pair: 5,
  two_pair: 12,
  three_of_a_kind: 16,
  straight: 22,
  flush: 26,
  full_house: 34,
  four_of_a_kind: 50,
  straight_flush: 75,
  royal_flush: 100,
};

const TYPE_ORDER: Readonly<Record<HandType, number>> = {
  one_pair: 0,
  two_pair: 1,
  three_of_a_kind: 2,
  straight: 3,
  flush: 4,
  full_house: 5,
  four_of_a_kind: 6,
  straight_flush: 7,
  royal_flush: 8,
};

function combinations<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === size) {
      result.push(chosen);
      return;
    }
    for (let index = start; index <= values.length - (size - chosen.length); index += 1) {
      visit(index + 1, [...chosen, values[index]]);
    }
  };
  visit(0, []);
  return result;
}
function sortedCardIds(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id).sort((left, right) => left.localeCompare(right));
}

function candidate(
  type: HandType,
  cards: readonly Card[],
  ranks: readonly CardRank[],
  label: string,
): HandCandidate {
  const cardIds = sortedCardIds(cards);
  return {
    candidateId: `${type}:${cardIds.join("+")}`,
    type,
    label,
    cardIds,
    ranks: [...ranks],
    damage: HAND_DAMAGE[type],
  };
}

function straightHigh(cards: readonly Card[]): CardRank | undefined {
  const ranks = [...new Set(cards.map((card) => card.rank))].sort((a, b) => a - b);
  if (ranks.length !== 5) return undefined;
  if (ranks.join(",") === "2,3,4,5,14") return 5;
  const consecutive = ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
  return consecutive ? ranks[4] : undefined;
}

function handLabel(type: HandType, ranks: readonly CardRank[]): string {
  switch (type) {
    case "one_pair":
      return `PAIR ${RANK_LABELS[ranks[0]]}`;
    case "two_pair":
      return `TWO PAIR ${RANK_LABELS[ranks[0]]}/${RANK_LABELS[ranks[1]]}`;
    case "three_of_a_kind":
      return `THREE ${RANK_LABELS[ranks[0]]}`;
    case "straight":
      return `STRAIGHT ${RANK_LABELS[ranks[0]]} HIGH`;
    case "flush":
      return "FLUSH";
    case "full_house":
      return `FULL HOUSE ${RANK_LABELS[ranks[0]]} OVER ${RANK_LABELS[ranks[1]]}`;
    case "four_of_a_kind":
      return `FOUR ${RANK_LABELS[ranks[0]]}`;
    case "straight_flush":
      return `STRAIGHT FLUSH ${RANK_LABELS[ranks[0]]} HIGH`;
    case "royal_flush":
      return "ROYAL FLUSH";
  }
}

/** Enumerates every valid role and exact physical-card combination in a five-card hand. */
export function evaluateHand(hand: readonly Card[]): HandCandidate[] {
  if (hand.length !== 5) throw new Error("Poker hands must contain exactly 5 cards.");
  if (new Set(hand.map((card) => card.id)).size !== hand.length) {
    throw new Error("Poker hands cannot contain duplicate physical cards.");
  }

  const groups = new Map<CardRank, Card[]>();
  for (const card of hand) {
    const cards = groups.get(card.rank) ?? [];
    groups.set(card.rank, [...cards, card]);
  }

  const result: HandCandidate[] = [];
  const groupedRanks = [...groups.keys()].sort((a, b) => b - a);

  for (const rank of groupedRanks) {
    const cards = groups.get(rank) ?? [];
    if (cards.length >= 2) {
      for (const pair of combinations(cards, 2)) {
        result.push(candidate("one_pair", pair, [rank], handLabel("one_pair", [rank])));
      }
    }
  }

  const pairRanks = groupedRanks.filter((rank) => (groups.get(rank)?.length ?? 0) >= 2);
  for (const [highRank, lowRank] of combinations(pairRanks, 2)) {
    const highPairs = combinations(groups.get(highRank) ?? [], 2);
    const lowPairs = combinations(groups.get(lowRank) ?? [], 2);
    for (const highPair of highPairs) {
      for (const lowPair of lowPairs) {
        const ranks = [highRank, lowRank] as const;
        result.push(candidate("two_pair", [...highPair, ...lowPair], ranks, handLabel("two_pair", ranks)));
      }
    }
  }

  for (const rank of groupedRanks) {
    const cards = groups.get(rank) ?? [];
    if (cards.length >= 3) {
      for (const three of combinations(cards, 3)) {
        result.push(candidate("three_of_a_kind", three, [rank], handLabel("three_of_a_kind", [rank])));
      }
    }
  }

  const high = straightHigh(hand);
  const isFlush = hand.every((card) => card.suit === hand[0].suit);
  if (high !== undefined) {
    result.push(candidate("straight", hand, [high], handLabel("straight", [high])));
  }
  if (isFlush) {
    result.push(candidate("flush", hand, [], handLabel("flush", [])));
  }

  const tripleRank = groupedRanks.find((rank) => groups.get(rank)?.length === 3);
  const fullHousePairRank = groupedRanks.find((rank) => groups.get(rank)?.length === 2);
  if (tripleRank !== undefined && fullHousePairRank !== undefined) {
    const ranks = [tripleRank, fullHousePairRank] as const;
    result.push(candidate("full_house", hand, ranks, handLabel("full_house", ranks)));
  }

  const fourRank = groupedRanks.find((rank) => groups.get(rank)?.length === 4);
  if (fourRank !== undefined) {
    const fourCards = groups.get(fourRank) ?? [];
    result.push(candidate("four_of_a_kind", fourCards, [fourRank], handLabel("four_of_a_kind", [fourRank])));
  }

  if (high !== undefined && isFlush) {
    result.push(candidate("straight_flush", hand, [high], handLabel("straight_flush", [high])));
    if (high === 14 && hand.some((card) => card.rank === 10)) {
      result.push(candidate("royal_flush", hand, [14], handLabel("royal_flush", [14])));
    }
  }

  return result.sort((left, right) => {
    const typeDifference = TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
    if (typeDifference !== 0) return typeDifference;
    const rankDifference = (right.ranks[0] ?? 0) - (left.ranks[0] ?? 0);
    if (rankDifference !== 0) return rankDifference;
    return left.candidateId.localeCompare(right.candidateId);
  });
}

export function findCandidate(
  hand: readonly Card[],
  candidateId: string,
): HandCandidate | undefined {
  return evaluateHand(hand).find((entry) => entry.candidateId === candidateId);
}
