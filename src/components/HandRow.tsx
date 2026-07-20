import "./components.css";
import { CardView } from "./CardView";
import type { CardViewModel, PlayerTone } from "./types";

export interface HandRowProps {
  cards: readonly CardViewModel[];
  owner: PlayerTone;
  label: string;
  faceDown?: boolean;
  cardCount?: number;
  selectedCardIds?: readonly string[];
  attackingCardIds?: readonly string[];
  disabled?: boolean;
  onCardClick?: (card: CardViewModel, index: number) => void;
}

export function HandRow({
  cards,
  owner,
  label,
  faceDown = false,
  cardCount = 5,
  selectedCardIds = [],
  attackingCardIds = [],
  disabled = false,
  onCardClick,
}: HandRowProps) {
  const selected = new Set(selectedCardIds);
  const attacking = new Set(attackingCardIds);
  const visibleCount = faceDown ? Math.max(cardCount, cards.length) : cards.length;

  return (
    <div
      className="pd-hand-row"
      data-testid={`${owner}-hand`}
      data-owner={owner}
      role="group"
      aria-label={label}
    >
      {Array.from({ length: visibleCount }, (_, index) => {
        const card = cards[index] ?? null;

        return (
          <CardView
            key={card?.id ?? `card-back-${index}`}
            card={card}
            faceDown={faceDown}
            selected={Boolean(card && selected.has(card.id))}
            attacking={Boolean(card && attacking.has(card.id))}
            disabled={disabled}
            owner={owner}
            index={index}
            onClick={card && onCardClick ? () => onCardClick(card, index) : undefined}
          />
        );
      })}
    </div>
  );
}
