export const PROTOCOL_VERSION = 1 as const;

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;
export const MAX_DISPLAY_NAME_LENGTH = 16;

export type RoomPhase = "waiting_for_player" | "waiting_for_ready" | "countdown" | "playing" | "paused" | "result";
export type MatchPhase = "waiting_start" | "countdown" | "playing" | "result";
export type RoundId = "lobby" | `round-${number}`;
export type RelativeSide = "self" | "opponent";
export type WireSuit = "spades" | "hearts" | "diamonds" | "clubs";
export type WireHandType =
  | "one_pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush"
  | "royal_flush";
export type WireSkillType = "HEAL" | "SHUFFLE" | "STEAL" | "BLOCK" | "STOP";
export type WireMatchResult = "WIN" | "LOSE" | "DRAW";
export type WireMatchEndReason = "KO" | "TIME_UP" | "FORFEIT";

export interface RoomPlayerSnapshot {
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: 1 | 2;
  readonly connected: boolean;
  readonly ready: boolean;
}

export interface VisibleCard {
  readonly id: string;
  readonly suit: WireSuit;
  readonly rank: number;
}

export interface VisibleHandCandidate {
  readonly candidateId: string;
  readonly type: WireHandType;
  readonly cardIds: readonly string[];
  readonly ranks: readonly number[];
  readonly damage: number;
}

export interface VisibleSkill {
  readonly instanceId: string;
  readonly type: WireSkillType;
}

export interface VisibleMatchPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly connected: boolean;
  readonly hp: number;
  readonly handVersion: number;
  /** Null until the five-second countdown has completed. */
  readonly hand: readonly VisibleCard[] | null;
  readonly handCount: number;
  readonly candidates: readonly VisibleHandCandidate[];
  readonly skills: readonly VisibleSkill[];
  /** Match-clock deadlines. Compare them with VisibleMatchSnapshot.nowMs. */
  readonly stopUntilMs: number;
  readonly blockUntilMs: number;
  readonly shuffleLockUntilMs: number;
  readonly actionCooldownUntilMs: number;
  readonly skillCooldownUntilMs: number;
}

export interface VisibleSkillDrop {
  readonly id: string;
  readonly type: WireSkillType;
  readonly appearedAt: number;
  readonly expiresAt: number;
  readonly claimResolveAt: number | null;
  readonly claimants: readonly RelativeSide[];
}

export interface VisibleAttack {
  readonly id: string;
  readonly source: RelativeSide;
  readonly cards: readonly VisibleCard[];
  readonly damage: number;
  readonly startedAt: number;
  readonly blocked: boolean;
}

export interface PublicMatchConfig {
  readonly countdownMs: number;
  readonly matchDurationMs: number;
  readonly attackCooldownMs: number;
  readonly redrawCooldownMs: number;
  readonly skillIntervalMs: number;
  readonly skillVisibleMs: number;
  readonly claimWindowMs: number;
  readonly healAmount: number;
  readonly stopDurationMs: number;
  readonly blockDurationMs: number;
  readonly shuffleLockMs: number;
  readonly skillCooldownMs: number;
}

/**
 * A seat-oriented, public-only match view. Never add deck boxes, RNG state,
 * seeds, forced draws, pending attacks, resume tokens, or private config here.
 */
export interface VisibleMatchSnapshot {
  readonly roundId: Exclude<RoundId, "lobby">;
  readonly phase: MatchPhase;
  readonly nowMs: number;
  readonly countdownEndsAt: number | null;
  /** Server-authoritative match-clock deadline. Null before play begins. */
  readonly matchEndsAt: number | null;
  readonly self: VisibleMatchPlayer;
  readonly opponent: VisibleMatchPlayer;
  readonly skillDrop: VisibleSkillDrop | null;
  readonly activeAttacks: readonly VisibleAttack[];
  readonly result: WireMatchResult | null;
  readonly endReason: WireMatchEndReason | null;
  readonly publicConfig: PublicMatchConfig;
}

export interface RoomState {
  readonly roomCode: string;
  readonly phase: RoomPhase;
  readonly players: readonly RoomPlayerSnapshot[];
  /** Wall-clock deadline used only by the lobby countdown UI. */
  readonly countdownEndsAt: number | null;
  readonly match: VisibleMatchSnapshot | null;
}

export interface RoomAccessResponse {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly roomCode: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly socketTicket: string;
  readonly resumeToken: string;
  readonly socketUrl: string;
}

export const API_ERROR_CODES = [
  "INVALID_JSON",
  "INVALID_NAME",
  "INVALID_ROOM_CODE",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "RESUME_DENIED",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorResponse {
  readonly error: { readonly code: ApiErrorCode };
}

interface CommandEnvelope<Kind extends string, Payload> {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly kind: Kind;
  readonly commandId: string;
  readonly seq: number;
  readonly roundId: RoundId;
  readonly payload: Payload;
}

export type ReadySetCommand = CommandEnvelope<"ready.set", { readonly ready: boolean }>;
export type SyncRequestCommand = CommandEnvelope<"sync.request", Record<string, never>>;
export type RoomLeaveCommand = CommandEnvelope<"room.leave", Record<string, never>>;
export type HandRedrawCommand = CommandEnvelope<
  "hand.redraw",
  { readonly handVersion: number; readonly cardIds: readonly string[] }
>;
export type HandActivateCommand = CommandEnvelope<
  "hand.activate",
  { readonly handVersion: number; readonly candidateId: string }
>;
export type SkillUseCommand = CommandEnvelope<"skill.use", { readonly instanceId: string }>;
export type RematchReadyCommand = CommandEnvelope<"rematch.ready", { readonly ready: boolean }>;

export type ClientCommand =
  | ReadySetCommand
  | SyncRequestCommand
  | RoomLeaveCommand
  | HandRedrawCommand
  | HandActivateCommand
  | SkillUseCommand
  | RematchReadyCommand;

export const COMMAND_REJECT_REASONS = [
  "INVALID_MESSAGE",
  "UNSUPPORTED_PROTOCOL",
  "PLAYER_NOT_FOUND",
  "PLAYER_NOT_CONNECTED",
  "WAITING_FOR_PLAYER",
  "COUNTDOWN_STARTED",
  "MATCH_ALREADY_STARTED",
  "MATCH_NOT_STARTED",
  "MATCH_FINISHED",
  "MATCH_PAUSED",
  "ROUND_MISMATCH",
  "STALE_SEQUENCE",
  "STALE_HAND",
  "INVALID_READY_VALUE",
  "INVALID_CARD_SELECTION",
  "INVALID_CANDIDATE",
  "INVALID_SKILL",
  "ACTION_REJECTED",
] as const;

export type CommandRejectReason = (typeof COMMAND_REJECT_REASONS)[number];

export interface RoomWelcomeMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly kind: "room.welcome";
  readonly roomCode: string;
  readonly playerId: string;
}

export interface StateSnapshotMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly kind: "state.snapshot";
  readonly serverNowMs: number;
  readonly stateVersion: number;
  readonly state: RoomState;
}

export interface CommandAcceptedMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly kind: "command.accepted";
  readonly commandId: string;
  readonly stateVersion: number;
  readonly duplicate: boolean;
}

export interface CommandRejectedMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly kind: "command.rejected";
  readonly commandId: string | null;
  readonly stateVersion: number;
  readonly reason: CommandRejectReason;
}

export type ServerMessage = RoomWelcomeMessage | StateSnapshotMessage | CommandAcceptedMessage | CommandRejectedMessage;

export function normalizeRoomCode(input: string): string {
  let value = input.trim();
  try {
    const parsed = new URL(value);
    value = parsed.searchParams.get("room") ?? value;
  } catch {
    // A room code is expected to fail URL parsing.
  }
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidRoomCode(input: string): boolean {
  const code = normalizeRoomCode(input);
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
}

export function normalizeDisplayName(input: string): string | null {
  const name = input.trim();
  if (name.length === 0 || [...name].length > MAX_DISPLAY_NAME_LENGTH) return null;
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validEnvelope(value: Record<string, unknown>) {
  return (
    typeof value.commandId === "string" &&
    value.commandId.length >= 1 &&
    value.commandId.length <= 128 &&
    Number.isSafeInteger(value.seq) &&
    (value.seq as number) >= 0 &&
    (value.roundId === "lobby" || (typeof value.roundId === "string" && /^round-[1-9]\d*$/.test(value.roundId))) &&
    isRecord(value.payload)
  );
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 5 &&
    value.every((entry) => typeof entry === "string" && entry.length >= 1 && entry.length <= 128) &&
    new Set(value).size === value.length
  );
}

export type ClientCommandParseResult =
  | { readonly ok: true; readonly command: ClientCommand }
  | { readonly ok: false; readonly reason: "INVALID_MESSAGE" | "UNSUPPORTED_PROTOCOL" };

/** Runtime validation at the network boundary; TypeScript types are not trusted. */
export function parseClientCommand(value: unknown): ClientCommandParseResult {
  if (!isRecord(value)) return { ok: false, reason: "INVALID_MESSAGE" };
  if (value.protocolVersion !== PROTOCOL_VERSION) return { ok: false, reason: "UNSUPPORTED_PROTOCOL" };
  if (!validEnvelope(value)) return { ok: false, reason: "INVALID_MESSAGE" };
  const payload = value.payload as Record<string, unknown>;

  if (value.kind === "ready.set") {
    if (value.roundId !== "lobby" || typeof payload.ready !== "boolean") {
      return { ok: false, reason: "INVALID_MESSAGE" };
    }
    return { ok: true, command: value as unknown as ReadySetCommand };
  }
  if (value.kind === "sync.request" || value.kind === "room.leave") {
    return { ok: true, command: value as unknown as SyncRequestCommand | RoomLeaveCommand };
  }
  if (value.roundId === "lobby") return { ok: false, reason: "INVALID_MESSAGE" };
  if (value.kind === "hand.redraw") {
    if (!Number.isSafeInteger(payload.handVersion) || !isUniqueStringArray(payload.cardIds)) {
      return { ok: false, reason: "INVALID_MESSAGE" };
    }
    return { ok: true, command: value as unknown as HandRedrawCommand };
  }
  if (value.kind === "hand.activate") {
    if (
      !Number.isSafeInteger(payload.handVersion) ||
      typeof payload.candidateId !== "string" ||
      payload.candidateId.length < 1 ||
      payload.candidateId.length > 512
    ) {
      return { ok: false, reason: "INVALID_MESSAGE" };
    }
    return { ok: true, command: value as unknown as HandActivateCommand };
  }
  if (value.kind === "skill.use") {
    if (typeof payload.instanceId !== "string" || payload.instanceId.length < 1 || payload.instanceId.length > 256) {
      return { ok: false, reason: "INVALID_MESSAGE" };
    }
    return { ok: true, command: value as unknown as SkillUseCommand };
  }
  if (value.kind === "rematch.ready") {
    if (typeof payload.ready !== "boolean") return { ok: false, reason: "INVALID_MESSAGE" };
    return { ok: true, command: value as unknown as RematchReadyCommand };
  }
  return { ok: false, reason: "INVALID_MESSAGE" };
}
