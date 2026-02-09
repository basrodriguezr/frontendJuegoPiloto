"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGameConfig } from "@/api/config-loader";
import { playPack, playTicket } from "@/api/client";
import type { GameConfig, GameMode, PackLevel, PackOutcome, PackPlay, PackSize, PlayOutcome } from "@/api/types";
import { gameBus, uiBus } from "@/game/events";
import { PhaserBoard } from "@/game/phaser-board";
import { createStateMachine, type GameState } from "@/game/state-machine";
import { formatMoney } from "@/lib/format-money";
import { startTelemetry } from "@/lib/telemetry";
import styles from "./page.module.css";

type UiStage = "splash" | "menu" | "bet" | "play";

const stateLabels: Record<GameState, string> = {
  MENU: "Menu listo",
  LOADING: "Cargando",
  READY: "Listo",
  REVEAL: "Reveal inicial",
  CASCADE_LOOP: "Cascada",
  END_TICKET: "Fin de ticket",
  PACK_LIST: "Lista de pack",
  REPLAY: "Replay",
  SUMMARY: "Resumen",
};

function asPlayOutcome(play: PackPlay): PlayOutcome {
  return {
    playId: play.playId,
    mode: play.mode,
    bet: play.bet,
    grid0: play.grid0,
    cascades: play.cascades,
    totalWin: play.totalWin,
  };
}

export default function Home() {
  const sessionId = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `session-${Date.now()}`),
    [],
  );
  const machineRef = useRef(createStateMachine("LOADING"));
  const splashDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [config, setConfig] = useState<GameConfig | null>(null);
  const [mode, setMode] = useState<GameMode>("nivel1");
  const [packSize, setPackSize] = useState<PackSize>(5);
  const [packLevel, setPackLevel] = useState<PackLevel>("nivel1");
  const [bet, setBet] = useState<number>(0);
  const [state, setState] = useState<GameState>("LOADING");
  const [loadingText, setLoadingText] = useState("Cargando configuracion remota...");
  const [play, setPlay] = useState<PlayOutcome | undefined>();
  const [packOutcome, setPackOutcome] = useState<PackOutcome | undefined>();
  const [packRevealed, setPackRevealed] = useState(0);
  const [displayedWin, setDisplayedWin] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uiStage, setUiStage] = useState<UiStage>("splash");
  const [replayModal, setReplayModal] = useState<PlayOutcome | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesIndex, setRulesIndex] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  const transition = useCallback((next: GameState) => {
    machineRef.current.transition(next);
    setState(next);
    gameBus.emit("game:state-change", { state: next });
  }, []);

  const selectMode = (nextMode: GameMode) => {
    setMode(nextMode);
    setPlay(undefined);
    setPackOutcome(undefined);
    setPackRevealed(0);
    uiBus.emit("ui:select-mode", { mode: nextMode });
    setUiStage("bet");
  };

  const changePack = (size: PackSize) => {
    setPackSize(size);
    setPackOutcome(undefined);
    setPackRevealed(0);
    uiBus.emit("ui:select-pack", { packSize: size });
  };

  const changePackLevel = (level: PackLevel) => {
    setPackLevel(level);
    setPackOutcome(undefined);
    setPackRevealed(0);
  };

  const clearSplashDelay = useCallback(() => {
    if (splashDelayRef.current) {
      clearTimeout(splashDelayRef.current);
      splashDelayRef.current = null;
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    clearSplashDelay();
    setError(null);
    setLoadingText("Cargando configuracion remota...");
    setUiStage("splash");
    const splashStart = Date.now();
    transition("LOADING");
    try {
      const cfg = await loadGameConfig();
      setConfig(cfg);
      setBet(cfg.betValues?.[0] ?? cfg.betOptions.minBet);
      const firstEnabled = cfg.modes.find((m) => m.enabled)?.code ?? "nivel1";
      const defaultMode = (cfg.availableModes?.[0] as GameMode | undefined) ?? firstEnabled;
      setMode(defaultMode);
      setPackLevel(cfg.packLevels?.[0] ?? (firstEnabled === "nivel2" ? "nivel2" : "nivel1"));
      setPackSize(cfg.packSizes[0]);
      gameBus.emit("game:config-loaded", cfg);
      transition("MENU");
      const delay = Math.max(0, 2000 - (Date.now() - splashStart));
      splashDelayRef.current = setTimeout(() => setUiStage("menu"), delay);
    } catch (err) {
      setError("No pudimos cargar la configuracion del cliente.");
      gameBus.emit("game:error", { message: String(err) });
      transition("MENU");
      const delay = Math.max(0, 2000 - (Date.now() - splashStart));
      splashDelayRef.current = setTimeout(() => setUiStage("menu"), delay);
    }
  }, [clearSplashDelay, transition]);

  useEffect(() => {
    const stopTelemetry = startTelemetry();
    refreshConfig();
    return () => {
      stopTelemetry();
      clearSplashDelay();
    };
  }, [clearSplashDelay, refreshConfig]);

  useEffect(() => {
    setPackOutcome(undefined);
    setPackRevealed(0);
  }, [bet, mode, packSize, packLevel]);

  useEffect(() => {
    if (play) {
      setDisplayedWin(0);
    }
  }, [play?.playId]);

  useEffect(() => {
    if (packOutcome) {
      setDisplayedWin(0);
    }
  }, [packOutcome?.packId]);

  useEffect(() => {
    if (!play && !packOutcome) {
      setDisplayedWin(0);
    }
  }, [packOutcome, play]);

  useEffect(() => {
    if (mode === "pack" || !play) {
      return;
    }
    setDisplayedWin(0);
    const unsubscribe = gameBus.on("game:win:increment", ({ playId, amount }) => {
      if (playId !== play.playId) return;
      setDisplayedWin((prev) => prev + amount);
    });
    return () => {
      unsubscribe();
    };
  }, [mode, play?.playId]);

  async function handlePlaySingle() {
    if (!config) return;
    setError(null);
    setLoadingText("Solicitando ticket....");
    transition("LOADING");
    gameBus.emit("game:play:started", { mode, bet });
    uiBus.emit("ui:play", { mode, bet });
    try {
      const outcome = await playTicket({
        clientCode: config.clientCode,
        companyCode: config.companyCode,
        sessionId,
        mode,
        bet,
      });
      setPlay(outcome);
      setPackOutcome(undefined);
      setPackRevealed(0);
      transition("REVEAL");
      gameBus.emit("game:play:completed", outcome);
      const cascadeDuration = 1200 + outcome.cascades.length * 1000;
      setTimeout(() => transition("END_TICKET"), cascadeDuration);
    } catch (err) {
      setError("No pudimos obtener el ticket.");
      transition("MENU");
      gameBus.emit("game:error", { message: String(err) });
    }
  }

  async function handlePlayPack() {
    if (!config) return;
    if (packOutcome && packRevealed < packOutcome.plays.length) {
      setPackRevealed((prev) => Math.min(prev + 1, packOutcome.plays.length));
      transition("PACK_LIST");
      return;
    }
    if (packOutcome && packRevealed >= packOutcome.plays.length) {
      return;
    }
    setError(null);
    setLoadingText("Creando pack determinista...");
    transition("LOADING");
    gameBus.emit("game:pack:started", { mode, bet, packSize, packLevel });
    uiBus.emit("ui:play", { mode, bet, packSize, packLevel });
    try {
      const outcome = await playPack({
        clientCode: config.clientCode,
        companyCode: config.companyCode,
        sessionId,
        mode,
        packLevel,
        bet,
        packSize,
      });
      setPackOutcome(outcome);
      setPlay(undefined);
      setPackRevealed(1);
      transition("PACK_LIST");
    } catch (err) {
      setError("No pudimos generar el pack. Intenta nuevamente.");
      transition("MENU");
      gameBus.emit("game:error", { message: String(err) });
    }
  }

  const boardPlay: PlayOutcome | undefined = mode === "pack" ? undefined : play;

  const packTotal = packOutcome?.plays.length ?? packSize;
  const revealedPlays = packOutcome ? packOutcome.plays.slice(0, packRevealed) : [];
  const revealedTotalWin = revealedPlays.reduce((acc, ticket) => acc + ticket.totalWin, 0);
  const revealedTotalBet = bet * revealedPlays.length;
  const remainingTickets = Math.max(0, packTotal - packRevealed);
  const bestRevealed = revealedPlays.reduce<PackPlay | null>((best, ticket) => {
    if (!best || ticket.totalWin > best.totalWin) {
      return ticket;
    }
    return best;
  }, null);

  useEffect(() => {
    if (mode === "pack") {
      setDisplayedWin(revealedTotalWin);
    }
  }, [mode, revealedTotalWin]);

  const moneyFormat = config?.money;
  const jackpots = config?.jackpots;
  const betValues = config?.betValues?.length ? config.betValues : config ? [config.betOptions.minBet] : [];
  const safeBetValues = betValues.length > 0 ? betValues : [0];
  const availableModes = config?.availableModes ?? ["nivel1", "nivel2", "pack"];
  const packLevels = config?.packLevels ?? ["nivel1", "nivel2"];

  const hudBetValue = mode === "pack" ? bet * packTotal : bet;
  const betLabel = moneyFormat ? formatMoney(hudBetValue, moneyFormat) : `$${hudBetValue.toLocaleString("es-CL")}`;
  const totalWinLabel = moneyFormat
    ? formatMoney(displayedWin, moneyFormat)
    : `$${displayedWin.toLocaleString("es-CL")}`;
  const bonusActive = play?.cascades.some((step) => step.bonus) ?? false;

  const packLevelLabel = packLevel === "nivel1" ? "Nivel 1" : "Nivel 2";
  const modeBadge =
    mode === "nivel1"
      ? "Volatilidad baja"
      : mode === "nivel2"
        ? "Volatilidad alta"
        : `Paquete de tickets - ${packLevelLabel}`;

  const packSummary =
    packOutcome && moneyFormat
      ? {
        totalBet: formatMoney(revealedTotalBet, moneyFormat),
        totalWin: formatMoney(revealedTotalWin, moneyFormat),
        bestIndex: bestRevealed ? bestRevealed.ticketIndex + 1 : null,
      }
      : null;

  const stageSteps: { key: UiStage; label: string }[] = [
    { key: "splash", label: "Splash" },
    { key: "menu", label: "Menu" },
    { key: "bet", label: "Monto" },
    { key: "play", label: "Jugar" },
  ];

  const betIndex = Math.max(0, safeBetValues.indexOf(bet));
  const betValue = safeBetValues[betIndex] ?? 0;
  const betDisplay = moneyFormat ? formatMoney(betValue, moneyFormat) : `$${betValue.toLocaleString("es-CL")}`;
  const canDecreaseBet = betIndex > 0;
  const canIncreaseBet = betIndex < safeBetValues.length - 1;
  const canRevealMore = !packOutcome || packRevealed < packTotal;

  const packActionLabel = packOutcome
    ? `Abrir ticket (${remainingTickets} restantes)`
    : `Generar ${packSize} tickets`;

  const rulesPages = config?.symbolPaytable ?? [];
  const rulesTotal = rulesPages.length;
  const activeRule = rulesTotal > 0 ? rulesPages[rulesIndex % rulesTotal] : null;
  const activeRuleMatches = activeRule?.matches.filter((rule) => rule.count >= 3) ?? [];
  const ruleStyle = activeRule
    ? {
      background: `linear-gradient(135deg, ${activeRule.color}cc, ${activeRule.color}22)`,
      borderColor: activeRule.color,
      boxShadow: `0 12px 24px ${activeRule.color}33`,
    }
    : undefined;
  const goPrevRule = () => {
    if (rulesTotal === 0) return;
    setRulesIndex((prev) => (prev - 1 + rulesTotal) % rulesTotal);
  };
  const goNextRule = () => {
    if (rulesTotal === 0) return;
    setRulesIndex((prev) => (prev + 1) % rulesTotal);
  };

  const rulesInfoContent = (
    <div className={styles.rulesInfoBody}>
      <div className={styles.rulesInfoSection}>
        <h4 className={styles.rulesInfoHeading}>Reglas del Juego</h4>
        <p className={styles.rulesInfoText}>
          Los Videojuegos de Lotería de Concepción se rigen por el Decreto Supremo N°1.136, del Ministerio de Hacienda,
          publicado en el Diario Oficial de 27 de abril de 2005, cuyo texto fue sustituido por el Decreto Supremo Nº158,
          del Ministerio de Hacienda, publicado con fecha 21 de abril del 2016, en lo sucesivo DS N°1.136, dictado en
          conformidad con el artículo 90 de la Ley 18.768 y Ley 18.568 de Lotería.
        </p>
        <p className={styles.rulesInfoText}>
          Advertimos a nuestros clientes que el producto "Videojuegos" es un juego especializado que requiere conocer
          sus reglas, razón por la cual le invitamos a leer las reglas que presentamos a continuación, y en caso de
          dudas, usar el sistema de atención al cliente antes de jugar.
        </p>
      </div>
      <div className={styles.rulesInfoSection}>
        <h4 className={styles.rulesInfoHeading}>¿Cómo jugar?</h4>
        <p className={styles.rulesInfoText}>Primero, seleccione la modalidad de juego que desea jugar:</p>
        <ul className={styles.rulesInfoList}>
          <li>Nivel 1 (Baja volatilidad): Mayor probabilidad de ganar por jugada, premios en promedio más bajos.</li>
          <li>Nivel 2 (Alta volatilidad): Menor probabilidad de ganar por jugada, premios en promedio más altos.</li>
          <li>Paquete de tickets: Permite comprar múltiples tickets de forma simultánea (5, 10, 15 o 20 tickets).</li>
        </ul>
      </div>
      <div className={styles.rulesInfoSection}>
        <h5 className={styles.rulesInfoSubheading}>Nivel 1</h5>
        <ul className={styles.rulesInfoList}>
          <li>Seleccione el importe del ticket usando los botones “+” y “-”.</li>
          <li>Presione el botón "Play" (representado por un triángulo ►).</li>
          <li>El importe se descontará automáticamente de su saldo.</li>
          <li>Si encuentra 3 o más símbolos iguales, gana el premio de acuerdo a la tabla de pagos disponible en el juego</li>
          <li>
            Si encuentra el símbolo de bonus, activará la característica de bonificación. En la ronda de bonificación,
            debe dispara el cañón para hundir un barco y ganar el importe mostrado.
          </li>
          <li>
            Si usted encuentra una llave de oro, plata o bronce, abrirá el cofre correspondiente y ganará el importe
            mostrado en el cofre.
          </li>
        </ul>
      </div>
      <div className={styles.rulesInfoSection}>
        <h5 className={styles.rulesInfoSubheading}>Nivel 2</h5>
        <ul className={styles.rulesInfoList}>
          <li>Seleccione el importe del ticket con los botones “+” y “-”.</li>
          <li>Presione el botón "Play" (►).</li>
          <li>El importe se descontará automáticamente y comenzará la jugada.</li>
          <li>Los símbolos caerán automáticamente en pantalla.</li>
          <li>
            Los grupos de 3 o más símbolos conectados horizontal o verticalmente formarán combinaciones ganadoras,
            explotarán, y serán reemplazados por nuevos símbolos.
          </li>
          <li>Si encuentra 3 símbolos de cofres, ganará un premio instantáneo aleatorio.</li>
          <li>Si usted encuentra 3 símbolos de "Extra Spins", ganará 3 jugadas adicionales.</li>
          <li>
            Si usted encuentra 3 símbolos de "Bonus", activará la característica de bonificación, en ella, debe disparar
            el cañón para hundir un barco y ganar el premio mostrado. Si golpea al pulpo con el cañón, subirá el nivel de
            premiación, el nivel máximo es 3.
          </li>
          <li>La jugada termina cuando ya no hay más combinaciones posibles.</li>
        </ul>
      </div>
      <div className={styles.rulesInfoSection}>
        <h5 className={styles.rulesInfoSubheading}>Paquete de tickets</h5>
        <p className={styles.rulesInfoText}>
          La opción de “Paquete de tickets” proporciona la posibilidad de comprar múltiples tickets de manera simultánea,
          se pueden comprar (5, 10, 15 o 20 unidades).
        </p>
      </div>
      <div className={styles.rulesInfoSection}>
        <h4 className={styles.rulesInfoHeading}>Tabla de Premios</h4>
        <p className={styles.rulesInfoText}>
          Los pagos se realizarán de acuerdo con la tabla de premiación de los símbolos disponible en la sección
          “Información” del juego.
        </p>
      </div>
      <div className={styles.rulesInfoSection}>
        <h4 className={styles.rulesInfoHeading}>Pozos Acumulados Mayor y Menor</h4>
        <p className={styles.rulesInfoText}>
          Los pozos acumulados mayor y menor son un pozo acumulado común entre todos los videojuegos. Estos se otorgan de
          manera aleatoria y se incrementan en función del monto apostado por los jugadores en todos los videojuegos. De
          cada jugada realizada, el 3% del valor apostado se destina al pozo acumulado, el cual se distribuye entre los
          acumulados menor y mayor.
        </p>
      </div>
      <div className={styles.rulesInfoSection}>
        <h4 className={styles.rulesInfoHeading}>Hechos de fuerza mayor</h4>
        <p className={styles.rulesInfoText}>
          Lotería de Concepción, realiza un esfuerzo importante en mantener actualizado y libre de errores sus sistemas.
          No obstante, lo anterior no garantiza que la información publicada a través de Internet, tanto de apuestas
          realizadas, como de resultados esté libre de errores. Lotería de Concepción podrá rectificar esta información
          cada vez que sea necesario, y no será responsable de causas de fuerza mayor o caso fortuito.
        </p>
      </div>
      <div className={styles.rulesInfoSection}>
        <h4 className={styles.rulesInfoHeading}>Ataques al sistema de información o datos informáticos</h4>
        <p className={styles.rulesInfoText}>
          Estos delitos, en sus diversas modalidades, se encuentran tipificados en los artículos 1°, 4°, 5°, 7° y 8° de
          la ley N°21.459.
        </p>
        <div className={styles.rulesInfoLaw}>
          <p className={styles.rulesInfoLawTitle}>Artículo 1°.-</p>
          <p className={styles.rulesInfoText}>
            Sanciona a "El que obstaculice o impida el normal funcionamiento, total o parcial, de un sistema informático,
            a través de la introducción, transmisión, daño, deterioro, alteración o supresión de los datos informáticos...".
          </p>
        </div>
        <div className={styles.rulesInfoLaw}>
          <p className={styles.rulesInfoLawTitle}>Artículo 4°.-</p>
          <p className={styles.rulesInfoText}>
            Ataque a la integridad de los datos informáticos: Castiga a "El que indebidamente altere, dañe o suprima datos
            informáticos...".
          </p>
        </div>
        <div className={styles.rulesInfoLaw}>
          <p className={styles.rulesInfoLawTitle}>Artículo 5°.-</p>
          <p className={styles.rulesInfoText}>
            Castiga a quien "indebidamente introduzca, altere, dañe o suprima datos informáticos con la intención de que
            sean tomados como auténticos o utilizados para generar documentos auténticos...".
          </p>
        </div>
        <div className={styles.rulesInfoLaw}>
          <p className={styles.rulesInfoLawTitle}>Artículo 7°.-</p>
          <p className={styles.rulesInfoText}>
            Sanciona a quien, "causando perjuicio a otro, con la finalidad de obtener un beneficio económico para sí o para
            un tercero, manipule un sistema informático, mediante la introducción, alteración, daño o supresión de datos
            informáticos...".
          </p>
        </div>
        <div className={styles.rulesInfoLaw}>
          <p className={styles.rulesInfoLawTitle}>Artículo 8°.-</p>
          <p className={styles.rulesInfoText}>
            Sanciona a quien, para cometer los delitos anteriores, "entregare u obtuviere para su utilización, importare,
            difundiera o realizare otra forma de puesta a disposición uno o más dispositivos, programas computacionales,
            contraseñas, códigos de seguridad o de acceso...".
          </p>
        </div>
      </div>
    </div>
  );

  const packPlayForModal = (ticketIndex: number) => {
    const ticket = packOutcome?.plays[ticketIndex];
    if (ticket) {
      setReplayModal(asPlayOutcome(ticket));
    }
  };

  const renderPackGrid = () => {
    const tickets = packOutcome ? packOutcome.plays.slice(0, packRevealed) : [];
    const size = packTotal;
    const cols = Math.max(2, Math.ceil(Math.sqrt(size)));
    const rows = Math.ceil(size / cols);
    const items = Array.from({ length: rows * cols }).map((_, idx) => tickets[idx]);

    return (
      <div className={styles.packGrid}>
        {items.map((ticket, idx) => {
          if (!ticket) {
            return (
              <div key={`placeholder-${idx}`} className={`${styles.packCard} ${styles.packPlaceholder}`}>
                <span className={styles.packIndex}>Ticket {idx + 1}</span>
                <span className={styles.packWinMuted}>¿?</span>
              </div>
            );
          }
          const winLabel = moneyFormat ? formatMoney(ticket.totalWin, moneyFormat) : ticket.totalWin;
          const modeLabel =
            ticket.mode === "nivel1"
              ? "NIVEL 1"
              : ticket.mode === "nivel2"
                ? "NIVEL 2"
                : ticket.mode.toUpperCase();
          const winClass = ticket.totalWin > 0 ? styles.packWin : styles.packWinMuted;
          return (
            <button key={ticket.playId} className={styles.packCard} onClick={() => packPlayForModal(ticket.ticketIndex)} type="button">
              <span className={styles.packIndex}>Ticket {ticket.ticketIndex + 1}</span>
              <span className={winClass}>{winLabel}</span>
              <span className={styles.packMode}>{modeLabel}</span>
              <span className={styles.packReplay}>Ver jugada</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.stageNav}>
          <div className={styles.stageSteps}>
            {stageSteps.map((step) => (
              <div key={step.key} className={`${styles.stageStep} ${uiStage === step.key ? styles.stageActive : ""}`}>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.stageActions}>
            {uiStage !== "splash" ? (
              <button className={styles.ghost} onClick={refreshConfig} type="button">
                Reload config
              </button>
            ) : null}
          </div>
        </div>

        {uiStage === "splash" ? (
          <section className={`${styles.panel} ${styles.splash}`}>
            <div className={styles.splashLogo}>
              <img className={styles.splashLogoImage} src="/LOGO%20LOTERIA.png" alt="Logo" />
            </div>
            <div className={styles.splashLoader}>
              <span className={styles.splashBar} />
            </div>
          </section>
        ) : null}

        {uiStage === "menu" ? (
          <section className={styles.columns}>
            <article className={styles.panel}>
              <div className={styles.jackpotBar}>
                <div>
                  <p className={styles.metricLabel}>Mayor</p>
                  <p className={styles.metricValue}>${(jackpots?.mayor ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className={styles.metricLabel}>Menor</p>
                  <p className={styles.metricValue}>${(jackpots?.menor ?? 0).toLocaleString()}</p>
                </div>
              </div>
              <h2>Elige tu experiencia</h2>
              <div className={styles.modeGrid}>
                {availableModes.map((m) => (
                  <button
                    key={m}
                    className={`${styles.modeCard} ${mode === m ? styles.modeActive : ""}`}
                    onClick={() => selectMode(m as GameMode)}
                    type="button"
                  >
                    <p className={styles.modeTitle}>{m.toUpperCase()}</p>
                    <p className={styles.modeSubtitle}>
                      {m === "nivel1" ? "Baja volatilidad" : m === "nivel2" ? "Alta volatilidad" : "Paquete de tickets"}
                    </p>
                  </button>
                ))}
              </div>

              {mode === "pack" ? (
                <>
                  <div className={styles.packRow}>
                    <div>
                      <p className={styles.label}>Tamano de pack</p>
                      <p className={styles.packValue}>{packSize} tickets</p>
                    </div>
                    <select
                      value={packSize}
                      onChange={(e) => changePack(Number(e.target.value) as PackSize)}
                      className={styles.select}
                    >
                      {config?.packSizes.map((size) => (
                        <option key={size} value={size}>
                          {size} tickets
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.packRow}>
                    <div>
                      <p className={styles.label}>Nivel de pack</p>
                      <p className={styles.packValue}>{packLevelLabel}</p>
                    </div>
                    <select
                      value={packLevel}
                      onChange={(e) => changePackLevel(e.target.value as PackLevel)}
                      className={styles.select}
                    >
                      {packLevels.map((level) => (
                        <option key={level} value={level}>
                          {level === "nivel1" ? "Nivel 1 (Baja volatilidad)" : "Nivel 2 (Alta volatilidad)"}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
            </article>
          </section>
        ) : null}

        {uiStage === "bet" ? (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Selecciona tu ticket</h2>
              <span className={styles.chip}>{modeBadge}</span>
            </div>
            {mode === "pack" ? (
              <>
                <div className={styles.packRow}>
                  <div>
                    <p className={styles.label}>Tamano de pack</p>
                    <p className={styles.packValue}>{packSize} tickets</p>
                  </div>
                  <select
                    value={packSize}
                    onChange={(e) => changePack(Number(e.target.value) as PackSize)}
                    className={styles.select}
                  >
                    {config?.packSizes.map((size) => (
                      <option key={size} value={size}>
                        {size} tickets
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.packRow}>
                  <div>
                    <p className={styles.label}>Nivel de pack</p>
                    <p className={styles.packValue}>{packLevelLabel}</p>
                  </div>
                  <select
                    value={packLevel}
                    onChange={(e) => changePackLevel(e.target.value as PackLevel)}
                    className={styles.select}
                  >
                    {packLevels.map((level) => (
                      <option key={level} value={level}>
                        {level === "nivel1" ? "Nivel 1 (Baja volatilidad)" : "Nivel 2 (Alta volatilidad)"}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            <div className={styles.betSelector}>
              <button
                className={styles.betAdjust}
                onClick={() => setBet(safeBetValues[betIndex - 1])}
                type="button"
                disabled={!canDecreaseBet}
                aria-label="Disminuir monto"
              >
                -
              </button>
              <div className={styles.betDisplay}>
                <p className={styles.label}>Monto</p>
                <p className={styles.betAmount}>{betDisplay}</p>
              </div>
              <button
                className={styles.betAdjust}
                onClick={() => setBet(safeBetValues[betIndex + 1])}
                type="button"
                disabled={!canIncreaseBet}
                aria-label="Aumentar monto"
              >
                +
              </button>
            </div>
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => setUiStage("menu")} type="button">
                Volver al menu
              </button>
              <button className={styles.primary} onClick={() => setUiStage("play")} type="button">
                Ir a jugar
              </button>
            </div>
          </section>
        ) : null}

        {uiStage === "play" ? (
          <section className={styles.columns}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>Config y Play</h2>
                <span className={styles.chip}>{boardPlay ? boardPlay.playId : "Esperando ticket"}</span>
              </div>

              <div className={styles.hud}>
                <div>
                  <p className={styles.label}>Estado</p>
                  <p className={styles.bold}>{stateLabels[state]}</p>
                </div>
                <div>
                  <p className={styles.label}>Modo</p>
                  <p className={styles.bold}>{mode.toUpperCase()}</p>
                </div>
                <div>
                  <p className={styles.label}>Bet</p>
                  <p className={styles.bold}>{betLabel}</p>
                </div>
                <div>
                  <p className={styles.label}>Win</p>
                  <p className={styles.bold}>{totalWinLabel}</p>
                </div>
                <div>
                  <p className={styles.label}>Bonus</p>
                  <p className={styles.bold}>{bonusActive ? "BONUS" : "-"}</p>
                </div>
              </div>

              {mode === "pack" ? (
                <>
                  <div className={styles.packRow}>
                    <div>
                      <p className={styles.label}>Tamano de pack</p>
                      <p className={styles.packValue}>{packSize} tickets</p>
                    </div>
                    <select
                      value={packSize}
                      onChange={(e) => changePack(Number(e.target.value) as PackSize)}
                      className={styles.select}
                    >
                      {config?.packSizes.map((size) => (
                        <option key={size} value={size}>
                          {size} tickets
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.packRow}>
                    <div>
                      <p className={styles.label}>Nivel de pack</p>
                      <p className={styles.packValue}>{packLevelLabel}</p>
                    </div>
                    <select
                      value={packLevel}
                      onChange={(e) => changePackLevel(e.target.value as PackLevel)}
                      className={styles.select}
                    >
                      {packLevels.map((level) => (
                        <option key={level} value={level}>
                          {level === "nivel1" ? "Nivel 1 (Baja volatilidad)" : "Nivel 2 (Alta volatilidad)"}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}

              <div className={styles.actions}>
                {mode === "pack" ? (
                  <>
                    <button className={styles.primary} onClick={handlePlayPack} type="button" disabled={!canRevealMore}>
                      {packActionLabel}
                    </button>
                    {packOutcome && remainingTickets > 0 ? (
                      <button className={styles.secondary} onClick={() => setPackRevealed(packTotal)} type="button">
                        Abrir todos
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button className={styles.primary} onClick={handlePlaySingle} type="button">
                    Play ►
                  </button>
                )}
                <button className={styles.ghost} onClick={() => setUiStage("bet")} type="button">
                  Cambiar monto
                </button>
              </div>
              {error ? <p className={styles.error}>{error}</p> : null}
              <div className={styles.rulesButtonRow}>
                <button
                  className={styles.rulesButton}
                  onClick={() => {
                    setRulesIndex(0);
                    setRulesOpen(true);
                  }}
                  type="button"
                >
                  <span className={styles.rulesIcon}>i</span>
                  <span>Reglas del juego</span>
                </button>
                <button className={styles.rulesButton} onClick={() => setInfoOpen(true)} type="button">
                  <span className={styles.rulesIcon}>i</span>
                  <span>Informacion</span>
                </button>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>{mode === "pack" ? "Resultados de tickets" : "Tablero"}</h2>
                <span className={styles.chip}>{boardPlay ? boardPlay.playId : "Esperando ticket"}</span>
              </div>
              {mode === "pack" ? (
                <>
                  <div className={styles.packSummaryRow}>
                    <div>
                      <p className={styles.label}>Total bet</p>
                      <p className={styles.bold}>{packSummary?.totalBet ?? "-"}</p>
                    </div>
                    <div>
                      <p className={styles.label}>Total win</p>
                      <p className={styles.bold}>{packSummary?.totalWin ?? "-"}</p>
                    </div>
                    <div>
                      <p className={styles.label}>Mejor ticket</p>
                      <p className={styles.bold}>
                        {packSummary?.bestIndex ?? "-"}
                      </p>
                    </div>
                  </div>
                  <div className={styles.packProgress}>
                    <div>
                      <p className={styles.label}>Tickets abiertos</p>
                      <p className={styles.bold}>
                        {packRevealed} / {packTotal}
                      </p>
                    </div>
                    <div>
                      <p className={styles.label}>Tickets restantes</p>
                      <p className={styles.bold}>{remainingTickets}</p>
                    </div>
                  </div>
                  {packOutcome ? renderPackGrid() : <p className={styles.muted}>Abre tickets para ver premios.</p>}
                  {packOutcome ? <p className={styles.muted}>Click en un ticket para ver la jugada en replay.</p> : null}
                </>
              ) : (
                <div className={styles.boardShell}>
                  <PhaserBoard play={boardPlay} symbolPaytable={config?.symbolPaytable} />
                </div>
              )}
            </article>
          </section>
        ) : null}
      </main>
      {state === "LOADING" ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>{loadingText}</p>
        </div>
      ) : null}
      {replayModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <p>Replay {replayModal.playId}</p>
              <button className={styles.ghost} onClick={() => setReplayModal(null)} type="button">
                Cerrar
              </button>
            </div>
            <div className={styles.modalBody}>
              <PhaserBoard play={replayModal} symbolPaytable={config?.symbolPaytable} />
            </div>
          </div>
        </div>
      ) : null}
      {rulesOpen && activeRule ? (
        <div className={styles.rulesOverlay}>
          <div className={`${styles.modal} ${styles.rulesModal}`}>
            <div className={styles.rulesHeader}>
              <p className={styles.rulesTitle}>COMO JUGAR</p>
              <button className={styles.ghost} onClick={() => setRulesOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className={styles.rulesBody}>
              <button className={styles.rulesNav} onClick={goPrevRule} type="button" aria-label="Anterior">
                {"<"}
              </button>
              <div className={styles.rulesCard}>
                <div className={styles.rulesSymbol} style={ruleStyle}>
                  {activeRule.label}
                </div>
                <div className={styles.rulesList}>
                  {activeRuleMatches.map((rule) => (
                    <div key={rule.count} className={styles.rulesRow}>
                      <span className={styles.rulesCount}>{rule.count} simbolos coincidentes</span>
                      <span className={styles.rulesMultiplier}>X {rule.multiplier.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button className={styles.rulesNav} onClick={goNextRule} type="button" aria-label="Siguiente">
                {">"}
              </button>
            </div>
            <div className={styles.rulesFooter}>
              <span>
                {rulesIndex + 1} / {rulesTotal}
              </span>
            </div>
          </div>
        </div>
      ) : null}
      {infoOpen ? (
        <div className={styles.rulesOverlay}>
          <div className={`${styles.modal} ${styles.rulesModal}`}>
            <div className={styles.rulesHeader}>
              <p className={styles.rulesTitle}>INFORMACION</p>
              <button className={styles.ghost} onClick={() => setInfoOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className={styles.rulesInfo}>{rulesInfoContent}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
