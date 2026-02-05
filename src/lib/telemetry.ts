import { gameBus } from "@/game/events";

const sessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `session-${Date.now()}`;

function log(event: string, payload: unknown) {
  // Basic console logger with correlation id; can be replaced by real collector.
  // eslint-disable-next-line no-console
  console.info(`[telemetry] ${event}`, { sessionId, payload, ts: new Date().toISOString() });
}

export function startTelemetry() {
  const unsubscribers = [
    gameBus.on("game:config-loaded", (cfg) => log("config_loaded", { clientCode: cfg.clientCode, gameCode: cfg.gameCode })),
    gameBus.on("game:state-change", ({ state }) => log("game:state-change", { state })),
    gameBus.on("game:play:started", (payload) => log("play_started", payload)),
    gameBus.on("game:play:completed", (payload) => log("game:play:completed", payload)),
    gameBus.on("game:pack:started", (payload) => log("pack_started", payload)),
    gameBus.on("game:pack:completed", (payload) => log("game:pack:completed", payload)),
    gameBus.on("game:replay:opened", (payload) => log("replay_opened", payload)),
    gameBus.on("game:replay:closed", (payload) => log("replay_closed", payload)),
    gameBus.on("game:error", (payload) => log("game:error", payload)),
  ];

  log("game_loaded", { sessionId });

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}
