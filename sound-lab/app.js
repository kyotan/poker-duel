(() => {
  "use strict";

  const catalog = [
    {
      title: "開始・カード",
      code: "FLOW",
      sounds: [
        { id: "start", name: "START", subtitle: "開始決定", description: "STARTボタンが受理された時の明るい決定音です。" },
        { id: "countdown_tick", name: "COUNTDOWN", subtitle: "5秒カウント", description: "5→1で少しずつ高くなる短いカウント音です。", options: { count: 3 } },
        { id: "countdown_go", name: "GO!", subtitle: "操作開始", description: "0秒でカードを公開し、操作を解禁する瞬間の和音です。" },
        { id: "card_select", name: "CARD SELECT", subtitle: "選択・解除", description: "カードを選んだ時の軽く短いクリック音です。" },
        { id: "deal", name: "DEAL FIVE", subtitle: "カード配布", description: "5枚を素早く配り、最後に着地を知らせる音です。" },
        { id: "discard_refresh", name: "DISCARD & SHUFFLE", subtitle: "交換・補充", description: "捨てる紙音と新しいカードが入る音を1セットにしています。" },
        { id: "hand_ready", name: "HAND READY", subtitle: "新しい役成立", description: "手札更新で新しい役が成立した時の控えめな通知です。" },
      ],
    },
    {
      title: "役・ダメージ",
      code: "ATTACK",
      sounds: [
        { id: "attack_light", name: "2 HIT COMBO", subtitle: "ONE PAIR • 2 CARDS", description: "2枚の使用カードが、軽く弾みながら続けて着弾します。" },
        { id: "attack_medium", name: "3 HIT COMBO", subtitle: "THREE OF A KIND • 3 CARDS", description: "3枚の使用カードが、少しずつ強くなりながら連続着弾します。" },
        { id: "attack_strong", name: "4 HIT COMBO", subtitle: "TWO PAIR / FOUR • 4 CARDS", description: "4枚の使用カードを、低音を加えた連打として鳴らします。" },
        { id: "attack_max", name: "5 HIT FINISH", subtitle: "FIVE-CARD HAND • 5 CARDS", description: "5枚の連続着弾から、大役らしいフィニッシュ音へつなげます。" },
        { id: "low_hp", name: "LOW HP", subtitle: "残りHP警告", description: "HPが30以下や10以下に入った瞬間だけ鳴らす警告です。" },
      ],
    },
    {
      title: "スキル・争奪",
      code: "SKILL",
      sounds: [
        { id: "skill_drop", name: "SKILL DROP", subtitle: "新スキル出現", description: "中央にスキルが出現したことを知らせる中立のベル音です。", side: "neutral" },
        { id: "claim_self", name: "CLAIM", subtitle: "選択側が取得", description: "選択中のPLAYERまたはENEMYがスキルを獲得する上昇音です。" },
        { id: "claim_opponent", name: "OPPONENT CLAIM", subtitle: "相手側が取得", description: "相手に先を越されたことを示す下降音です。" },
        { id: "claim_tie", name: "DOUBLE CLAIM", subtitle: "同時取得", description: "双方が取得した時に赤と青へ分かれる和音です。", side: "neutral" },
        { id: "claim_full", name: "STOCK FULL", subtitle: "満杯で消滅", description: "3枠が満杯で新しいスキルが消える、柔らかい失敗音です。" },
        { id: "skill_press", name: "SKILL BUTTON", subtitle: "スキルを押す", description: "スキル枠をタップした直後に返す短い操作音です。" },
        { id: "skill_expire", name: "DROP EXPIRED", subtitle: "未取得で消滅", description: "10秒以内に取得されなかったスキルが消える音です。", side: "neutral" },
      ],
    },
    {
      title: "スキル効果",
      code: "EFFECT",
      sounds: [
        { id: "skill_heal", name: "HEAL +20", subtitle: "HP回復", description: "HPが上向きに回復する、明るい4音のきらめきです。" },
        { id: "skill_stop", name: "STOP", subtitle: "役・交換ロック", description: "短いブレーキと鍵が閉まる低音です。" },
        { id: "skill_shuffle", name: "SHUFFLE", subtitle: "手札を強制交換", description: "カードが渦を巻き、最後に新しい手札が着地する音です。" },
        { id: "skill_steal", name: "STEAL", subtitle: "相手から奪取", description: "反対側から吸い込み、選択側へ移動する音です。" },
        { id: "no_effect", name: "NO EFFECT", subtitle: "効果なしで消費", description: "HEAL満タンなど、空振りしたことを示す乾いた2音です。" },
        { id: "stop_release", name: "STOP RELEASE", subtitle: "操作ロック解除", description: "鍵が開き、操作可能に戻ったことを示す上昇音です。" },
        { id: "invalid", name: "ACTION LOCKED", subtitle: "禁止操作", description: "STOPやクールダウン中に禁止操作を押した時の低い音です。" },
      ],
    },
    {
      title: "結果・通信",
      code: "RESULT",
      sounds: [
        { id: "win", name: "WIN", subtitle: "勝利", description: "決着の約0.3秒後に鳴る、短く明るいファンファーレです。" },
        { id: "lose", name: "LOSE", subtitle: "敗北", description: "暗くなりすぎない、柔らかい下降3音です。" },
        { id: "draw", name: "DRAW", subtitle: "同時KO", description: "勝敗どちらにも寄らない中立の2つの和音です。", side: "neutral" },
        { id: "disconnect", name: "DISCONNECTED", subtitle: "通信切断", description: "接続が切れたことを静かに知らせる下降音です。", side: "neutral" },
        { id: "reconnect", name: "RECONNECTED", subtitle: "通信復帰", description: "対戦へ戻れたことを知らせる短い復帰音です。", side: "neutral" },
      ],
    },
  ];

  const soundById = new Map(catalog.flatMap((category) => category.sounds).map((sound) => [sound.id, sound]));
  const engine = new window.PokerSoundEngine();
  const dom = {
    audioStatus: document.querySelector("#audio-status"),
    audioStatusText: document.querySelector("#audio-status-text"),
    enableAudio: document.querySelector("#enable-audio"),
    sideButtons: [...document.querySelectorAll(".side-button")],
    volume: document.querySelector("#master-volume"),
    volumeValue: document.querySelector("#volume-value"),
    volumeDown: document.querySelector("#volume-down"),
    volumeUp: document.querySelector("#volume-up"),
    mute: document.querySelector("#mute-button"),
    stopAll: document.querySelector("#stop-all"),
    playingSide: document.querySelector("#playing-side"),
    nowPlaying: document.querySelector("#now-playing-title"),
    nowDescription: document.querySelector("#now-playing-description"),
    nowPanel: document.querySelector(".now-playing"),
    soundGrid: document.querySelector("#sound-grid"),
    history: document.querySelector("#sound-history"),
    countdown: document.querySelector("#countdown-display"),
    sequenceButtons: [...document.querySelectorAll("[data-sequence]")],
    skipToGo: document.querySelector("#skip-to-go"),
    visualizer: document.querySelector("#sound-visualizer"),
    toast: document.querySelector("#toast"),
  };

  const savedVolume = Number.parseInt(localStorage.getItem("poker-duel-sound-lab-volume") || "65", 10);
  const initialVolume = Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 65;
  const state = {
    audioEnabled: false,
    side: "self",
    volume: initialVolume,
    muted: false,
    lastSound: null,
    history: [],
    sequence: null,
    virtualTimeMs: 0,
    lastInvalidAt: -Infinity,
    playingTimeouts: new Map(),
  };

  let toastTimer = null;
  let lastSequenceTick = performance.now();

  function renderCatalog() {
    dom.soundGrid.innerHTML = catalog
      .map(
        (category) => `
          <article class="sound-category">
            <div class="category-heading">
              <h3>${category.title}</h3>
              <span>${category.code}</span>
            </div>
            <div class="sound-list">
              ${category.sounds
                .map(
                  (sound) => `
                    <button
                      type="button"
                      class="sound-button"
                      data-sound="${sound.id}"
                      aria-label="${sound.name}、${sound.subtitle}を再生"
                    >
                      <span>
                        <strong>${sound.name}</strong>
                        <small>${sound.subtitle}</small>
                      </span>
                      <span class="play-mark" aria-hidden="true">▶</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
          </article>
        `,
      )
      .join("");

    dom.soundGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sound]");
      if (!button) return;
      const sound = soundById.get(button.dataset.sound);
      if (!sound) return;
      void playSound(sound.id, { button, options: sound.options, side: sound.side });
    });
  }

  async function enableAudio(playConfirmation = false) {
    try {
      await engine.ensureReady();
      state.audioEnabled = true;
      updateAudioStatus();
      if (playConfirmation) {
        await playSound("hand_ready", { skipEnsure: true });
      }
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "音声を有効にできませんでした。", 3200);
      updateAudioStatus();
      return false;
    }
  }

  async function playSound(soundId, config = {}) {
    const sound = soundById.get(soundId) || {
      id: soundId,
      name: config.label || soundId.toUpperCase(),
      subtitle: "SEQUENCE",
      description: config.description || "シーケンス内の効果音です。",
    };

    if (soundId === "invalid") {
      const now = performance.now();
      if (now - state.lastInvalidAt < 500) {
        showToast("禁止操作音は500msに1回までです。", 1200);
        return null;
      }
      state.lastInvalidAt = now;
    }

    if (!config.skipEnsure && !(await enableAudio(false))) return null;
    const side = config.side || sound.side || state.side;
    const result = engine.play(soundId, side, config.options || {});
    state.lastSound = {
      id: soundId,
      name: config.label || sound.name,
      subtitle: sound.subtitle,
      side,
      at: Date.now(),
      durationMs: result.durationMs,
    };
    state.history.unshift(state.lastSound);
    state.history = state.history.slice(0, 6);
    updateNowPlaying(sound, config.label, side);
    updateHistory();
    markPlaying(config.button || document.querySelector(`[data-sound="${soundId}"]`), result.durationMs);
    return result;
  }

  function markPlaying(button, durationMs) {
    if (!button) return;
    button.classList.add("is-playing");
    const previous = state.playingTimeouts.get(button);
    if (previous) window.clearTimeout(previous);
    const timeout = window.setTimeout(() => {
      button.classList.remove("is-playing");
      state.playingTimeouts.delete(button);
    }, Math.max(180, durationMs + 80));
    state.playingTimeouts.set(button, timeout);
  }

  function updateNowPlaying(sound, label, side) {
    dom.nowPlaying.textContent = label || sound.name;
    dom.nowDescription.textContent = sound.description;
    const sideLabel = side === "neutral" ? "PLAYING AT CENTER" : `PLAYING AS ${side === "enemy" ? "ENEMY" : "PLAYER"}`;
    dom.playingSide.textContent = sideLabel;
  }

  function updateHistory() {
    if (state.history.length === 0) {
      dom.history.innerHTML = '<li class="history-empty">まだ再生されていません</li>';
      return;
    }
    dom.history.innerHTML = state.history
      .map((sound) => `<li>${sound.name}<br><small>${sound.side === "enemy" ? "ENEMY" : sound.side === "neutral" ? "CENTER" : "PLAYER"}</small></li>`)
      .join("");
  }

  function setSide(side) {
    state.side = side === "enemy" ? "enemy" : "self";
    document.body.dataset.side = state.side;
    dom.sideButtons.forEach((button) => {
      const active = button.dataset.side === state.side;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    dom.nowPanel.classList.toggle("is-enemy", state.side === "enemy");
    dom.playingSide.textContent = `PLAYING AS ${state.side === "enemy" ? "ENEMY" : "PLAYER"}`;
  }

  function setVolume(value) {
    state.volume = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    dom.volume.value = String(state.volume);
    dom.volumeValue.textContent = `${state.volume}%`;
    dom.volume.style.background = `linear-gradient(90deg, var(--blue) 0 ${state.volume}%, #d8dce7 ${state.volume}% 100%)`;
    engine.setVolume(state.volume / 100);
    try {
      localStorage.setItem("poker-duel-sound-lab-volume", String(state.volume));
    } catch {
      // 保存できなくても試聴は継続する。
    }
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    engine.setMuted(state.muted);
    dom.mute.classList.toggle("is-active", state.muted);
    dom.mute.setAttribute("aria-pressed", String(state.muted));
    dom.mute.textContent = state.muted ? "UNMUTE" : "MUTE";
    updateAudioStatus();
  }

  function updateAudioStatus() {
    const audioState = engine.getState();
    const ready = state.audioEnabled && audioState.contextState === "running";
    dom.audioStatus.classList.toggle("is-ready", ready && !state.muted);
    dom.audioStatus.classList.toggle("is-muted", state.muted);
    dom.enableAudio.classList.toggle("is-ready", ready);
    if (state.muted) {
      dom.audioStatusText.textContent = "音声はMUTE中です";
      dom.enableAudio.querySelector("span").textContent = "音声は有効です";
      dom.enableAudio.querySelector("small").textContent = "MUTEを解除して試聴";
    } else if (ready) {
      dom.audioStatusText.textContent = `音声ON・${state.volume}%`;
      dom.enableAudio.querySelector("span").textContent = "音声は有効です";
      dom.enableAudio.querySelector("small").textContent = "タップで確認音を再生";
    } else {
      dom.audioStatusText.textContent = "音声はまだOFFです";
      dom.enableAudio.querySelector("span").textContent = "音声を有効にする";
      dom.enableAudio.querySelector("small").textContent = "最初に1回タップ";
    }
  }

  function createSequence(kind) {
    if (kind === "start") {
      return {
        kind,
        label: "START COUNTDOWN",
        durationMs: 5900,
        events: [
          { at: 0, sound: "start", label: "START", side: "neutral" },
          { at: 500, sound: "countdown_tick", label: "5", side: "neutral", options: { count: 5 } },
          { at: 1500, sound: "countdown_tick", label: "4", side: "neutral", options: { count: 4 } },
          { at: 2500, sound: "countdown_tick", label: "3", side: "neutral", options: { count: 3 } },
          { at: 3500, sound: "countdown_tick", label: "2", side: "neutral", options: { count: 2 } },
          { at: 4500, sound: "countdown_tick", label: "1", side: "neutral", options: { count: 1 } },
          { at: 5500, sound: "countdown_go", label: "GO!", side: "neutral" },
        ],
      };
    }
    if (kind === "cards") {
      return {
        kind,
        label: "CARD FLOW",
        durationMs: 1750,
        events: [
          { at: 0, sound: "deal", label: "DEAL FIVE" },
          { at: 560, sound: "hand_ready", label: "HAND READY" },
          { at: 1120, sound: "discard_refresh", label: "DISCARD & SHUFFLE" },
        ],
      };
    }
    if (kind === "skill") {
      return {
        kind,
        label: "SKILL FLOW",
        durationMs: 2300,
        events: [
          { at: 0, sound: "skill_drop", label: "SKILL DROP", side: "neutral" },
          { at: 720, sound: "claim_self", label: "SKILL CLAIMED" },
          { at: 1320, sound: "skill_press", label: "SKILL BUTTON" },
          { at: 1480, sound: "skill_heal", label: "HEAL +20" },
        ],
      };
    }
    return {
      kind: "attacks",
      label: "ATTACK LADDER",
      durationMs: 3700,
      events: [
        { at: 0, sound: "attack_light", label: "2 HIT COMBO" },
        { at: 700, sound: "attack_medium", label: "3 HIT COMBO" },
        { at: 1500, sound: "attack_strong", label: "4 HIT COMBO" },
        { at: 2350, sound: "attack_max", label: "5 HIT FINISH" },
      ],
    };
  }

  async function startSequence(kind) {
    if (!(await enableAudio(false))) return;
    stopSequence(true);
    const definition = createSequence(kind);
    state.sequence = {
      ...definition,
      active: true,
      elapsedMs: 0,
      nextEventIndex: 0,
      display: kind === "start" ? "START" : definition.label,
    };
    lastSequenceTick = performance.now();
    processSequenceEvents();
    updateCountdownDisplay();
  }

  function updateSequence(deltaMs) {
    if (!state.sequence?.active) return;
    state.sequence.elapsedMs += Math.max(0, deltaMs);
    processSequenceEvents();
    if (state.sequence.elapsedMs >= state.sequence.durationMs) {
      state.sequence.active = false;
      if (state.sequence.kind === "start") state.sequence.display = "READY!";
      updateCountdownDisplay();
    }
  }

  function processSequenceEvents() {
    if (!state.sequence?.active) return;
    while (
      state.sequence.nextEventIndex < state.sequence.events.length &&
      state.sequence.events[state.sequence.nextEventIndex].at <= state.sequence.elapsedMs
    ) {
      const event = state.sequence.events[state.sequence.nextEventIndex];
      state.sequence.nextEventIndex += 1;
      state.sequence.display = event.label;
      void playSound(event.sound, {
        skipEnsure: true,
        label: event.label,
        side: event.side,
        options: event.options,
      });
      updateCountdownDisplay();
    }
  }

  function stopSequence(stopAudio) {
    if (state.sequence) state.sequence.active = false;
    state.sequence = null;
    dom.countdown.textContent = "READY";
    dom.countdown.classList.remove("is-active");
    if (stopAudio) engine.stopAll();
  }

  function skipToGo() {
    if (!state.sequence || state.sequence.kind !== "start") {
      showToast("STARTシーケンスを実行中に使用できます。", 1600);
      return;
    }
    engine.stopAll();
    state.sequence.active = false;
    state.sequence.display = "GO!";
    state.sequence.elapsedMs = state.sequence.durationMs;
    state.sequence.nextEventIndex = state.sequence.events.length;
    void playSound("countdown_go", { label: "GO!", side: "neutral" });
    updateCountdownDisplay();
  }

  function updateCountdownDisplay() {
    const text = state.sequence?.display || "READY";
    dom.countdown.textContent = text;
    dom.countdown.classList.remove("is-active");
    void dom.countdown.offsetWidth;
    dom.countdown.classList.add("is-active");
  }

  function stopEverything() {
    stopSequence(false);
    engine.stopAll();
    for (const [button, timeout] of state.playingTimeouts.entries()) {
      window.clearTimeout(timeout);
      button.classList.remove("is-playing");
    }
    state.playingTimeouts.clear();
    dom.nowPlaying.textContent = "すべて停止しました";
    dom.nowDescription.textContent = "次に試したい音を選んでください。";
    showToast("予約中のシーケンスを含め、すべて停止しました。", 1800);
  }

  function showToast(message, duration = 1800) {
    if (toastTimer) window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), duration);
  }

  function resizeCanvas() {
    const rect = dom.visualizer.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(rect.width * ratio));
    const height = Math.max(120, Math.round(rect.height * ratio));
    if (dom.visualizer.width !== width || dom.visualizer.height !== height) {
      dom.visualizer.width = width;
      dom.visualizer.height = height;
    }
  }

  function drawVisualizer(now) {
    resizeCanvas();
    const context = dom.visualizer.getContext("2d");
    const width = dom.visualizer.width;
    const height = dom.visualizer.height;
    const audioData = engine.getAnalyserData();
    const active = engine.getState().activeGroups.length > 0;
    const enemy = state.side === "enemy";
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, enemy ? "#4f111b" : "#092b6d");
    background.addColorStop(0.52, "#17203a");
    background.addColorStop(1, enemy ? "#a81422" : "#1265e8");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.globalAlpha = 0.16;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    for (let x = 0; x < width; x += width / 12) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    context.globalAlpha = 1;

    const bars = 24;
    const gap = width * 0.006;
    const barWidth = (width - gap * (bars + 1)) / bars;
    for (let index = 0; index < bars; index += 1) {
      const dataIndex = Math.floor((index / bars) * audioData.length);
      const measured = audioData[dataIndex] / 255;
      const idle = 0.06 + Math.sin(now / 430 + index * 0.63) * 0.018;
      const level = active ? Math.max(0.09, measured) : idle;
      const barHeight = Math.max(5, level * height * 0.82);
      const x = gap + index * (barWidth + gap);
      const y = height - barHeight - height * 0.08;
      const gradient = context.createLinearGradient(0, y, 0, height);
      gradient.addColorStop(0, "#fff7a8");
      gradient.addColorStop(0.45, "#ffd72e");
      gradient.addColorStop(1, enemy ? "#ef3340" : "#20b4ff");
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, Math.min(8, barWidth / 2));
      context.fill();
    }

    context.fillStyle = "rgba(255,255,255,0.92)";
    context.font = `900 ${Math.max(18, width * 0.025)}px "Trebuchet MS", sans-serif`;
    context.textAlign = "center";
    context.fillText(active ? "PLAYING" : "READY", width / 2, height * 0.2);
    window.requestAnimationFrame(drawVisualizer);
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showToast("この環境ではフルスクリーンへ切り替えられません。", 2200);
    }
  }

  engine.onStateChange = updateAudioStatus;
  renderCatalog();
  setVolume(initialVolume);
  setSide("self");
  updateHistory();
  updateAudioStatus();
  window.requestAnimationFrame(drawVisualizer);

  dom.enableAudio.addEventListener("click", () => void enableAudio(true));
  dom.sideButtons.forEach((button) => button.addEventListener("click", () => setSide(button.dataset.side)));
  dom.volume.addEventListener("input", (event) => setVolume(event.target.value));
  dom.volumeDown.addEventListener("click", () => setVolume(state.volume - 5));
  dom.volumeUp.addEventListener("click", () => setVolume(state.volume + 5));
  dom.mute.addEventListener("click", () => setMuted(!state.muted));
  dom.stopAll.addEventListener("click", stopEverything);
  dom.sequenceButtons.forEach((button) => button.addEventListener("click", () => void startSequence(button.dataset.sequence)));
  dom.skipToGo.addEventListener("click", skipToGo);

  window.setInterval(() => {
    const now = performance.now();
    const delta = Math.min(250, now - lastSequenceTick);
    lastSequenceTick = now;
    updateSequence(delta);
  }, 50);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopSequence(false);
      void engine.suspend();
    } else {
      state.audioEnabled = false;
      updateAudioStatus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "f" || event.repeat) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    void toggleFullscreen();
  });

  window.addEventListener("resize", resizeCanvas);

  window.render_game_to_text = () =>
    JSON.stringify({
      mode: "sound-lab",
      coordinateSystem: "DOM-based audition console; no gameplay world coordinates",
      audio: engine.getState(),
      controls: {
        selectedSide: state.side,
        volumePercent: state.volume,
        muted: state.muted,
        audioEnabled: state.audioEnabled,
      },
      sequence: state.sequence
        ? {
            kind: state.sequence.kind,
            active: state.sequence.active,
            elapsedMs: Math.round(state.sequence.elapsedMs),
            display: state.sequence.display,
            nextEventIndex: state.sequence.nextEventIndex,
          }
        : null,
      lastSound: state.lastSound,
      recentSoundIds: state.history.map((sound) => sound.id),
      visibleCategories: catalog.map((category) => ({
        title: category.title,
        soundIds: category.sounds.map((sound) => sound.id),
      })),
      virtualTimeMs: state.virtualTimeMs,
    });

  window.advanceTime = (milliseconds) => {
    const safeMs = Math.max(0, Number(milliseconds) || 0);
    state.virtualTimeMs += safeMs;
    updateSequence(safeMs);
    return window.render_game_to_text();
  };
})();
