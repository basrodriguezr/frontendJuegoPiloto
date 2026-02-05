export type GameState =
  | "MENU"
  | "LOADING"
  | "READY"
  | "REVEAL"
  | "CASCADE_LOOP"
  | "END_TICKET"
  | "PACK_LIST"
  | "REPLAY"
  | "SUMMARY";

export interface StateContext {
  mode?: "nivel1" | "nivel2" | "pack";
  packId?: string;
  ticketIndex?: number;
}

export interface StateMachine {
  state: GameState;
  context: StateContext;
  transition: (next: GameState, ctx?: Partial<StateContext>) => void;
}

export function createStateMachine(initial: GameState = "MENU"): StateMachine {
  const ctx: StateContext = {};
  let current: GameState = initial;

  function transition(next: GameState, partial?: Partial<StateContext>) {
    current = next;
    if (partial) {
      Object.assign(ctx, partial);
    }
  }

  return {
    get state() {
      return current;
    },
    get context() {
      return ctx;
    },
    transition,
  };
}
