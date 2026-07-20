import type { CSSProperties } from "react";

import { useI18n } from "../i18n";
import "./components.css";

export type StatusBadgeMode =
  | "ready"
  | "cooldown"
  | "stopped"
  | "sending"
  | "rejected"
  | "reconnecting"
  | "offline";

export interface StatusBadgeProps {
  mode: StatusBadgeMode;
  remainingMs?: number;
  totalMs?: number;
  label?: string;
  detail?: string;
  className?: string;
}

function seconds(milliseconds: number) {
  return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}

export function StatusBadge({
  mode,
  remainingMs = 0,
  totalMs = 1,
  label,
  detail,
  className = "",
}: StatusBadgeProps) {
  const { t } = useI18n();
  const defaultLabels: Record<StatusBadgeMode, string> = {
    ready: t("status.ready"),
    cooldown: t("status.cooldown", { seconds: seconds(remainingMs) }),
    stopped: t("status.stopped", { seconds: seconds(remainingMs) }),
    sending: t("status.sending"),
    rejected: t("status.rejected"),
    reconnecting: t("status.reconnecting"),
    offline: t("status.offline"),
  };
  const progress = Math.min(1, Math.max(0, remainingMs / Math.max(1, totalMs)));
  const visibleDetail = detail ?? (mode === "stopped" ? t("status.handLocked") : undefined);
  const testId: Record<StatusBadgeMode, string> = {
    ready: "action-ready",
    cooldown: "action-cooldown",
    stopped: "hand-locked",
    sending: "action-sending",
    rejected: "action-rejected",
    reconnecting: "connection-status",
    offline: "connection-status",
  };

  return (
    <div
      className={`pd-status-badge pd-status-badge--${mode} ${className}`.trim()}
      data-testid={testId[mode]}
      role="status"
      aria-live="polite"
      style={{ "--pd-status-progress": progress } as CSSProperties}
    >
      <strong
        className="pd-status-badge__label"
        data-testid={
          mode === "cooldown" ? "action-cooldown-value" : mode === "stopped" ? "stop-timer" : undefined
        }
      >
        {label ?? defaultLabels[mode]}
      </strong>
      {visibleDetail ? <span className="pd-status-badge__detail">{visibleDetail}</span> : null}
      {mode === "cooldown" ? <span className="pd-status-badge__progress" aria-hidden="true" /> : null}
    </div>
  );
}
