import { createEventBus } from "@/lib/event-bus";
import type { GameConfig, GameMode, PackLevel, PackOutcome, PackSize, PlayOutcome } from "@/api/types";
import type { GameState } from "./state-machine";

export type UiEvents = {
  "ui:play": { mode: GameMode; bet: number; packSize?: number; packLevel?: PackLevel };
  "ui:select-mode": { mode: GameMode };
  "ui:select-pack": { packSize?: number };
  "ui:replay-ticket": { ticketIndex: number };
};

export type GameEvents = {
  "game:config-loaded": GameConfig;
  "game:state-change": { state: GameState };
  "game:play:started": { mode: GameMode; bet: number };
  "game:play:completed": PlayOutcome;
  "game:pack:started": { mode: GameMode; bet: number; packSize: PackSize; packLevel: PackLevel };
  "game:pack:completed": PackOutcome;
  "game:win:increment": { playId: string; amount: number };
  "game:replay:opened": { ticketIndex: number };
  "game:replay:closed": { ticketIndex?: number };
  "game:error": { message: string };
};

export const uiBus = createEventBus<UiEvents>();
export const gameBus = createEventBus<GameEvents>();
