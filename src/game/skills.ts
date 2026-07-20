import { redrawEntireHand } from "./cards";
import { randomInt } from "./random";
import type { PlayerCoreState, RandomSource, SkillInstance, SkillType } from "./types";

export interface SkillConfig {
  readonly healAmount: number;
  readonly maxHp: number;
  readonly stopDurationMs: number;
  readonly blockDurationMs: number;
  readonly shuffleLockMs: number;
  readonly skillCooldownMs: number;
  readonly stockLimit: number;
}

export const DEFAULT_SKILL_CONFIG: SkillConfig = {
  healAmount: 20,
  maxHp: 100,
  stopDurationMs: 10_000,
  blockDurationMs: 5_000,
  shuffleLockMs: 800,
  skillCooldownMs: 1_000,
  stockLimit: 3,
};

export const DEFAULT_SKILL_WEIGHTS: Readonly<Record<SkillType, number>> = {
  HEAL: 42,
  SHUFFLE: 35,
  STEAL: 15,
  BLOCK: 5,
  STOP: 3,
};

export function createPlayerState(
  playerId: string,
  deck: PlayerCoreState["deck"],
  overrides: Partial<Omit<PlayerCoreState, "playerId" | "deck">> = {},
): PlayerCoreState {
  return {
    playerId,
    deck,
    hp: overrides.hp ?? 100,
    skills: overrides.skills ?? [],
    stopUntilMs: overrides.stopUntilMs ?? 0,
    blockUntilMs: overrides.blockUntilMs ?? 0,
    shuffleLockUntilMs: overrides.shuffleLockUntilMs ?? 0,
    actionCooldownUntilMs: overrides.actionCooldownUntilMs ?? 0,
    skillCooldownUntilMs: overrides.skillCooldownUntilMs ?? 0,
  };
}

export function createSkill(type: SkillType, instanceId: string): SkillInstance {
  if (instanceId.length === 0) throw new Error("Skill instanceId must not be empty.");
  return { instanceId, type };
}

export function addSkillToStock(
  player: PlayerCoreState,
  skill: SkillInstance,
  stockLimit = DEFAULT_SKILL_CONFIG.stockLimit,
): { readonly player: PlayerCoreState; readonly added: boolean } {
  if (player.skills.length >= stockLimit) return { player, added: false };
  if (player.skills.some((owned) => owned.instanceId === skill.instanceId)) {
    throw new Error(`Duplicate skill instanceId: ${skill.instanceId}`);
  }
  return { player: { ...player, skills: [...player.skills, skill] }, added: true };
}

export function drawWeightedSkill(
  random: RandomSource,
  weights: Readonly<Record<SkillType, number>> = DEFAULT_SKILL_WEIGHTS,
): SkillType {
  const entries = (Object.entries(weights) as [SkillType, number][]).filter(([, weight]) => {
    if (!Number.isFinite(weight) || weight < 0) throw new Error("Skill weights must be finite and non-negative.");
    return weight > 0;
  });
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new Error("At least one skill weight must be greater than zero.");

  let roll = random.next() * total;
  for (const [type, weight] of entries) {
    if (roll < weight) return type;
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}

export type HandActionBlockReason = "STOP" | "SHUFFLE_LOCK" | "ACTION_COOLDOWN";

export function handActionBlockReason(
  player: PlayerCoreState,
  nowMs: number,
): HandActionBlockReason | undefined {
  if (nowMs < player.shuffleLockUntilMs) return "SHUFFLE_LOCK";
  if (nowMs < player.stopUntilMs) return "STOP";
  if (nowMs < player.actionCooldownUntilMs) return "ACTION_COOLDOWN";
  return undefined;
}

export type SkillEffect = "HEALED" | "STOPPED" | "SHUFFLED" | "STOLEN" | "BLOCKED" | "NO_EFFECT";
export type SkillRejectReason = "NOT_OWNED" | "SKILL_COOLDOWN" | "DUPLICATE_PLAYER";

export type SkillUseResult =
  | {
      readonly ok: false;
      readonly reason: SkillRejectReason;
      readonly actor: PlayerCoreState;
      readonly target: PlayerCoreState;
    }
  | {
      readonly ok: true;
      readonly actor: PlayerCoreState;
      readonly target: PlayerCoreState;
      readonly consumedSkill: SkillInstance;
      readonly effect: SkillEffect;
      readonly stolenSkill?: SkillInstance;
      readonly shuffledCardIds?: readonly string[];
    };

export interface SkillUseRequest {
  readonly actor: PlayerCoreState;
  readonly target: PlayerCoreState;
  readonly skillInstanceId: string;
  readonly nowMs: number;
  readonly random: RandomSource;
  readonly config?: Partial<SkillConfig>;
}

/**
 * Resolves a valid stocked-skill request atomically. A valid request consumes
 * the skill before checking whether its effect can change state.
 */
export function resolveSkillUse(request: SkillUseRequest): SkillUseResult {
  const { actor, target, skillInstanceId, nowMs, random } = request;
  if (actor.playerId === target.playerId) return { ok: false, reason: "DUPLICATE_PLAYER", actor, target };
  if (nowMs < actor.skillCooldownUntilMs) return { ok: false, reason: "SKILL_COOLDOWN", actor, target };

  const skill = actor.skills.find((entry) => entry.instanceId === skillInstanceId);
  if (!skill) return { ok: false, reason: "NOT_OWNED", actor, target };

  const config: SkillConfig = { ...DEFAULT_SKILL_CONFIG, ...request.config };
  let nextActor: PlayerCoreState = {
    ...actor,
    skills: actor.skills.filter((entry) => entry.instanceId !== skillInstanceId),
    skillCooldownUntilMs: nowMs + config.skillCooldownMs,
  };
  let nextTarget = target;

  switch (skill.type) {
    case "HEAL": {
      const hp = Math.min(config.maxHp, nextActor.hp + config.healAmount);
      const effect: SkillEffect = hp === nextActor.hp ? "NO_EFFECT" : "HEALED";
      nextActor = { ...nextActor, hp };
      return { ok: true, actor: nextActor, target: nextTarget, consumedSkill: skill, effect };
    }
    case "STOP":
      nextTarget = { ...nextTarget, stopUntilMs: nowMs + config.stopDurationMs };
      return { ok: true, actor: nextActor, target: nextTarget, consumedSkill: skill, effect: "STOPPED" };
    case "BLOCK":
      nextActor = { ...nextActor, blockUntilMs: nowMs + config.blockDurationMs };
      return { ok: true, actor: nextActor, target: nextTarget, consumedSkill: skill, effect: "BLOCKED" };
    case "SHUFFLE": {
      const update = redrawEntireHand(nextTarget.deck, random);
      nextTarget = {
        ...nextTarget,
        deck: update.state,
        shuffleLockUntilMs: nowMs + config.shuffleLockMs,
      };
      return {
        ok: true,
        actor: nextActor,
        target: nextTarget,
        consumedSkill: skill,
        effect: "SHUFFLED",
        shuffledCardIds: update.drawnCards.map((card) => card.id),
      };
    }
    case "STEAL": {
      if (nextTarget.skills.length === 0) {
        return { ok: true, actor: nextActor, target: nextTarget, consumedSkill: skill, effect: "NO_EFFECT" };
      }
      const stolenSkill = nextTarget.skills[randomInt(random, nextTarget.skills.length)];
      nextTarget = {
        ...nextTarget,
        skills: nextTarget.skills.filter((entry) => entry.instanceId !== stolenSkill.instanceId),
      };
      nextActor = { ...nextActor, skills: [...nextActor.skills, stolenSkill] };
      return {
        ok: true,
        actor: nextActor,
        target: nextTarget,
        consumedSkill: skill,
        effect: "STOLEN",
        stolenSkill,
      };
    }
  }
}
