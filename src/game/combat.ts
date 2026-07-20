import { redrawCards } from "./cards";
import { evaluateHand } from "./hands";
import { handActionBlockReason, type HandActionBlockReason } from "./skills";
import type { HandCandidate, PlayerCoreState, RandomSource } from "./types";

export interface HandActionConfig {
  readonly attackCooldownMs: number;
  readonly redrawCooldownMs: number;
}

export const DEFAULT_HAND_ACTION_CONFIG: HandActionConfig = {
  attackCooldownMs: 1_200,
  redrawCooldownMs: 800,
};

export type HandActionRejectReason =
  | HandActionBlockReason
  | "INVALID_CANDIDATE"
  | "INVALID_CARDS"
  | "MATCH_FINISHED"
  | "DUPLICATE_PLAYER";

export type ActivateHandResult =
  | {
      readonly ok: false;
      readonly reason: HandActionRejectReason;
      readonly actor: PlayerCoreState;
      readonly target: PlayerCoreState;
    }
  | {
      readonly ok: true;
      readonly actor: PlayerCoreState;
      readonly target: PlayerCoreState;
      readonly candidate: HandCandidate;
      readonly damage: number;
      readonly returnedCardIds: readonly string[];
      readonly drawnCardIds: readonly string[];
    };

export interface ActivateHandRequest {
  readonly actor: PlayerCoreState;
  readonly target: PlayerCoreState;
  readonly candidateId: string;
  readonly nowMs: number;
  readonly random: RandomSource;
  readonly config?: Partial<HandActionConfig>;
}

export function applyDamage(hp: number, damage: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(damage) || damage < 0) {
    throw new Error("HP and non-negative damage must be finite numbers.");
  }
  return Math.max(0, hp - damage);
}

export type DuelOutcome =
  | { readonly status: "active" }
  | { readonly status: "draw" }
  | { readonly status: "won"; readonly winnerId: string; readonly loserId: string };

export interface SimultaneousDamageResult {
  readonly first: PlayerCoreState;
  readonly second: PlayerCoreState;
  readonly outcome: DuelOutcome;
}

/** Applies both attacks from the same resolution window against the pre-window HP values. */
export function resolveSimultaneousDamage(
  first: PlayerCoreState,
  second: PlayerCoreState,
  damageFromFirst: number,
  damageFromSecond: number,
): SimultaneousDamageResult {
  const nextFirst = { ...first, hp: applyDamage(first.hp, damageFromSecond) };
  const nextSecond = { ...second, hp: applyDamage(second.hp, damageFromFirst) };
  let outcome: DuelOutcome = { status: "active" };

  if (nextFirst.hp === 0 && nextSecond.hp === 0) {
    outcome = { status: "draw" };
  } else if (nextSecond.hp === 0) {
    outcome = { status: "won", winnerId: first.playerId, loserId: second.playerId };
  } else if (nextFirst.hp === 0) {
    outcome = { status: "won", winnerId: second.playerId, loserId: first.playerId };
  }

  return { first: nextFirst, second: nextSecond, outcome };
}

/** Validates the candidate against the current hand, applies damage once, and refills used cards. */
export function resolveHandActivation(request: ActivateHandRequest): ActivateHandResult {
  const { actor, target, candidateId, nowMs, random } = request;
  if (actor.playerId === target.playerId) {
    return { ok: false, reason: "DUPLICATE_PLAYER", actor, target };
  }
  if (actor.hp <= 0 || target.hp <= 0) {
    return { ok: false, reason: "MATCH_FINISHED", actor, target };
  }
  const blocked = handActionBlockReason(actor, nowMs);
  if (blocked) return { ok: false, reason: blocked, actor, target };

  const candidate = evaluateHand(actor.deck.hand).find((entry) => entry.candidateId === candidateId);
  if (!candidate) return { ok: false, reason: "INVALID_CANDIDATE", actor, target };

  const config: HandActionConfig = { ...DEFAULT_HAND_ACTION_CONFIG, ...request.config };
  const update = redrawCards(actor.deck, candidate.cardIds, random);
  const nextActor: PlayerCoreState = {
    ...actor,
    deck: update.state,
    actionCooldownUntilMs: nowMs + config.attackCooldownMs,
  };
  const nextTarget: PlayerCoreState = { ...target, hp: applyDamage(target.hp, candidate.damage) };

  return {
    ok: true,
    actor: nextActor,
    target: nextTarget,
    candidate,
    damage: candidate.damage,
    returnedCardIds: update.returnedCards.map((card) => card.id),
    drawnCardIds: update.drawnCards.map((card) => card.id),
  };
}

export type RedrawHandResult =
  | {
      readonly ok: false;
      readonly reason: HandActionBlockReason | "INVALID_CARDS" | "MATCH_FINISHED";
      readonly player: PlayerCoreState;
    }
  | {
      readonly ok: true;
      readonly player: PlayerCoreState;
      readonly returnedCardIds: readonly string[];
      readonly drawnCardIds: readonly string[];
    };

export interface RedrawHandRequest {
  readonly player: PlayerCoreState;
  readonly cardIds: readonly string[];
  readonly nowMs: number;
  readonly random: RandomSource;
  readonly config?: Partial<HandActionConfig>;
}

export function resolveRedraw(request: RedrawHandRequest): RedrawHandResult {
  const { player, cardIds, nowMs, random } = request;
  if (player.hp <= 0) return { ok: false, reason: "MATCH_FINISHED", player };
  const blocked = handActionBlockReason(player, nowMs);
  if (blocked) return { ok: false, reason: blocked, player };

  try {
    const config: HandActionConfig = { ...DEFAULT_HAND_ACTION_CONFIG, ...request.config };
    const update = redrawCards(player.deck, cardIds, random);
    return {
      ok: true,
      player: {
        ...player,
        deck: update.state,
        actionCooldownUntilMs: nowMs + config.redrawCooldownMs,
      },
      returnedCardIds: update.returnedCards.map((card) => card.id),
      drawnCardIds: update.drawnCards.map((card) => card.id),
    };
  } catch {
    return { ok: false, reason: "INVALID_CARDS", player };
  }
}
