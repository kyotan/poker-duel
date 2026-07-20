import { useEffect, useState, type FormEvent } from "react";
import type { CatBreed, CatPose } from "../avatar/cats";
import type { BattleController } from "../controller/BattleController";
import {
  DEFAULT_GAME_CONFIG,
  gameController,
  type GameConfig,
  type GameSnapshot,
} from "../controller/GameController";
import type { HpHealEffect } from "../components";
import type { SkillType } from "../game";
import { localizeSkill, useI18n, type Locale } from "../i18n";
import "./development-tools.css";

type DebugCopyKey =
  | "developmentOnly"
  | "title"
  | "close"
  | "randomDrop"
  | "seed"
  | "weight"
  | "nextSkill"
  | "random"
  | "timing"
  | "matchDuration"
  | "skillInterval"
  | "dropVisible"
  | "attackCd"
  | "redrawCd"
  | "stopDuration"
  | "blockDuration"
  | "shuffleLock"
  | "cpuSpeed"
  | "cpuHelp"
  | "cpuMin"
  | "cpuMax"
  | "defaults"
  | "cancel"
  | "applyReset"
  | "open";

const DEBUG_COPY: Record<Locale, Record<DebugCopyKey, string>> = {
  ja: {
    developmentOnly: "開発環境のみ",
    title: "テスト設定",
    close: "設定を閉じる",
    randomDrop: "乱数・スキル出現",
    seed: "乱数シード",
    weight: "{skill}の重み",
    nextSkill: "次回スキル",
    random: "ランダム",
    timing: "タイミング（ミリ秒）",
    matchDuration: "試合時間",
    skillInterval: "スキル間隔",
    dropVisible: "表示時間",
    attackCd: "攻撃クールダウン",
    redrawCd: "交換クールダウン",
    stopDuration: "ストップ時間",
    blockDuration: "ブロック時間",
    shuffleLock: "シャッフル操作ロック",
    cpuSpeed: "CPU速度（ミリ秒）",
    cpuHelp: "CPUが次の行動を考える追加待ち時間です。数値を大きくするとゆっくりになります。",
    cpuMin: "CPU待ち時間・最小",
    cpuMax: "CPU待ち時間・最大",
    defaults: "初期値",
    cancel: "キャンセル",
    applyReset: "適用してリセット",
    open: "開発用テスト設定を開く",
  },
  en: {
    developmentOnly: "DEVELOPMENT ONLY",
    title: "TEST SETTINGS",
    close: "Close settings",
    randomDrop: "RANDOM & DROP",
    seed: "Random seed",
    weight: "{skill} weight",
    nextSkill: "Next skill",
    random: "RANDOM",
    timing: "TIMING (ms)",
    matchDuration: "Match duration",
    skillInterval: "Skill interval",
    dropVisible: "Drop visible",
    attackCd: "Attack cooldown",
    redrawCd: "Redraw cooldown",
    stopDuration: "STOP duration",
    blockDuration: "BLOCK duration",
    shuffleLock: "SHUFFLE lock",
    cpuSpeed: "CPU SPEED (ms)",
    cpuHelp: "Extra time the CPU waits before its next move. Higher values make it play more slowly.",
    cpuMin: "CPU wait min",
    cpuMax: "CPU wait max",
    defaults: "DEFAULTS",
    cancel: "CANCEL",
    applyReset: "APPLY & RESET",
    open: "Open development test settings",
  },
};

function debugText(locale: Locale, key: DebugCopyKey, params: Record<string, string | number> = {}) {
  return DEBUG_COPY[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="debug-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function DebugSettings({
  state,
  onApply,
  onClose,
}: {
  state: GameSnapshot;
  onApply: (config: GameConfig) => void;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const text = (key: DebugCopyKey, params?: Record<string, string | number>) => debugText(locale, key, params);
  const [draft, setDraft] = useState<GameConfig>(() => ({
    ...state.config,
    skillWeights: { ...state.config.skillWeights },
  }));
  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateWeight = (type: SkillType, value: number) =>
    setDraft((current) => ({
      ...current,
      skillWeights: { ...current.skillWeights, [type]: Math.max(0, value) },
    }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(draft);
    onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="debug-dialog" role="dialog" aria-modal="true" aria-labelledby="debug-dialog-title" onSubmit={submit}>
        <header>
          <div><span>{text("developmentOnly")}</span><h2 id="debug-dialog-title">{text("title")}</h2></div>
          <button type="button" aria-label={text("close")} onClick={onClose}>×</button>
        </header>
        <div className="debug-dialog__body">
          <section>
            <h3>{text("randomDrop")}</h3>
            <label className="debug-field debug-field--wide"><span>{text("seed")}</span><input value={draft.seed} onChange={(event) => update("seed", event.target.value)} /></label>
            <div className="debug-grid debug-grid--weights">
              {(["HEAL", "SHUFFLE", "STEAL", "BLOCK", "STOP"] as SkillType[]).map((type) => (
                <NumberSetting key={type} label={text("weight", { skill: localizeSkill(type, locale, draft.healAmount) })} value={draft.skillWeights[type]} min={0} max={100} onChange={(value) => updateWeight(type, value)} />
              ))}
            </div>
            <label className="debug-field debug-field--wide"><span>{text("nextSkill")}</span><select value={draft.forcedNextSkill} onChange={(event) => update("forcedNextSkill", event.target.value as GameConfig["forcedNextSkill"])}><option value="RANDOM">{text("random")}</option>{(["HEAL", "SHUFFLE", "STEAL", "BLOCK", "STOP"] as SkillType[]).map((type) => <option key={type} value={type}>{localizeSkill(type, locale, draft.healAmount)}</option>)}</select></label>
          </section>
          <section>
            <h3>{text("timing")}</h3>
            <div className="debug-grid">
              <NumberSetting label={text("skillInterval")} value={draft.skillIntervalMs} min={2_000} max={120_000} step={500} onChange={(value) => update("skillIntervalMs", value)} />
              <NumberSetting label={text("matchDuration")} value={draft.matchDurationMs} min={5_000} max={600_000} step={1_000} onChange={(value) => update("matchDurationMs", value)} />
              <NumberSetting label={text("dropVisible")} value={draft.skillVisibleMs} min={1_000} max={30_000} step={500} onChange={(value) => update("skillVisibleMs", value)} />
              <NumberSetting label={text("attackCd")} value={draft.attackCooldownMs} min={100} max={5_000} step={100} onChange={(value) => update("attackCooldownMs", value)} />
              <NumberSetting label={text("redrawCd")} value={draft.redrawCooldownMs} min={100} max={5_000} step={100} onChange={(value) => update("redrawCooldownMs", value)} />
              <NumberSetting label={text("stopDuration")} value={draft.stopDurationMs} min={500} max={30_000} step={500} onChange={(value) => update("stopDurationMs", value)} />
              <NumberSetting label={text("blockDuration")} value={draft.blockDurationMs} min={500} max={30_000} step={500} onChange={(value) => update("blockDurationMs", value)} />
              <NumberSetting label={text("shuffleLock")} value={draft.shuffleLockMs} min={100} max={5_000} step={100} onChange={(value) => update("shuffleLockMs", value)} />
            </div>
          </section>
          <section>
            <h3>{text("cpuSpeed")}</h3>
            <p className="debug-help">{text("cpuHelp")}</p>
            <div className="debug-grid">
              <NumberSetting label={text("cpuMin")} value={draft.cpuThinkMinMs} min={0} max={10_000} step={100} onChange={(value) => update("cpuThinkMinMs", value)} />
              <NumberSetting label={text("cpuMax")} value={draft.cpuThinkMaxMs} min={0} max={10_000} step={100} onChange={(value) => update("cpuThinkMaxMs", value)} />
            </div>
          </section>
        </div>
        <footer>
          <button type="button" className="dialog-reset" onClick={() => setDraft({ ...DEFAULT_GAME_CONFIG, skillWeights: { ...DEFAULT_GAME_CONFIG.skillWeights } })}>{text("defaults")}</button>
          <button type="button" className="dialog-cancel" onClick={onClose}>{text("cancel")}</button>
          <button type="submit" className="dialog-apply">{text("applyReset")}</button>
        </footer>
      </form>
    </div>
  );
}

export interface DevelopmentToolsProps {
  state: GameSnapshot;
  controller: BattleController;
  playMode: "choose" | "cpu" | "online";
  catAssignment: { player: CatBreed; enemy: CatBreed };
  playerCatPose: CatPose;
  enemyCatPose: CatPose;
  healEffects: Partial<Record<"enemy" | "player", HpHealEffect>>;
}

export default function DevelopmentTools({
  state,
  controller,
  playMode,
  catAssignment,
  playerCatPose,
  enemyCatPose,
  healEffects,
}: DevelopmentToolsProps) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const renderText = () => {
      const gameState = JSON.parse(controller.renderText()) as Record<string, unknown>;
      return JSON.stringify({
        ...gameState,
        uiMode: playMode,
        catAvatars: {
          player: { breed: catAssignment.player, pose: playerCatPose },
          enemy: { breed: catAssignment.enemy, pose: enemyCatPose },
        },
        activeHealEffects: Object.entries(healEffects).map(([side, effect]) => ({ side, ...effect })),
      });
    };
    window.render_game_to_text = renderText;
    window.advanceTime = (milliseconds: number) => {
      controller.advanceTime(milliseconds, true);
      return renderText();
    };
    window.__POKER_DUEL_TEST__ = {
      reset: (options) => gameController.debugReset(options),
      forceSkillDrop: (type) => gameController.forceSkillDrop(type),
    };
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
      delete window.__POKER_DUEL_TEST__;
    };
  }, [catAssignment.enemy, catAssignment.player, controller, enemyCatPose, healEffects, playMode, playerCatPose]);

  return (
    <>
      {playMode !== "online" ? (
        <button className="developer-button" data-testid="developer-settings-button" type="button" aria-label={debugText(locale, "open")} onClick={() => setOpen(true)}>⚙</button>
      ) : null}
      {open ? (
        <DebugSettings
          state={state}
          onApply={(config) => gameController.applyConfig(config)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
