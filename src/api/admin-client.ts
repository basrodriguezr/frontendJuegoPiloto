import type { GameConfig } from "./types";

type ConfigCodes = {
  clientCode: string;
  companyCode: string;
  gameCode: string;
};

type LoginResponse = {
  user: { id: string; email: string };
  token: string;
};

function resolveApiBaseUrl() {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    return `${protocol}//${host}:4000`;
  }

  return "http://localhost:4000";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function adminLogin(email: string, password: string): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
}

export async function fetchAdminGameConfig(token: string, codes: ConfigCodes): Promise<GameConfig> {
  const params = new URLSearchParams({
    clientCode: codes.clientCode,
    companyCode: codes.companyCode,
    gameCode: codes.gameCode
  });
  return requestJson<GameConfig>(`/api/v1/admin/game-config?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function saveAdminGameConfig(
  token: string,
  payload: ConfigCodes & { config: GameConfig }
): Promise<GameConfig> {
  const response = await requestJson<{ ok: boolean; config: GameConfig }>("/api/v1/admin/game-config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  return response.config;
}
