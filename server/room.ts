import { createHash, randomBytes, randomInt } from "node:crypto";

import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  normalizeDisplayName,
  normalizeRoomCode,
  type ApiErrorCode,
  type ClientCommand,
  type CommandRejectReason,
  type PublicMatchConfig,
  type RoomAccessResponse,
  type RoomPlayerSnapshot,
  type RoomState,
  type StateSnapshotMessage,
  type VisibleCard,
  type VisibleHandCandidate,
  type VisibleMatchPlayer,
  type VisibleMatchSnapshot,
  type WireMatchEndReason,
  type WireMatchResult,
  type WireSkillType,
} from "../src/shared/protocol.ts";

const SOCKET_TICKET_LIFETIME_MS = 30_000;
const EMPTY_WAITING_ROOM_LIFETIME_MS = 15 * 60_000;
const COMMAND_HISTORY_LIMIT = 128;
const SERVER_TICK_MS = 50;
const RECONNECT_GRACE_MS = 30_000;

type InternalSide = "player" | "enemy";

interface InternalCard {
  readonly id: string;
  readonly suit: VisibleCard["suit"];
  readonly rank: number;
}

interface InternalCandidate {
  readonly candidateId: string;
  readonly type: VisibleHandCandidate["type"];
  readonly cardIds: readonly string[];
  readonly ranks: readonly number[];
  readonly damage: number;
}

interface InternalPlayerState {
  readonly playerId: string;
  readonly hp: number;
  readonly deck: {
    readonly hand: readonly InternalCard[];
    readonly handVersion: number;
  };
  readonly skills: readonly { readonly instanceId: string; readonly type: WireSkillType }[];
  readonly stopUntilMs: number;
  readonly blockUntilMs: number;
  readonly shuffleLockUntilMs: number;
  readonly actionCooldownUntilMs: number;
  readonly skillCooldownUntilMs: number;
}

interface InternalGameSnapshot {
  readonly phase: VisibleMatchSnapshot["phase"];
  readonly nowMs: number;
  readonly countdownEndsAt: number | null;
  readonly matchEndsAt: number | null;
  readonly player: InternalPlayerState;
  readonly enemy: InternalPlayerState;
  readonly playerCandidates: readonly InternalCandidate[];
  readonly enemyCandidates: readonly InternalCandidate[];
  readonly skillDrop: null | {
    readonly id: string;
    readonly type: WireSkillType;
    readonly appearedAt: number;
    readonly expiresAt: number;
    readonly claimResolveAt: number | null;
    readonly claimantIds: readonly string[];
  };
  readonly activeAttacks: readonly {
    readonly id: string;
    readonly source: InternalSide;
    readonly cards: readonly InternalCard[];
    readonly damage: number;
    readonly startedAt: number;
    readonly blocked?: boolean;
  }[];
  readonly result: WireMatchResult | null;
  readonly endReason: WireMatchEndReason | null;
  readonly config: PublicMatchConfig & Record<string, unknown>;
}

interface ServerGameController {
  getSnapshot(): InternalGameSnapshot;
  applyConfig(patch: { countdownMs: number }): void;
  preparePvp(seed: string): void;
  startMatch(): boolean;
  advanceTime(milliseconds: number, manual?: boolean): void;
  redrawSide(side: InternalSide, cardIds: readonly string[]): boolean;
  activateSideHand(side: InternalSide, candidateId: string): boolean;
  useSideSkill(side: InternalSide, instanceId: string): boolean;
  forfeitSide(side: InternalSide): boolean;
}

interface ServerGameControllerConstructor {
  new (): ServerGameController;
}

// GameController currently imports UI localization. Keeping this import opaque
// prevents the Node-only server typecheck from pulling React/DOM declarations;
// the tsx/Vitest runtime still loads the real shared controller.
const controllerModulePath = "../src/controller/" + "GameController.ts";
const { GameController } = (await import(controllerModulePath)) as { GameController: ServerGameControllerConstructor };

type InternalRoomErrorCode =
  | ApiErrorCode
  | "SOCKET_TICKET_DENIED"
  | "PLAYER_ALREADY_CONNECTED"
  | "ROOM_CODE_GENERATION_FAILED";

export class RoomError extends Error {
  constructor(readonly code: InternalRoomErrorCode) {
    super(code);
    this.name = "RoomError";
  }
}

interface TimerDriver {
  readonly now: () => number;
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const systemTimer: TimerDriver = {
  now: () => Date.now(),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface StoredCommandResult {
  readonly ok: boolean;
  readonly reason?: CommandRejectReason;
}

interface RoomPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: 1 | 2;
  resumeTokenHash: string;
  connected: boolean;
  departed: boolean;
  ready: boolean;
  lastSeq: number;
  readonly commands: Map<string, StoredCommandResult>;
}

interface SocketTicketRecord {
  readonly roomCode: string;
  readonly playerId: string;
  readonly expiresAt: number;
}

export interface RoomCredentials {
  readonly roomCode: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly socketTicket: string;
  readonly resumeToken: string;
}

export interface ApplyCommandResult {
  readonly ok: boolean;
  readonly duplicate: boolean;
  readonly changed: boolean;
  readonly leftRoom: boolean;
  readonly stateVersion: number;
  readonly reason?: CommandRejectReason;
}

export interface RoomDirectoryOptions {
  readonly countdownMs?: number;
  readonly timer?: TimerDriver;
  readonly roomCodeFactory?: () => string;
  readonly tokenFactory?: () => string;
  readonly matchSeedFactory?: (roomCode: string, roundNumber: number) => string;
}

type RoomChangeListener = (roomCode: string, snapshot: StateSnapshotMessage) => void;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function defaultToken(): string {
  return randomBytes(24).toString("base64url");
}

function defaultRoomCode(): string {
  let result = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    result += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return result;
}

function defaultMatchSeed(roomCode: string, roundNumber: number) {
  return `${roomCode}:${roundNumber}:${randomBytes(16).toString("hex")}`;
}

function publicCard(card: InternalCard): VisibleCard {
  return { id: card.id, suit: card.suit, rank: card.rank };
}

function publicCandidate(candidate: InternalCandidate): VisibleHandCandidate {
  return {
    candidateId: candidate.candidateId,
    type: candidate.type,
    cardIds: [...candidate.cardIds],
    ranks: [...candidate.ranks],
    damage: candidate.damage,
  };
}

class LobbyRoom {
  private readonly players = new Map<string, RoomPlayer>();
  private readonly controller: ServerGameController;
  private version = 0;
  private countdownEndsAt: number | null = null;
  private tickTimer: unknown = null;
  private readonly disconnectTimers = new Map<string, unknown>();
  private lastTickAt = 0;
  private paused = false;
  private lastActivityAt: number;
  private roundNumber = 1;
  private matchSeed: string;

  constructor(
    readonly code: string,
    private readonly timer: TimerDriver,
    countdownMs: number,
    private readonly seedFactory: (roomCode: string, roundNumber: number) => string,
    private readonly changed: () => void,
  ) {
    this.lastActivityAt = timer.now();
    this.controller = new GameController();
    if (countdownMs !== this.controller.getSnapshot().config.countdownMs) {
      this.controller.applyConfig({ countdownMs });
    }
    this.matchSeed = this.seedFactory(code, this.roundNumber);
    this.controller.preparePvp(this.matchSeed);
  }

  get stateVersion() {
    return this.version;
  }

  get playerCount() {
    return this.players.size;
  }

  get connectedPlayerCount() {
    return [...this.players.values()].filter((player) => player.connected).length;
  }

  get updatedAt() {
    return this.lastActivityAt;
  }

  hasPlayer(playerId: string) {
    const player = this.players.get(playerId);
    return Boolean(player && !player.departed);
  }

  playerName(playerId: string) {
    return this.players.get(playerId)?.displayName ?? null;
  }

  addPlayer(displayName: string, playerId: string, resumeTokenHash: string) {
    if (this.players.size >= 2) throw new RoomError("ROOM_FULL");
    const occupied = new Set([...this.players.values()].map((player) => player.seat));
    const seat: 1 | 2 = occupied.has(1) ? 2 : 1;
    this.players.set(playerId, {
      playerId,
      displayName,
      seat,
      resumeTokenHash,
      connected: false,
      departed: false,
      ready: false,
      lastSeq: -1,
      commands: new Map(),
    });
    this.mutated();
  }

  validateResume(playerId: string, resumeToken: string) {
    const player = this.players.get(playerId);
    if (!player || player.departed || player.resumeTokenHash !== tokenHash(resumeToken)) {
      throw new RoomError("RESUME_DENIED");
    }
  }

  rotateResumeToken(playerId: string, resumeTokenHash: string) {
    const player = this.players.get(playerId);
    if (!player) throw new RoomError("RESUME_DENIED");
    player.resumeTokenHash = resumeTokenHash;
    this.touch();
  }

  connect(playerId: string) {
    const player = this.players.get(playerId);
    if (!player || player.departed) throw new RoomError("SOCKET_TICKET_DENIED");
    if (player.connected) throw new RoomError("PLAYER_ALREADY_CONNECTED");
    player.connected = true;
    this.clearDisconnectTimer(playerId);
    if (this.paused && this.players.size === 2 && [...this.players.values()].every((entry) => entry.connected)) {
      this.paused = false;
      this.startTicking();
    } else if (
      this.controller.getSnapshot().phase === "result" &&
      this.players.size === 2 &&
      [...this.players.values()].every((entry) => entry.connected && entry.ready)
    ) {
      this.startNextRound();
    }
    this.mutated();
  }

  disconnect(playerId: string) {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return false;
    player.connected = false;
    const phase = this.controller.getSnapshot().phase;
    if (phase === "countdown") {
      this.cancelTick();
      this.controller.preparePvp(this.matchSeed);
      this.countdownEndsAt = null;
      for (const entry of this.players.values()) entry.ready = false;
    } else if (phase === "playing") {
      this.paused = true;
      this.cancelTick();
      this.startDisconnectTimer(player);
    } else if (phase === "waiting_start") {
      for (const entry of this.players.values()) entry.ready = false;
    }
    this.mutated();
    return true;
  }

  removePlayer(playerId: string) {
    const removedPlayer = this.players.get(playerId);
    if (!removedPlayer) return false;
    this.clearDisconnectTimer(playerId);
    const phase = this.controller.getSnapshot().phase;
    if (phase === "playing") {
      removedPlayer.connected = false;
      removedPlayer.departed = true;
      removedPlayer.ready = false;
      removedPlayer.resumeTokenHash = "departed";
      this.paused = false;
      this.cancelTick();
      for (const timer of this.disconnectTimers.values()) this.timer.clear(timer);
      this.disconnectTimers.clear();
      const side: InternalSide = removedPlayer.seat === 1 ? "player" : "enemy";
      this.controller.forfeitSide(side);
      this.countdownEndsAt = null;
      this.mutated();
      return true;
    }
    this.players.delete(playerId);
    if (phase === "countdown") {
      this.cancelTick();
      this.controller.preparePvp(this.matchSeed);
      this.countdownEndsAt = null;
    }
    for (const entry of this.players.values()) entry.ready = false;
    this.mutated();
    return true;
  }

  applyCommand(playerId: string, command: ClientCommand): ApplyCommandResult {
    const player = this.players.get(playerId);
    if (!player) return this.rejected("PLAYER_NOT_FOUND");
    const previous = player.commands.get(command.commandId);
    if (previous) {
      return {
        ok: previous.ok,
        duplicate: true,
        changed: false,
        leftRoom: false,
        stateVersion: this.version,
        reason: previous.reason,
      };
    }
    if (command.seq <= player.lastSeq) return this.rejected("STALE_SEQUENCE");
    player.lastSeq = command.seq;

    let result: ApplyCommandResult;
    if (!player.connected) {
      result = this.rejected("PLAYER_NOT_CONNECTED");
    } else if (command.kind === "sync.request") {
      result = this.accepted(false);
    } else if (command.kind === "room.leave") {
      result = { ...this.accepted(false), leftRoom: true };
    } else if (command.kind === "ready.set") {
      result = this.setReady(player, command.payload.ready);
    } else if (command.kind === "rematch.ready") {
      result = this.setRematchReady(player, command);
    } else {
      result = this.applyMatchCommand(player, command);
    }
    this.rememberCommand(player, command.commandId, result);
    return result;
  }

  snapshot(viewerPlayerId?: string): RoomState {
    const players = this.publicPlayers();
    const viewer = this.players.get(viewerPlayerId ?? "") ?? [...this.players.values()].sort((a, b) => a.seat - b.seat)[0];
    return {
      roomCode: this.code,
      phase: this.phase(),
      players,
      countdownEndsAt: this.countdownEndsAt,
      match: viewer ? this.visibleMatch(viewer) : null,
    };
  }

  dispose() {
    this.cancelTick();
    for (const timer of this.disconnectTimers.values()) this.timer.clear(timer);
    this.disconnectTimers.clear();
  }

  private setReady(player: RoomPlayer, ready: boolean): ApplyCommandResult {
    const match = this.controller.getSnapshot();
    if (match.phase !== "waiting_start") return this.rejected("MATCH_ALREADY_STARTED");
    if (this.players.size < 2) return this.rejected("WAITING_FOR_PLAYER");
    if (player.ready === ready) return this.accepted(false);
    player.ready = ready;
    this.mutated();
    if ([...this.players.values()].every((entry) => entry.ready && entry.connected)) this.beginCountdown();
    return this.accepted(true);
  }

  private setRematchReady(player: RoomPlayer, command: Extract<ClientCommand, { kind: "rematch.ready" }>) {
    const match = this.controller.getSnapshot();
    if (command.roundId !== this.roundId()) return this.rejected("ROUND_MISMATCH");
    if (match.phase !== "result") return this.rejected("MATCH_NOT_STARTED");
    if (player.ready === command.payload.ready) return this.accepted(false);
    player.ready = command.payload.ready;
    this.mutated();
    if ([...this.players.values()].every((entry) => entry.ready && entry.connected)) {
      this.startNextRound();
    }
    return this.accepted(true);
  }

  private applyMatchCommand(
    player: RoomPlayer,
    command: Extract<ClientCommand, { kind: "hand.redraw" | "hand.activate" | "skill.use" }>,
  ): ApplyCommandResult {
    if (command.roundId !== this.roundId()) return this.rejected("ROUND_MISMATCH");
    if (this.paused) return this.rejected("MATCH_PAUSED");
    const match = this.controller.getSnapshot();
    if (match.phase === "result") return this.rejected("MATCH_FINISHED");
    if (match.phase !== "playing") return this.rejected("MATCH_NOT_STARTED");
    const side: InternalSide = player.seat === 1 ? "player" : "enemy";
    const actor = side === "player" ? match.player : match.enemy;
    const candidates = side === "player" ? match.playerCandidates : match.enemyCandidates;

    let accepted = false;
    if (command.kind === "hand.redraw") {
      if (command.payload.handVersion !== actor.deck.handVersion) return this.rejected("STALE_HAND");
      const handIds = new Set(actor.deck.hand.map((card) => card.id));
      if (command.payload.cardIds.some((cardId) => !handIds.has(cardId))) {
        return this.rejected("INVALID_CARD_SELECTION");
      }
      accepted = this.controller.redrawSide(side, command.payload.cardIds);
    } else if (command.kind === "hand.activate") {
      if (command.payload.handVersion !== actor.deck.handVersion) return this.rejected("STALE_HAND");
      if (!candidates.some((candidate) => candidate.candidateId === command.payload.candidateId)) {
        return this.rejected("INVALID_CANDIDATE");
      }
      accepted = this.controller.activateSideHand(side, command.payload.candidateId);
    } else {
      if (!actor.skills.some((skill) => skill.instanceId === command.payload.instanceId)) {
        return this.rejected("INVALID_SKILL");
      }
      accepted = this.controller.useSideSkill(side, command.payload.instanceId);
    }
    if (!accepted) return this.rejected("ACTION_REJECTED");
    this.mutated();
    return this.accepted(true);
  }

  private beginCountdown() {
    if (!this.controller.startMatch()) return;
    const match = this.controller.getSnapshot();
    // READY is a lobby/rematch latch, not a value that carries into the round.
    for (const entry of this.players.values()) entry.ready = false;
    this.countdownEndsAt = this.timer.now() + (match.countdownEndsAt! - match.nowMs);
    this.paused = false;
    this.startTicking();
    this.mutated();
  }

  private startNextRound() {
    this.roundNumber += 1;
    this.matchSeed = this.seedFactory(this.code, this.roundNumber);
    this.controller.preparePvp(this.matchSeed);
    for (const entry of this.players.values()) entry.ready = false;
    this.beginCountdown();
  }

  private startTicking() {
    if (this.tickTimer !== null || this.paused) return;
    this.lastTickAt = this.timer.now();
    this.tickTimer = this.timer.set(() => this.tick(), SERVER_TICK_MS);
  }

  private tick() {
    this.tickTimer = null;
    if (this.paused) return;
    const before = this.controller.getSnapshot();
    const phaseBefore = before.phase;
    if (phaseBefore !== "countdown" && phaseBefore !== "playing") return;
    const now = this.timer.now();
    const wallElapsed = Math.max(0, now - this.lastTickAt);
    // A delayed Node timer must not advance the authoritative game clock past
    // the three-minute deadline. This also prevents an attack whose resolveAt
    // is after the deadline from being applied before the timeout decision.
    const elapsed = phaseBefore === "playing" && before.matchEndsAt !== null
      ? Math.min(wallElapsed, Math.max(0, before.matchEndsAt - before.nowMs))
      : wallElapsed;
    this.lastTickAt = now;
    this.controller.advanceTime(elapsed, false);
    const phaseAfter = this.controller.getSnapshot().phase;
    if (phaseAfter !== "countdown") this.countdownEndsAt = null;
    this.mutated();
    if (phaseAfter === "countdown" || phaseAfter === "playing") {
      this.tickTimer = this.timer.set(() => this.tick(), SERVER_TICK_MS);
    }
  }

  private cancelTick() {
    if (this.tickTimer !== null) this.timer.clear(this.tickTimer);
    this.tickTimer = null;
  }

  private startDisconnectTimer(player: RoomPlayer) {
    if (this.disconnectTimers.has(player.playerId)) return;
    const handle = this.timer.set(() => {
      this.disconnectTimers.delete(player.playerId);
      const current = this.players.get(player.playerId);
      if (!current || current.connected || this.controller.getSnapshot().phase !== "playing") return;
      const side: InternalSide = current.seat === 1 ? "player" : "enemy";
      if (!this.controller.forfeitSide(side)) return;
      this.paused = false;
      this.countdownEndsAt = null;
      for (const timer of this.disconnectTimers.values()) this.timer.clear(timer);
      this.disconnectTimers.clear();
      this.mutated();
    }, RECONNECT_GRACE_MS);
    this.disconnectTimers.set(player.playerId, handle);
  }

  private clearDisconnectTimer(playerId: string) {
    const handle = this.disconnectTimers.get(playerId);
    if (handle === undefined) return;
    this.timer.clear(handle);
    this.disconnectTimers.delete(playerId);
  }

  private publicPlayers(): RoomPlayerSnapshot[] {
    return [...this.players.values()]
      .sort((left, right) => left.seat - right.seat)
      .map(({ playerId, displayName, seat, connected, ready }) => ({
        playerId,
        displayName,
        seat,
        connected,
        ready,
      }));
  }

  private visibleMatch(viewer: RoomPlayer): VisibleMatchSnapshot | null {
    const match = this.controller.getSnapshot();
    if (match.phase === "waiting_start") return null;
    const seatOne = [...this.players.values()].find((entry) => entry.seat === 1);
    const seatTwo = [...this.players.values()].find((entry) => entry.seat === 2);
    if (!seatOne || !seatTwo) return null;
    const viewerIsSeatOne = viewer.seat === 1;
    const revealCards = match.phase === "playing" || match.phase === "result";
    const selfPlayer = viewerIsSeatOne ? seatOne : seatTwo;
    const opponentPlayer = viewerIsSeatOne ? seatTwo : seatOne;
    const selfCore = viewerIsSeatOne ? match.player : match.enemy;
    const opponentCore = viewerIsSeatOne ? match.enemy : match.player;
    const selfCandidates = viewerIsSeatOne ? match.playerCandidates : match.enemyCandidates;
    const opponentCandidates = viewerIsSeatOne ? match.enemyCandidates : match.playerCandidates;
    const selfInternalSide: InternalSide = viewerIsSeatOne ? "player" : "enemy";
    const result = viewerIsSeatOne ? match.result : this.reverseResult(match.result);
    const config = match.config;

    return {
      roundId: this.roundId(),
      phase: match.phase,
      nowMs: match.nowMs,
      countdownEndsAt: match.countdownEndsAt,
      matchEndsAt: match.matchEndsAt,
      self: this.visiblePlayer(selfPlayer, selfCore, selfCandidates, revealCards),
      opponent: this.visiblePlayer(opponentPlayer, opponentCore, opponentCandidates, revealCards),
      skillDrop: match.skillDrop
        ? {
            id: match.skillDrop.id,
            type: match.skillDrop.type,
            appearedAt: match.skillDrop.appearedAt,
            expiresAt: match.skillDrop.expiresAt,
            claimResolveAt: match.skillDrop.claimResolveAt,
            claimants: match.skillDrop.claimantIds.map((claimant) =>
              claimant === selfCore.playerId ? "self" as const : "opponent" as const,
            ),
          }
        : null,
      activeAttacks: match.activeAttacks.map((attack) => ({
        id: attack.id,
        source: attack.source === selfInternalSide ? "self" : "opponent",
        cards: attack.cards.map(publicCard),
        damage: attack.damage,
        startedAt: attack.startedAt,
        blocked: Boolean(attack.blocked),
      })),
      result,
      endReason: match.endReason,
      publicConfig: {
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
      },
    };
  }

  private visiblePlayer(
    roomPlayer: RoomPlayer,
    core: InternalPlayerState,
    candidates: readonly InternalCandidate[],
    revealCards: boolean,
  ): VisibleMatchPlayer {
    return {
      playerId: roomPlayer.playerId,
      displayName: roomPlayer.displayName,
      connected: roomPlayer.connected,
      hp: core.hp,
      handVersion: core.deck.handVersion,
      hand: revealCards ? core.deck.hand.map(publicCard) : null,
      handCount: core.deck.hand.length,
      candidates: revealCards ? candidates.map(publicCandidate) : [],
      skills: core.skills.map((skill) => ({ instanceId: skill.instanceId, type: skill.type })),
      stopUntilMs: core.stopUntilMs,
      blockUntilMs: core.blockUntilMs,
      shuffleLockUntilMs: core.shuffleLockUntilMs,
      actionCooldownUntilMs: core.actionCooldownUntilMs,
      skillCooldownUntilMs: core.skillCooldownUntilMs,
    };
  }

  private reverseResult(result: WireMatchResult | null): WireMatchResult | null {
    if (result === "WIN") return "LOSE";
    if (result === "LOSE") return "WIN";
    return result;
  }

  private roundId(): `round-${number}` {
    return `round-${this.roundNumber}`;
  }

  private phase(): RoomState["phase"] {
    const matchPhase = this.controller.getSnapshot().phase;
    if (this.players.size < 2) return "waiting_for_player";
    if (this.paused) return "paused";
    if (matchPhase === "countdown") return "countdown";
    if (matchPhase === "playing") return "playing";
    if (matchPhase === "result") return "result";
    return "waiting_for_ready";
  }

  private rememberCommand(player: RoomPlayer, commandId: string, result: ApplyCommandResult) {
    player.commands.set(commandId, { ok: result.ok, reason: result.reason });
    while (player.commands.size > COMMAND_HISTORY_LIMIT) {
      const oldest = player.commands.keys().next().value;
      if (oldest === undefined) break;
      player.commands.delete(oldest);
    }
  }

  private accepted(changed: boolean): ApplyCommandResult {
    return { ok: true, duplicate: false, changed, leftRoom: false, stateVersion: this.version };
  }

  private rejected(reason: CommandRejectReason): ApplyCommandResult {
    return { ok: false, duplicate: false, changed: false, leftRoom: false, stateVersion: this.version, reason };
  }

  private touch() {
    this.lastActivityAt = this.timer.now();
  }

  private mutated() {
    this.version += 1;
    this.touch();
    this.changed();
  }
}

export class RoomDirectory {
  private readonly rooms = new Map<string, LobbyRoom>();
  private readonly tickets = new Map<string, SocketTicketRecord>();
  private readonly listeners = new Set<RoomChangeListener>();
  private readonly timer: TimerDriver;
  private readonly countdownMs: number;
  private readonly roomCodeFactory: () => string;
  private readonly tokenFactory: () => string;
  private readonly matchSeedFactory: (roomCode: string, roundNumber: number) => string;

  constructor(options: RoomDirectoryOptions = {}) {
    this.timer = options.timer ?? systemTimer;
    this.countdownMs = options.countdownMs ?? 5_000;
    this.roomCodeFactory = options.roomCodeFactory ?? defaultRoomCode;
    this.tokenFactory = options.tokenFactory ?? defaultToken;
    this.matchSeedFactory = options.matchSeedFactory ?? defaultMatchSeed;
  }

  createRoom(rawDisplayName: string): RoomCredentials {
    this.prune();
    const displayName = this.validName(rawDisplayName);
    let roomCode = "";
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = normalizeRoomCode(this.roomCodeFactory());
      if (candidate.length === ROOM_CODE_LENGTH && !this.rooms.has(candidate)) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) throw new RoomError("ROOM_CODE_GENERATION_FAILED");
    const room = new LobbyRoom(
      roomCode,
      this.timer,
      this.countdownMs,
      this.matchSeedFactory,
      () => this.emit(roomCode),
    );
    this.rooms.set(roomCode, room);
    return this.addPlayer(room, displayName);
  }

  joinRoom(rawRoomCode: string, rawDisplayName: string): RoomCredentials {
    this.prune();
    const room = this.requireRoom(rawRoomCode);
    if (room.playerCount >= 2) throw new RoomError("ROOM_FULL");
    return this.addPlayer(room, this.validName(rawDisplayName));
  }

  resumeRoom(rawRoomCode: string, playerId: string, resumeToken: string): RoomCredentials {
    this.prune();
    const room = this.requireRoom(rawRoomCode);
    room.validateResume(playerId, resumeToken);
    const rotatedResumeToken = this.tokenFactory();
    room.rotateResumeToken(playerId, tokenHash(rotatedResumeToken));
    return this.issueCredentials(room, playerId, room.playerName(playerId) ?? "", rotatedResumeToken);
  }

  consumeSocketTicket(rawRoomCode: string, socketTicket: string): { roomCode: string; playerId: string } {
    this.pruneTickets();
    const roomCode = normalizeRoomCode(rawRoomCode);
    const ticket = this.tickets.get(socketTicket);
    if (!ticket || ticket.roomCode !== roomCode || ticket.expiresAt < this.timer.now()) {
      throw new RoomError("SOCKET_TICKET_DENIED");
    }
    this.tickets.delete(socketTicket);
    const room = this.rooms.get(roomCode);
    if (!room?.hasPlayer(ticket.playerId)) throw new RoomError("SOCKET_TICKET_DENIED");
    return { roomCode, playerId: ticket.playerId };
  }

  connect(roomCode: string, playerId: string) {
    this.requireRoom(roomCode).connect(playerId);
  }

  disconnect(roomCode: string, playerId: string) {
    this.rooms.get(normalizeRoomCode(roomCode))?.disconnect(playerId);
  }

  applyCommand(roomCode: string, playerId: string, command: ClientCommand): ApplyCommandResult {
    const room = this.rooms.get(normalizeRoomCode(roomCode));
    if (!room) return { ok: false, duplicate: false, changed: false, leftRoom: false, stateVersion: 0, reason: "PLAYER_NOT_FOUND" };
    const result = room.applyCommand(playerId, command);
    if (result.leftRoom) this.leave(roomCode, playerId);
    return result;
  }

  leave(roomCode: string, playerId: string) {
    const normalized = normalizeRoomCode(roomCode);
    const room = this.rooms.get(normalized);
    if (!room?.removePlayer(playerId)) return;
    if (room.playerCount === 0 || room.connectedPlayerCount === 0) {
      room.dispose();
      this.rooms.delete(normalized);
    }
  }

  snapshot(rawRoomCode: string, viewerPlayerId?: string): StateSnapshotMessage {
    const room = this.requireRoom(rawRoomCode);
    return {
      protocolVersion: PROTOCOL_VERSION,
      kind: "state.snapshot",
      serverNowMs: this.timer.now(),
      stateVersion: room.stateVersion,
      state: room.snapshot(viewerPlayerId),
    };
  }

  subscribe(listener: RoomChangeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.tickets.clear();
    this.listeners.clear();
  }

  private addPlayer(room: LobbyRoom, displayName: string) {
    const playerId = `p_${this.tokenFactory().slice(0, 12)}`;
    const resumeToken = this.tokenFactory();
    room.addPlayer(displayName, playerId, tokenHash(resumeToken));
    return this.issueCredentials(room, playerId, displayName, resumeToken);
  }

  private issueCredentials(room: LobbyRoom, playerId: string, displayName: string, resumeToken: string): RoomCredentials {
    const socketTicket = this.tokenFactory();
    this.tickets.set(socketTicket, { roomCode: room.code, playerId, expiresAt: this.timer.now() + SOCKET_TICKET_LIFETIME_MS });
    return { roomCode: room.code, playerId, displayName, socketTicket, resumeToken };
  }

  private requireRoom(rawRoomCode: string) {
    const roomCode = normalizeRoomCode(rawRoomCode);
    if (roomCode.length !== ROOM_CODE_LENGTH) throw new RoomError("INVALID_ROOM_CODE");
    const room = this.rooms.get(roomCode);
    if (!room) throw new RoomError("ROOM_NOT_FOUND");
    return room;
  }

  private validName(rawDisplayName: string) {
    const displayName = normalizeDisplayName(rawDisplayName);
    if (!displayName) throw new RoomError("INVALID_NAME");
    return displayName;
  }

  private emit(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const seatOneView = this.snapshot(roomCode);
    for (const listener of this.listeners) listener(roomCode, seatOneView);
  }

  private prune() {
    const expiredBefore = this.timer.now() - EMPTY_WAITING_ROOM_LIFETIME_MS;
    for (const [code, room] of this.rooms) {
      if (room.updatedAt > expiredBefore || room.playerCount > 1 || room.snapshot().phase === "playing") continue;
      room.dispose();
      this.rooms.delete(code);
    }
    this.pruneTickets();
  }

  private pruneTickets() {
    const now = this.timer.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}

export function withSocketUrl(credentials: RoomCredentials, socketUrl: string): RoomAccessResponse {
  return { protocolVersion: PROTOCOL_VERSION, ...credentials, socketUrl };
}
