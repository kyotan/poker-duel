import type { CSSProperties } from "react";

import { useI18n } from "../i18n";
import "./components.css";
import type { CardSuit, CardViewModel, PlayerTone } from "./types";

const SUIT_DETAILS: Record<CardSuit, { glyph: string; translationKey: "card.hearts" | "card.diamonds" | "card.clubs" | "card.spades" }> = {
  hearts: { glyph: "♥", translationKey: "card.hearts" },
  diamonds: { glyph: "♦", translationKey: "card.diamonds" },
  clubs: { glyph: "♣", translationKey: "card.clubs" },
  spades: { glyph: "♠", translationKey: "card.spades" },
};

function displayRank(rank: string | number) {
  if (typeof rank === "string") return rank;
  return ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank] ?? String(rank);
}

export interface CardViewProps {
  card?: CardViewModel | null;
  faceDown?: boolean;
  selected?: boolean;
  attacking?: boolean;
  disabled?: boolean;
  owner?: PlayerTone;
  index?: number;
  className?: string;
  onClick?: () => void;
}

export function CardView({
  card,
  faceDown = false,
  selected = false,
  attacking = false,
  disabled = false,
  owner = "player",
  index = 0,
  className = "",
  onClick,
}: CardViewProps) {
  const { t } = useI18n();
  const suit = card ? SUIT_DETAILS[card.suit] : undefined;
  const rank = card ? displayRank(card.rank) : undefined;
  const isInteractive = Boolean(onClick && card && !faceDown && !disabled);
  const label = faceDown
    ? t("card.faceDown")
    : card && suit
      ? t("card.label", {
          rank: rank ?? "",
          suit: t(suit.translationKey),
          selected: selected ? t("card.selected") : "",
        })
      : t("card.empty");

  const classes = [
    "pd-card",
    faceDown ? "pd-card--back" : "",
    selected ? "pd-card--selected" : "",
    attacking ? "pd-card--attacking" : "",
    !card && !faceDown ? "pd-card--empty" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      data-testid={faceDown ? "card-back" : "hand-card"}
      data-owner={owner}
      data-index={index}
      data-card-id={faceDown ? "" : (card?.id ?? "")}
      data-rank={faceDown ? "" : (card?.rank ?? "")}
      data-suit={faceDown ? undefined : card?.suit}
      data-face-up={faceDown ? "false" : "true"}
      data-selected={selected ? "true" : "false"}
      data-locked={disabled ? "true" : "false"}
      disabled={!isInteractive}
      aria-label={label}
      aria-pressed={isInteractive ? selected : undefined}
      onClick={isInteractive ? onClick : undefined}
      style={{ "--pd-card-index": index } as CSSProperties}
    >
      {faceDown ? (
        <span className="pd-card__back-pattern" aria-hidden="true" />
      ) : card && suit ? (
        <>
          <span className="pd-card__corner" aria-hidden="true">
            <span className="pd-card__rank">{rank}</span>
            <span className="pd-card__corner-suit">{suit.glyph}</span>
          </span>
          <span className="pd-card__suit" aria-hidden="true">
            {suit.glyph}
          </span>
          {selected ? (
            <span className="pd-card__selected-mark" aria-hidden="true">
              ✓
            </span>
          ) : null}
        </>
      ) : (
        <span className="pd-card__empty-mark" aria-hidden="true" />
      )}
    </button>
  );
}
