export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;

export type Suit = (typeof SUITS)[number];

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export type CardRank = (typeof RANKS)[number];

export interface Card {
  readonly id: string;
  readonly ownerId: string;
  readonly suit: Suit;
  readonly rank: CardRank;
}

export interface RandomSource {
  /** Returns a value in the half-open interval [0, 1). */
  next(): number;
}

export interface DeckState {
  readonly ownerId: string;
  readonly hand: readonly Card[];
  readonly box: readonly Card[];
  readonly handVersion: number;
}

export interface DeckUpdate {
  readonly state: DeckState;
  readonly returnedCards: readonly Card[];
  readonly drawnCards: readonly Card[];
}

export const HAND_TYPES = [
  "one_pair",
  "two_pair",
  "three_of_a_kind",
  "straight",
  "flush",
  "full_house",
  "four_of_a_kind",
  "straight_flush",
  "royal_flush",
] as const;

export type HandType = (typeof HAND_TYPES)[number];

export interface HandCandidate {
  /** Stable for the same role and exact set of physical cards. */
  readonly candidateId: string;
  readonly type: HandType;
  readonly label: string;
  readonly cardIds: readonly string[];
  /** Important ranks, ordered high-to-low where applicable. */
  readonly ranks: readonly CardRank[];
  readonly damage: number;
}

export const SKILL_TYPES = ["HEAL", "SHUFFLE", "STEAL", "BLOCK", "STOP"] as const;

export type SkillType = (typeof SKILL_TYPES)[number];

export interface SkillInstance {
  readonly instanceId: string;
  readonly type: SkillType;
}

export interface PlayerCoreState {
  readonly playerId: string;
  readonly hp: number;
  readonly deck: DeckState;
  readonly skills: readonly SkillInstance[];
  /** STOP blocks hand activation and redraw, but never stocked skill use. */
  readonly stopUntilMs: number;
  /** BLOCK negates incoming hand-attack damage, but never actions or skill effects. */
  readonly blockUntilMs: number;
  /** Short atomic lock used while a forced SHUFFLE is resolving. */
  readonly shuffleLockUntilMs: number;
  /** Shared cooldown for hand activation and voluntary redraw. */
  readonly actionCooldownUntilMs: number;
  readonly skillCooldownUntilMs: number;
}
