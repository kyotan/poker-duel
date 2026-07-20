export type SoundSide = "player" | "enemy" | "center";

export type GameSound =
  | "start"
  | "countdown"
  | "timeWarning"
  | "go"
  | "deal"
  | "select"
  | "discard"
  | "handReady"
  | "skillDrop"
  | "skillClaim"
  | "skillPress"
  | "heal"
  | "stop"
  | "shuffle"
  | "steal"
  | "blockActivate"
  | "blockImpact"
  | "noEffect"
  | "locked"
  | "lowHp"
  | "win"
  | "lose"
  | "draw";

type AudioContextConstructor = typeof AudioContext;

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

interface ToneOptions {
  at?: number;
  duration?: number;
  from?: number;
  to?: number;
  gain?: number;
  type?: OscillatorType;
  pan?: number;
}

interface NoiseOptions {
  at?: number;
  duration?: number;
  from?: number;
  to?: number;
  gain?: number;
  filter?: BiquadFilterType;
  pan?: number;
}

const sideParameters: Record<SoundSide, { pitch: number; gain: number; pan: number }> = {
  player: { pitch: 1.06, gain: 1, pan: 0.18 },
  enemy: { pitch: 0.94, gain: 0.8, pan: -0.18 },
  center: { pitch: 1, gain: 1, pan: 0 },
};

export class SoundManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.65;
  private muted = false;
  private enabled = false;

  get state() {
    return {
      supported: Boolean((window as AudioWindow).AudioContext || (window as AudioWindow).webkitAudioContext),
      enabled: this.enabled,
      contextState: this.context?.state ?? "closed",
      volume: this.volume,
      muted: this.muted,
    };
  }

  async enable() {
    const AudioContextClass =
      (window as AudioWindow).AudioContext || (window as AudioWindow).webkitAudioContext;
    if (!AudioContextClass) return false;

    if (!this.context) {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      this.master = this.context.createGain();
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer();
      this.applyVolume();
    }

    if (this.context.state !== "running") await this.context.resume();
    const unlock = this.context.createBufferSource();
    unlock.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    unlock.connect(this.master!);
    unlock.start();
    this.enabled = this.context.state === "running";
    return this.enabled;
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyVolume();
  }

  play(sound: GameSound, side: SoundSide = "player", option = 0) {
    if (!this.context || !this.master || this.context.state !== "running") return 0;
    const base = this.context.currentTime + 0.01;
    const notes = (frequencies: number[], step = 0.07, duration = 0.12, gain = 0.075) => {
      frequencies.forEach((frequency, index) =>
        this.tone(base, side, { at: index * step, duration, from: frequency, gain, type: "triangle" }),
      );
      return Math.max(0, frequencies.length - 1) * step + duration;
    };

    switch (sound) {
      case "start":
        return notes([523, 659, 784, 1047], 0.065, 0.12, 0.075);
      case "countdown": {
        const count = Math.max(1, Math.min(5, option || 5));
        const frequency = 510 + (5 - count) * 82;
        this.tone(base, "center", { duration: 0.1, from: frequency, to: frequency * 1.04, gain: 0.09 });
        return 100;
      }
      case "timeWarning": {
        const count = Math.max(1, Math.min(10, option || 10));
        const urgency = (10 - count) / 9;
        const frequency = 360 + urgency * 430;
        this.tone(base, "center", {
          duration: count <= 3 ? 0.18 : 0.11,
          from: frequency,
          to: frequency * (count <= 3 ? 0.86 : 1.03),
          gain: count <= 3 ? 0.105 : 0.078,
          type: "triangle",
        });
        if (count <= 3) {
          this.noise(base, "center", {
            duration: 0.045,
            from: 1_800,
            to: 650,
            gain: 0.018,
            filter: "lowpass",
          });
        }
        return count <= 3 ? 190 : 120;
      }
      case "go":
        [523, 784, 1047].forEach((frequency) =>
          this.tone(base, "center", { duration: 0.26, from: frequency, gain: 0.1, type: "triangle" }),
        );
        this.noise(base, "center", { duration: 0.055, from: 2600, gain: 0.025, filter: "highpass" });
        return 280;
      case "deal":
        for (let index = 0; index < 5; index += 1) {
          this.noise(base, side, { at: index * 0.052, duration: 0.034, from: 2500, to: 1450, gain: 0.022 });
        }
        this.tone(base, side, { at: 0.22, duration: 0.08, from: 520, to: 760, gain: 0.06, type: "triangle" });
        return 310;
      case "select":
        this.tone(base, side, { duration: 0.055, from: 780, to: 920, gain: 0.045, type: "triangle" });
        return 70;
      case "discard":
        this.noise(base, side, { duration: 0.17, from: 2200, to: 800, gain: 0.034 });
        this.tone(base, side, { at: 0.15, duration: 0.075, from: 360, to: 520, gain: 0.06, type: "triangle" });
        return 240;
      case "handReady":
        notes([784, 1047], 0.08, 0.12, 0.065);
        return 220;
      case "skillDrop":
        [880, 1320, 1760].forEach((frequency, index) =>
          this.tone(base, "center", { at: index * 0.04, duration: 0.34 - index * 0.05, from: frequency, gain: 0.07 - index * 0.01 }),
        );
        return 420;
      case "skillClaim":
        notes([660, 880, 1320], 0.07, 0.13, 0.085);
        return 300;
      case "skillPress":
        this.tone(base, side, { duration: 0.08, from: 520, to: 780, gain: 0.065, type: "triangle" });
        return 100;
      case "heal":
        notes([523, 659, 784, 1047], 0.075, 0.16, 0.08);
        return 420;
      case "stop":
        this.noise(base, side, { duration: 0.14, from: 3200, to: 500, gain: 0.03, filter: "lowpass" });
        this.tone(base, side, { duration: 0.3, from: 880, to: 120, gain: 0.1, type: "sawtooth" });
        return 320;
      case "shuffle":
        for (let index = 0; index < 5; index += 1) {
          this.noise(base, side, { at: index * 0.045, duration: 0.055, from: 2600 - index * 160, to: 1000, gain: 0.032 });
        }
        this.tone(base, side, { at: 0.22, duration: 0.1, from: 330, to: 560, gain: 0.065, type: "triangle" });
        return 340;
      case "steal":
        this.tone(base, side, { duration: 0.16, from: 1200, to: 480, gain: 0.08, type: "triangle" });
        this.tone(base, side, { at: 0.15, duration: 0.16, from: 480, to: 920, gain: 0.09, type: "triangle", pan: side === "player" ? 0.35 : -0.35 });
        return 330;
      case "blockActivate": {
        const panCenter = sideParameters[side].pan;
        [520, 740, 1040].forEach((frequency, index) =>
          this.tone(base, side, {
            at: index * 0.065,
            duration: 0.19 + index * 0.025,
            from: frequency,
            to: frequency * 1.18,
            gain: 0.052 - index * 0.006,
            type: "triangle",
          }),
        );
        this.tone(base, side, {
          at: 0.15,
          duration: 0.38,
          from: 880,
          to: 1120,
          gain: 0.04,
          pan: Math.max(-0.8, panCenter - 0.24),
        });
        this.tone(base, side, {
          at: 0.15,
          duration: 0.38,
          from: 1320,
          to: 1680,
          gain: 0.032,
          pan: Math.min(0.8, panCenter + 0.24),
        });
        this.noise(base, side, {
          at: 0.14,
          duration: 0.24,
          from: 2500,
          to: 6000,
          gain: 0.012,
          filter: "highpass",
        });
        return 550;
      }
      case "blockImpact":
        this.noise(base, side, {
          duration: 0.045,
          from: 6200,
          to: 3200,
          gain: 0.014,
          filter: "highpass",
        });
        this.tone(base, side, {
          duration: 0.065,
          from: 2400,
          to: 1550,
          gain: 0.052,
          type: "triangle",
        });
        [1580, 2370, 3440].forEach((frequency, index) =>
          this.tone(base, side, {
            at: 0.008 + index * 0.004,
            duration: 0.13 - index * 0.022,
            from: frequency,
            gain: 0.03 - index * 0.007,
          }),
        );
        return 150;
      case "noEffect":
        notes([330, 245], 0.105, 0.09, 0.055);
        return 210;
      case "locked":
        notes([190, 170], 0.08, 0.055, 0.06);
        return 140;
      case "lowHp":
        this.tone(base, side, { duration: 0.13, from: 220, to: 160, gain: 0.09 });
        this.tone(base, side, { at: 0.22, duration: 0.13, from: 220, to: 160, gain: 0.09 });
        return 370;
      case "win":
        notes([523, 659, 784, 1047, 1568], 0.095, 0.3, 0.09);
        return 720;
      case "lose":
        notes([440, 349, 294], 0.15, 0.2, 0.075);
        return 540;
      case "draw":
        [587, 880].forEach((frequency) => this.tone(base, "center", { duration: 0.25, from: frequency, gain: 0.07 }));
        [659, 988].forEach((frequency) => this.tone(base, "center", { at: 0.24, duration: 0.3, from: frequency, gain: 0.07 }));
        return 560;
    }
  }

  playAttack(cardCount: number, damage: number, side: SoundSide = "player") {
    if (!this.context || !this.master || this.context.state !== "running") return 0;
    const base = this.context.currentTime + 0.01;
    const hits = Math.max(2, Math.min(5, Math.round(cardCount)));
    const power = Math.max(0.55, Math.min(1.2, 0.55 + damage / 120));
    const spacing = 0.115 + hits * 0.005;
    const firstImpact = 0.09;

    this.tone(base, side, {
      duration: 0.125,
      from: 560 - power * 90,
      to: 880 + power * 380,
      gain: 0.05 + power * 0.025,
      type: "triangle",
    });
    this.noise(base, side, { duration: 0.1, from: 1600, to: 3700, gain: 0.02, filter: "highpass" });

    for (let index = 0; index < hits; index += 1) {
      const at = firstImpact + index * spacing;
      const crescendo = 0.78 + (index / Math.max(1, hits - 1)) * 0.3;
      this.tone(base, side, {
        at,
        duration: 0.055,
        from: 760 + index * 38,
        to: 430 + index * 16,
        gain: (0.05 + power * 0.025) * crescendo,
        type: "triangle",
      });
      this.tone(base, side, {
        at: at + 0.018,
        duration: 0.105 + power * 0.025,
        from: 205 - index * 9,
        to: Math.max(45, 72 - index * 3),
        gain: (0.075 + power * 0.05) * crescendo,
      });
      this.noise(base, side, {
        at: at + 0.014,
        duration: 0.07,
        from: 2050 - index * 120,
        to: 650,
        gain: (0.025 + power * 0.018) * crescendo,
      });
    }

    const finalImpact = firstImpact + (hits - 1) * spacing;
    if (damage >= 50) {
      this.tone(base, side, { at: finalImpact + 0.04, duration: 0.25, from: 115, to: 42, gain: 0.15 });
      [784, 1047, 1568].forEach((frequency, index) =>
        this.tone(base, side, { at: finalImpact + 0.07 + index * 0.035, duration: 0.2, from: frequency, gain: 0.055, type: "triangle" }),
      );
    }
    return Math.round((finalImpact + (damage >= 50 ? 0.34 : 0.2)) * 1000);
  }

  private applyVolume() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0.0001 : Math.max(0.0001, this.volume), now, 0.015);
  }

  private createNoiseBuffer() {
    const buffer = this.context!.createBuffer(1, this.context!.sampleRate * 2, this.context!.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      previous = previous * 0.24 + (Math.random() * 2 - 1) * 0.76;
      data[index] = previous * 0.8;
    }
    return buffer;
  }

  private connect(node: AudioNode, gainValue: number, start: number, end: number, pan: number) {
    const gain = this.context!.createGain();
    const panner = this.context!.createStereoPanner?.();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), Math.min(end - 0.004, start + 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    node.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(pan, start);
      gain.connect(panner);
      panner.connect(this.master!);
    } else {
      gain.connect(this.master!);
    }
  }

  private tone(base: number, side: SoundSide, options: ToneOptions) {
    const parameters = sideParameters[side];
    const start = base + (options.at ?? 0);
    const duration = Math.max(0.025, options.duration ?? 0.1);
    const end = start + duration;
    const oscillator = this.context!.createOscillator();
    oscillator.type = options.type ?? "sine";
    const from = Math.max(30, (options.from ?? 440) * parameters.pitch);
    const to = Math.max(30, (options.to ?? options.from ?? 440) * parameters.pitch);
    oscillator.frequency.setValueAtTime(from, start);
    if (Math.abs(from - to) > 0.1) oscillator.frequency.exponentialRampToValueAtTime(to, end);
    this.connect(oscillator, (options.gain ?? 0.07) * parameters.gain, start, end, options.pan ?? parameters.pan);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }

  private noise(base: number, side: SoundSide, options: NoiseOptions) {
    if (!this.noiseBuffer) return;
    const parameters = sideParameters[side];
    const start = base + (options.at ?? 0);
    const duration = Math.max(0.025, options.duration ?? 0.1);
    const end = start + duration;
    const source = this.context!.createBufferSource();
    const filter = this.context!.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = options.filter ?? "bandpass";
    const from = Math.max(60, options.from ?? 1800);
    const to = Math.max(60, options.to ?? from);
    filter.frequency.setValueAtTime(from, start);
    if (Math.abs(from - to) > 0.1) filter.frequency.exponentialRampToValueAtTime(to, end);
    source.connect(filter);
    this.connect(filter, (options.gain ?? 0.03) * parameters.gain, start, end, options.pan ?? parameters.pan);
    source.start(start, Math.random() * Math.max(0, this.noiseBuffer.duration - duration - 0.02));
    source.stop(end + 0.01);
  }
}

export const soundManager = new SoundManager();
