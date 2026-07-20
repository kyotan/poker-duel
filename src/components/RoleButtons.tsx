import "./components.css";
import { useI18n } from "../i18n";
import type { RoleActionViewModel } from "./types";

export interface RoleButtonsProps {
  roles: readonly RoleActionViewModel[];
  selectedDiscardCount: number;
  disabled?: boolean;
  discardDisabled?: boolean;
  discardLabel?: string;
  emptyMessage?: string;
  onActivateRole?: (role: RoleActionViewModel) => void;
  onDiscard?: () => void;
}

export function RoleButtons({
  roles,
  selectedDiscardCount,
  disabled = false,
  discardDisabled,
  discardLabel,
  emptyMessage,
  onActivateRole,
  onDiscard,
}: RoleButtonsProps) {
  const { t } = useI18n();
  const cannotDiscard =
    disabled || discardDisabled === true || selectedDiscardCount === 0 || !onDiscard;

  return (
    <div
      className="pd-role-actions"
      data-testid="hand-actions"
      role="group"
      aria-label={t("roles.groupLabel")}
    >
      {roles.length === 0 && emptyMessage ? (
        <span className="pd-role-actions__empty" role="status">
          {emptyMessage}
        </span>
      ) : null}
      {roles.map((role) => {
        const isDisabled = disabled || role.disabled === true || !onActivateRole;

        return (
          <button
            type="button"
            className="pd-role-button"
            key={role.id}
            data-testid="role-candidate"
            data-candidate-id={role.id}
            data-hand-type={role.handType ?? ""}
            data-rank={role.rank ?? ""}
            data-damage={role.damage}
            data-card-ids={role.cardIds.join(",")}
            disabled={isDisabled}
            aria-label={t(isDisabled ? "roles.disabledLabel" : "roles.activateLabel", {
              role: role.label,
              damage: role.damage,
            })}
            onClick={isDisabled ? undefined : () => onActivateRole?.(role)}
          >
            <span>{role.label}</span>
            <strong>{t("roles.damage", { damage: role.damage })}</strong>
          </button>
        );
      })}
      <button
        type="button"
        className="pd-discard-button"
        data-testid="discard-shuffle"
        disabled={cannotDiscard}
        aria-label={t("roles.discardLabel", {
          count: selectedDiscardCount,
          disabled: cannotDiscard ? t("roles.unavailable") : "",
        })}
        onClick={cannotDiscard ? undefined : onDiscard}
      >
        <span>{discardLabel ?? t("roles.discard")}</span>
        <strong>{selectedDiscardCount > 0 ? t("roles.cardsCount", { count: selectedDiscardCount }) : t("roles.selectCards")}</strong>
      </button>
    </div>
  );
}
