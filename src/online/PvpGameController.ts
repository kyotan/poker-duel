import type { GameSound, SoundSide } from "../audio/SoundManager";
import type { BattleController } from "../controller/BattleController";
import {
  DEFAULT_GAME_CONFIG,
  type GameConfig,
  type GameEvent,
  type GameSnapshot,
  type MatchResult,
} from "../controller/GameController";
import type { AttackVisual } from "../effects/EffectsCanvas";
import type {
  Card,
  CardRank,
  HandCandidate,
  PlayerCoreState,
  SkillType,
} from "../game";
import type {
  LobbyConnectionState,
  LobbyPhase,
  OnlineLobbySession,
} from "./api";
import type {
  RelativeSide,
  VisibleCard,
  VisibleMatchPlayer,
  VisibleMatchSnapshot,
} from "../shared/protocol";

type Listener = () => void;
type EventListener = (event: GameEvent) => void;

function sideFor(relative: RelativeSide): SoundSide {
  return relative === "self" ? "player" : "enemy";
}

function cardFromWire(card: VisibleCard, ownerId: string): Card {
  return {
    id: card.id,
    ownerId,
    suit: card.suit,
    rank: card.rank as CardRank,
  };
}

/**
 * Countdown cards contain identifiers only. The fake rank/suit values are never
 * rendered face-up or included in renderText; they exist solely so the shared UI
 * can draw the correct number of card backs without receiving private card data.
 */
function hiddenCards(ownerId: string, count: number): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `hidden-${ownerId}-${index}`,
    ownerId,
    suit: "spades" as const,
    rank: 2 as const,
  }));
}

function playerFromWire(player: VisibleMatchPlayer): PlayerCoreState {
  return {
    playerId: player.playerId,
    hp: player.hp,
    deck: {
      ownerId: player.playerId,
      hand: player.hand
        ? player.hand.map((card) => cardFromWire(card, player.playerId))
        : hiddenCards(player.playerId, player.handCount),
      // A client view must never contain the recyclable box or infer its order.
      box: [],
      handVersion: player.handVersion,
    },
    skills: player.skills.map((skill) => ({
      instanceId: skill.instanceId,
      type: skill.type,
    })),
    stopUntilMs: player.stopUntilMs,
    blockUntilMs: player.blockUntilMs,
    shuffleLockUntilMs: player.shuffleLockUntilMs,
    actionCooldownUntilMs: player.actionCooldownUntilMs,
    skillCooldownUntilMs: player.skillCooldownUntilMs,
  };
}

function candidatesFromWire(player: VisibleMatchPlayer): HandCandidate[] {
  return player.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    type: candidate.type,
    label: candidate.type,
    cardIds: [...candidate.cardIds],
    ranks: candidate.ranks as readonly CardRank[],
    damage: candidate.damage,
  }));
}

function attackFromWire(match: VisibleMatchSnapshot, attack: VisibleMatchSnapshot["activeAttacks"][number]): AttackVisual {
  const ownerId = attack.source === "self" ? match.self.playerId : match.opponent.playerId;
  return {
    id: attack.id,
    source: attack.source === "self" ? "player" : "enemy",
    cards: attack.cards.map((card) => cardFromWire(card, ownerId)),
    damage: attack.damage,
    startedAt: attack.startedAt,
    blocked: attack.blocked,
  };
}

function configFromWire(match: VisibleMatchSnapshot): GameConfig {
  const config = match.publicConfig;
  return {
    ...DEFAULT_GAME_CONFIG,
    // This is a public client-view marker, not the authoritative server seed.
    seed: "LAN-PVP-PUBLIC-VIEW",
    countdownMs: config.countdownMs,
    matchDurationMs: config.matchDurationMs,
    attackCooldownMs: config.attackCooldownMs,
    redrawCooldownMs: config.redrawCooldownMs,
    skillIntervalMs: config.skillIntervalMs,
    skillVisibleMs: config.skillVisibleMs,
    claimWindowMs: config.claimWindowMs,
    healAmount: config.healAmount,
    stopDurationMs: config.stopDurationMs,
    blockDurationMs: config.blockDurationMs,
    shuffleLockMs: config.shuffleLockMs,
    skillCooldownMs: config.skillCooldownMs,
    skillWeights: { ...DEFAULT_GAME_CONFIG.skillWeights },
    forcedNextSkill: "RANDOM",
  };
}

function skillDropFromWire(match: VisibleMatchSnapshot) {
  if (!match.skillDrop) return null;
  return {
    id: match.skillDrop.id,
    type: match.skillDrop.type,
    appearedAt: match.skillDrop.appearedAt,
    expiresAt: match.skillDrop.expiresAt,
    claimResolveAt: match.skillDrop.claimResolveAt,
    claimantIds: match.skillDrop.claimants.map((claimant) =>
      claimant === "self" ? match.self.playerId : match.opponent.playerId,
    ),
  };
}

function hasNewCandidate(previous: VisibleMatchPlayer, next: VisibleMatchPlayer) {
  const previousIds = new Set(previous.candidates.map((candidate) => candidate.candidateId));
  return next.candidates.some((candidate) => !previousIds.has(candidate.candidateId));
}

function consumedSkills(previous: VisibleMatchPlayer, next: VisibleMatchPlayer) {
  const nextIds = new Set(next.skills.map((skill) => skill.instanceId));
  return previous.skills.filter((skill) => !nextIds.has(skill.instanceId));
}

function addedSkills(previous: VisibleMatchPlayer, next: VisibleMatchPlayer) {
  const previousIds = new Set(previous.skills.map((skill) => skill.instanceId));
  return next.skills.filter((skill) => !previousIds.has(skill.instanceId));
}

export class PvpGameController implements BattleController {
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly unsubscribeSession: () => void;
  private authoritativeMatch: VisibleMatchSnapshot | null;
  private selectedCardIds = new Set<string>();
  private revision = 0;
  private disposed = false;
  private state: GameSnapshot;

  // The LAN server owns match time and publishes a fresh view every 50 ms.
  // Prevent the browser animation loop from advancing authoritative deadlines.
  readonly isManualClock = true;

  constructor(private readonly session: OnlineLobbySession) {
    this.authoritativeMatch = session.getSnapshot().room.match;
    this.state = this.project(this.authoritativeMatch);
    this.unsubscribeSession = session.subscribe(() => this.receiveSessionUpdate());
  }

  getSnapshot = () => this.state;

  get localDisplayName() {
    const snapshot = this.session.getSnapshot();
    return snapshot.room.players.find((player) => player.playerId === snapshot.localPlayerId)?.displayName
      ?? this.session.localDisplayName;
  }

  get opponentDisplayName() {
    const snapshot = this.session.getSnapshot();
    return snapshot.room.players.find((player) => player.playerId !== snapshot.localPlayerId)?.displayName ?? "";
  }

  get roomCode() {
    return this.session.roomCode;
  }

  get roundId() {
    return this.authoritativeMatch?.roundId ?? null;
  }

  get connection(): LobbyConnectionState {
    return this.session.getSnapshot().connection;
  }

  get opponentConnected() {
    const snapshot = this.session.getSnapshot();
    return snapshot.room.match?.opponent.connected
      ?? snapshot.room.players.find((player) => player.playerId !== snapshot.localPlayerId)?.connected
      ?? false;
  }

  get roomPhase(): LobbyPhase {
    return this.session.getSnapshot().room.phase;
  }

  get serverNowMs() {
    return this.session.getSnapshot().serverNowMs;
  }

  get stateVersion() {
    return this.session.getSnapshot().stateVersion;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeToEvents(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  startMatch() {
    return false;
  }

  rematch() {
    this.session.setRematchReady(true);
  }

  toggleCard(cardId: string) {
    if (!this.canSelect() || !this.state.player.deck.hand.some((card) => card.id === cardId)) return false;
    if (this.selectedCardIds.has(cardId)) this.selectedCardIds.delete(cardId);
    else this.selectedCardIds.add(cardId);
    this.state = { ...this.state, selectedCardIds: [...this.selectedCardIds], revision: ++this.revision };
    this.emitEvent({ type: "sound", sound: "select", side: "player" });
    this.emitChange();
    return true;
  }

  discardSelected() {
    if (!this.canUseHandAction() || this.selectedCardIds.size === 0 || !this.authoritativeMatch) return false;
    return this.session.redraw(this.authoritativeMatch.self.handVersion, [...this.selectedCardIds]);
  }

  activatePlayerHand(candidateId: string) {
    if (!this.canUseHandAction() || !this.authoritativeMatch) return false;
    if (!this.authoritativeMatch.self.candidates.some((candidate) => candidate.candidateId === candidateId)) return false;
    return this.session.activate(this.authoritativeMatch.self.handVersion, candidateId);
  }

  usePlayerSkill(skillInstanceId: string) {
    if (!this.canUseSkill() || !this.authoritativeMatch) return false;
    if (!this.authoritativeMatch.self.skills.some((skill) => skill.instanceId === skillInstanceId)) return false;
    return this.session.useSkill(skillInstanceId);
  }

  advanceTime(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error("advanceTime requires a non-negative finite value.");
    }
    if (milliseconds === 0) return;
    this.state = {
      ...this.state,
      nowMs: this.state.nowMs + milliseconds,
      revision: ++this.revision,
    };
    this.emitChange();
  }

  renderText() {
    const match = this.authoritativeMatch;
    const reveal = match?.phase === "playing" || match?.phase === "result";
    const playerText = (player: VisibleMatchPlayer | undefined, selected: readonly string[]) => player ? {
      playerId: player.playerId,
      displayName: player.displayName,
      connected: player.connected,
      hp: player.hp,
      handVersion: player.handVersion,
      hand: reveal && player.hand
        ? player.hand.map((card) => ({ id: card.id, suit: card.suit, rank: card.rank, faceUp: true }))
        : Array.from({ length: player.handCount }, (_, index) => ({ id: `hidden-${index}`, faceUp: false })),
      selectedCardIds: selected,
      candidates: reveal ? player.candidates : [],
      skills: player.skills,
      stopRemainingMs: Math.max(0, player.stopUntilMs - this.state.nowMs),
      blockRemainingMs: Math.max(0, player.blockUntilMs - this.state.nowMs),
      shuffleLockRemainingMs: Math.max(0, player.shuffleLockUntilMs - this.state.nowMs),
      actionCooldownMs: Math.max(0, player.actionCooldownUntilMs - this.state.nowMs),
      skillCooldownMs: Math.max(0, player.skillCooldownUntilMs - this.state.nowMs),
    } : null;

    return JSON.stringify({
      schemaVersion: 1,
      mode: "lan-pvp",
      roomCode: this.roomCode,
      connection: this.connection,
      roomPhase: this.roomPhase,
      stateVersion: this.stateVersion,
      serverNowMs: this.serverNowMs,
      roundId: match?.roundId ?? null,
      phase: this.state.phase,
      gameTimeMs: Math.round(this.state.nowMs),
      countdownRemainingMs: this.state.countdownEndsAt === null
        ? 0
        : Math.max(0, Math.ceil(this.state.countdownEndsAt - this.state.nowMs)),
      matchRemainingMs: this.state.matchEndsAt === null
        ? 0
        : Math.max(0, Math.ceil(this.state.matchEndsAt - this.state.nowMs)),
      player: playerText(match?.self, [...this.selectedCardIds]),
      enemy: playerText(match?.opponent, []),
      skillDrop: match?.skillDrop ?? null,
      activeAnimations: this.state.activeAttacks.map((attack) => ({
        id: attack.id,
        source: attack.source,
        hitCount: attack.cards.length,
        damage: attack.damage,
        blocked: Boolean(attack.blocked),
        elapsedMs: Math.max(0, this.state.nowMs - attack.startedAt),
      })),
      result: this.state.result,
      endReason: this.state.endReason,
      audio: null,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.detachSession();
    this.session.leave();
  }

  /** Returns the live room session when a cancelled countdown goes back to the lobby. */
  detachSession() {
    if (!this.disposed) {
      this.disposed = true;
      this.unsubscribeSession();
      this.listeners.clear();
      this.eventListeners.clear();
    }
    return this.session;
  }

  private receiveSessionUpdate() {
    if (this.disposed) return;
    const next = this.session.getSnapshot().room.match;
    const previous = this.authoritativeMatch;

    if (previous && next && previous.roundId === next.roundId) {
      this.emitDiffEvents(previous, next);
      if (previous.self.handVersion !== next.self.handVersion) this.selectedCardIds.clear();
    } else if (previous?.roundId !== next?.roundId) {
      this.selectedCardIds.clear();
      if (previous?.phase === "result" && next?.phase === "countdown") {
        this.emitEvent({ type: "sound", sound: "start", side: "center" });
        this.emitEvent({ type: "sound", sound: "countdown", side: "center", option: 5 });
      }
    }

    this.authoritativeMatch = next;
    this.state = this.project(next);
    this.emitChange();
  }

  private emitDiffEvents(previous: VisibleMatchSnapshot, next: VisibleMatchSnapshot) {
    if (previous.phase === "countdown" && next.phase === "playing") {
      this.emitEvent({ type: "sound", sound: "go", side: "center" });
      this.emitEvent({ type: "sound", sound: "deal", side: "player" });
    }

    const previousAttackIds = new Set(previous.activeAttacks.map((attack) => attack.id));
    const newAttacks = next.activeAttacks.filter((attack) => !previousAttackIds.has(attack.id));
    for (const attack of newAttacks) {
      this.emitEvent({
        type: "attackSound",
        side: sideFor(attack.source),
        cardCount: attack.cards.length,
        damage: attack.damage,
        blocked: attack.blocked,
      });
    }

    const selfConsumed = consumedSkills(previous.self, next.self);
    const opponentConsumed = consumedSkills(previous.opponent, next.opponent);
    this.emitConsumedSkillEvents("self", selfConsumed, previous, next);
    this.emitConsumedSkillEvents("opponent", opponentConsumed, previous, next);

    const shuffledSelf = opponentConsumed.some((skill) => skill.type === "SHUFFLE");
    const shuffledOpponent = selfConsumed.some((skill) => skill.type === "SHUFFLE");
    const attackedBySelf = newAttacks.some((attack) => attack.source === "self");
    const attackedByOpponent = newAttacks.some((attack) => attack.source === "opponent");
    this.emitHandVersionEvents(previous.self, next.self, "player", attackedBySelf || shuffledSelf);
    this.emitHandVersionEvents(previous.opponent, next.opponent, "enemy", attackedByOpponent || shuffledOpponent);

    const priorSkillIds = new Set([
      ...previous.self.skills.map((skill) => skill.instanceId),
      ...previous.opponent.skills.map((skill) => skill.instanceId),
    ]);
    if (addedSkills(previous.self, next.self).some((skill) => !priorSkillIds.has(skill.instanceId))) {
      this.emitEvent({ type: "sound", sound: "skillClaim", side: "player" });
    }
    if (addedSkills(previous.opponent, next.opponent).some((skill) => !priorSkillIds.has(skill.instanceId))) {
      this.emitEvent({ type: "sound", sound: "skillClaim", side: "enemy" });
    }

    if (next.skillDrop && next.skillDrop.id !== previous.skillDrop?.id) {
      this.emitEvent({ type: "sound", sound: "skillDrop", side: "center" });
    }

    if (next.result && next.result !== previous.result) {
      this.emitEvent({ type: "matchResult", result: next.result });
    }
  }

  private emitHandVersionEvents(
    previous: VisibleMatchPlayer,
    next: VisibleMatchPlayer,
    side: SoundSide,
    explainedByOtherEvent: boolean,
  ) {
    if (previous.handVersion === next.handVersion || explainedByOtherEvent) return;
    this.emitEvent({ type: "sound", sound: "discard", side });
    if (hasNewCandidate(previous, next)) this.emitEvent({ type: "sound", sound: "handReady", side });
  }

  private emitConsumedSkillEvents(
    actorSide: RelativeSide,
    consumed: readonly { type: SkillType }[],
    previous: VisibleMatchSnapshot,
    next: VisibleMatchSnapshot,
  ) {
    const side = sideFor(actorSide);
    const actorBefore = actorSide === "self" ? previous.self : previous.opponent;
    const actorAfter = actorSide === "self" ? next.self : next.opponent;
    const targetBefore = actorSide === "self" ? previous.opponent : previous.self;
    const targetAfter = actorSide === "self" ? next.opponent : next.self;
    for (const skill of consumed) {
      this.emitEvent({ type: "sound", sound: "skillPress", side });
      this.emitEvent({
        type: "sound",
        sound: this.skillEffectSound(skill.type, actorBefore, actorAfter, targetBefore, targetAfter),
        side,
      });
      if (skill.type === "HEAL") {
        const recoveredHp = Math.min(
          next.publicConfig.healAmount,
          Math.max(0, 100 - actorBefore.hp),
        );
        if (recoveredHp > 0) {
          this.emitEvent({
            type: "healVisual",
            side: actorSide === "self" ? "player" : "enemy",
            amount: recoveredHp,
          });
        }
      }
    }
  }

  private skillEffectSound(
    type: SkillType,
    actorBefore: VisibleMatchPlayer,
    actorAfter: VisibleMatchPlayer,
    targetBefore: VisibleMatchPlayer,
    targetAfter: VisibleMatchPlayer,
  ): GameSound {
    if (type === "HEAL") return actorBefore.hp < 100 ? "heal" : "noEffect";
    if (type === "STOP") return targetAfter.stopUntilMs > targetBefore.stopUntilMs ? "stop" : "noEffect";
    if (type === "BLOCK") return actorAfter.blockUntilMs > actorBefore.blockUntilMs ? "blockActivate" : "noEffect";
    if (type === "SHUFFLE") return targetAfter.handVersion !== targetBefore.handVersion ? "shuffle" : "noEffect";
    return targetAfter.skills.length < targetBefore.skills.length ? "steal" : "noEffect";
  }

  private project(match: VisibleMatchSnapshot | null): GameSnapshot {
    if (!match) return this.emptySnapshot();
    const validSelected = new Set(
      [...this.selectedCardIds].filter((cardId) => match.self.hand?.some((card) => card.id === cardId)),
    );
    this.selectedCardIds = validSelected;
    return {
      revision: ++this.revision,
      phase: match.phase,
      nowMs: match.nowMs,
      countdownEndsAt: match.countdownEndsAt,
      matchStartedAt: match.matchEndsAt === null ? null : match.matchEndsAt - match.publicConfig.matchDurationMs,
      matchEndsAt: match.matchEndsAt,
      player: playerFromWire(match.self),
      enemy: playerFromWire(match.opponent),
      playerCandidates: candidatesFromWire(match.self),
      enemyCandidates: candidatesFromWire(match.opponent),
      selectedCardIds: [...validSelected],
      skillDrop: skillDropFromWire(match),
      nextSkillDropAt: Number.POSITIVE_INFINITY,
      nextCpuActionAt: Number.POSITIVE_INFINITY,
      activeAttacks: match.activeAttacks.map((attack) => attackFromWire(match, attack)),
      notice: null,
      result: match.result as MatchResult | null,
      endReason: match.endReason,
      config: configFromWire(match),
      cpuPaused: true,
    };
  }

  private emptySnapshot(): GameSnapshot {
    const client = this.session.getSnapshot();
    const self = client.room.players.find((player) => player.playerId === client.localPlayerId);
    const opponent = client.room.players.find((player) => player.playerId !== client.localPlayerId);
    const placeholder = (playerId: string): PlayerCoreState => ({
      playerId,
      hp: 100,
      deck: { ownerId: playerId, hand: hiddenCards(playerId, 5), box: [], handVersion: 0 },
      skills: [],
      stopUntilMs: 0,
      blockUntilMs: 0,
      shuffleLockUntilMs: 0,
      actionCooldownUntilMs: 0,
      skillCooldownUntilMs: 0,
    });
    return {
      revision: ++this.revision,
      phase: "waiting_start",
      nowMs: 0,
      countdownEndsAt: null,
      matchStartedAt: null,
      matchEndsAt: null,
      player: placeholder(self?.playerId ?? client.localPlayerId),
      enemy: placeholder(opponent?.playerId ?? "opponent"),
      playerCandidates: [],
      enemyCandidates: [],
      selectedCardIds: [],
      skillDrop: null,
      nextSkillDropAt: Number.POSITIVE_INFINITY,
      nextCpuActionAt: Number.POSITIVE_INFINITY,
      activeAttacks: [],
      notice: null,
      result: null,
      endReason: null,
      config: { ...DEFAULT_GAME_CONFIG, seed: "LAN-PVP-PUBLIC-VIEW", skillWeights: { ...DEFAULT_GAME_CONFIG.skillWeights } },
      cpuPaused: true,
    };
  }

  private canSelect() {
    const match = this.authoritativeMatch;
    return Boolean(match && match.phase === "playing" && match.nowMs >= match.self.shuffleLockUntilMs);
  }

  private canUseHandAction() {
    const match = this.authoritativeMatch;
    return Boolean(match
      && match.phase === "playing"
      && match.nowMs >= match.self.shuffleLockUntilMs
      && match.nowMs >= match.self.stopUntilMs
      && match.nowMs >= match.self.actionCooldownUntilMs);
  }

  private canUseSkill() {
    const match = this.authoritativeMatch;
    return Boolean(match
      && match.phase === "playing"
      && match.nowMs >= match.self.shuffleLockUntilMs
      && match.nowMs >= match.self.skillCooldownUntilMs);
  }

  private emitEvent(event: GameEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }

  private emitChange() {
    this.listeners.forEach((listener) => listener());
  }
}
