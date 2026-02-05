import { fetchConfig } from "./client";
import type { GameConfig } from "./types";

export async function loadGameConfig(): Promise<GameConfig> {
  const clientCode = process.env.NEXT_PUBLIC_CLIENT_CODE ?? "demo";
  const companyCode = process.env.NEXT_PUBLIC_COMPANY_CODE ?? "demo";
  const gameCode = process.env.NEXT_PUBLIC_GAME_CODE ?? "e-instant";
  return fetchConfig({ clientCode, companyCode, gameCode });
}
