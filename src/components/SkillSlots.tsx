import type { CSSProperties } from "react";

import { useI18n } from "../i18n";
import "./components.css";
import type { PlayerTone, SkillSlotViewModel } from "./types";

export interface SkillSlotsProps {
  skills: readonly (SkillSlotViewModel | null)[];
  owner: PlayerTone;
  label: string;
  interactive?: boolean;
  disabled?: boolean;
  maxSlots?: number;
  onUse?: (skill: SkillSlotViewModel, index: number) => void;
}

function formatSeconds(milliseconds: number) {
  return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}

export function SkillSlots({
  skills,
  owner,
  label,
  interactive = false,
  disabled = false,
  maxSlots = 3,
  onUse,
}: SkillSlotsProps) {
  const { t } = useI18n();
  return (
    <div
      className="pd-skill-slots"
      data-testid={`${owner}-skill-list`}
      data-owner={owner}
      role="group"
      aria-label={label}
    >
      {Array.from({ length: maxSlots }, (_, index) => {
        const skill = skills[index] ?? null;

        if (!skill) {
          return (
            <div
              className="pd-skill-slot pd-skill-slot--empty"
              key={`empty-${index}`}
              data-testid="skill-slot"
              data-owner={owner}
              data-slot={index}
              data-skill-instance-id=""
              data-skill-type=""
              data-state="empty"
            >
              <span>{t("skills.empty")}</span>
            </div>
          );
        }

        const cooldownRemainingMs = Math.max(0, skill.cooldownRemainingMs ?? 0);
        const cooldownTotalMs = Math.max(1, skill.cooldownTotalMs ?? cooldownRemainingMs);
        const cooldownProgress = Math.min(1, cooldownRemainingMs / cooldownTotalMs);
        const canUse = Boolean(
          interactive &&
            onUse &&
            !disabled &&
            skill.available !== false &&
            cooldownRemainingMs === 0,
        );
        const statusText =
          skill.statusText ??
          (cooldownRemainingMs > 0
            ? formatSeconds(cooldownRemainingMs)
            : interactive
              ? t("skills.ready")
              : t("skills.stocked"));
        const content = (
          <>
            <span className="pd-skill-slot__name">{skill.name}</span>
            <span className="pd-skill-slot__status">{statusText}</span>
            {cooldownRemainingMs > 0 ? (
              <span
                className="pd-skill-slot__cooldown"
                data-testid="skill-cooldown"
                style={{ "--pd-skill-cooldown": cooldownProgress } as CSSProperties}
                aria-hidden="true"
              />
            ) : null}
          </>
        );

        if (!interactive) {
          return (
            <div
              className="pd-skill-slot"
              key={skill.id}
              data-testid="skill-slot"
              data-owner={owner}
              data-slot={index}
              data-skill-instance-id={skill.id}
              data-skill-type={skill.type ?? skill.name}
              data-state={cooldownRemainingMs > 0 ? "cooldown" : "stocked"}
              aria-label={t("skills.itemLabel", { skill: skill.name, status: statusText })}
            >
              {content}
            </div>
          );
        }

        return (
          <button
            type="button"
            className="pd-skill-slot"
            key={skill.id}
            data-testid="skill-slot"
            data-owner={owner}
            data-slot={index}
            data-skill-instance-id={skill.id}
            data-skill-type={skill.type ?? skill.name}
            data-state={canUse ? "ready" : cooldownRemainingMs > 0 ? "cooldown" : "disabled"}
            disabled={!canUse}
            aria-label={t("skills.useLabel", { skill: skill.name, status: statusText })}
            onClick={canUse ? () => onUse?.(skill, index) : undefined}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
