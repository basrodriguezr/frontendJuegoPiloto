export type GameMode = "nivel1" | "nivel2" | "pack";
export type PackLevel = "nivel1" | "nivel2";

export type PackSize = 5 | 10 | 15 | 20;

export interface MoneyFormat {
  currency: string;
  decimals: number;
  thousandSeparator: string;
  decimalSeparator: string;
}

export interface BetOptions {
  minBet: number;
  maxBet: number;
  step: number;
}

export interface BoardSpec {
  rows: number;
  cols: number;
  symbols: string[];
}

export interface SymbolWeight {
  symbol: string;
  weight: number;
}

export interface PaytableEntry {
  symbol: string;
  minCluster: number;
  win: number;
}

export interface SymbolMatchRule {
  count: number;
  multiplier: number;
}

export interface SymbolPaytableEntry {
  symbol: string;
  label: string;
  color: string;
  matches: SymbolMatchRule[];
}

export interface ModeConfig {
  code: GameMode;
  enabled: boolean;
  weights: SymbolWeight[];
  paytable: PaytableEntry[];
}

export interface ClientBranding {
  logoUrl?: string;
  backgroundUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
}

export interface GameConfig {
  clientCode: string;
  companyCode: string;
  gameCode: string;
  money: MoneyFormat;
  betOptions: BetOptions;
  betValues?: number[];
  jackpots?: {
    mayor: number;
    menor: number;
  };
  availableModes?: GameMode[];
  packLevels?: PackLevel[];
  modes: ModeConfig[];
  packSizes: PackSize[];
  board: BoardSpec;
  symbolPaytable?: SymbolPaytableEntry[];
  branding?: ClientBranding;
}

export interface CellRef {
  row: number;
  col: number;
}

export interface DropIn {
  col: number;
  symbols: string[];
}

export interface CascadeStep {
  removeCells: CellRef[];
  dropIn: DropIn[];
  winStep: number;
  gridAfter?: string[][];
  bonus?: boolean;
  bonusData?: {
    mode: Exclude<GameMode, "pack">;
    triggerCount: number;
    triggerCells?: CellRef[];
    prizeMultipliers: number[];
    endCode: string;
    maxRounds: number;
  };
}

export interface PlayOutcome {
  playId: string;
  mode: GameMode;
  bet: number;
  grid0: string[][];
  cascades: CascadeStep[];
  totalWin: number;
}

export interface PackPlay {
  playId: string;
  mode: GameMode;
  bet: number;
  ticketIndex: number;
  grid0: string[][];
  cascades: CascadeStep[];
  totalWin: number;
}

export interface PackOutcome {
  packId: string;
  packLevel: PackLevel;
  plays: PackPlay[];
  totalBet: number;
  totalWin: number;
  bestIndex?: number;
}

export interface ApiError {
  message: string;
  status?: number;
  cause?: unknown;
}

export interface WsRequest<T = unknown> {
  type: string;
  requestId: string;
  payload?: T;
}

export interface WsResponse<T = unknown> {
  type: "response";
  requestId?: string;
  ok: boolean;
  data?: T;
  error?: ApiError;
}
