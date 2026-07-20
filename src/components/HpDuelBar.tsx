import "./components.css";
import { useI18n } from "../i18n";

export interface HpDuelBarProps {
  enemyHp: number;
  playerHp: number;
  maxHp?: number;
  impactTarget?: "enemy" | "player" | null;
  damageText?: string | null;
  healEffects?: Partial<Record<"enemy" | "player", HpHealEffect>>;
  className?: string;
}

export interface HpHealEffect {
  id: number;
  amount: number;
}

function clampHp(hp: number, maxHp: number) {
  return Math.min(maxHp, Math.max(0, hp));
}

interface HpSegmentProps {
  side: "enemy" | "player";
  hp: number;
  maxHp: number;
  impacted: boolean;
  damageText?: string | null;
  healEffect?: HpHealEffect;
}

function HpSegment({ side, hp, maxHp, impacted, damageText, healEffect }: HpSegmentProps) {
  const { t } = useI18n();
  const safeHp = clampHp(hp, maxHp);
  const percent = maxHp > 0 ? (safeHp / maxHp) * 100 : 0;
  const spokenSide = t(side === "enemy" ? "hp.enemy" : "hp.player");
  const healing = Boolean(healEffect && healEffect.amount > 0);

  return (
    <div
      className={`pd-hp-duel__segment pd-hp-duel__segment--${side}${impacted ? " pd-hp-duel__segment--impact" : ""}${healing ? " pd-hp-duel__segment--healing" : ""}`}
      data-testid={`${side}-hp-bar`}
      role="progressbar"
      aria-label={t("hp.label", { side: spokenSide })}
      aria-valuemin={0}
      aria-valuemax={maxHp}
      aria-valuenow={safeHp}
      aria-valuetext={`${safeHp} / ${maxHp}`}
    >
      <span className="pd-hp-duel__track" aria-hidden="true">
        <span className="pd-hp-duel__fill" style={{ width: `${percent}%` }} />
      </span>
      <strong className="pd-hp-duel__value" data-testid={`${side}-hp-value`} aria-hidden="true">
        {safeHp} / {maxHp}
      </strong>
      {impacted && damageText ? (
        <span className="pd-hp-duel__damage" aria-live="polite">
          {damageText}
        </span>
      ) : null}
      {healing && healEffect ? (
        <span
          className="pd-hp-duel__heal-effect"
          data-testid={`${side}-heal-effect`}
          key={healEffect.id}
        >
          <span className="pd-hp-duel__heal-sparkles" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <i key={index}>✦</i>)}
          </span>
          <strong className="pd-hp-duel__heal-value" aria-live="polite">+{healEffect.amount}</strong>
        </span>
      ) : null}
    </div>
  );
}

export function HpDuelBar({
  enemyHp,
  playerHp,
  maxHp = 100,
  impactTarget = null,
  damageText = null,
  healEffects,
  className = "",
}: HpDuelBarProps) {
  const { t } = useI18n();
  const safeMax = Math.max(1, maxHp);

  return (
    <section className={`pd-hp-duel ${className}`.trim()} data-testid="hp-row" aria-label={t("hp.groupLabel")}>
      <HpSegment
        side="enemy"
        hp={enemyHp}
        maxHp={safeMax}
        impacted={impactTarget === "enemy"}
        damageText={damageText}
        healEffect={healEffects?.enemy}
      />
      <div className="pd-hp-duel__badge" data-testid="hp-badge" aria-hidden="true">
        HP
      </div>
      <HpSegment
        side="player"
        hp={playerHp}
        maxHp={safeMax}
        impacted={impactTarget === "player"}
        damageText={damageText}
        healEffect={healEffects?.player}
      />
    </section>
  );
}
