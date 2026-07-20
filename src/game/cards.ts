import { shuffle } from "./random";
import { RANKS, SUITS, type Card, type CardRank, type DeckState, type DeckUpdate, type RandomSource, type Suit } from "./types";

export const HAND_SIZE = 5;
export const CARD_BOX_SIZE = 52;

export const SUIT_SYMBOLS: Readonly<Record<Suit, string>> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export const RANK_LABELS: Readonly<Record<CardRank, string>> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

function ownerToken(ownerId: string): string {
  return encodeURIComponent(ownerId);
}
export function cardId(ownerId: string, suit: Suit, rank: CardRank): string {
  return `${ownerToken(ownerId)}:${suit}:${rank}`;
}

export function formatCard(card: Card): string {
  return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

export function createCardBox(ownerId: string): Card[] {
  if (ownerId.length === 0) throw new Error("ownerId must not be empty.");
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: cardId(ownerId, suit, rank),
      ownerId,
      suit,
      rank,
    })),
  );
}

export function createDeckState(ownerId: string, random: RandomSource): DeckState {
  const shuffled = shuffle(createCardBox(ownerId), random);
  return {
    ownerId,
    hand: shuffled.slice(0, HAND_SIZE),
    box: shuffled.slice(HAND_SIZE),
    handVersion: 1,
  };
}

/**
 * Returns selected physical cards to the owner's box, shuffles the complete
 * box once, then immediately draws the same number. Returned cards may be
 * drawn again during this same update, by design.
 */
export function redrawCards(
  deck: DeckState,
  selectedCardIds: readonly string[],
  random: RandomSource,
): DeckUpdate {
  if (selectedCardIds.length < 1 || selectedCardIds.length > HAND_SIZE) {
    throw new Error("A redraw must select between 1 and 5 cards.");
  }

  const selected = new Set(selectedCardIds);
  if (selected.size !== selectedCardIds.length) {
    throw new Error("A redraw cannot contain duplicate card IDs.");
  }

  const returnedCards = deck.hand.filter((card) => selected.has(card.id));
  if (returnedCards.length !== selected.size) {
    throw new Error("A redraw can only use cards in the current hand.");
  }

  const retainedCards = deck.hand.filter((card) => !selected.has(card.id));
  const shuffledBox = shuffle([...deck.box, ...returnedCards], random);
  const drawnCards = shuffledBox.slice(0, returnedCards.length);
  const nextBox = shuffledBox.slice(returnedCards.length);
  const nextState: DeckState = {
    ownerId: deck.ownerId,
    hand: [...retainedCards, ...drawnCards],
    box: nextBox,
    handVersion: deck.handVersion + 1,
  };

  const errors = validateDeckState(nextState);
  if (errors.length > 0) {
    throw new Error(`Invalid deck state after redraw: ${errors.join(" ")}`);
  }

  return { state: nextState, returnedCards, drawnCards };
}

export function redrawEntireHand(deck: DeckState, random: RandomSource): DeckUpdate {
  return redrawCards(deck, deck.hand.map((card) => card.id), random);
}

export function validateDeckState(deck: DeckState): string[] {
  const errors: string[] = [];
  const cards = [...deck.hand, ...deck.box];
  const ids = new Set(cards.map((card) => card.id));

  if (deck.hand.length !== HAND_SIZE) errors.push(`Hand contains ${deck.hand.length}, expected 5.`);
  if (deck.box.length !== CARD_BOX_SIZE - HAND_SIZE) errors.push(`Box contains ${deck.box.length}, expected 47.`);
  if (cards.length !== CARD_BOX_SIZE) errors.push(`Owner has ${cards.length}, expected 52.`);
  if (ids.size !== cards.length) errors.push("Duplicate physical card IDs detected.");
  if (cards.some((card) => card.ownerId !== deck.ownerId)) errors.push("Foreign-owned card detected.");

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!ids.has(cardId(deck.ownerId, suit, rank))) {
        errors.push(`Missing card ${suit}:${rank}.`);
      }
    }
  }
  return errors;
}
