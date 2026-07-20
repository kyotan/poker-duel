import type { GameEvent, GameSnapshot } from "./GameController";

export interface BattleController {
  readonly getSnapshot: () => GameSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly isManualClock: boolean;
  subscribeToEvents(listener: (event: GameEvent) => void): () => void;
  startMatch(): boolean;
  rematch(): void;
  toggleCard(cardId: string): boolean;
  discardSelected(): boolean;
  activatePlayerHand(candidateId: string): boolean;
  usePlayerSkill(skillInstanceId: string): boolean;
  advanceTime(milliseconds: number, manual?: boolean): void;
  renderText(): string;
}
