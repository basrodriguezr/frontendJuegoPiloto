import type {
  ApiError,
  GameConfig,
  GameMode,
  PackLevel,
  PackOutcome,
  PackSize,
  PlayOutcome,
  WsRequest,
  WsResponse,
} from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingRequest>();
let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;

function resolveWsUrl() {
  if (WS_URL) return WS_URL;
  if (typeof window === "undefined") {
    throw new Error("WebSocket URL is not available on the server.");
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const port = "4000";
  return `${protocol}://${host}:${port}/ws`;
}

function handleSocketMessage(event: MessageEvent) {
  let payload: WsResponse;
  try {
    payload = JSON.parse(String(event.data));
  } catch (err) {
    return;
  }

  if (payload.type !== "response" || !payload.requestId) {
    return;
  }

  const pendingRequest = pending.get(payload.requestId);
  if (!pendingRequest) return;
  clearTimeout(pendingRequest.timeoutId);
  pending.delete(payload.requestId);

  if (payload.ok) {
    pendingRequest.resolve(payload.data);
  } else {
    const error: ApiError = payload.error ?? { message: "Unknown error" };
    const wrapped = new Error(error.message);
    (wrapped as Error & { status?: number }).status = error.status;
    pendingRequest.reject(wrapped);
  }
}

function rejectAllPending(reason: string) {
  pending.forEach((value, key) => {
    clearTimeout(value.timeoutId);
    value.reject(new Error(reason));
    pending.delete(key);
  });
}

async function ensureSocket(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return socket;
  }
  if (connecting) return connecting;

  connecting = new Promise((resolve, reject) => {
    const url = resolveWsUrl();
    const ws = new WebSocket(url);
    socket = ws;
    let opened = false;

    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };

    const onOpen = () => {
      cleanup();
      opened = true;
      ws.addEventListener("message", handleSocketMessage);
      ws.addEventListener("close", onClose);
      connecting = null;
      resolve(ws);
    };

    const onError = () => {
      cleanup();
      connecting = null;
      reject(new Error("WebSocket connection failed."));
    };

    const onClose = () => {
      if (socket === ws) {
        socket = null;
      }
      rejectAllPending("WebSocket connection closed.");
      if (!opened) {
        connecting = null;
        reject(new Error("WebSocket connection closed before opening."));
      }
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });

  return connecting;
}

async function wsRequest<TResponse, TPayload = unknown>(
  type: string,
  payload?: TPayload,
  timeoutMs = 15000,
): Promise<TResponse> {
  const ws = await ensureSocket();
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `req-${Date.now()}-${Math.random()}`;

  const message: WsRequest<TPayload> = { type, requestId, payload };

  return new Promise<TResponse>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("WebSocket request timed out."));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timeoutId });
    ws.send(JSON.stringify(message));
  });
}

export async function fetchConfig(params: {
  clientCode: string;
  companyCode: string;
  gameCode: string;
}): Promise<GameConfig> {
  return wsRequest<GameConfig>("config.get", params);
}

export async function playTicket(payload: {
  clientCode: string;
  companyCode: string;
  sessionId: string;
  mode: GameMode;
  bet: number;
}): Promise<PlayOutcome> {
  return wsRequest<PlayOutcome>("play.single", payload);
}

export async function playPack(payload: {
  clientCode: string;
  companyCode: string;
  sessionId: string;
  mode: Extract<GameMode, "pack" | "nivel1" | "nivel2">;
  packLevel: PackLevel;
  bet: number;
  packSize: PackSize;
}): Promise<PackOutcome> {
  return wsRequest<PackOutcome>("play.pack", payload);
}
