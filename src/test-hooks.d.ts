import type { DebugResetOptions } from "./controller/GameController";
import type { SkillType } from "./game";

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => string;
    __POKER_DUEL_TEST__?: {
      reset: (options?: DebugResetOptions) => void;
      forceSkillDrop: (type?: SkillType) => boolean;
    };
  }
}

export {};
