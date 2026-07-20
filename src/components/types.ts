export type CardSuit = "hearts" | "diamonds" | "clubs" | "spades";

export type PlayerTone = "enemy" | "player";

export interface CardViewModel {
  id: string;
  rank: string | number;
  suit: CardSuit;
}

export interface SkillSlotViewModel {
  id: string;
  type?: string;
  name: string;
  available?: boolean;
  statusText?: string;
  cooldownRemainingMs?: number;
  cooldownTotalMs?: number;
}

export interface RoleActionViewModel {
  id: string;
  label: string;
  damage: number;
  cardIds: readonly string[];
  handType?: string;
  rank?: string;
  disabled?: boolean;
}
