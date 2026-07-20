import type { GameSound, SoundSide } from "../audio/SoundManager";
import {
  DEFAULT_SKILL_WEIGHTS,
  RANK_LABELS,
  SeededRandom,
  addSkillToStock,
  chooseCpuAction,
  chooseCpuSkill,
  createDeckState,
  createPlayerState,
  createSkill,
  drawWeightedSkill,
  evaluateHand,
  resolveHandActivation,
  resolveRedraw,
  resolveSimultaneousDamage,
  resolveSkillUse,
  type Card,
  type CardRank,
  type HandCandidate,
  type PlayerCoreState,
  type SkillEffect,
  type SkillInstance,
  type SkillType,
  type Suit,
} from "../game";
import type { AttackVisual } from "../effects/EffectsCanvas";
import { localizeHand, localizeSkill, translate } from "../i18n";

export type MatchPhase = "waiting_start" | "countdown" | "playing" | "result";
export type MatchResult = "WIN" | "LOSE" | "DRAW";
export type MatchEndReason = "KO" | "TIME_UP" | "FORFEIT";
export type GameSide = "player" | "enemy";

export interface GameConfig {
  seed: string;
  countdownMs: number;
  /** Maximum active-play time. The pre-match countdown is not included. */
  matchDurationMs: number;
  attackCooldownMs: number;
  redrawCooldownMs: number;
  skillIntervalMs: number;
  skillVisibleMs: number;
  claimWindowMs: number;
  healAmount: number;
  stopDurationMs: number;
  blockDurationMs: number;
  shuffleLockMs: number;
  skillCooldownMs: number;
  cpuThinkMinMs: number;
  cpuThinkMaxMs: number;
  skillWeights: Record<SkillType, number>;
  forcedNextSkill: SkillType | "RANDOM";
}

export const CPU_SPEED_PRESETS = {
  normal: { cpuThinkMinMs: 900, cpuThinkMaxMs: 1_400 },
  strong: { cpuThinkMinMs: 450, cpuThinkMaxMs: 800 },
} as const satisfies Record<string, Pick<GameConfig, "cpuThinkMinMs" | "cpuThinkMaxMs">>;

export type CpuStrength = keyof typeof CPU_SPEED_PRESETS;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  seed: "POKER-DUEL-01",
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
  ...CPU_SPEED_PRESETS.normal,
  skillWeights: { ...DEFAULT_SKILL_WEIGHTS },
  forcedNextSkill: "RANDOM",
};

export interface SkillDropState {
  id: string;
  type: SkillType;
  appearedAt: number;
  expiresAt: number;
  claimResolveAt: number | null;
  claimantIds: readonly string[];
}

interface PendingAttack {
  id: string;
  source: "player" | "enemy";
  damage: number;
  cards: readonly Card[];
  resolveAt: number;
  candidateLabel: string;
}

export interface NoticeState {
  id: number;
  text: string;
  tone: "neutral" | "player" | "enemy" | "skill";
  expiresAt: number;
}

export interface GameSnapshot {
  revision: number;
  phase: MatchPhase;
  nowMs: number;
  countdownEndsAt: number | null;
  /** Match-clock timestamps. Both are null until active play begins. */
  matchStartedAt: number | null;
  matchEndsAt: number | null;
  player: PlayerCoreState;
  enemy: PlayerCoreState;
  playerCandidates: readonly HandCandidate[];
  enemyCandidates: readonly HandCandidate[];
  selectedCardIds: readonly string[];
  skillDrop: SkillDropState | null;
  nextSkillDropAt: number;
  nextCpuActionAt: number;
  activeAttacks: readonly AttackVisual[];
  notice: NoticeState | null;
  result: MatchResult | null;
  endReason: MatchEndReason | null;
  config: GameConfig;
  cpuPaused: boolean;
}

/** Remaining active-play time for timer UI and deterministic tests. */
export function getMatchRemainingMs(
  snapshot: Pick<GameSnapshot, "phase" | "nowMs" | "matchEndsAt">,
) {
  if (snapshot.phase !== "playing" || snapshot.matchEndsAt === null) return 0;
  return Math.max(0, snapshot.matchEndsAt - snapshot.nowMs);
}

export type GameEvent =
  | { type: "sound"; sound: GameSound; side?: SoundSide; option?: number }
  | { type: "attackSound"; side: SoundSide; cardCount: number; damage: number; blocked: boolean }
  | { type: "healVisual"; side: GameSide; amount: number }
  | { type: "matchResult"; result: MatchResult };

export interface CardFixture {
  suit: Suit;
  rank: CardRank;
}

export interface PlayerFixture {
  hp?: number;
  hand?: readonly CardFixture[];
  skills?: readonly SkillType[];
  stopRemainingMs?: number;
  blockRemainingMs?: number;
}

export interface DebugResetOptions {
  seed?: string;
  phase?: "waiting_start" | "playing";
  player?: PlayerFixture;
  enemy?: PlayerFixture;
  nextSkill?: SkillType | "RANDOM";
  cpuPaused?: boolean;
}

type Listener = () => void;
type EventListener = (event: GameEvent) => void;

const ATTACK_WINDOW_MS = 100;
const PLAYER_ID = "player";
const ENEMY_ID = "enemy";

function visibleCandidates(candidates: readonly HandCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.type}:${candidate.label}:${candidate.damage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fixedHand(player: PlayerCoreState, specs: readonly CardFixture[]): PlayerCoreState {
  if (specs.length !== 5) throw new Error("A fixed debug hand must contain five cards.");
  const allCards = [...player.deck.hand, ...player.deck.box];
  const hand = specs.map((spec) => {
    const card = allCards.find((entry) => entry.suit === spec.suit && entry.rank === spec.rank);
    if (!card) throw new Error(`Card not found: ${spec.suit}:${spec.rank}`);
    return card;
  });
  if (new Set(hand.map((card) => card.id)).size !== 5) throw new Error("A fixed hand cannot contain duplicate cards.");
  const handIds = new Set(hand.map((card) => card.id));
  return {
    ...player,
    deck: {
      ...player.deck,
      hand,
      box: allCards.filter((card) => !handIds.has(card.id)),
      handVersion: player.deck.handVersion + 1,
    },
  };
}

export class GameController {
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private playerRandom = new SeededRandom(`${DEFAULT_GAME_CONFIG.seed}:player`);
  private enemyRandom = new SeededRandom(`${DEFAULT_GAME_CONFIG.seed}:enemy`);
  private skillRandom = new SeededRandom(`${DEFAULT_GAME_CONFIG.seed}:skill`);
  private serial = 0;
  private noticeSerial = 0;
  private manualClock = false;
  private state: GameSnapshot;

  constructor() {
    this.state = this.createInitialState(DEFAULT_GAME_CONFIG);
  }

  getSnapshot = () => this.state;

  get isManualClock() {
    return this.manualClock;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeToEvents(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  startMatch() {
    if (this.state.phase !== "waiting_start") return false;
    this.state = {
      ...this.state,
      phase: "countdown",
      countdownEndsAt: this.state.nowMs + this.state.config.countdownMs,
      notice: null,
      revision: this.state.revision + 1,
    };
    this.emitEvent({ type: "sound", sound: "start", side: "center" });
    this.emitEvent({ type: "sound", sound: "countdown", side: "center", option: 5 });
    this.emitChange();
    return true;
  }

  rematch() {
    this.reset(this.state.config);
  }

  /** Initializes a server-authoritative two-player match without CPU actions. */
  preparePvp(seed: string) {
    const config = { ...this.state.config, seed };
    this.manualClock = false;
    this.serial = 0;
    this.pendingAttackList = [];
    this.state = {
      ...this.createInitialState(config),
      cpuPaused: true,
      nextCpuActionAt: Number.POSITIVE_INFINITY,
    };
    this.emitChange();
  }

  reset(config: GameConfig = this.state.config) {
    this.manualClock = false;
    this.serial = 0;
    this.pendingAttackList = [];
    this.state = this.createInitialState(config);
    this.emitChange();
  }

  applyConfig(patch: Partial<GameConfig>) {
    const merged: GameConfig = {
      ...this.state.config,
      ...patch,
      skillWeights: {
        ...this.state.config.skillWeights,
        ...(patch.skillWeights ?? {}),
      },
    };
    const rawCpuMin = Number.isFinite(merged.cpuThinkMinMs) ? Math.max(0, merged.cpuThinkMinMs) : DEFAULT_GAME_CONFIG.cpuThinkMinMs;
    const rawCpuMax = Number.isFinite(merged.cpuThinkMaxMs) ? Math.max(0, merged.cpuThinkMaxMs) : DEFAULT_GAME_CONFIG.cpuThinkMaxMs;
    const config: GameConfig = {
      ...merged,
      matchDurationMs: Number.isFinite(merged.matchDurationMs)
        ? Math.max(1, merged.matchDurationMs)
        : DEFAULT_GAME_CONFIG.matchDurationMs,
      cpuThinkMinMs: Math.min(rawCpuMin, rawCpuMax),
      cpuThinkMaxMs: Math.max(rawCpuMin, rawCpuMax),
    };
    if (Object.values(config.skillWeights).every((weight) => weight <= 0)) {
      throw new Error(translate("error.skillWeights"));
    }
    this.reset(config);
  }

  debugReset(options: DebugResetOptions = {}) {
    const config: GameConfig = {
      ...this.state.config,
      seed: options.seed ?? this.state.config.seed,
      forcedNextSkill: options.nextSkill ?? this.state.config.forcedNextSkill,
    };
    this.pendingAttackList = [];
    this.state = this.createInitialState(config);
    let player = this.applyFixture(this.state.player, options.player);
    let enemy = this.applyFixture(this.state.enemy, options.enemy);
    const phase = options.phase ?? "playing";
    if (phase === "playing") {
      player = { ...player, actionCooldownUntilMs: 0, skillCooldownUntilMs: 0 };
      enemy = { ...enemy, actionCooldownUntilMs: 0, skillCooldownUntilMs: 0 };
    }
    this.state = {
      ...this.state,
      phase,
      player,
      enemy,
      playerCandidates: visibleCandidates(evaluateHand(player.deck.hand)),
      enemyCandidates: visibleCandidates(evaluateHand(enemy.deck.hand)),
      countdownEndsAt: null,
      matchStartedAt: phase === "playing" ? this.state.nowMs : null,
      matchEndsAt: phase === "playing" ? this.state.nowMs + config.matchDurationMs : null,
      nextSkillDropAt: phase === "playing" ? this.state.nowMs + config.skillIntervalMs : 0,
      nextCpuActionAt: phase === "playing" ? this.state.nowMs + this.cpuThinkDelay(config) : Number.POSITIVE_INFINITY,
      cpuPaused: options.cpuPaused ?? true,
      revision: this.state.revision + 1,
    };
    this.manualClock = true;
    this.emitChange();
  }

  forceSkillDrop(type?: SkillType) {
    if (this.state.phase !== "playing" || this.state.skillDrop) return false;
    this.spawnSkill(type);
    this.emitChange();
    return true;
  }

  toggleCard(cardId: string) {
    if (this.state.phase !== "playing" || this.state.nowMs < this.state.player.shuffleLockUntilMs) {
      this.reject(translate("notice.selectUnavailable"));
      return false;
    }
    if (!this.state.player.deck.hand.some((card) => card.id === cardId)) return false;
    const selected = new Set(this.state.selectedCardIds);
    if (selected.has(cardId)) selected.delete(cardId);
    else selected.add(cardId);
    this.state = {
      ...this.state,
      selectedCardIds: [...selected],
      revision: this.state.revision + 1,
    };
    this.emitEvent({ type: "sound", sound: "select", side: "player" });
    this.emitChange();
    return true;
  }

  discardSelected() {
    if (this.state.phase !== "playing" || this.state.selectedCardIds.length === 0) return false;
    const result = resolveRedraw({
      player: this.state.player,
      cardIds: this.state.selectedCardIds,
      nowMs: this.state.nowMs,
      random: this.playerRandom,
      config: { redrawCooldownMs: this.state.config.redrawCooldownMs },
    });
    if (!result.ok) {
      this.reject(this.handRejectMessage(result.reason));
      return false;
    }
    this.state = {
      ...this.state,
      player: result.player,
      playerCandidates: visibleCandidates(evaluateHand(result.player.deck.hand)),
      selectedCardIds: [],
      notice: this.notice(translate("notice.shuffled", { count: result.returnedCardIds.length }), "player", 1_000),
      revision: this.state.revision + 1,
    };
    this.emitEvent({ type: "sound", sound: "discard", side: "player" });
    if (this.state.playerCandidates.length > 0) this.emitEvent({ type: "sound", sound: "handReady", side: "player" });
    this.emitChange();
    return true;
  }

  /** Server-side redraw entry point for either PvP seat. */
  redrawSide(side: GameSide, cardIds: readonly string[]) {
    if (this.state.phase !== "playing") return false;
    const actor = side === "player" ? this.state.player : this.state.enemy;
    const random = side === "player" ? this.playerRandom : this.enemyRandom;
    const result = resolveRedraw({
      player: actor,
      cardIds,
      nowMs: this.state.nowMs,
      random,
      config: { redrawCooldownMs: this.state.config.redrawCooldownMs },
    });
    if (!result.ok) return false;

    if (side === "player") {
      this.state = {
        ...this.state,
        player: result.player,
        playerCandidates: visibleCandidates(evaluateHand(result.player.deck.hand)),
        selectedCardIds: [],
        revision: this.state.revision + 1,
      };
    } else {
      this.state = {
        ...this.state,
        enemy: result.player,
        enemyCandidates: visibleCandidates(evaluateHand(result.player.deck.hand)),
        revision: this.state.revision + 1,
      };
    }
    this.emitEvent({ type: "sound", sound: "discard", side });
    this.emitChange();
    return true;
  }

  activatePlayerHand(candidateId: string) {
    const accepted = this.activateHand("player", candidateId);
    this.emitChange();
    return accepted;
  }

  /** Server-side hand activation entry point for either PvP seat. */
  activateSideHand(side: GameSide, candidateId: string) {
    const accepted = this.activateHand(side, candidateId);
    this.emitChange();
    return accepted;
  }

  usePlayerSkill(skillInstanceId: string) {
    const accepted = this.useSkill("player", skillInstanceId);
    this.emitChange();
    return accepted;
  }

  /** Server-side stocked-skill entry point for either PvP seat. */
  useSideSkill(side: GameSide, skillInstanceId: string) {
    const accepted = this.useSkill(side, skillInstanceId);
    this.emitChange();
    return accepted;
  }

  /** Ends an active PvP round when one seat exhausts its reconnect grace period. */
  forfeitSide(side: GameSide) {
    if (this.state.phase !== "playing") return false;
    this.finishMatch(side === "player" ? "LOSE" : "WIN", "FORFEIT");
    this.emitChange();
    return true;
  }

  advanceTime(milliseconds: number, manual = true) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("advanceTime requires a non-negative finite value.");
    if (manual) this.manualClock = true;
    const target = this.state.nowMs + milliseconds;
    while (this.state.nowMs < target) {
      const step = Math.min(50, target - this.state.nowMs);
      const previousTime = this.state.nowMs;
      this.state = { ...this.state, nowMs: this.state.nowMs + step };
      this.processCountdown(previousTime);
      if (this.state.phase === "playing") this.processPlayingState();
      this.pruneTransientState();
    }
    this.state = { ...this.state, revision: this.state.revision + 1 };
    this.emitChange();
  }

  renderText() {
    const { state } = this;
    const revealCards = state.phase === "playing" || state.phase === "result";
    const playerPermissions = this.permissions(state.player, true);
    const enemyPermissions = this.permissions(state.enemy, false);
    const playerState = this.textPlayer(state.player, state.playerCandidates, revealCards, playerPermissions, state.selectedCardIds);
    const enemyState = this.textPlayer(state.enemy, state.enemyCandidates, revealCards, enemyPermissions, []);
    return JSON.stringify({
      schemaVersion: 1,
      coordinateSystem: "DOM battle table; attack canvas uses top-left origin, +x right, +y down",
      mode: "cpu",
      phase: state.phase,
      gameTimeMs: Math.round(state.nowMs),
      countdownRemainingMs: state.countdownEndsAt ? Math.max(0, Math.ceil(state.countdownEndsAt - state.nowMs)) : 0,
      matchRemainingMs: Math.ceil(getMatchRemainingMs(state)),
      player: playerState,
      enemy: enemyState,
      cpu: {
        paused: state.cpuPaused,
        nextActionInMs: Number.isFinite(state.nextCpuActionAt)
          ? Math.max(0, Math.ceil(state.nextCpuActionAt - state.nowMs))
          : null,
      },
      skillDrop: state.skillDrop
        ? {
            id: state.skillDrop.id,
            type: state.skillDrop.type,
            remainingMs: Math.max(0, Math.ceil(state.skillDrop.expiresAt - state.nowMs)),
            claimState: state.skillDrop.claimResolveAt ? "claiming" : "open",
            claimantIds: state.skillDrop.claimantIds,
          }
        : null,
      activeAnimations: state.activeAttacks.map((attack) => ({
        id: attack.id,
        source: attack.source,
        hitCount: attack.cards.length,
        damage: attack.damage,
        blocked: Boolean(attack.blocked),
        elapsedMs: Math.max(0, state.nowMs - attack.startedAt),
      })),
      debugConfig: {
        skillIntervalMs: state.config.skillIntervalMs,
        cpuThinkMinMs: state.config.cpuThinkMinMs,
        cpuThinkMaxMs: state.config.cpuThinkMaxMs,
        blockDurationMs: state.config.blockDurationMs,
      },
      notice: state.notice?.text ?? null,
      result: state.result,
      endReason: state.endReason,
      audio: null,
    });
  }

  private createInitialState(config: GameConfig): GameSnapshot {
    this.playerRandom = new SeededRandom(`${config.seed}:player`);
    this.enemyRandom = new SeededRandom(`${config.seed}:enemy`);
    this.skillRandom = new SeededRandom(`${config.seed}:skill`);
    const player = createPlayerState(PLAYER_ID, createDeckState(PLAYER_ID, this.playerRandom));
    const enemy = createPlayerState(ENEMY_ID, createDeckState(ENEMY_ID, this.enemyRandom));
    return {
      revision: 1,
      phase: "waiting_start",
      nowMs: 0,
      countdownEndsAt: null,
      matchStartedAt: null,
      matchEndsAt: null,
      player,
      enemy,
      playerCandidates: [],
      enemyCandidates: [],
      selectedCardIds: [],
      skillDrop: null,
      nextSkillDropAt: 0,
      nextCpuActionAt: Number.POSITIVE_INFINITY,
      activeAttacks: [],
      notice: null,
      result: null,
      endReason: null,
      config,
      cpuPaused: false,
    };
  }

  private applyFixture(player: PlayerCoreState, fixture?: PlayerFixture) {
    if (!fixture) return player;
    let next = player;
    if (fixture.hand) next = fixedHand(next, fixture.hand);
    const skills = (fixture.skills ?? []).map((type, index) => createSkill(type, `debug-${player.playerId}-${index}-${type}`));
    return {
      ...next,
      hp: fixture.hp ?? next.hp,
      skills: fixture.skills ? skills : next.skills,
      stopUntilMs: fixture.stopRemainingMs ? this.state.nowMs + fixture.stopRemainingMs : next.stopUntilMs,
      blockUntilMs: fixture.blockRemainingMs ? this.state.nowMs + fixture.blockRemainingMs : next.blockUntilMs,
    };
  }

  private processCountdown(previousTime: number) {
    if (this.state.phase !== "countdown" || this.state.countdownEndsAt === null) return;
    const previousCount = Math.max(0, Math.ceil((this.state.countdownEndsAt - previousTime) / 1_000));
    const nextCount = Math.max(0, Math.ceil((this.state.countdownEndsAt - this.state.nowMs) / 1_000));
    if (nextCount !== previousCount && nextCount > 0) {
      this.emitEvent({ type: "sound", sound: "countdown", side: "center", option: nextCount });
    }
    if (this.state.nowMs < this.state.countdownEndsAt) return;
    const playerCandidates = visibleCandidates(evaluateHand(this.state.player.deck.hand));
    const enemyCandidates = visibleCandidates(evaluateHand(this.state.enemy.deck.hand));
    this.state = {
      ...this.state,
      phase: "playing",
      countdownEndsAt: null,
      matchStartedAt: this.state.nowMs,
      matchEndsAt: this.state.nowMs + this.state.config.matchDurationMs,
      playerCandidates,
      enemyCandidates,
      nextSkillDropAt: this.state.nowMs + this.state.config.skillIntervalMs,
      nextCpuActionAt: this.state.nowMs + this.cpuThinkDelay(),
      notice: this.notice(translate("notice.go"), "neutral", 1_100),
    };
    this.emitEvent({ type: "sound", sound: "go", side: "center" });
    this.emitEvent({ type: "sound", sound: "deal", side: "player" });
  }

  private processPlayingState() {
    this.resolveDueAttacks();
    if (this.state.phase !== "playing") return;
    if (this.state.matchEndsAt !== null && this.state.nowMs >= this.state.matchEndsAt) {
      this.finishMatch(this.timeoutResult(), "TIME_UP");
      return;
    }
    this.resolveSkillClaim();
    this.expireSkillDrop();
    if (!this.state.skillDrop && this.state.nowMs >= this.state.nextSkillDropAt) this.spawnSkill();
    if (!this.state.cpuPaused && this.state.nowMs >= this.state.nextCpuActionAt) this.runCpuTurn();
  }

  private activateHand(source: "player" | "enemy", candidateId: string) {
    if (this.state.phase !== "playing") return false;
    const actor = source === "player" ? this.state.player : this.state.enemy;
    const target = source === "player" ? this.state.enemy : this.state.player;
    const random = source === "player" ? this.playerRandom : this.enemyRandom;
    const cardsBefore = actor.deck.hand;
    const result = resolveHandActivation({
      actor,
      target,
      candidateId,
      nowMs: this.state.nowMs,
      random,
      config: { attackCooldownMs: this.state.config.attackCooldownMs },
    });
    if (!result.ok) {
      if (source === "player") this.reject(this.handRejectMessage(result.reason));
      return false;
    }
    const attackCards = result.candidate.cardIds
      .map((cardId) => cardsBefore.find((card) => card.id === cardId))
      .filter((card): card is Card => Boolean(card));
    const openWindow = this.pendingAttackList
      .map((pendingAttack) => pendingAttack.resolveAt)
      .filter((pendingResolveAt) => pendingResolveAt > this.state.nowMs)
      .sort((first, second) => first - second)[0];
    const resolveAt = openWindow ?? this.state.nowMs + ATTACK_WINDOW_MS;
    const attack: PendingAttack = {
      id: `attack-${++this.serial}`,
      source,
      damage: result.damage,
      cards: attackCards,
      resolveAt,
      candidateLabel: result.candidate.label,
    };
    const pending = this.pendingAttacks();
    pending.push(attack);
    this.setPendingAttacks(pending);

    if (source === "player") {
      this.state = {
        ...this.state,
        player: result.actor,
        playerCandidates: visibleCandidates(evaluateHand(result.actor.deck.hand)),
        selectedCardIds: [],
      };
    } else {
      this.state = {
        ...this.state,
        enemy: result.actor,
        enemyCandidates: visibleCandidates(evaluateHand(result.actor.deck.hand)),
      };
    }
    this.registerSkillClaim(actor.playerId);
    if (source === "player") {
      this.state = {
        ...this.state,
        notice: this.notice(translate("notice.roleActivated", {
          role: localizeHand(result.candidate.type, result.candidate.ranks),
        }), "player", 900),
      };
    }
    return true;
  }

  private pendingAttackList: PendingAttack[] = [];

  private pendingAttacks() {
    return [...this.pendingAttackList];
  }

  private setPendingAttacks(attacks: PendingAttack[]) {
    this.pendingAttackList = attacks;
  }

  private resolveDueAttacks() {
    if (this.pendingAttackList.length === 0) return;
    const due = this.pendingAttackList.filter((attack) => attack.resolveAt <= this.state.nowMs);
    if (due.length === 0) return;
    const earliest = Math.min(...due.map((attack) => attack.resolveAt));
    const windowAttacks = due.filter((attack) => attack.resolveAt === earliest);
    this.pendingAttackList = this.pendingAttackList.filter((attack) => attack.resolveAt !== earliest);
    const attemptedPlayerDamage = windowAttacks
      .filter((attack) => attack.source === "player")
      .reduce((sum, attack) => sum + attack.damage, 0);
    const attemptedEnemyDamage = windowAttacks
      .filter((attack) => attack.source === "enemy")
      .reduce((sum, attack) => sum + attack.damage, 0);
    const enemyBlocked = this.state.nowMs < this.state.enemy.blockUntilMs;
    const playerBlocked = this.state.nowMs < this.state.player.blockUntilMs;
    const playerDamage = enemyBlocked ? 0 : attemptedPlayerDamage;
    const enemyDamage = playerBlocked ? 0 : attemptedEnemyDamage;
    const resolution = resolveSimultaneousDamage(this.state.player, this.state.enemy, playerDamage, enemyDamage);
    const newAnimations: AttackVisual[] = windowAttacks.map((attack) => ({
      id: attack.id,
      source: attack.source,
      cards: [...attack.cards],
      damage: attack.damage,
      startedAt: this.state.nowMs,
      blocked: attack.source === "player" ? enemyBlocked : playerBlocked,
    }));
    const blockedAttacks = newAnimations.filter((attack) => attack.blocked);
    this.state = {
      ...this.state,
      player: resolution.first,
      enemy: resolution.second,
      activeAttacks: [...this.state.activeAttacks, ...newAnimations],
      notice:
        blockedAttacks.length > 0
          ? this.notice(
              blockedAttacks.length === newAnimations.length
                ? translate("notice.blockAll")
                : translate("notice.blockOne"),
              "skill",
              1_250,
            )
          : this.state.notice,
    };
    for (const [index, attack] of windowAttacks.entries()) {
      this.emitEvent({
        type: "attackSound",
        side: attack.source,
        cardCount: attack.cards.length,
        damage: attack.damage,
        blocked: Boolean(newAnimations[index]?.blocked),
      });
    }
    if (resolution.outcome.status === "active") return;
    const result: MatchResult =
      resolution.outcome.status === "draw"
        ? "DRAW"
        : resolution.outcome.winnerId === PLAYER_ID
          ? "WIN"
          : "LOSE";
    this.finishMatch(result, "KO");
  }

  private finishMatch(result: MatchResult, endReason: MatchEndReason) {
    this.state = {
      ...this.state,
      phase: "result",
      result,
      endReason,
      skillDrop: null,
      notice: null,
    };
    this.pendingAttackList = [];
    this.emitEvent({ type: "matchResult", result });
  }

  private timeoutResult(): MatchResult {
    if (this.state.player.hp === this.state.enemy.hp) return "DRAW";
    return this.state.player.hp > this.state.enemy.hp ? "WIN" : "LOSE";
  }

  private registerSkillClaim(playerId: string) {
    const drop = this.state.skillDrop;
    if (!drop || this.state.nowMs >= drop.expiresAt) return;
    if (drop.claimResolveAt !== null && this.state.nowMs > drop.claimResolveAt) return;
    const claimantIds = drop.claimantIds.includes(playerId) ? drop.claimantIds : [...drop.claimantIds, playerId];
    this.state = {
      ...this.state,
      skillDrop: {
        ...drop,
        claimantIds,
        claimResolveAt: drop.claimResolveAt ?? this.state.nowMs + this.state.config.claimWindowMs,
      },
    };
  }

  private resolveSkillClaim() {
    const drop = this.state.skillDrop;
    if (!drop?.claimResolveAt || this.state.nowMs < drop.claimResolveAt) return;
    let player = this.state.player;
    let enemy = this.state.enemy;
    let playerAdded = false;
    let enemyAdded = false;
    for (const claimantId of drop.claimantIds) {
      const skill = createSkill(drop.type, `${drop.id}-${claimantId}`);
      if (claimantId === PLAYER_ID) {
        const added = addSkillToStock(player, skill);
        player = added.player;
        playerAdded = added.added;
      } else if (claimantId === ENEMY_ID) {
        const added = addSkillToStock(enemy, skill);
        enemy = added.player;
        enemyAdded = added.added;
      }
    }
    const skillName = localizeSkill(drop.type, undefined, this.state.config.healAmount);
    const claimantText =
      playerAdded && enemyAdded
        ? translate("notice.claimBoth", { skill: skillName })
        : playerAdded
          ? translate("notice.claimPlayer", { skill: skillName })
          : enemyAdded
            ? translate("notice.claimCpu", { skill: skillName })
            : translate("notice.claimFull", { skill: skillName });
    this.state = {
      ...this.state,
      player,
      enemy,
      skillDrop: null,
      notice: this.notice(claimantText, "skill", 1_300),
    };
    this.emitEvent({ type: "sound", sound: "skillClaim", side: playerAdded ? "player" : enemyAdded ? "enemy" : "center" });
  }

  private expireSkillDrop() {
    if (!this.state.skillDrop || this.state.nowMs < this.state.skillDrop.expiresAt) return;
    this.state = {
      ...this.state,
      skillDrop: null,
      notice: this.notice(translate("notice.dropExpired"), "neutral", 900),
    };
  }

  private spawnSkill(forced?: SkillType) {
    const configuredForcedSkill = this.state.config.forcedNextSkill;
    const type =
      forced ??
      (configuredForcedSkill === "RANDOM"
        ? drawWeightedSkill(this.skillRandom, this.state.config.skillWeights)
        : configuredForcedSkill);
    const id = `drop-${++this.serial}`;
    this.state = {
      ...this.state,
      skillDrop: {
        id,
        type,
        appearedAt: this.state.nowMs,
        expiresAt: this.state.nowMs + this.state.config.skillVisibleMs,
        claimResolveAt: null,
        claimantIds: [],
      },
      nextSkillDropAt: this.state.nowMs + this.state.config.skillIntervalMs,
      config:
        configuredForcedSkill === "RANDOM"
          ? this.state.config
          : { ...this.state.config, forcedNextSkill: "RANDOM" },
      notice: this.notice(translate("notice.dropAppeared", {
        skill: localizeSkill(type, undefined, this.state.config.healAmount),
      }), "skill", 1_000),
    };
    this.emitEvent({ type: "sound", sound: "skillDrop", side: "center" });
  }

  private useSkill(source: "player" | "enemy", skillInstanceId: string) {
    if (this.state.phase !== "playing") return false;
    const actor = source === "player" ? this.state.player : this.state.enemy;
    const target = source === "player" ? this.state.enemy : this.state.player;
    if (this.state.nowMs < actor.shuffleLockUntilMs) {
      if (source === "player") this.reject(translate("notice.shuffleLocked"));
      return false;
    }
    const result = resolveSkillUse({
      actor,
      target,
      skillInstanceId,
      nowMs: this.state.nowMs,
      random: source === "player" ? this.playerRandom : this.enemyRandom,
      config: {
        healAmount: this.state.config.healAmount,
        stopDurationMs: this.state.config.stopDurationMs,
        blockDurationMs: this.state.config.blockDurationMs,
        shuffleLockMs: this.state.config.shuffleLockMs,
        skillCooldownMs: this.state.config.skillCooldownMs,
      },
    });
    if (!result.ok) {
      if (source === "player") this.reject(result.reason === "SKILL_COOLDOWN" ? translate("notice.skillCooldown") : translate("notice.skillUnavailable"));
      return false;
    }
    const recoveredHp = result.effect === "HEALED"
      ? Math.max(0, result.actor.hp - actor.hp)
      : 0;
    if (source === "player") {
      this.state = {
        ...this.state,
        player: result.actor,
        enemy: result.target,
        enemyCandidates: visibleCandidates(evaluateHand(result.target.deck.hand)),
      };
      if (result.effect === "SHUFFLED") {
        // CPU has no visible selection, but its next decision must use the new hand.
        this.state = { ...this.state, nextCpuActionAt: Math.max(this.state.nextCpuActionAt, result.target.shuffleLockUntilMs) };
      }
    } else {
      this.state = {
        ...this.state,
        enemy: result.actor,
        player: result.target,
        playerCandidates: visibleCandidates(evaluateHand(result.target.deck.hand)),
        selectedCardIds: result.effect === "SHUFFLED" ? [] : this.state.selectedCardIds,
      };
    }
    const side: SoundSide = source;
    this.emitEvent({ type: "sound", sound: "skillPress", side });
    this.emitSkillSound(result.effect, side);
    if (recoveredHp > 0) {
      this.emitEvent({ type: "healVisual", side: source, amount: recoveredHp });
    }
    const skillName = result.consumedSkill.type;
    const message = this.skillNotice(skillName, result.effect, source, recoveredHp);
    this.state = {
      ...this.state,
      notice: this.notice(message, source === "player" ? "player" : "enemy", 1_250),
    };
    return true;
  }

  private runCpuTurn() {
    const enemy = this.state.enemy;
    if (this.state.nowMs < enemy.shuffleLockUntilMs) {
      this.state = { ...this.state, nextCpuActionAt: enemy.shuffleLockUntilMs + 60 };
      return;
    }
    const skill = this.state.nowMs >= enemy.skillCooldownUntilMs
      ? chooseCpuSkill({ self: enemy, opponent: this.state.player, opponentCandidates: this.state.playerCandidates })
      : undefined;
    if (skill && this.useSkill("enemy", skill.instanceId)) {
      this.state = { ...this.state, nextCpuActionAt: this.state.nowMs + this.cpuThinkDelay() };
      return;
    }
    if (this.state.nowMs < enemy.stopUntilMs || this.state.nowMs < enemy.actionCooldownUntilMs) {
      const unblockAt = Math.max(enemy.stopUntilMs, enemy.actionCooldownUntilMs);
      this.state = { ...this.state, nextCpuActionAt: Math.min(unblockAt + 40, this.state.nowMs + 500) };
      return;
    }
    const action = chooseCpuAction(enemy.deck.hand, this.enemyRandom, "normal");
    if (action.type === "activate") {
      this.activateHand("enemy", action.candidate.candidateId);
    } else {
      const result = resolveRedraw({
        player: enemy,
        cardIds: action.cardIds,
        nowMs: this.state.nowMs,
        random: this.enemyRandom,
        config: { redrawCooldownMs: this.state.config.redrawCooldownMs },
      });
      if (result.ok) {
        this.state = {
          ...this.state,
          enemy: result.player,
          enemyCandidates: visibleCandidates(evaluateHand(result.player.deck.hand)),
        };
        this.emitEvent({ type: "sound", sound: "discard", side: "enemy" });
      }
    }
    this.state = {
      ...this.state,
      nextCpuActionAt:
        Math.max(this.state.nowMs, this.state.enemy.actionCooldownUntilMs) + this.cpuThinkDelay(),
    };
  }

  private pruneTransientState() {
    const activeAttacks = this.state.activeAttacks.filter((attack) => this.state.nowMs - attack.startedAt < 1_300);
    const notice = this.state.notice && this.state.nowMs >= this.state.notice.expiresAt ? null : this.state.notice;
    if (activeAttacks.length !== this.state.activeAttacks.length || notice !== this.state.notice) {
      this.state = { ...this.state, activeAttacks, notice };
    }
  }

  private permissions(player: PlayerCoreState, isPlayer: boolean) {
    const active = this.state.phase === "playing";
    const shuffleLocked = this.state.nowMs < player.shuffleLockUntilMs;
    const stopped = this.state.nowMs < player.stopUntilMs;
    const cooldown = this.state.nowMs < player.actionCooldownUntilMs;
    return {
      selectCards: active && isPlayer && !shuffleLocked,
      activateHand: active && !shuffleLocked && !stopped && !cooldown,
      redraw: active && !shuffleLocked && !stopped && !cooldown,
      useSkill: active && !shuffleLocked && this.state.nowMs >= player.skillCooldownUntilMs,
    };
  }

  private textPlayer(
    player: PlayerCoreState,
    candidates: readonly HandCandidate[],
    faceUp: boolean,
    inputPermissions: ReturnType<GameController["permissions"]>,
    selectedCardIds: readonly string[],
  ) {
    return {
      hp: player.hp,
      maxHp: 100,
      hand: faceUp
        ? player.deck.hand.map((card) => ({ id: card.id, rank: RANK_LABELS[card.rank], suit: card.suit, faceUp: true }))
        : Array.from({ length: 5 }, (_, index) => ({ id: `hidden-${index}`, faceUp: false })),
      deckCount: player.deck.box.length,
      handVersion: player.deck.handVersion,
      selectedCardIds,
      candidates: faceUp
        ? candidates.map((candidate) => ({
            id: candidate.candidateId,
            type: candidate.type,
            label: candidate.label,
            damage: candidate.damage,
            cardIds: candidate.cardIds,
          }))
        : [],
      actionCooldownMs: Math.max(0, Math.ceil(player.actionCooldownUntilMs - this.state.nowMs)),
      skillCooldownMs: Math.max(0, Math.ceil(player.skillCooldownUntilMs - this.state.nowMs)),
      stopRemainingMs: Math.max(0, Math.ceil(player.stopUntilMs - this.state.nowMs)),
      blockRemainingMs: Math.max(0, Math.ceil(player.blockUntilMs - this.state.nowMs)),
      shuffleLockRemainingMs: Math.max(0, Math.ceil(player.shuffleLockUntilMs - this.state.nowMs)),
      skills: player.skills.map((skill) => ({ id: skill.instanceId, type: skill.type })),
      inputPermissions,
    };
  }

  private notice(text: string, tone: NoticeState["tone"], durationMs: number): NoticeState {
    return {
      id: ++this.noticeSerial,
      text,
      tone,
      expiresAt: this.state.nowMs + durationMs,
    };
  }

  private reject(message: string) {
    this.state = {
      ...this.state,
      notice: this.notice(message, "neutral", 800),
      revision: this.state.revision + 1,
    };
    this.emitEvent({ type: "sound", sound: "locked", side: "player" });
    this.emitChange();
  }

  private handRejectMessage(reason: string) {
    if (reason === "STOP") return translate("notice.stopLocked");
    if (reason === "SHUFFLE_LOCK") return translate("notice.shuffleLocked");
    if (reason === "ACTION_COOLDOWN") return translate("notice.actionCooldown");
    return translate("notice.actionUnavailable");
  }

  private skillNotice(skill: SkillType, effect: SkillEffect, source: "player" | "enemy", recoveredHp = 0) {
    const owner = source === "player" ? "" : translate("notice.cpuOwner");
    const skillName = localizeSkill(skill, undefined, this.state.config.healAmount);
    if (effect === "NO_EFFECT") return translate("notice.noEffect", { owner, skill: skillName });
    if (effect === "HEALED") return translate("notice.healed", { owner, amount: recoveredHp });
    if (effect === "STOPPED") return translate("notice.stopped", { owner });
    if (effect === "BLOCKED") {
      const seconds = this.state.config.blockDurationMs / 1_000;
      const duration = Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
      return translate("notice.blocked", { owner, duration });
    }
    if (effect === "SHUFFLED") return translate("notice.forcedShuffle", { owner });
    return translate("notice.stolen", { owner });
  }

  private emitSkillSound(effect: SkillEffect, side: SoundSide) {
    const sound: GameSound =
      effect === "HEALED"
        ? "heal"
        : effect === "STOPPED"
          ? "stop"
          : effect === "BLOCKED"
            ? "blockActivate"
            : effect === "SHUFFLED"
              ? "shuffle"
              : effect === "STOLEN"
                ? "steal"
                : "noEffect";
    this.emitEvent({ type: "sound", sound, side });
  }

  private cpuThinkDelay(config: GameConfig = this.state.config) {
    const first = Number.isFinite(config.cpuThinkMinMs) ? Math.max(0, config.cpuThinkMinMs) : DEFAULT_GAME_CONFIG.cpuThinkMinMs;
    const second = Number.isFinite(config.cpuThinkMaxMs) ? Math.max(0, config.cpuThinkMaxMs) : DEFAULT_GAME_CONFIG.cpuThinkMaxMs;
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    return min + Math.round(this.enemyRandom.next() * (max - min));
  }

  private emitChange() {
    for (const listener of this.listeners) listener();
  }

  private emitEvent(event: GameEvent) {
    for (const listener of this.eventListeners) listener(event);
  }
}

export const gameController = new GameController();
