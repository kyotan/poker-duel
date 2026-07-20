import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CpuStrength } from "../controller/GameController";
import { useI18n } from "../i18n";
import {
  OnlineApiError,
  OnlineLobbySession,
  buildInviteUrl,
  createOnlineRoom,
  formatRoomCode,
  isValidRoomCode,
  joinOnlineRoom,
  normalizeRoomCode,
  roomCodeFromCurrentUrl,
  type LobbyClientSnapshot,
} from "./api";
import { QrInvite } from "./QrInvite";

const DISPLAY_NAME_KEY = "poker-duel-display-name";

type SetupError =
  | "INVALID_NAME"
  | "INVALID_CODE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "SERVER_UNREACHABLE"
  | "SERVER_ERROR"
  | string;

function initialDisplayName() {
  try {
    return window.localStorage.getItem(DISPLAY_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Plain HTTP LAN pages may not expose the Clipboard API.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

export function ModeSelectOverlay({
  onCpu,
  onOnline,
}: {
  onCpu: (strength: CpuStrength) => void;
  onOnline: () => void;
}) {
  const { t } = useI18n();
  const [selectingCpuStrength, setSelectingCpuStrength] = useState(false);

  if (selectingCpuStrength) {
    return (
      <section className="match-overlay mode-select cpu-strength-select" data-testid="cpu-strength-select">
        <button className="overlay-back" type="button" data-testid="cpu-strength-back" onClick={() => setSelectingCpuStrength(false)}>‹ {t("cpuStrength.back")}</button>
        <span className="match-overlay__eyebrow">{t("cpuStrength.eyebrow")}</span>
        <h1>{t("cpuStrength.title")}</h1>
        <div className="mode-select__choices cpu-strength-select__choices" role="group" aria-label={t("cpuStrength.groupLabel")}>
          <button className="mode-card cpu-strength-card cpu-strength-card--normal" type="button" data-testid="cpu-strength-normal" onClick={() => onCpu("normal")}>
            <span aria-hidden="true">★</span>
            <strong>{t("cpuStrength.normal")}</strong>
            <small>{t("cpuStrength.normalDetail")}</small>
          </button>
          <button className="mode-card cpu-strength-card cpu-strength-card--strong" type="button" data-testid="cpu-strength-strong" onClick={() => onCpu("strong")}>
            <span aria-hidden="true">⚡</span>
            <strong>{t("cpuStrength.strong")}</strong>
            <small>{t("cpuStrength.strongDetail")}</small>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="match-overlay mode-select" data-testid="mode-select">
      <span className="match-overlay__eyebrow">{t("mode.eyebrow")}</span>
      <h1>{t("mode.title")}</h1>
      <div className="mode-select__choices">
        <button className="mode-card mode-card--cpu" type="button" data-testid="mode-cpu" onClick={() => setSelectingCpuStrength(true)}>
          <span aria-hidden="true">🤖</span>
          <strong>{t("mode.cpu")}</strong>
          <small>{t("mode.cpuDetail")}</small>
        </button>
        <button className="mode-card mode-card--online" type="button" data-testid="mode-online" onClick={onOnline}>
          <span aria-hidden="true">⚡</span>
          <strong>{t("mode.online")}</strong>
          <small>{t("mode.onlineDetail")}</small>
        </button>
      </div>
    </section>
  );
}

function setupErrorText(code: SetupError | null, t: ReturnType<typeof useI18n>["t"]) {
  if (!code) return null;
  switch (code) {
    case "INVALID_NAME": return t("online.invalidName");
    case "INVALID_CODE":
    case "INVALID_ROOM_CODE": return t("online.invalidCode");
    case "ROOM_NOT_FOUND": return t("online.roomNotFound");
    case "ROOM_FULL": return t("online.roomFull");
    case "SERVER_UNREACHABLE":
    case "CONNECTION_LOST": return t("online.connectionFailed");
    default: return t("online.serverError");
  }
}

function PlayerSeat({
  name,
  connected,
  ready,
  isLocal = false,
}: {
  name?: string;
  connected?: boolean;
  ready?: boolean;
  isLocal?: boolean;
}) {
  const { t } = useI18n();
  return (
    <article className={`online-player${ready ? " online-player--ready" : ""}${name ? "" : " online-player--empty"}`}>
      <span className="online-player__avatar" aria-hidden="true">{name ? (isLocal ? "😄" : "😎") : "?"}</span>
      <div>
        <small>{isLocal ? t("online.you") : connected === false ? t("online.disconnected") : t("online.connected")}</small>
        <strong>{name ?? t("online.openSeat")}</strong>
      </div>
      <b>{name ? (ready ? t("online.ready") : t("online.notReady")) : "…"}</b>
    </article>
  );
}

export function OnlineLobby({
  onBack,
  onMatch,
  onReadyGesture,
  initialSession = null,
}: {
  onBack: () => void;
  onMatch?: (session: OnlineLobbySession) => void;
  onReadyGesture?: () => void;
  initialSession?: OnlineLobbySession | null;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [roomCode, setRoomCode] = useState(roomCodeFromCurrentUrl);
  const [session, setSession] = useState<OnlineLobbySession | null>(initialSession);
  const [snapshot, setSnapshot] = useState<LobbyClientSnapshot | null>(() => initialSession?.getSnapshot() ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [now, setNow] = useState(Date.now());
  const handedOff = useRef(false);

  useEffect(() => {
    if (!session) return;
    setSnapshot(session.getSnapshot());
    return session.subscribe(() => setSnapshot(session.getSnapshot()));
  }, [session]);

  useEffect(() => {
    if (snapshot?.room.phase !== "countdown") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [snapshot?.room.phase]);

  useEffect(() => {
    if (!session || !snapshot?.room.match || !onMatch || handedOff.current) return;
    handedOff.current = true;
    onMatch(session);
  }, [onMatch, session, snapshot?.room.match]);

  const validName = displayName.trim().length >= 1 && displayName.trim().length <= 16;
  const performSessionRequest = async (request: () => Promise<OnlineLobbySession>) => {
    if (!validName) {
      setError("INVALID_NAME");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await request();
      try {
        window.localStorage.setItem(DISPLAY_NAME_KEY, displayName.trim());
      } catch {
        // The room still works when browser storage is unavailable.
      }
      handedOff.current = false;
      setSession(next);
    } catch (caught) {
      setError(caught instanceof OnlineApiError ? caught.code : "SERVER_ERROR");
    } finally {
      setBusy(false);
    }
  };

  const createRoom = () => void performSessionRequest(() => createOnlineRoom(displayName));
  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(normalized)) {
      setError("INVALID_CODE");
      return;
    }
    void performSessionRequest(() => joinOnlineRoom(normalized, displayName));
  };

  const leave = () => {
    session?.leave();
    setSession(null);
    setSnapshot(null);
    onBack();
  };

  const errorText = setupErrorText(error ?? snapshot?.errorCode ?? null, t);

  if (!session || !snapshot) {
    return (
      <section className="match-overlay online-setup" data-testid="online-setup">
        <button className="overlay-back" type="button" data-testid="online-back" onClick={onBack}>‹ {t("mode.back")}</button>
        <span className="match-overlay__eyebrow">{t("online.eyebrow")}</span>
        <h1>{t("online.title")}</h1>
        <form className="online-setup__form" onSubmit={joinRoom}>
          <label className="online-field">
            <span>{t("online.displayName")}</span>
            <input
              value={displayName}
              maxLength={16}
              autoComplete="nickname"
              data-testid="online-display-name"
              placeholder={t("online.displayNamePlaceholder")}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <small>{t("online.displayNameHelp")}</small>
          </label>
          <button className="online-primary" type="button" data-testid="create-room" disabled={busy} onClick={createRoom}>
            {busy ? t("online.connecting") : t("online.createRoom")}
          </button>
          <div className="online-divider"><span>{t("online.or")}</span></div>
          <label className="online-field">
            <span>{t("online.roomCode")}</span>
            <input
              value={roomCode}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              data-testid="online-room-code-input"
              placeholder={t("online.roomCodePlaceholder")}
              onBlur={() => setRoomCode(formatRoomCode(roomCode))}
              onChange={(event) => setRoomCode(event.target.value)}
            />
            <small>{t("online.roomCodeHelp")}</small>
          </label>
          <button className="online-secondary" type="submit" data-testid="join-room" disabled={busy}>
            {busy ? t("online.connecting") : t("online.joinRoom")}
          </button>
          {errorText ? <p className="online-error" role="alert" data-testid="online-error">{errorText}</p> : null}
        </form>
      </section>
    );
  }

  const { room } = snapshot;
  const localPlayer = room.players.find((player) => player.playerId === snapshot.localPlayerId);
  const opponent = room.players.find((player) => player.playerId !== snapshot.localPlayerId);
  const inviteUrl = buildInviteUrl(room.roomCode);
  const loopbackInvite = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const canShare = typeof navigator.share === "function";
  const countdownNow = room.phase === "countdown" ? Math.max(now, Date.now()) : now;
  const countdown = Math.max(0, Math.ceil(((room.countdownEndsAt ?? countdownNow) - countdownNow) / 1_000));

  const markCopied = (kind: "link" | "code") => {
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1_600);
  };
  const copyInvite = async () => {
    if (await copyText(inviteUrl)) markCopied("link");
  };
  const copyCode = async () => {
    if (await copyText(room.roomCode)) markCopied("code");
  };
  const shareInvite = async () => {
    try {
      await navigator.share({ title: "POKER DUEL", text: `${t("online.roomLabel")}: ${formatRoomCode(room.roomCode)}`, url: inviteUrl });
    } catch {
      // Cancelling the native share sheet should not surface as a game error.
    }
  };

  if (room.phase === "countdown") {
    return (
      <section className="match-overlay online-countdown" data-testid="online-countdown">
        <span>{t("online.countdown")}</span>
        <strong>{countdown}</strong>
        <div className="online-countdown__players"><b>{localPlayer?.displayName}</b><i>VS</i><b>{opponent?.displayName}</b></div>
      </section>
    );
  }

  if (room.phase === "playing") {
    return (
      <section className="match-overlay online-connected" data-testid="online-connected">
        <span>{t("online.eyebrow")}</span>
        <h1>{t("online.matchConnected")}</h1>
        <p>{t("online.matchPending")}</p>
        <button className="online-leave" type="button" onClick={leave}>{t("online.leave")}</button>
      </section>
    );
  }

  const opponentPresent = Boolean(opponent);
  const readyDisabled = !opponentPresent || snapshot.connection !== "connected";

  return (
    <section className="match-overlay online-lobby" data-testid="online-lobby">
      <header className="online-lobby__header">
        <div><span>{t("online.lobby")}</span><strong>{opponentPresent ? t("online.waitingReady") : t("online.waitingPlayer")}</strong></div>
        <button className="online-leave" type="button" data-testid="leave-room" onClick={leave}>{t("online.leave")}</button>
      </header>

      <div className="online-invite">
        <span>{t("online.roomLabel")}</span>
        <strong data-testid="lobby-room-code">{formatRoomCode(room.roomCode)}</strong>
        <p>{t("online.inviteHelp")}</p>
        {loopbackInvite ? <p className="online-lan-warning" role="note">{t("online.localUrlWarning")}</p> : null}
        <div className="online-invite__actions">
          {canShare ? <button type="button" onClick={() => void shareInvite()}>{t("online.shareInvite")}</button> : null}
          <button type="button" data-testid="copy-invite-link" onClick={() => void copyInvite()}>{copied === "link" ? t("online.copied") : t("online.copyLink")}</button>
          <button type="button" data-testid="copy-room-code" onClick={() => void copyCode()}>{copied === "code" ? t("online.copied") : t("online.copyCode")}</button>
          <button type="button" data-testid="toggle-qr" aria-expanded={showQr} onClick={() => setShowQr((current) => !current)}>{showQr ? t("online.hideQr") : t("online.showQr")}</button>
        </div>
        {showQr ? (
          <div className="online-qr" data-testid="qr-placeholder">
            <QrInvite
              className="online-qr__frame"
              inviteUrl={inviteUrl}
              ariaLabel={t("online.qrAlt")}
              loadingLabel={t("online.qrLoading")}
              errorLabel={t("online.qrError")}
            />
            <div><strong>{t("online.qrTitle")}</strong><p>{loopbackInvite ? t("online.localUrlWarning") : t("online.qrReady")}</p></div>
          </div>
        ) : null}
      </div>

      <div className="online-players" aria-label={t("online.players")}>
        <PlayerSeat name={localPlayer?.displayName} connected={localPlayer?.connected} ready={localPlayer?.ready} isLocal />
        <span className="online-players__versus">VS</span>
        <PlayerSeat name={opponent?.displayName} connected={opponent?.connected} ready={opponent?.ready} />
      </div>

      <button
        className={`online-ready${localPlayer?.ready ? " online-ready--active" : ""}`}
        type="button"
        data-testid="online-ready"
        disabled={readyDisabled}
        onClick={() => {
          onReadyGesture?.();
          session.setReady(!localPlayer?.ready);
        }}
      >
        {localPlayer?.ready ? t("online.cancelReady") : t("online.start")}
      </button>
      <p className="online-ready-help">
        {!opponentPresent ? t("online.needOpponent") : localPlayer?.ready ? t("online.waitOpponentReady") : ""}
      </p>
      {errorText ? <p className="online-error" role="alert">{errorText}</p> : null}
    </section>
  );
}
