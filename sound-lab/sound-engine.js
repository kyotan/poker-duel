(() => {
  "use strict";

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  class PokerSoundEngine {
    constructor() {
      this.context = null;
      this.masterGain = null;
      this.compressor = null;
      this.analyser = null;
      this.noiseBuffer = null;
      this.volume = 0.65;
      this.muted = false;
      this.groupSerial = 0;
      this.activeGroups = new Map();
      this.maxGroups = 6;
      this.onStateChange = null;
    }

    get supported() {
      return Boolean(AudioContextClass);
    }

    async ensureReady() {
      if (!this.supported) {
        throw new Error("このブラウザはWeb Audio APIに対応していません。");
      }

      if (!this.context) {
        this.context = new AudioContextClass({ latencyHint: "interactive" });
        this._buildGraph();
        this.context.addEventListener?.("statechange", () => this._emitState());
      }

      if (this.context.state !== "running") {
        await this.context.resume();
      }

      // iOS Safariで音声経路を確実に解禁するための極短い無音バッファ。
      const unlock = this.context.createBufferSource();
      unlock.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      unlock.connect(this.masterGain);
      unlock.start(0);
      this._emitState();
      return this.context.state;
    }

    _buildGraph() {
      this.masterGain = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.analyser = this.context.createAnalyser();

      this.compressor.threshold.value = -22;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.72;

      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.noiseBuffer = this._createNoiseBuffer();
    }

    _createNoiseBuffer() {
      const seconds = 2;
      const buffer = this.context.createBuffer(1, this.context.sampleRate * seconds, this.context.sampleRate);
      const channel = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < channel.length; i += 1) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.22 + white * 0.78;
        channel[i] = previous * 0.82;
      }
      return buffer;
    }

    setVolume(value) {
      this.volume = Math.min(1, Math.max(0, Number(value) || 0));
      this._applyMasterGain();
      this._emitState();
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      this._applyMasterGain();
      this._emitState();
    }

    _applyMasterGain() {
      if (!this.context || !this.masterGain) return;
      const now = this.context.currentTime;
      const target = this.muted ? 0.0001 : Math.max(0.0001, this.volume);
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(target, now, 0.015);
    }

    async suspend() {
      if (!this.context) return;
      this.stopAll();
      if (this.context.state === "running") {
        await this.context.suspend();
      }
      this._emitState();
    }

    stopAll() {
      for (const groupId of [...this.activeGroups.keys()]) {
        this.stopGroup(groupId);
      }
      this._emitState();
    }

    stopGroup(groupId) {
      const group = this.activeGroups.get(groupId);
      if (!group) return;
      group.stopped = true;
      for (const source of group.sources) {
        try {
          source.stop();
        } catch {
          // すでに終了したSourceNodeはそのまま破棄する。
        }
      }
      group.sources.clear();
      this.activeGroups.delete(groupId);
    }

    play(soundId, side = "self", options = {}) {
      if (!this.context || this.context.state !== "running") {
        throw new Error("音声を有効にしてから再生してください。");
      }

      const priority = this._priorityFor(soundId);
      this._enforceGroupLimit(priority);
      const group = {
        id: `sound-${++this.groupSerial}`,
        soundId,
        side,
        priority,
        baseTime: this.context.currentTime + 0.012,
        startedAt: performance.now(),
        sources: new Set(),
        stopped: false,
      };
      this.activeGroups.set(group.id, group);
      const durationMs = Math.round(this._playRecipe(group, soundId, side, options) * 1000);
      group.durationMs = durationMs;
      this._emitState();
      return { groupId: group.id, durationMs };
    }

    _enforceGroupLimit(incomingPriority) {
      if (this.activeGroups.size < this.maxGroups) return;
      const candidates = [...this.activeGroups.values()].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.startedAt - b.startedAt;
      });
      const target = candidates.find((group) => group.priority <= incomingPriority) || candidates[0];
      if (target) this.stopGroup(target.id);
    }

    _priorityFor(soundId) {
      if (["win", "lose", "draw", "countdown_go", "attack_max"].includes(soundId)) return 4;
      if (["skill_drop", "skill_stop", "low_hp", "disconnect"].includes(soundId)) return 3;
      if (soundId.startsWith("skill_") || soundId.startsWith("attack_") || soundId.startsWith("claim_")) return 2;
      return 1;
    }

    _sideParams(side) {
      if (side === "enemy") return { pitch: 0.94, pan: -0.2, gain: 0.78 };
      if (side === "neutral") return { pitch: 1, pan: 0, gain: 1 };
      return { pitch: 1.06, pan: 0.2, gain: 1 };
    }

    _registerSource(source, group) {
      group.sources.add(source);
      source.addEventListener?.("ended", () => {
        group.sources.delete(source);
        if (group.sources.size === 0) {
          this.activeGroups.delete(group.id);
          this._emitState();
        }
      });
    }

    _connectVoice(node, group, gainValue, startTime, endTime, panValue, attack = 0.008) {
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner ? this.context.createStereoPanner() : null;
      const peakAt = Math.min(endTime - 0.004, startTime + attack);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), peakAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);
      node.connect(gain);
      if (panner) {
        panner.pan.setValueAtTime(panValue, startTime);
        gain.connect(panner);
        panner.connect(this.masterGain);
      } else {
        gain.connect(this.masterGain);
      }
    }

    _tone(group, side, config) {
      const sideParams = this._sideParams(side);
      const startTime = group.baseTime + (config.at || 0);
      const duration = Math.max(0.025, config.duration || 0.1);
      const endTime = startTime + duration;
      const oscillator = this.context.createOscillator();
      oscillator.type = config.type || "sine";
      const from = Math.max(30, (config.from || 440) * sideParams.pitch);
      const to = Math.max(30, (config.to || config.from || 440) * sideParams.pitch);
      oscillator.frequency.setValueAtTime(from, startTime);
      if (Math.abs(from - to) > 0.1) {
        oscillator.frequency.exponentialRampToValueAtTime(to, endTime);
      }
      this._connectVoice(
        oscillator,
        group,
        (config.gain || 0.08) * sideParams.gain,
        startTime,
        endTime,
        config.pan ?? sideParams.pan,
        config.attack,
      );
      this._registerSource(oscillator, group);
      oscillator.start(startTime);
      oscillator.stop(endTime + 0.01);
      return endTime;
    }

    _noise(group, side, config) {
      const sideParams = this._sideParams(side);
      const startTime = group.baseTime + (config.at || 0);
      const duration = Math.max(0.025, config.duration || 0.1);
      const endTime = startTime + duration;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      source.buffer = this.noiseBuffer;
      filter.type = config.filter || "bandpass";
      filter.Q.value = config.q || 0.8;
      const from = Math.max(60, config.from || 1800);
      const to = Math.max(60, config.to || from);
      filter.frequency.setValueAtTime(from, startTime);
      if (Math.abs(from - to) > 0.1) {
        filter.frequency.exponentialRampToValueAtTime(to, endTime);
      }
      source.connect(filter);
      this._connectVoice(
        filter,
        group,
        (config.gain || 0.035) * sideParams.gain,
        startTime,
        endTime,
        config.pan ?? sideParams.pan,
        config.attack || 0.004,
      );
      this._registerSource(source, group);
      const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.02);
      source.start(startTime, Math.random() * maxOffset);
      source.stop(endTime + 0.01);
      return endTime;
    }

    _notes(group, side, notes, config = {}) {
      const step = config.step || 0.07;
      const duration = config.duration || 0.11;
      notes.forEach((frequency, index) => {
        this._tone(group, side, {
          at: (config.at || 0) + index * step,
          duration,
          type: config.type || "triangle",
          from: frequency,
          to: config.glide ? frequency * config.glide : frequency,
          gain: config.gain || 0.09,
          attack: config.attack || 0.006,
        });
      });
      return (config.at || 0) + (notes.length - 1) * step + duration;
    }

    _attackCombo(group, side, config) {
      const hits = Math.max(2, Math.min(5, config.hits || 2));
      const spacing = config.spacing || 0.12;
      const power = config.power || 1;
      const firstHitAt = config.firstHitAt || 0.085;

      // カードがHPゲージへ向かう短い飛翔音。
      this._tone(group, side, {
        duration: firstHitAt + 0.035,
        type: "triangle",
        from: config.launchFrom || 540,
        to: config.launchTo || 980,
        gain: 0.055 + power * 0.035,
      });
      this._noise(group, side, {
        duration: firstHitAt + 0.015,
        filter: "highpass",
        from: 1700,
        to: 3600,
        gain: 0.018 + power * 0.012,
      });

      // 使用カード1枚ずつが連続して叩くイメージの多段ヒット。
      for (let index = 0; index < hits; index += 1) {
        const at = firstHitAt + index * spacing;
        const crescendo = 0.78 + (index / Math.max(1, hits - 1)) * 0.28;
        const impactGain = (0.075 + power * 0.052) * crescendo;
        this._tone(group, side, {
          at,
          duration: 0.055,
          type: "triangle",
          from: 760 + index * 42,
          to: 430 + index * 18,
          gain: 0.045 + power * 0.025,
        });
        this._tone(group, side, {
          at: at + 0.018,
          duration: 0.105 + power * 0.025,
          type: "sine",
          from: 205 - index * 9,
          to: 72 - index * 3,
          gain: impactGain,
        });
        this._noise(group, side, {
          at: at + 0.014,
          duration: 0.07,
          filter: "bandpass",
          from: 2050 - index * 120,
          to: 650,
          gain: (0.025 + power * 0.02) * crescendo,
        });
      }

      const finalHitAt = firstHitAt + (hits - 1) * spacing;
      if (config.finisher) {
        this._tone(group, side, {
          at: finalHitAt + 0.045,
          duration: 0.25,
          type: "sine",
          from: 115,
          to: 42,
          gain: 0.17,
        });
        [784, 1047, 1568].forEach((frequency, index) => {
          this._tone(group, side, {
            at: finalHitAt + 0.07 + index * 0.035,
            duration: 0.22 - index * 0.025,
            type: "triangle",
            from: frequency,
            to: frequency * 1.04,
            gain: 0.065 - index * 0.008,
          });
        });
        return finalHitAt + 0.34;
      }

      if (power >= 0.95) {
        this._tone(group, side, {
          at: finalHitAt + 0.035,
          duration: 0.19,
          type: "sine",
          from: 135,
          to: 55,
          gain: 0.13 + power * 0.025,
        });
        return finalHitAt + 0.26;
      }

      return finalHitAt + 0.18;
    }

    _playRecipe(group, soundId, side, options) {
      switch (soundId) {
        case "card_select":
          this._tone(group, side, { duration: 0.055, type: "triangle", from: 780, to: 920, gain: 0.055 });
          return 0.07;

        case "discard_refresh":
          this._noise(group, side, { duration: 0.17, filter: "bandpass", from: 2100, to: 850, gain: 0.038 });
          this._tone(group, side, { at: 0.145, duration: 0.075, type: "triangle", from: 360, to: 510, gain: 0.065 });
          return 0.24;

        case "deal":
          [0, 0.048, 0.096, 0.144, 0.192].forEach((at, index) => {
            this._noise(group, side, { at, duration: 0.034, filter: "bandpass", from: 2500 - index * 90, gain: 0.026 });
          });
          this._tone(group, side, { at: 0.205, duration: 0.075, type: "sine", from: 520, to: 780, gain: 0.065 });
          return 0.3;

        case "hand_ready":
          this._notes(group, side, [784, 1047], { step: 0.085, duration: 0.12, type: "triangle", gain: 0.075 });
          return 0.23;

        case "skill_press":
          this._tone(group, side, { duration: 0.08, type: "triangle", from: 520, to: 780, gain: 0.07 });
          return 0.1;

        case "attack_light":
          return this._attackCombo(group, side, { hits: 2, spacing: 0.125, power: 0.62, launchFrom: 620, launchTo: 920 });

        case "attack_medium":
          return this._attackCombo(group, side, { hits: 3, spacing: 0.13, power: 0.78, launchFrom: 540, launchTo: 1060 });

        case "attack_strong":
          return this._attackCombo(group, side, { hits: 4, spacing: 0.135, power: 1, launchFrom: 460, launchTo: 1240 });

        case "attack_max":
          return this._attackCombo(group, side, { hits: 5, spacing: 0.14, power: 1.12, launchFrom: 420, launchTo: 1380, finisher: true });

        case "skill_drop":
          [880, 1320, 1760].forEach((frequency, index) => {
            this._tone(group, "neutral", { at: index * 0.045, duration: 0.34 - index * 0.05, type: "sine", from: frequency, to: frequency * 1.03, gain: 0.085 - index * 0.012, pan: 0 });
          });
          return 0.42;

        case "claim_self":
          this._notes(group, side, [660, 880, 1320], { step: 0.07, duration: 0.13, type: "triangle", gain: 0.095 });
          return 0.3;

        case "claim_opponent":
          this._notes(group, side, [660, 494, 392], { step: 0.07, duration: 0.13, type: "triangle", gain: 0.085 });
          return 0.3;

        case "claim_tie":
          [660, 880].forEach((frequency) => this._tone(group, "self", { duration: 0.18, type: "triangle", from: frequency, gain: 0.078 }));
          [660, 494].forEach((frequency) => this._tone(group, "enemy", { duration: 0.18, type: "triangle", from: frequency, gain: 0.078 }));
          this._tone(group, "neutral", { at: 0.17, duration: 0.13, type: "sine", from: 660, gain: 0.1, pan: 0 });
          return 0.33;

        case "claim_full":
          this._noise(group, side, { duration: 0.12, filter: "highpass", from: 900, to: 2400, gain: 0.028 });
          this._tone(group, side, { at: 0.04, duration: 0.13, type: "triangle", from: 320, to: 220, gain: 0.065 });
          return 0.2;

        case "skill_heal":
          this._notes(group, side, [523, 659, 784, 1047], { step: 0.075, duration: 0.15, type: "sine", gain: 0.095 });
          return 0.43;

        case "skill_stop":
          this._tone(group, side, { duration: 0.25, type: "triangle", from: 920, to: 175, gain: 0.13 });
          this._noise(group, side, { at: 0.13, duration: 0.11, filter: "lowpass", from: 1700, to: 380, gain: 0.04 });
          this._tone(group, side, { at: 0.215, duration: 0.09, type: "square", from: 120, to: 105, gain: 0.06 });
          return 0.34;

        case "skill_shuffle":
          [0, 0.04, 0.08, 0.12, 0.16].forEach((at, index) => {
            this._noise(group, side, { at, duration: 0.035, filter: "bandpass", from: 2450 - index * 210, gain: 0.034 });
          });
          this._tone(group, side, { at: 0.17, duration: 0.075, type: "triangle", from: 330, to: 440, gain: 0.07 });
          return 0.27;

        case "skill_steal":
          this._tone(group, side === "self" ? "enemy" : "self", { duration: 0.15, type: "triangle", from: 1200, to: 470, gain: 0.09 });
          this._noise(group, "neutral", { at: 0.055, duration: 0.1, filter: "bandpass", from: 2300, to: 820, gain: 0.034, pan: 0 });
          this._tone(group, side, { at: 0.145, duration: 0.125, type: "triangle", from: 480, to: 920, gain: 0.11 });
          return 0.3;

        case "skill_expire":
          this._tone(group, "neutral", { duration: 0.13, type: "sine", from: 980, to: 460, gain: 0.06, pan: 0 });
          this._noise(group, "neutral", { at: 0.06, duration: 0.12, filter: "highpass", from: 1200, to: 3600, gain: 0.026, pan: 0 });
          return 0.22;

        case "no_effect":
          this._tone(group, side, { duration: 0.085, type: "triangle", from: 330, to: 260, gain: 0.07 });
          this._tone(group, side, { at: 0.11, duration: 0.085, type: "triangle", from: 260, to: 215, gain: 0.06 });
          return 0.22;

        case "stop_release":
          this._tone(group, side, { duration: 0.17, type: "sine", from: 220, to: 660, gain: 0.085 });
          this._tone(group, side, { at: 0.145, duration: 0.1, type: "triangle", from: 990, to: 1120, gain: 0.07 });
          return 0.27;

        case "invalid":
          this._tone(group, side, { duration: 0.05, type: "sine", from: 190, to: 175, gain: 0.075 });
          this._tone(group, side, { at: 0.085, duration: 0.05, type: "sine", from: 180, to: 165, gain: 0.065 });
          return 0.16;

        case "low_hp":
          this._tone(group, side, { duration: 0.13, type: "sine", from: 220, to: 160, gain: 0.13 });
          this._tone(group, side, { at: 0.23, duration: 0.13, type: "sine", from: 220, to: 155, gain: 0.12 });
          return 0.4;

        case "start":
          this._notes(group, "neutral", [523, 659, 784, 1047], { step: 0.085, duration: 0.14, type: "triangle", gain: 0.09 });
          return 0.48;

      case "countdown_tick": {
          const frequencies = { 5: 494, 4: 554, 3: 587, 2: 659, 1: 740 };
          const frequency = frequencies[options.count] || 620;
          this._tone(group, "neutral", { duration: 0.085, type: "triangle", from: frequency, to: frequency * 1.025, gain: 0.1, pan: 0 });
          return 0.11;
        }

        case "countdown_go":
          [523, 784, 1047].forEach((frequency) => {
            this._tone(group, "neutral", { duration: 0.23, type: "triangle", from: frequency, to: frequency * 1.05, gain: 0.09, pan: 0 });
          });
          this._noise(group, "neutral", { duration: 0.055, filter: "highpass", from: 3000, to: 5000, gain: 0.035, pan: 0 });
          return 0.27;

        case "win":
          this._notes(group, side, [523, 659, 784, 1047], { step: 0.105, duration: 0.2, type: "triangle", gain: 0.11 });
          this._tone(group, side, { at: 0.43, duration: 0.42, type: "sine", from: 1568, to: 1600, gain: 0.085 });
          return 0.9;

        case "lose":
          this._notes(group, side, [440, 349, 294], { step: 0.17, duration: 0.2, type: "sine", gain: 0.09 });
          this._tone(group, side, { at: 0.48, duration: 0.16, type: "sine", from: 110, to: 95, gain: 0.08 });
          return 0.69;

        case "draw":
          [587, 880].forEach((frequency) => this._tone(group, "neutral", { duration: 0.24, type: "triangle", from: frequency, gain: 0.08, pan: 0 }));
          [659, 988].forEach((frequency) => this._tone(group, "neutral", { at: 0.25, duration: 0.32, type: "triangle", from: frequency, gain: 0.075, pan: 0 }));
          return 0.62;

        case "disconnect":
          this._tone(group, "neutral", { duration: 0.27, type: "triangle", from: 700, to: 340, gain: 0.085, pan: 0 });
          this._noise(group, "neutral", { at: 0.09, duration: 0.22, filter: "lowpass", from: 1300, to: 220, gain: 0.035, pan: 0 });
          return 0.35;

        case "reconnect":
          this._tone(group, "neutral", { duration: 0.23, type: "sine", from: 330, to: 660, gain: 0.09, pan: 0 });
          this._tone(group, "neutral", { at: 0.2, duration: 0.14, type: "triangle", from: 990, to: 1100, gain: 0.07, pan: 0 });
          return 0.38;

        default:
          this._tone(group, side, { duration: 0.1, type: "sine", from: 440, to: 660, gain: 0.06 });
          return 0.12;
      }
    }

    getAnalyserData() {
      if (!this.analyser) return new Uint8Array(32);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      return data;
    }

    getState() {
      return {
        supported: this.supported,
        contextState: this.context?.state || "not-created",
        volume: this.volume,
        muted: this.muted,
        activeGroups: [...this.activeGroups.values()].map((group) => ({
          id: group.id,
          soundId: group.soundId,
          side: group.side,
          priority: group.priority,
          voiceCount: group.sources.size,
        })),
      };
    }

    _emitState() {
      this.onStateChange?.(this.getState());
    }
  }

  window.PokerSoundEngine = PokerSoundEngine;
})();
