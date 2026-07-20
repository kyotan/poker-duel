import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
  type RoomAccessResponse,
  type RoomPhase,
  type RoomPlayerSnapshot,
  type RoomState,
  type ClientCommand,
  type RoundId,
  type ServerMessage,
} from "../shared/protocol";

export { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode };

export type LobbyPhase = RoomPhase;

export type LobbyConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

export type LobbyPlayer = RoomPlayerSnapshot;
export type LobbyRoomState = RoomState;

export interface LobbyClientSnapshot {
  connection: LobbyConnectionState;
  room: LobbyRoomState;
  localPlayerId: string;
  errorCode: string | null;
  /** Latest authoritative wall-clock value received from the LAN server. */
  serverNowMs: number;
  /** Monotonic room state version used to ignore stale snapshots. */
  stateVersion: number;
}

type SessionResponse = RoomAccessResponse;

interface ErrorResponse {
  error?: {
    code?: string;
  };
}

type Listener = () => void;

export class OnlineApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OnlineApiError";
  }
}

function apiBaseUrl() {
  const configured = import.meta.env.VITE_POKER_DUEL_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const host = window.location.hostname.includes(":")
    ? `[${window.location.hostname}]`
    : window.location.hostname;
  return `${window.location.protocol}//${host}:8787`;
}

async function requestSession(path: string, body: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OnlineApiError("SERVER_UNREACHABLE");
  }

  const payload = await response.json().catch(() => ({})) as SessionResponse | ErrorResponse;
  if (!response.ok || !("socketUrl" in payload)) {
    const code = "error" in payload ? payload.error?.code : undefined;
    throw new OnlineApiError(code ?? "SERVER_ERROR");
  }
  return payload;
}

function commandId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function initialRoom(session: SessionResponse): LobbyRoomState {
  return {
    roomCode: session.roomCode,
    phase: "waiting_for_player",
    players: [{
      playerId: session.playerId,
      displayName: session.displayName,
      seat: 1,
      connected: true,
      ready: false,
    }],
    countdownEndsAt: null,
    match: null,
  };
}

export class OnlineLobbySession {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private sequence = 0;
  private intentionallyClosed = false;
  private reconnectTimer: number | null = null;
  private reconnectDeadline = 0;
  private credentials: SessionResponse;
  private snapshot: LobbyClientSnapshot;

  constructor(session: SessionResponse) {
    this.credentials = session;
    this.snapshot = {
      connection: "connecting",
      room: initialRoom(session),
      localPlayerId: session.playerId,
      errorCode: null,
      serverNowMs: 0,
      stateVersion: 0,
    };
    this.connect(session.socketUrl);
  }

  getSnapshot = () => this.snapshot;

  get roomCode() {
    return this.credentials.roomCode;
  }

  get localDisplayName() {
    return this.credentials.displayName;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(next: Partial<LobbyClientSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private connect(socketUrl: string) {
    if (this.intentionallyClosed) return;
    const url = new URL(socketUrl, apiBaseUrl());
    if (!url.searchParams.has("ticket")) {
      url.searchParams.set("ticket", this.credentials.socketTicket);
    }
    this.socket = new WebSocket(url);
    this.socket.addEventListener("open", () => {
      this.reconnectDeadline = 0;
      this.emit({ connection: "connected", errorCode: null });
    });
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => this.handleClose());
    this.socket.addEventListener("error", () => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        this.emit({ connection: "error", errorCode: "SERVER_UNREACHABLE" });
      }
    });
  }

  private handleMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    let packet: unknown;
    try {
      packet = JSON.parse(raw);
    } catch {
      return;
    }
    if (!packet || typeof packet !== "object") return;
    const message = packet as ServerMessage;
    if (message.kind === "state.snapshot" && message.state) {
      if (message.stateVersion < this.snapshot.stateVersion) return;
      this.emit({
        room: message.state,
        connection: "connected",
        errorCode: null,
        serverNowMs: message.serverNowMs,
        stateVersion: message.stateVersion,
      });
    } else if (message.kind === "command.accepted") {
      if (message.stateVersion > this.snapshot.stateVersion) {
        this.emit({ stateVersion: message.stateVersion, errorCode: null });
      }
    } else if (message.kind === "command.rejected") {
      this.emit({
        errorCode: message.reason,
        stateVersion: Math.max(this.snapshot.stateVersion, message.stateVersion),
      });
    }
  }

  private handleClose() {
    this.socket = null;
    if (this.intentionallyClosed) {
      this.emit({ connection: "closed" });
      return;
    }
    if (!this.reconnectDeadline) this.reconnectDeadline = Date.now() + 30_000;
    if (Date.now() >= this.reconnectDeadline) {
      this.emit({ connection: "error", errorCode: "CONNECTION_LOST" });
      return;
    }
    this.emit({ connection: "reconnecting" });
    this.reconnectTimer = window.setTimeout(() => void this.resume(), 1_000);
  }

  private async resume() {
    if (this.intentionallyClosed) return;
    try {
      const next = await requestSession(`/v1/rooms/${this.credentials.roomCode}/resume`, {
        playerId: this.credentials.playerId,
        resumeToken: this.credentials.resumeToken,
      });
      this.credentials = next;
      this.connect(next.socketUrl);
    } catch {
      this.handleClose();
    }
  }

  private send<Kind extends ClientCommand["kind"]>(
    kind: Kind,
    payload: Extract<ClientCommand, { kind: Kind }>["payload"],
    roundId: RoundId,
  ) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.sequence += 1;
    this.socket.send(JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind,
      commandId: commandId(),
      seq: this.sequence,
      roundId,
      payload,
    }));
    return true;
  }

  setReady(ready: boolean) {
    return this.send("ready.set", { ready }, "lobby");
  }

  requestSync() {
    return this.send("sync.request", {}, this.currentRoundId());
  }

  redraw(handVersion: number, cardIds: readonly string[]) {
    return this.send("hand.redraw", { handVersion, cardIds }, this.currentRoundId());
  }

  activate(handVersion: number, candidateId: string) {
    return this.send("hand.activate", { handVersion, candidateId }, this.currentRoundId());
  }

  useSkill(instanceId: string) {
    return this.send("skill.use", { instanceId }, this.currentRoundId());
  }

  setRematchReady(ready = true) {
    return this.send("rematch.ready", { ready }, this.currentRoundId());
  }

  leave() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.send("room.leave", {}, this.currentRoundId());
    this.socket?.close(1000, "left-room");
    this.emit({ connection: "closed" });
  }

  private currentRoundId(): RoundId {
    return this.snapshot.room.match?.roundId ?? "lobby";
  }
}

export function formatRoomCode(code: string) {
  const normalized = normalizeRoomCode(code);
  return normalized.length > 3
    ? `${normalized.slice(0, 3)} ${normalized.slice(3, 6)}`
    : normalized;
}

export function buildInviteUrl(code: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", normalizeRoomCode(code));
  return url.toString();
}

export function roomCodeFromCurrentUrl() {
  return normalizeRoomCode(new URL(window.location.href).searchParams.get("room") ?? "");
}

export async function createOnlineRoom(displayName: string) {
  const session = await requestSession("/v1/rooms", { displayName: displayName.trim() });
  return new OnlineLobbySession(session);
}

export async function joinOnlineRoom(roomCode: string, displayName: string) {
  const normalized = normalizeRoomCode(roomCode);
  const session = await requestSession(`/v1/rooms/${normalized}/join`, { displayName: displayName.trim() });
  return new OnlineLobbySession(session);
}
