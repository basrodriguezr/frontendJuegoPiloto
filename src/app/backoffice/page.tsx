"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminLogin, fetchAdminGameConfig, saveAdminGameConfig } from "@/api/admin-client";
import type { EngineConfig, EngineLevelConfig, GameConfig } from "@/api/types";
import styles from "./page.module.css";

type LevelCode = "nivel1" | "nivel2";

const TOKEN_KEY = "piloto_admin_token";

const DEFAULT_ENGINE: EngineConfig = {
  rng: {
    source: "math-random",
    seed: null
  },
  levels: {
    nivel1: {
      engineType: "cluster",
      rows: 3,
      cols: 5,
      includeDiagonals: true,
      fillMode: "replace",
      maxCascades: 20,
      matchMinCluster: 3,
      excludedSymbols: ["N"],
      bonus: {
        triggerSymbol: "N",
        triggerCount: 2,
        prizeMultipliers: [2, 3, 5, 8],
        maxRounds: 25,
        endCode: "TERMINO_DE_BONUS"
      }
    },
    nivel2: {
      engineType: "cluster",
      rows: 7,
      cols: 5,
      includeDiagonals: false,
      fillMode: "cascade",
      maxCascades: 20,
      matchMinCluster: 3,
      excludedSymbols: ["N"],
      bonus: {
        triggerSymbol: "N",
        triggerCount: 3,
        prizeMultipliers: [4, 6, 8, 10, 12, 16, 20, 30, 40],
        maxRounds: 25,
        endCode: "TERMINO_DE_BONUS"
      }
    }
  }
};

function cloneConfig(config: GameConfig): GameConfig {
  return JSON.parse(JSON.stringify(config)) as GameConfig;
}

function normalizeEngine(config: GameConfig): EngineConfig {
  const normalizeLevel = (level: LevelCode): EngineLevelConfig => {
    const source = config.engine?.levels?.[level];
    const defaults = DEFAULT_ENGINE.levels[level];
    const legacyEngineType = (source as { engineType?: string } | undefined)?.engineType;
    const fillMode: EngineLevelConfig["fillMode"] =
      source?.fillMode === "rodillo"
        ? "rodillo"
        : source?.fillMode === "replace"
          ? "replace"
          : source?.fillMode === "cascade"
            ? "cascade"
            : legacyEngineType === "reels"
              ? "rodillo"
              : defaults.fillMode;
    return {
      ...defaults,
      ...source,
      engineType: "cluster",
      fillMode,
      bonus: {
        ...defaults.bonus,
        ...(source?.bonus ?? {})
      }
    };
  };

  return {
    rng: {
      source: config.engine?.rng?.source || DEFAULT_ENGINE.rng.source,
      seed: config.engine?.rng?.seed ?? DEFAULT_ENGINE.rng.seed
    },
    levels: {
      nivel1: normalizeLevel("nivel1"),
      nivel2: normalizeLevel("nivel2")
    }
  };
}

function toNumberCsv(values: number[] | undefined) {
  return (values ?? []).join(",");
}

function toSymbolCsv(values: string[] | undefined) {
  return (values ?? []).join(",");
}

function parseNumberCsv(input: string): number[] {
  return input
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseSymbolCsv(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function sanitizeCodes(codes: { clientCode: string; companyCode: string; gameCode: string }) {
  return {
    clientCode: codes.clientCode.trim() || "demo",
    companyCode: codes.companyCode.trim() || "demo",
    gameCode: codes.gameCode.trim() || "e-instant",
  };
}

function updateLevelField(
  config: GameConfig,
  level: LevelCode,
  updater: (levelConfig: EngineLevelConfig) => void
) {
  const draft = cloneConfig(config);
  draft.engine = normalizeEngine(draft);
  updater(draft.engine.levels[level]);
  return draft;
}

export default function BackofficePage() {
  const defaultCodes = useMemo(
    () => ({
      clientCode: process.env.NEXT_PUBLIC_CLIENT_CODE ?? "demo",
      companyCode: process.env.NEXT_PUBLIC_COMPANY_CODE ?? "demo",
      gameCode: process.env.NEXT_PUBLIC_GAME_CODE ?? "e-instant"
    }),
    []
  );

  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState(defaultCodes);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [betValuesText, setBetValuesText] = useState("");
  const [packSizesText, setPackSizesText] = useState("");
  const [excludedText, setExcludedText] = useState<Record<LevelCode, string>>({
    nivel1: "",
    nivel2: ""
  });
  const [bonusPrizesText, setBonusPrizesText] = useState<Record<LevelCode, string>>({
    nivel1: "",
    nivel2: ""
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [grafanaUrl, setGrafanaUrl] = useState("http://localhost:3002");

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
    }
    const envUrl = process.env.NEXT_PUBLIC_GRAFANA_URL?.trim();
    if (envUrl) {
      setGrafanaUrl(envUrl.replace(/\/+$/, ""));
      return;
    }
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    setGrafanaUrl(`${protocol}//${host}:3002`);
  }, []);

  const hydratedEngine = useMemo(() => {
    if (!config) return null;
    return normalizeEngine(config);
  }, [config]);

  function loadEditorStrings(nextConfig: GameConfig) {
    const engine = normalizeEngine(nextConfig);
    setBetValuesText(toNumberCsv(nextConfig.betValues));
    setPackSizesText(toNumberCsv(nextConfig.packSizes as unknown as number[]));
    setExcludedText({
      nivel1: toSymbolCsv(engine.levels.nivel1.excludedSymbols),
      nivel2: toSymbolCsv(engine.levels.nivel2.excludedSymbols)
    });
    setBonusPrizesText({
      nivel1: toNumberCsv(engine.levels.nivel1.bonus.prizeMultipliers),
      nivel2: toNumberCsv(engine.levels.nivel2.bonus.prizeMultipliers)
    });
  }

  async function onLogin() {
    try {
      setError("");
      setMessage("");
      const response = await adminLogin(email, password);
      setToken(response.token);
      window.localStorage.setItem(TOKEN_KEY, response.token);
      setMessage(`Sesion iniciada como ${response.user.email}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesion");
    }
  }

  async function onLoadConfig() {
    if (!token) {
      setError("Inicia sesion antes de cargar configuracion.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      setMessage("");
      const resolvedCodes = sanitizeCodes(codes);
      setCodes(resolvedCodes);
      const nextConfig = await fetchAdminGameConfig(token, resolvedCodes);
      nextConfig.engine = normalizeEngine(nextConfig);
      setConfig(nextConfig);
      loadEditorStrings(nextConfig);
      setMessage(`Configuracion cargada (${resolvedCodes.clientCode}/${resolvedCodes.companyCode}/${resolvedCodes.gameCode})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar configuracion");
    } finally {
      setLoading(false);
    }
  }

  async function onSaveConfig() {
    if (!token) {
      setError("Inicia sesion antes de guardar configuracion.");
      return;
    }
    if (!config) {
      setError("Primero carga una configuracion para poder guardarla.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const resolvedCodes = sanitizeCodes(codes);
      setCodes(resolvedCodes);

      const payload = cloneConfig(config);
      payload.engine = normalizeEngine(payload);
      payload.betValues = parseNumberCsv(betValuesText);
      payload.packSizes = parseNumberCsv(packSizesText) as GameConfig["packSizes"];

      (["nivel1", "nivel2"] as LevelCode[]).forEach((level) => {
        payload.engine!.levels[level].excludedSymbols = parseSymbolCsv(excludedText[level]);
        payload.engine!.levels[level].bonus.prizeMultipliers = parseNumberCsv(bonusPrizesText[level]);
        payload.engine!.levels[level].bonus.triggerSymbol =
          payload.engine!.levels[level].bonus.triggerSymbol.trim().toUpperCase();
      });

      const saved = await saveAdminGameConfig(token, { ...resolvedCodes, config: payload });
      saved.engine = normalizeEngine(saved);
      setConfig(saved);
      loadEditorStrings(saved);
      setMessage(`Configuracion guardada (${resolvedCodes.clientCode}/${resolvedCodes.companyCode}/${resolvedCodes.gameCode})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar configuracion");
    } finally {
      setSaving(false);
    }
  }

  function onLogout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setConfig(null);
    setMessage("");
    setError("");
  }

  function setGlobalNumber(path: "minBet" | "maxBet" | "step", value: number) {
    if (!config) return;
    const draft = cloneConfig(config);
    draft.betOptions[path] = Number.isFinite(value) ? value : draft.betOptions[path];
    setConfig(draft);
  }

  function setRngField(path: "source" | "seed", value: string) {
    if (!config) return;
    const draft = cloneConfig(config);
    draft.engine = normalizeEngine(draft);
    if (path === "seed") {
      draft.engine.rng.seed = value.trim() ? value.trim() : null;
    } else {
      draft.engine.rng.source = value;
    }
    setConfig(draft);
  }

  function setLevelNumber(level: LevelCode, key: keyof EngineLevelConfig, value: number) {
    if (!config) return;
    const numericKeys = new Set(["rows", "cols", "maxCascades", "matchMinCluster"]);
    if (!numericKeys.has(key)) return;
    const parsed = Number(value);
    setConfig(
      updateLevelField(config, level, (levelConfig) => {
        (levelConfig as unknown as Record<string, number>)[key] = Number.isFinite(parsed)
          ? Math.max(1, Math.round(parsed))
          : (levelConfig as unknown as Record<string, number>)[key];
      })
    );
  }

  function setLevelFillMode(level: LevelCode, value: "replace" | "cascade" | "rodillo") {
    if (!config) return;
    setConfig(updateLevelField(config, level, (levelConfig) => {
      levelConfig.fillMode = value;
    }));
  }

  function setLevelDiagonals(level: LevelCode, checked: boolean) {
    if (!config) return;
    setConfig(updateLevelField(config, level, (levelConfig) => {
      levelConfig.includeDiagonals = checked;
    }));
  }

  function setBonusField(
    level: LevelCode,
    key: keyof EngineLevelConfig["bonus"],
    value: string | number
  ) {
    if (!config) return;
    setConfig(
      updateLevelField(config, level, (levelConfig) => {
        if (key === "triggerSymbol") {
          levelConfig.bonus.triggerSymbol = String(value);
          return;
        }
        if (key === "endCode") {
          levelConfig.bonus.endCode = String(value);
          return;
        }
        if (key === "triggerCount") {
          levelConfig.bonus.triggerCount = Math.max(1, Math.round(Number(value)));
          return;
        }
        if (key === "maxRounds") {
          levelConfig.bonus.maxRounds = Math.max(1, Math.round(Number(value)));
        }
      })
    );
  }

  function setWeight(level: LevelCode, symbol: string, value: number) {
    if (!config) return;
    const draft = cloneConfig(config);
    const mode = draft.modes.find((entry) => entry.code === level);
    if (!mode) return;
    const item = mode.weights.find((entry) => entry.symbol === symbol);
    if (!item) return;
    item.weight = Number.isFinite(value) ? Math.max(0, value) : item.weight;
    setConfig(draft);
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Backoffice</h1>
            <p>Configura reglas de juego, RNG, pesos, bonus y precios por nivel.</p>
          </div>
          <span className={styles.chip}>JWT Admin</span>
        </header>

        <section className={styles.panel}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="demo@piloto.local" />
            </div>
            <div className={styles.field}>
              <label>Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Demo1234!"
                type="password"
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.primary} type="button" onClick={onLogin}>
                Login
              </button>
              <button className={styles.ghost} type="button" onClick={onLogout}>
                Logout
              </button>
            </div>
          </div>
          {token ? <p className={styles.status}>Token activo</p> : <p className={styles.subtle}>Sin sesion activa</p>}
        </section>

        <section className={styles.panel}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label>clientCode</label>
              <input
                value={codes.clientCode}
                onChange={(e) => setCodes((prev) => ({ ...prev, clientCode: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label>companyCode</label>
              <input
                value={codes.companyCode}
                onChange={(e) => setCodes((prev) => ({ ...prev, companyCode: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label>gameCode</label>
              <input
                value={codes.gameCode}
                onChange={(e) => setCodes((prev) => ({ ...prev, gameCode: e.target.value }))}
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.secondary} type="button" disabled={!token || loading} onClick={onLoadConfig}>
                {loading ? "Cargando..." : "Cargar config"}
              </button>
              <button className={styles.primary} type="button" disabled={!token || !config || saving} onClick={onSaveConfig}>
                {saving ? "Guardando..." : "Guardar config"}
              </button>
              <a className={styles.secondary} href={grafanaUrl} target="_blank" rel="noreferrer">
                Abrir Grafana
              </a>
              <Link href="/" className={styles.ghost}>
                Volver al juego
              </Link>
            </div>
          </div>
          {message ? <p className={styles.status}>{message}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </section>

        {config && hydratedEngine ? (
          <>
            <section className={styles.panel}>
              <h2 className={styles.levelTitle}>Global</h2>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>RNG Source</label>
                  <input
                    value={hydratedEngine.rng.source}
                    onChange={(e) => setRngField("source", e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>RNG Seed</label>
                  <input
                    value={hydratedEngine.rng.seed ?? ""}
                    onChange={(e) => setRngField("seed", e.target.value)}
                    placeholder="opcional"
                  />
                </div>
                <div className={styles.field}>
                  <label>Bet values (CSV)</label>
                  <input value={betValuesText} onChange={(e) => setBetValuesText(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Pack sizes (CSV)</label>
                  <input value={packSizesText} onChange={(e) => setPackSizesText(e.target.value)} />
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label>Min Bet</label>
                  <input
                    type="number"
                    value={config.betOptions.minBet}
                    onChange={(e) => setGlobalNumber("minBet", Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label>Max Bet</label>
                  <input
                    type="number"
                    value={config.betOptions.maxBet}
                    onChange={(e) => setGlobalNumber("maxBet", Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label>Step</label>
                  <input
                    type="number"
                    value={config.betOptions.step}
                    onChange={(e) => setGlobalNumber("step", Number(e.target.value))}
                  />
                </div>
              </div>
            </section>

            <section className={styles.grid2}>
              {(["nivel1", "nivel2"] as LevelCode[]).map((level) => {
                const levelEngine = hydratedEngine.levels[level];
                const mode = config.modes.find((entry) => entry.code === level);
                return (
                  <article key={level} className={styles.panel}>
                    <h3 className={styles.levelTitle}>{level.toUpperCase()}</h3>
                    <p className={styles.subtle}>Reglas de tablero, match y bonus.</p>
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label>Engine Type</label>
                        <input value={levelEngine.engineType} disabled />
                      </div>
                      <div className={styles.field}>
                        <label>Fill Mode</label>
                        <select
                          value={levelEngine.fillMode}
                          onChange={(e) => setLevelFillMode(level, e.target.value as "replace" | "cascade" | "rodillo")}
                        >
                          <option value="replace">replace</option>
                          <option value="cascade">cascade</option>
                          <option value="rodillo">rodillo</option>
                        </select>
                      </div>
                    </div>
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label>Rows</label>
                        <input
                          type="number"
                          value={levelEngine.rows}
                          onChange={(e) => setLevelNumber(level, "rows", Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Cols</label>
                        <input
                          type="number"
                          value={levelEngine.cols}
                          onChange={(e) => setLevelNumber(level, "cols", Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Include diagonals</label>
                        <input
                          type="checkbox"
                          checked={levelEngine.includeDiagonals}
                          onChange={(e) => setLevelDiagonals(level, e.target.checked)}
                        />
                      </div>
                    </div>
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label>Max Cascades</label>
                        <input
                          type="number"
                          value={levelEngine.maxCascades}
                          onChange={(e) => setLevelNumber(level, "maxCascades", Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Match Min Cluster</label>
                        <input
                          type="number"
                          value={levelEngine.matchMinCluster}
                          onChange={(e) => setLevelNumber(level, "matchMinCluster", Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Excluded symbols (CSV)</label>
                        <input
                          value={excludedText[level]}
                          onChange={(e) => setExcludedText((prev) => ({ ...prev, [level]: e.target.value }))}
                        />
                      </div>
                    </div>

                    <p className={styles.subtle}>Bonus</p>
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label>Trigger Symbol</label>
                        <input
                          value={levelEngine.bonus.triggerSymbol}
                          onChange={(e) => setBonusField(level, "triggerSymbol", e.target.value)}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Trigger Count</label>
                        <input
                          type="number"
                          value={levelEngine.bonus.triggerCount}
                          onChange={(e) => setBonusField(level, "triggerCount", Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>Max Rounds</label>
                        <input
                          type="number"
                          value={levelEngine.bonus.maxRounds}
                          onChange={(e) => setBonusField(level, "maxRounds", Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.field}>
                        <label>End Code</label>
                        <input
                          value={levelEngine.bonus.endCode}
                          onChange={(e) => setBonusField(level, "endCode", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label>Prize multipliers (CSV)</label>
                      <input
                        value={bonusPrizesText[level]}
                        onChange={(e) => setBonusPrizesText((prev) => ({ ...prev, [level]: e.target.value }))}
                      />
                    </div>

                    <p className={styles.subtle}>Pesos por simbolo</p>
                    <table className={styles.weights}>
                      <thead>
                        <tr>
                          <th>Simbolo</th>
                          <th>Peso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(mode?.weights ?? []).map((weight) => (
                          <tr key={`${level}-${weight.symbol}`}>
                            <td>{weight.symbol}</td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                value={weight.weight}
                                onChange={(e) => setWeight(level, weight.symbol, Number(e.target.value))}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </article>
                );
              })}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
