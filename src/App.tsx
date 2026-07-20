import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { soundManager } from "./audio/SoundManager";
import {
  assignDistinctCats,
  CAT_POSES,
  catFramePath,
  createLocalCatSeed,
  type CatBreed,
  type CatPose,
} from "./avatar/cats";
import {
  HandRow,
  HpDuelBar,
  RoleButtons,
  SkillSlots,
  StatusBadge,
  type CardViewModel,
  type HpHealEffect,
  type RoleActionViewModel,
  type SkillSlotViewModel,
  type StatusBadgeMode,
} from "./components";
import {
  CPU_SPEED_PRESETS,
  gameController,
  getMatchRemainingMs,
  type CpuStrength,
  type GameSnapshot,
} from "./controller/GameController";
import type { BattleController } from "./controller/BattleController";
import { EffectsCanvas } from "./effects/EffectsCanvas";
import { RANK_LABELS, type PlayerCoreState } from "./game";
import { localizeHand, localizeSkill, useI18n, type Locale } from "./i18n";
import { ModeSelectOverlay, OnlineLobby, PvpGameController, roomCodeFromCurrentUrl } from "./online";

const DevelopmentTools = import.meta.env.DEV
  ? lazy(() => import("./debug/DevelopmentTools"))
  : null;

function cardViews(player: PlayerCoreState): CardViewModel[] {
  return player.deck.hand.map((card) => ({
    id: card.id,
    rank: RANK_LABELS[card.rank],
    suit: card.suit,
  }));
}

function skillViews(player: PlayerCoreState, nowMs: number, locale: Locale, healAmount: number): SkillSlotViewModel[] {
  const remaining = Math.max(0, player.skillCooldownUntilMs - nowMs);
  return player.skills.map((skill) => ({
    id: skill.instanceId,
    type: skill.type,
    name: localizeSkill(skill.type, locale, healAmount),
    available: remaining <= 0,
    cooldownRemainingMs: remaining,
    cooldownTotalMs: 1_000,
  }));
}

function statusFor(player: PlayerCoreState, nowMs: number): {
  mode: StatusBadgeMode;
  remainingMs: number;
  totalMs: number;
} {
  if (nowMs < player.shuffleLockUntilMs) {
    return { mode: "sending", remainingMs: player.shuffleLockUntilMs - nowMs, totalMs: 800 };
  }
  if (nowMs < player.stopUntilMs) {
    return { mode: "stopped", remainingMs: player.stopUntilMs - nowMs, totalMs: 10_000 };
  }
  if (nowMs < player.actionCooldownUntilMs) {
    return { mode: "cooldown", remainingMs: player.actionCooldownUntilMs - nowMs, totalMs: 1_200 };
  }
  return { mode: "ready", remainingMs: 0, totalMs: 1 };
}

function BattleLogo() {
  return (
    <div className="battle-logo" data-testid="poker-duel-logo" aria-label="Poker Duel">
      <span className="battle-logo__poker">POKER</span>
      <span className="battle-logo__duel">DUEL</span>
      <span className="battle-logo__spark" aria-hidden="true">★</span>
    </div>
  );
}

interface FighterInfoProps {
  side: "player" | "enemy";
  name: string;
  cat: CatBreed;
  pose: CatPose;
  online?: boolean;
  status: ReturnType<typeof statusFor>;
  blockRemainingMs: number;
}

function FighterInfo({ side, name, cat, pose, online = false, status, blockRemainingMs }: FighterInfoProps) {
  const { locale, t } = useI18n();
  const blocking = blockRemainingMs > 0;
  return (
    <section
      className={`fighter-info fighter-info--${side}${blocking ? " fighter-info--blocking" : ""}`}
      data-testid={`${side}-info`}
      data-blocking={blocking}
    >
      <div
        className={`fighter-info__avatar fighter-info__avatar--${pose}`}
        data-cat={cat}
        data-pose={pose}
        aria-hidden="true"
      >
        <img src={catFramePath(cat, pose)} alt="" draggable="false" />
      </div>
      <div className="fighter-info__copy">
        <p>{t(side === "player" ? "fighter.you" : online ? "fighter.onlineRival" : "fighter.cpuRival")}</p>
        <strong>{name}</strong>
      </div>
      {blocking ? (
        <div className="fighter-block" data-testid={`${side}-block-status`} aria-label={t("fighter.blockRemaining", { seconds: (blockRemainingMs / 1_000).toFixed(1) })}>
          <span aria-hidden="true">◆</span>
          <strong>{localizeSkill("BLOCK", locale)}</strong>
          <b>{(blockRemainingMs / 1_000).toFixed(1)}s</b>
        </div>
      ) : null}
      <StatusBadge {...status} />
    </section>
  );
}

function SkillDrop({ state }: { state: GameSnapshot }) {
  const { locale, t } = useI18n();
  const drop = state.skillDrop;
  if (!drop) return null;
  const remaining = Math.max(0, drop.expiresAt - state.nowMs);
  const progress = remaining / Math.max(1, state.config.skillVisibleMs);
  const claimPending = drop.claimResolveAt !== null;
  return (
    <section
      className={`skill-drop${claimPending ? " skill-drop--claiming" : ""}`}
      data-testid="skill-drop"
      data-drop-id={drop.id}
      data-claim-state={claimPending ? "claiming" : "open"}
      style={{ "--skill-drop-angle": `${Math.max(0, progress) * 360}deg` } as CSSProperties}
      aria-live="assertive"
    >
      <span className="skill-drop__kicker">{t("skillDrop.kicker")}</span>
      <div className="skill-drop__timer" data-testid="skill-drop-timer">
        {claimPending ? "!" : (remaining / 1_000).toFixed(1)}
      </div>
      <strong data-testid="skill-drop-type">{localizeSkill(drop.type, locale, state.config.healAmount)}</strong>
      <small data-testid="skill-drop-prompt">
        {claimPending ? t("skillDrop.claiming") : t("skillDrop.prompt")}
      </small>
    </section>
  );
}

const FINAL_COUNTDOWN_MS = 10_000;

function formatMatchTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MatchTimer({ state }: { state: GameSnapshot }) {
  const { t } = useI18n();
  const remainingMs = getMatchRemainingMs(state);
  const finalCount = state.phase === "playing" && remainingMs > 0 && remainingMs <= FINAL_COUNTDOWN_MS
    ? Math.max(1, Math.ceil(remainingMs / 1_000))
    : null;

  useEffect(() => {
    if (finalCount !== null) soundManager.play("timeWarning", "center", finalCount);
  }, [finalCount]);

  if (state.phase !== "playing") return null;

  return (
    <>
      <div
        className={`match-timer${finalCount !== null ? " match-timer--urgent" : ""}`}
        data-testid="match-timer"
        data-urgent={finalCount !== null}
        role="timer"
        aria-label={t("matchTimer.aria", { seconds: Math.max(0, Math.ceil(remainingMs / 1_000)) })}
      >
        <span>{t("matchTimer.label")}</span>
        <strong data-testid="match-timer-value">{formatMatchTime(remainingMs)}</strong>
      </div>
      {finalCount !== null ? (
        <div
          className="time-limit-warning"
          data-testid="time-limit-warning"
          data-count={finalCount}
          key={finalCount}
          aria-live="assertive"
          aria-atomic="true"
        >
          <div className="time-limit-warning__copy">
            <span>{t("matchTimer.finalCountdown")}</span>
            <strong data-testid="time-limit-countdown">{finalCount}</strong>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MatchOverlay({
  state,
  onStart,
  onBack,
  onRematch,
  online = false,
  rematchPending = false,
}: {
  state: GameSnapshot;
  onStart: () => void;
  onBack: () => void;
  onRematch: () => void;
  online?: boolean;
  rematchPending?: boolean;
}) {
  const { t } = useI18n();
  if (state.phase === "playing") return null;

  if (state.phase === "waiting_start") {
    return (
      <section className="match-overlay match-overlay--start" data-testid="title-screen">
        <button className="overlay-back" type="button" data-testid="cpu-mode-back" onClick={onBack}>‹ {t("mode.back")}</button>
        <span className="match-overlay__eyebrow">{t("start.eyebrow")}</span>
        <h1>{t("start.title")}</h1>
        <div className="rule-pills" aria-label={t("start.rulesLabel")}>
          <span>{t("start.cards")}</span><span>{t("start.hp")}</span><span>{t("start.activeBattle")}</span>
        </div>
        <button className="start-button" data-testid="start-button" type="button" onClick={onStart}>
          <span>{t("start.button")}</span>
          <small>{t("start.openAfter")}</small>
        </button>
        <p>{t("start.help")}</p>
      </section>
    );
  }

  if (state.phase === "countdown") {
    const count = Math.max(1, Math.ceil(((state.countdownEndsAt ?? state.nowMs) - state.nowMs) / 1_000));
    return (
      <section className="match-overlay match-overlay--countdown" data-testid="countdown" data-phase="countdown">
        <span>{t("countdown.ready")}</span>
        <strong data-testid="countdown-value">{count}</strong>
      </section>
    );
  }

  const resultCopy = state.result === "WIN" ? t("result.win") : state.result === "LOSE" ? t("result.lose") : t("result.draw");
  const detail = state.endReason === "TIME_UP"
    ? state.result === "WIN"
      ? t("result.timeUpWinDetail")
      : state.result === "LOSE"
        ? t("result.timeUpLoseDetail")
        : t("result.timeUpDrawDetail")
    : state.result === "WIN"
      ? t(online ? "result.onlineWinDetail" : "result.winDetail")
      : state.result === "LOSE"
        ? t(online ? "result.onlineLoseDetail" : "result.loseDetail")
        : t("result.drawDetail");
  return (
    <section className={`match-overlay match-overlay--result match-overlay--${state.result?.toLowerCase()}`} data-testid="result-overlay" data-result={state.result} data-end-reason={state.endReason}>
      {online ? <button className="overlay-back" type="button" onClick={onBack}>‹ {t("online.leave")}</button> : null}
      <span>{t("result.kicker")}</span>
      <h1 data-testid="result-title">{resultCopy}</h1>
      <p data-testid="result-reason">{detail}</p>
      <button className="rematch-button" data-testid="rematch-button" type="button" disabled={rematchPending} onClick={onRematch}>
        {rematchPending ? t("result.waitRematch") : t("result.playAgain")}
      </button>
    </section>
  );
}

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [lobbySession, setLobbySession] = useState<ConstructorParameters<typeof PvpGameController>[0] | null>(null);
  const [onlineController, setOnlineController] = useState<PvpGameController | null>(null);
  const [onlineRematchPending, setOnlineRematchPending] = useState(false);
  const controller: BattleController = onlineController ?? gameController;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [muted, setMuted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [playMode, setPlayMode] = useState<"choose" | "cpu" | "online">(() => roomCodeFromCurrentUrl() ? "online" : "choose");
  const [localCatSeed, setLocalCatSeed] = useState(createLocalCatSeed);
  const [healEffects, setHealEffects] = useState<Partial<Record<"enemy" | "player", HpHealEffect>>>({});
  const healEffectSerial = useRef(0);
  const healEffectTimers = useRef<Partial<Record<"enemy" | "player", number>>>({});
  const playerCards = useMemo(() => cardViews(state.player), [state.player]);
  const enemyCards = useMemo(() => cardViews(state.enemy), [state.enemy]);
  const playerStatus = statusFor(state.player, state.nowMs);
  const enemyStatus = statusFor(state.enemy, state.nowMs);
  const onlinePaused = Boolean(onlineController && state.phase !== "result" && (
    onlineController.connection !== "connected"
    || onlineController.roomPhase === "paused"
    || !onlineController.opponentConnected
  ));
  const cardsFaceDown = state.phase === "waiting_start" || state.phase === "countdown";
  const handBlocked = onlinePaused || state.phase !== "playing" || state.nowMs < state.player.stopUntilMs || state.nowMs < state.player.shuffleLockUntilMs || state.nowMs < state.player.actionCooldownUntilMs;
  const selectionBlocked = onlinePaused || state.phase !== "playing" || state.nowMs < state.player.shuffleLockUntilMs;
  const skillBlocked = onlinePaused || state.phase !== "playing" || state.nowMs < state.player.shuffleLockUntilMs || state.nowMs < state.player.skillCooldownUntilMs;
  const lastAttack = state.activeAttacks[state.activeAttacks.length - 1];
  const impactTarget = lastAttack ? (lastAttack.source === "player" ? "enemy" : "player") : null;
  const attackSource = lastAttack?.source ?? null;
  const impactBlocked = Boolean(lastAttack?.blocked);
  const playerBlockRemainingMs = Math.max(0, state.player.blockUntilMs - state.nowMs);
  const enemyBlockRemainingMs = Math.max(0, state.enemy.blockUntilMs - state.nowMs);
  const catSelectionKey = onlineController
    ? `${onlineController.roomCode}:${onlineController.roundId ?? "pending"}`
    : localCatSeed;
  const catAssignment = useMemo(
    () => assignDistinctCats(catSelectionKey, state.player.playerId, state.enemy.playerId),
    [catSelectionKey, state.enemy.playerId, state.player.playerId],
  );
  const poseFor = (side: "player" | "enemy"): CatPose => {
    if (state.phase === "result") {
      if (state.result === "DRAW") return "defeat";
      if ((state.result === "LOSE" && side === "player") || (state.result === "WIN" && side === "enemy")) {
        return "defeat";
      }
      return "idle";
    }
    if (impactTarget === side) return impactBlocked ? "hiss" : "hit";
    if (attackSource === side) return "attack";
    if ((side === "player" ? playerBlockRemainingMs : enemyBlockRemainingMs) > 0) return "hiss";
    return "idle";
  };
  const playerCatPose = poseFor("player");
  const enemyCatPose = poseFor("enemy");
  const roles: RoleActionViewModel[] = state.playerCandidates.map((candidate) => ({
    id: candidate.candidateId,
    label: localizeHand(candidate.type, candidate.ranks, locale),
    damage: candidate.damage,
    cardIds: candidate.cardIds,
    handType: candidate.type,
    rank: candidate.ranks[0] ? RANK_LABELS[candidate.ranks[0]] : undefined,
    disabled: handBlocked,
  }));

  useEffect(() => {
    for (const breed of [catAssignment.player, catAssignment.enemy]) {
      for (const pose of CAT_POSES) {
        const image = new Image();
        image.src = catFramePath(breed, pose);
      }
    }
  }, [catAssignment.enemy, catAssignment.player]);

  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const current = performance.now();
      const delta = Math.min(100, Math.max(0, current - last));
      last = current;
      if (!controller.isManualClock) controller.advanceTime(delta, false);
    }, 50);
    return () => window.clearInterval(timer);
  }, [controller]);

  useEffect(() => controller.subscribeToEvents((event) => {
    if (event.type === "sound") soundManager.play(event.sound, event.side, event.option);
    if (event.type === "attackSound") {
      soundManager.playAttack(event.cardCount, event.damage, event.side);
      if (event.blocked) {
        soundManager.play("blockImpact", event.side === "player" ? "enemy" : "player");
      }
    }
    if (event.type === "matchResult") {
      window.setTimeout(() => soundManager.play(event.result === "WIN" ? "win" : event.result === "LOSE" ? "lose" : "draw", "center"), 260);
    }
    if (event.type === "healVisual") {
      const id = ++healEffectSerial.current;
      const side = event.side;
      const existingTimer = healEffectTimers.current[side];
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      setHealEffects((current) => ({
        ...current,
        [side]: { id, amount: event.amount },
      }));
      healEffectTimers.current[side] = window.setTimeout(() => {
        setHealEffects((current) => {
          if (current[side]?.id !== id) return current;
          const next = { ...current };
          delete next[side];
          return next;
        });
        delete healEffectTimers.current[side];
      }, 850);
    }
  }), [controller]);

  useEffect(() => () => {
    for (const timer of Object.values(healEffectTimers.current)) {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (state.phase !== "result") setOnlineRematchPending(false);
  }, [state.phase]);

  useEffect(() => {
    if (
      !onlineController
      || state.phase !== "waiting_start"
      || (onlineController.roomPhase !== "waiting_for_ready" && onlineController.roomPhase !== "waiting_for_player")
    ) return;
    const session = onlineController.detachSession();
    setLobbySession(session);
    setOnlineController(null);
  }, [onlineController, state.phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.repeat) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unlockAudio = useCallback(async () => {
    const enabled = await soundManager.enable();
    setAudioEnabled(enabled);
    return enabled;
  }, []);

  const start = async () => {
    await unlockAudio();
    controller.startMatch();
  };

  const toggleSound = async () => {
    if (!audioEnabled) {
      const enabled = await soundManager.enable();
      setAudioEnabled(enabled);
      setMuted(false);
      soundManager.setMuted(false);
      return;
    }
    setMuted((current) => {
      soundManager.setMuted(!current);
      return !current;
    });
  };

  const returnToModeSelect = () => {
    onlineController?.dispose();
    setOnlineController(null);
    setLobbySession(null);
    setOnlineRematchPending(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
    setPlayMode("choose");
  };

  const selectCpuStrength = (strength: CpuStrength) => {
    gameController.applyConfig(CPU_SPEED_PRESETS[strength]);
    setLocalCatSeed(createLocalCatSeed());
    setPlayMode("cpu");
  };

  const acceptOnlineMatch = useCallback((session: ConstructorParameters<typeof PvpGameController>[0]) => {
    soundManager.play("start", "center");
    soundManager.play("countdown", "center", 5);
    setLobbySession(null);
    setOnlineController((current) => {
      current?.dispose();
      return new PvpGameController(session);
    });
  }, []);

  const modeLabel = playMode === "cpu"
    ? t("top.cpuMode")
    : playMode === "online"
      ? onlineController?.roomCode ?? t("mode.online")
      : t("top.chooseMode");

  return (
    <div className="game-app">
      <header className="top-bar">
        <BattleLogo />
        <div className="top-bar__status">
          <span className="connection-pill" data-testid="connection-status"><i /> {playMode === "online" ? t("top.lanOnline") : t("top.liveLocal")}</span>
          <span className="room-pill" data-testid="room-code">{modeLabel}</span>
          <div className="language-switcher" role="group" aria-label={t("language.label")} data-testid="language-switcher">
            <span aria-hidden="true">🌐</span>
            <button type="button" data-testid="language-ja" className={locale === "ja" ? "is-active" : ""} aria-pressed={locale === "ja"} aria-label={t("language.japanese")} onClick={() => setLocale("ja")}>日本語</button>
            <button type="button" data-testid="language-en" className={locale === "en" ? "is-active" : ""} aria-pressed={locale === "en"} aria-label={t("language.english")} onClick={() => setLocale("en")}>EN</button>
          </div>
          <button className="sound-toggle" type="button" aria-label={muted ? t("top.soundOn") : t("top.soundOff")} onClick={toggleSound}>{muted ? "🔇" : "🔊"}</button>
        </div>
      </header>

      <main className="battle-shell" data-testid="battle-screen">
        <div
          className={`battle-stage${lastAttack ? ` battle-stage--under-attack battle-stage--attack-${lastAttack.source}${impactBlocked ? " battle-stage--blocked-impact" : ""}` : ""}`}
        >
          <div className="background-star background-star--one" aria-hidden="true">★</div>
          <div className="background-star background-star--two" aria-hidden="true">★</div>

          <section
            className={`combatant-line combatant-line--enemy${impactTarget === "enemy" ? impactBlocked ? " combatant-line--guard-hit" : " combatant-line--hit" : ""}${attackSource === "enemy" ? " combatant-line--attacking" : ""}`}
            key={`enemy-${lastAttack?.id ?? "idle"}`}
          >
            <FighterInfo
              side="enemy"
              name={onlineController?.opponentDisplayName || t("fighter.cpuName")}
              cat={catAssignment.enemy}
              pose={enemyCatPose}
              online={Boolean(onlineController)}
              status={enemyStatus}
              blockRemainingMs={enemyBlockRemainingMs}
            />
            <HandRow cards={enemyCards} owner="enemy" label={t(onlineController ? "hand.opponent" : "hand.cpu")} faceDown={cardsFaceDown} disabled />
            <SkillSlots skills={skillViews(state.enemy, state.nowMs, locale, state.config.healAmount)} owner="enemy" label={t(onlineController ? "skills.opponent" : "skills.cpu")} />
          </section>

          <section className="duel-center">
            <MatchTimer state={state} />
            <SkillDrop state={state} />
            <HpDuelBar
              enemyHp={state.enemy.hp}
              playerHp={state.player.hp}
              impactTarget={impactBlocked ? null : impactTarget}
              damageText={lastAttack && !impactBlocked ? `-${lastAttack.damage}` : null}
              healEffects={healEffects}
            />
            {state.notice ? <div className={`battle-notice battle-notice--${state.notice.tone}`} key={state.notice.id} role="status" data-testid="action-rejected">{state.notice.text}</div> : null}
          </section>

          <section className="player-actions">
            <RoleButtons
              roles={roles}
              selectedDiscardCount={state.selectedCardIds.length}
              disabled={onlinePaused || state.phase !== "playing" || state.nowMs < state.player.stopUntilMs || state.nowMs < state.player.shuffleLockUntilMs}
              discardDisabled={handBlocked}
              emptyMessage={state.phase === "playing" ? t("roles.none") : undefined}
              onActivateRole={(role) => controller.activatePlayerHand(role.id)}
              onDiscard={() => controller.discardSelected()}
            />
          </section>

          <section
            className={`combatant-line combatant-line--player${impactTarget === "player" ? impactBlocked ? " combatant-line--guard-hit" : " combatant-line--hit" : ""}${attackSource === "player" ? " combatant-line--attacking" : ""}`}
            key={`player-${lastAttack?.id ?? "idle"}`}
          >
            <FighterInfo
              side="player"
              name={onlineController?.localDisplayName || t("fighter.playerName")}
              cat={catAssignment.player}
              pose={playerCatPose}
              online={Boolean(onlineController)}
              status={playerStatus}
              blockRemainingMs={playerBlockRemainingMs}
            />
            <HandRow
              cards={playerCards}
              owner="player"
              label={t("hand.player")}
              faceDown={cardsFaceDown}
              selectedCardIds={state.selectedCardIds}
              disabled={selectionBlocked}
              onCardClick={(card) => controller.toggleCard(card.id)}
            />
            <SkillSlots
              skills={skillViews(state.player, state.nowMs, locale, state.config.healAmount)}
              owner="player"
              label={t("skills.player")}
              interactive
              disabled={skillBlocked}
              onUse={(skill) => controller.usePlayerSkill(skill.id)}
            />
          </section>

          {lastAttack ? (
            <div
              className={`impact-flash${impactBlocked ? " impact-flash--blocked" : ` impact-flash--${impactTarget}`}`}
              key={`flash-${lastAttack.id}`}
              aria-hidden="true"
            >
              <span className="impact-flash__burst" />
              <strong className="impact-flash__label">
                {impactBlocked ? t("impact.block") : t("impact.hit", { count: lastAttack.cards.length })}
              </strong>
            </div>
          ) : null}

          <EffectsCanvas attacks={state.activeAttacks} now={state.nowMs} />
          {onlinePaused && onlineController ? (
            <section className="match-overlay online-paused" data-testid="online-paused" role="status">
              <span>{t("top.lanOnline")}</span>
              <h1>{t("online.paused")}</h1>
              <button className="online-leave" type="button" onClick={returnToModeSelect}>{t("online.leave")}</button>
            </section>
          ) : state.phase === "waiting_start" && playMode === "choose" ? (
            <ModeSelectOverlay onCpu={selectCpuStrength} onOnline={() => setPlayMode("online")} />
          ) : state.phase === "waiting_start" && playMode === "online" && !onlineController ? (
            <OnlineLobby
              key={lobbySession ? "resumed-lobby" : "new-lobby"}
              initialSession={lobbySession}
              onBack={returnToModeSelect}
              onMatch={acceptOnlineMatch}
              onReadyGesture={() => void unlockAudio()}
            />
          ) : (
            <MatchOverlay
              state={state}
              onStart={start}
              onBack={returnToModeSelect}
              onRematch={() => {
                if (!onlineController) setLocalCatSeed(createLocalCatSeed());
                controller.rematch();
                if (onlineController) setOnlineRematchPending(true);
              }}
              online={Boolean(onlineController)}
              rematchPending={onlineRematchPending}
            />
          )}
        </div>
      </main>

      <footer className="game-footer">
        <span>{t("footer.discard")}</span>
        <span>{t("footer.attack")}</span>
        <span><kbd>F</kbd> {t("footer.fullscreen")}</span>
      </footer>

      {DevelopmentTools ? (
        <Suspense fallback={null}>
          <DevelopmentTools
            state={state}
            controller={controller}
            playMode={playMode}
            catAssignment={catAssignment}
            playerCatPose={playerCatPose}
            enemyCatPose={enemyCatPose}
            healEffects={healEffects}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
