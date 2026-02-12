"use client";

import { useEffect, useRef } from "react";
import type * as PhaserTypes from "phaser";
import type { GameMode, PlayOutcome, SymbolPaytableEntry } from "@/api/types";
import { gameBus } from "@/game/events";

type GridSize = { rows: number; cols: number };
type FillMode = "replace" | "cascade" | "rodillo";

type Props = {
  play?: PlayOutcome;
  mode?: GameMode;
  symbolPaytable?: SymbolPaytableEntry[];
  previewSize?: GridSize;
  fillMode?: FillMode;
};

type PhaserModule = typeof import("phaser");

type BoardMetrics = {
  cellSize: number;
  gap: number;
  offsetY: number;
  padding: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
};

const DEFAULT_METRICS: BoardMetrics = {
  cellSize: 70,
  gap: 8,
  offsetY: 32,
  padding: 0,
  width: 640,
  height: 640,
  rows: 7,
  cols: 5,
};
const BONUS_TRIGGER_SYMBOL = "N";
const BONUS_HIGHLIGHT_LIMIT = 3;
const MATCH_CONTOUR_DURATION = 340;
const LEVEL_ONE_PREVIEW_SIZE = { rows: 3, cols: 5 };
const LEVEL_TWO_PREVIEW_SIZE = { rows: 7, cols: 5 };
const FALLBACK_STRIP_SYMBOLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"];

function pickBoardSize(play: PlayOutcome | undefined, mode?: GameMode, previewSize?: GridSize): GridSize {
  if (play?.grid0?.length && play.grid0[0]?.length) {
    return { rows: play.grid0.length, cols: play.grid0[0].length };
  }
  if (previewSize?.rows && previewSize?.cols) {
    return {
      rows: Math.max(1, Math.round(previewSize.rows)),
      cols: Math.max(1, Math.round(previewSize.cols)),
    };
  }
  if (mode === "nivel1") {
    return LEVEL_ONE_PREVIEW_SIZE;
  }
  return LEVEL_TWO_PREVIEW_SIZE;
}

function normalizeGrid(grid: string[][], rows: number, cols: number): string[][] {
  const safeGrid = Array.isArray(grid) ? grid : [];
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => safeGrid[r]?.[c] ?? ""),
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const safe = hex.replace("#", "");
  const parsed = safe.length === 3
    ? safe.split("").map((c) => c + c).join("")
    : safe.padEnd(6, "0");
  const num = parseInt(parsed, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function darkenColor({ r, g, b }: { r: number; g: number; b: number }, amount: number): number {
  const factor = 1 - amount;
  return (clampChannel(r * factor) << 16) | (clampChannel(g * factor) << 8) | clampChannel(b * factor);
}

function lightenColor({ r, g, b }: { r: number; g: number; b: number }, amount: number): number {
  return (
    (clampChannel(r + (255 - r) * amount) << 16) |
    (clampChannel(g + (255 - g) * amount) << 8) |
    clampChannel(b + (255 - b) * amount)
  );
}

function computeMetrics(
  play: PlayOutcome | undefined,
  containerWidth: number,
  containerHeight?: number,
  mode?: GameMode,
  previewSize?: GridSize,
): BoardMetrics {
  const size = pickBoardSize(play, mode, previewSize);
  const rows = Math.max(1, size.rows);
  const cols = Math.max(1, size.cols);

  const safeWidth = containerWidth > 0 ? containerWidth : DEFAULT_METRICS.width;
  const safeHeight = containerHeight && containerHeight > 0 ? containerHeight : DEFAULT_METRICS.height;
  const padding = safeWidth >= 640 ? 12 : 8;
  const gap = 2;
  const offsetY = 32;

  const usableByWidth = Math.max(120, safeWidth - padding * 2 - gap * (cols - 1));
  const usableByHeight = Math.max(120, safeHeight - offsetY - padding * 2 - gap * (rows - 1));
  const rawCellByWidth = cols > 0 ? usableByWidth / cols : DEFAULT_METRICS.cellSize;
  const rawCellByHeight = rows > 0 ? usableByHeight / rows : DEFAULT_METRICS.cellSize;
  const rawCell = Math.min(rawCellByWidth, rawCellByHeight);
  const cellSize = Math.min(72, Math.max(20, rawCell));

  const width = padding * 2 + cols * cellSize + gap * (cols - 1);
  const height = offsetY + rows * cellSize + gap * (rows - 1) + padding;

  return { cellSize, gap, offsetY, padding, width, height, rows, cols };
}

function createBoardScene(
  Phaser: PhaserModule,
  getMetrics: () => BoardMetrics,
  getInitialPlay: () => PlayOutcome | undefined,
  getPreviewMode: () => GameMode | undefined,
  getPreviewSize: () => GridSize | undefined,
  getFillMode: () => FillMode | undefined,
  getSymbolColor: (symbol: string) => string,
) {
  return class BoardScene extends Phaser.Scene {
    private cellMap = new Map<string, Phaser.GameObjects.Container>();
    private grid?: string[][];
    private boardSize = pickBoardSize(undefined, getPreviewMode(), getPreviewSize());
    private header?: Phaser.GameObjects.Text;
    private metrics: BoardMetrics = getMetrics();
    private currentPlay?: PlayOutcome;
    private accumulatedWin = 0;
    private lastPositions?: { offsetX: number; offsetY: number };

    constructor() {
      super("BoardScene");
    }

    create() {
      this.cameras.main.setBackgroundColor("#0b1224");
      this.header = this.add.text(12, 12, "Tablero listo", {
        fontFamily: "var(--font-geist-sans)",
        fontSize: "16px",
        color: "#e2e8f0",
      });

      this.events.on("render-play", (play: PlayOutcome) => {
        this.renderPlay(play);
      });
      this.events.on("clear-play", () => {
        this.clearBoard();
      });

      const initialPlay = getInitialPlay();
      if (initialPlay) {
        this.renderPlay(initialPlay);
      } else {
        this.clearBoard();
      }

      this.events.on("metrics-changed", (metrics: BoardMetrics) => {
        this.metrics = metrics;
        if (this.grid) {
          this.drawGrid(this.grid);
        }
      });
    }

    private clearBoard() {
      this.time.removeAllEvents();
      this.tweens.killAll();
      this.currentPlay = undefined;
      this.accumulatedWin = 0;
      const previewMode = getPreviewMode();
      const size = pickBoardSize(undefined, previewMode, getPreviewSize());
      this.boardSize = { rows: Math.max(1, size.rows), cols: Math.max(1, size.cols) };
      const emptyGrid = normalizeGrid([], this.boardSize.rows, this.boardSize.cols);
      this.grid = emptyGrid;
      this.header?.setText("Esperando ticket");
      this.drawGrid(emptyGrid);
    }

    private playBoardIntro(): number {
      const entries = Array.from(this.cellMap.entries())
        .map(([key, container]) => {
          const [row, col] = key.split("-").map((value) => Number(value));
          return { row, col, container };
        })
        .filter((entry) => Number.isFinite(entry.row) && Number.isFinite(entry.col));

      if (entries.length === 0) {
        return 0;
      }

      if (getFillMode() === "rodillo") {
        const colStartDelay = 320;
        const dropDuration = 280;
        const stopDelay = 220;
        const settleDuration = 260;
        const spinTickMs = 90;
        const rows = Math.max(1, this.boardSize.rows);
        const cols = Math.max(1, this.boardSize.cols);
        const cellPitch = this.metrics.cellSize + this.metrics.gap;
        const lift = Math.max(cellPitch * 0.45, this.metrics.cellSize * 0.7);
        const minTurnsLastColumn = 2;
        const requiredLastColumnSteps = rows * minTurnsLastColumn;
        const symbolPool = Array.from(
          new Set(
            (this.grid ?? [])
              .flat()
              .map((symbol) => String(symbol || "").trim().toUpperCase())
              .filter(Boolean),
          ),
        );
        const reelSymbols = symbolPool.length > 0 ? symbolPool : FALLBACK_STRIP_SYMBOLS;
        const buildStrip = () => {
          const size = Math.max(28, reelSymbols.length * 4);
          return Array.from({ length: size }, () => reelSymbols[Math.floor(Math.random() * reelSymbols.length)] ?? "A");
        };

        const columnStates = Array.from({ length: cols }, (_, col) => {
          const strip = buildStrip();
          const startIndex = Math.floor(Math.random() * strip.length);
          const cells = entries
            .filter((entry) => entry.col === col)
            .sort((a, b) => a.row - b.row)
            .map((entry) => ({
              row: entry.row,
              container: entry.container,
              targetY: entry.container.y,
            }));
          return {
            col,
            cells,
            strip,
            stripCursor: startIndex + rows,
            spinning: false,
          };
        });

        columnStates.forEach((state) => {
          state.cells.forEach((cell, rowIdx) => {
            cell.container.setAlpha(0);
            cell.container.setScale(1);
            cell.container.setY(cell.targetY - lift);
            const symbol = state.strip[(state.stripCursor + rowIdx) % state.strip.length] ?? "A";
            this.updateCellContainerSymbol(cell.container, symbol);
          });
        });

        let lastColumnSpinSteps = 0;
        let stopSequenceScheduled = false;

        const scheduleStopSequence = () => {
          if (stopSequenceScheduled) return;
          stopSequenceScheduled = true;
          for (let col = 0; col < cols; col += 1) {
            this.time.delayedCall(col * stopDelay, () => {
              const state = columnStates[col];
              if (!state) return;
              state.spinning = false;
              state.cells.forEach((cell) => {
                const finalSymbol = this.grid?.[cell.row]?.[col] ?? String(cell.container.getData("symbol") ?? "");
                this.updateCellContainerSymbol(cell.container, finalSymbol);
                this.tweens.add({
                  targets: cell.container,
                  y: cell.targetY,
                  alpha: 1,
                  duration: settleDuration,
                  ease: "Cubic.easeOut",
                });
              });
              if (col === cols - 1) {
                this.time.delayedCall(settleDuration + 40, () => {
                  spinTimer.remove(false);
                });
              }
            });
          }
        };

        const spinTimer = this.time.addEvent({
          delay: spinTickMs,
          loop: true,
          callback: () => {
            columnStates.forEach((state) => {
              if (!state.spinning) return;
              state.stripCursor += 1;
              state.cells.forEach((cell, rowIdx) => {
                const symbol = state.strip[(state.stripCursor + rowIdx) % state.strip.length] ?? "A";
                this.updateCellContainerSymbol(cell.container, symbol);
                const offset = state.stripCursor % 2 === 0 ? -2 : 2;
                cell.container.setY(cell.targetY + offset);
              });
              if (state.col === cols - 1 && !stopSequenceScheduled) {
                lastColumnSpinSteps += 1;
                if (lastColumnSpinSteps >= requiredLastColumnSteps) {
                  scheduleStopSequence();
                }
              }
            });
          },
        });

        const dropColumn = (col: number) => {
          const state = columnStates[col];
          if (!state || state.cells.length === 0) return;
          let completed = 0;
          state.cells.forEach((cell) => {
            this.tweens.add({
              targets: cell.container,
              y: cell.targetY,
              alpha: 1,
              duration: dropDuration,
              delay: 0,
              ease: "Cubic.easeOut",
              onComplete: () => {
                completed += 1;
                if (completed === state.cells.length) {
                  state.spinning = true;
                }
              },
            });
          });
        };

        for (let col = 0; col < cols; col += 1) {
          this.time.delayedCall(col * colStartDelay, () => dropColumn(col));
        }

        const dropPhase =
          (cols - 1) * colStartDelay +
          dropDuration;
        const stopPhase =
          requiredLastColumnSteps * spinTickMs +
          Math.max(0, cols - 1) * stopDelay +
          settleDuration;
        return dropPhase + stopPhase;
      }

      if (getFillMode() === "cascade") {
        const colDelay = 120;
        const dropDuration = 380;
        const rows = Math.max(1, this.boardSize.rows);
        const cols = Math.max(1, this.boardSize.cols);
        const cellPitch = this.metrics.cellSize + this.metrics.gap;
        const lift = Math.max(cellPitch * (rows + 0.4), this.metrics.cellSize * 2.4);

        const byColumn = Array.from({ length: cols }, (_, col) =>
          entries
            .filter((entry) => entry.col === col)
            .sort((a, b) => a.row - b.row),
        );

        byColumn.forEach((columnEntries, col) => {
          columnEntries.forEach((entry) => {
            const targetY = entry.container.y;
            entry.container.setAlpha(0);
            entry.container.setY(targetY - lift);
            this.tweens.add({
              targets: entry.container,
              y: targetY,
              alpha: 1,
              duration: dropDuration,
              delay: col * colDelay,
              ease: "Cubic.easeOut",
            });
          });
        });

        return (cols - 1) * colDelay + dropDuration;
      }

      const ordered = entries
        .sort((a, b) => {
          if (a.row !== b.row) return a.row - b.row;
          return a.col - b.col;
        })
        .map((entry) => entry.container);

      const stepDelay = 40;
      const duration = 260;

      ordered.forEach((container, idx) => {
        container.setAlpha(0);
        container.setScale(0.82);
        this.tweens.add({
          targets: container,
          alpha: 1,
          scale: 1,
          duration,
          delay: idx * stepDelay,
          ease: "Back.easeOut",
        });
      });

      return duration + (ordered.length - 1) * stepDelay;
    }

    private getBoardOffsets() {
      const { cellSize, gap, offsetY } = this.metrics;
      const rows = this.boardSize.rows;
      const cols = this.boardSize.cols;
      const totalGridWidth = cols * cellSize + (cols - 1) * gap;
      const totalGridHeight = rows * cellSize + (rows - 1) * gap;
      const canvasWidth = this.scale?.width ?? this.metrics.width;
      const canvasHeight = this.scale?.height ?? this.metrics.height;
      const offsetX = Math.round((canvasWidth - totalGridWidth) / 2);
      const centeredY = Math.round((canvasHeight - totalGridHeight) / 2);
      const finalOffsetY = Math.max(centeredY, offsetY);
      this.lastPositions = { offsetX, offsetY: finalOffsetY };
      return this.lastPositions;
    }

    private getCellPosition(row: number, col: number) {
      const { cellSize, gap } = this.metrics;
      const offsets = this.lastPositions ?? this.getBoardOffsets();
      const x = offsets.offsetX + col * (cellSize + gap);
      const y = offsets.offsetY + row * (cellSize + gap);
      return { x, y };
    }

    private createCellContainer(symbol: string, x: number, y: number) {
      const { cellSize } = this.metrics;
      const symbolColor = symbol ? getSymbolColor(symbol) : "#64748b";
      const symbolRgb = hexToRgb(symbolColor);
      const metallic = Boolean(this.currentPlay);
      const baseFill = metallic ? darkenColor(symbolRgb, 0.64) : darkenColor(symbolRgb, 0.74);
      const glowFill = metallic ? lightenColor(symbolRgb, 0.24) : darkenColor(symbolRgb, 0.55);
      const highlightFill = metallic ? lightenColor(symbolRgb, 0.36) : lightenColor(symbolRgb, 0.2);
      const shadeFill = metallic ? darkenColor(symbolRgb, 0.82) : darkenColor(symbolRgb, 0.76);

      const rect = this.add.rectangle(0, 0, cellSize, cellSize, baseFill, 0.95);
      rect.setStrokeStyle(2, glowFill, 0.9);
      rect.setOrigin(0);

      const highlight = this.add.rectangle(
        2,
        2,
        cellSize - 4,
        Math.max(12, cellSize * 0.38),
        highlightFill,
        metallic ? 0.42 : 0.35
      );
      highlight.setOrigin(0);

      const shade = this.add.rectangle(
        2,
        cellSize * 0.54,
        cellSize - 4,
        Math.max(10, cellSize * 0.44),
        shadeFill,
        metallic ? 0.24 : 0.12
      );
      shade.setOrigin(0, 0);

      const labelFontSize = `12px`;
      const label = this.add.text(cellSize / 2, cellSize / 2, symbol, {
        fontFamily: "var(--font-geist-sans)",
        fontSize: labelFontSize,
        color: metallic ? "#ffffff" : "#f8fafc",
      });
      label.setOrigin(0.5);

      const container = this.add.container(x, y, [rect, highlight, shade, label]);
      container.setData("symbol", symbol);
      return container;
    }

    private updateCellContainerSymbol(container: Phaser.GameObjects.Container, symbol: string) {
      const safeSymbol = (symbol || "").trim().toUpperCase();
      const symbolColor = safeSymbol ? getSymbolColor(safeSymbol) : "#64748b";
      const symbolRgb = hexToRgb(symbolColor);
      const metallic = Boolean(this.currentPlay);
      const baseFill = metallic ? darkenColor(symbolRgb, 0.64) : darkenColor(symbolRgb, 0.74);
      const glowFill = metallic ? lightenColor(symbolRgb, 0.24) : darkenColor(symbolRgb, 0.55);
      const highlightFill = metallic ? lightenColor(symbolRgb, 0.36) : lightenColor(symbolRgb, 0.2);
      const shadeFill = metallic ? darkenColor(symbolRgb, 0.82) : darkenColor(symbolRgb, 0.76);

      const rect = container.list[0] as Phaser.GameObjects.Rectangle | undefined;
      const highlight = container.list[1] as Phaser.GameObjects.Rectangle | undefined;
      const shade = container.list[2] as Phaser.GameObjects.Rectangle | undefined;
      const label = container.list[3] as Phaser.GameObjects.Text | undefined;

      if (rect) {
        rect.setFillStyle(baseFill, 0.95);
        rect.setStrokeStyle(2, glowFill, 0.9);
      }
      if (highlight) {
        highlight.setFillStyle(highlightFill, metallic ? 0.42 : 0.35);
      }
      if (shade) {
        shade.setFillStyle(shadeFill, metallic ? 0.24 : 0.12);
      }
      if (label) {
        label.setText(safeSymbol);
        label.setColor(metallic ? "#ffffff" : "#f8fafc");
      }
      container.setData("symbol", safeSymbol);
    }

    private playBonusTriggerHighlight(
      triggerCount: number,
      triggerCells: Array<{ row: number; col: number }> | undefined,
      onComplete: () => void,
    ) {
      if (!this.grid) {
        onComplete();
        return;
      }

      const requestedCount = Math.max(1, Math.min(BONUS_HIGHLIGHT_LIMIT, triggerCount || BONUS_HIGHLIGHT_LIMIT));
      const explicitTargets: { row: number; col: number }[] = [];
      const explicitKeys = new Set<string>();
      (triggerCells ?? []).forEach((cell) => {
        if (cell.row < 0 || cell.col < 0) return;
        if (cell.row >= this.boardSize.rows || cell.col >= this.boardSize.cols) return;
        if (this.grid?.[cell.row]?.[cell.col] !== BONUS_TRIGGER_SYMBOL) return;
        const key = `${cell.row}-${cell.col}`;
        if (explicitKeys.has(key)) return;
        explicitKeys.add(key);
        explicitTargets.push({ row: cell.row, col: cell.col });
      });

      let highlightTargets = explicitTargets.slice(0, requestedCount);
      if (highlightTargets.length === 0) {
        const fallbackTargets: { row: number; col: number }[] = [];
        for (let row = 0; row < this.boardSize.rows; row += 1) {
          for (let col = 0; col < this.boardSize.cols; col += 1) {
            if (this.grid[row]?.[col] === BONUS_TRIGGER_SYMBOL) {
              fallbackTargets.push({ row, col });
            }
          }
        }
        highlightTargets = fallbackTargets.slice(0, Math.min(requestedCount, fallbackTargets.length));
      }

      if (highlightTargets.length === 0) {
        onComplete();
        return;
      }

      const { cellSize } = this.metrics;

      highlightTargets.forEach((cell, idx) => {
        const key = `${cell.row}-${cell.col}`;
        const container = this.cellMap.get(key);
        if (!container) return;

        const symbol = this.grid?.[cell.row]?.[cell.col] ?? container.getData("symbol") ?? BONUS_TRIGGER_SYMBOL;
        const symbolRgb = hexToRgb(getSymbolColor(symbol));
        const glowStroke = lightenColor(symbolRgb, 0.7);
        const baseStroke = darkenColor(symbolRgb, 0.55);
        const delay = idx * 120;

        const rect = container.list[0] as Phaser.GameObjects.Rectangle | undefined;
        const highlight = container.list[1] as Phaser.GameObjects.Rectangle | undefined;
        const shade = container.list[2] as Phaser.GameObjects.Rectangle | undefined;
        const label = container.list[3] as Phaser.GameObjects.Text | undefined;
        if (rect) {
          rect.setStrokeStyle(4, glowStroke, 1);
          rect.setFillStyle(lightenColor(symbolRgb, 0.15), 0.98);
        }
        if (highlight) {
          highlight.setFillStyle(lightenColor(symbolRgb, 0.4), 0.65);
        }
        if (shade) {
          shade.setFillStyle(darkenColor(symbolRgb, 0.7), 0.2);
        }
        if (label) {
          label.setColor("#fffdea");
          label.setShadow(0, 0, "#fef08a", 16, true, true);
          this.tweens.add({
            targets: label,
            scale: 1.35,
            duration: 180,
            delay,
            yoyo: true,
            repeat: 4,
            ease: "Sine.easeInOut",
          });
        }

        this.tweens.add({
          targets: container,
          scale: 1.08,
          duration: 180,
          delay,
          yoyo: true,
          repeat: 4,
          ease: "Sine.easeInOut",
        });

        const { x, y } = this.getCellPosition(cell.row, cell.col);
        const badgeWidth = Math.max(30, Math.round(cellSize * 0.54));
        const badgeHeight = Math.max(14, Math.round(cellSize * 0.24));
        const badgeX = x + cellSize - badgeWidth / 2 - 2;
        const badgeY = y + badgeHeight / 2 + 2;
        const badgeBg = this.add.rectangle(0, 0, badgeWidth, badgeHeight, 0xfde047, 0.95);
        badgeBg.setStrokeStyle(2, 0xfff7d6, 0.95);
        badgeBg.setBlendMode(Phaser.BlendModes.ADD);
        const badgeText = this.add.text(0, 0, "BONUS", {
          fontFamily: "var(--font-geist-sans)",
          fontSize: `${Math.max(9, Math.round(cellSize * 0.13))}px`,
          color: "#062330",
          fontStyle: "700",
        });
        badgeText.setOrigin(0.5);
        badgeText.setShadow(0, 0, "#fef08a", 8, true, true);
        const badge = this.add.container(badgeX, badgeY, [badgeBg, badgeText]);
        badge.setDepth(1210);
        badge.setAlpha(0);
        badge.setScale(0.85);

        this.tweens.add({
          targets: badge,
          alpha: 1,
          scale: 1,
          duration: 150,
          delay,
          ease: "Back.easeOut",
        });
        this.tweens.add({
          targets: badge,
          y: badgeY - 2,
          duration: 180,
          delay: delay + 150,
          yoyo: true,
          repeat: 4,
          ease: "Sine.easeInOut",
        });

        const ring = this.add.rectangle(x + cellSize / 2, y + cellSize / 2, cellSize + 10, cellSize + 10);
        ring.setStrokeStyle(3, glowStroke, 0.95);
        ring.setFillStyle(glowStroke, 0.06);
        ring.setBlendMode(Phaser.BlendModes.ADD);
        ring.setDepth(1200);
        this.tweens.add({
          targets: ring,
          alpha: 0.18,
          scaleX: 1.2,
          scaleY: 1.2,
          duration: 180,
          delay,
          yoyo: true,
          repeat: 4,
          ease: "Sine.easeInOut",
          onComplete: () => ring.destroy(),
        });

        const outerRing = this.add.rectangle(x + cellSize / 2, y + cellSize / 2, cellSize + 22, cellSize + 22);
        outerRing.setStrokeStyle(2, glowStroke, 0.75);
        outerRing.setFillStyle(0x000000, 0);
        outerRing.setBlendMode(Phaser.BlendModes.ADD);
        outerRing.setDepth(1190);
        this.tweens.add({
          targets: outerRing,
          alpha: 0,
          scaleX: 1.45,
          scaleY: 1.45,
          duration: 580,
          delay,
          ease: "Cubic.easeOut",
          onComplete: () => outerRing.destroy(),
        });

        this.time.delayedCall(1200 + delay, () => {
          if (rect?.active) {
            rect.setStrokeStyle(2, baseStroke, 0.9);
            rect.setFillStyle(darkenColor(symbolRgb, 0.7), 0.95);
          }
          if (highlight?.active) {
            highlight.setFillStyle(lightenColor(symbolRgb, 0.2), 0.35);
          }
          if (shade?.active) {
            shade.setFillStyle(0x111827, 0.28);
          }
          if (label?.active) {
            label.setColor("#f8fafc");
            label.setShadow(0, 0, "#000000", 0, false, false);
            label.setScale(1);
          }
          if (container.active) {
            container.setScale(1);
          }
          if (badge.active) {
            this.tweens.add({
              targets: badge,
              alpha: 0,
              scale: 0.92,
              duration: 140,
              ease: "Cubic.easeInOut",
              onComplete: () => badge.destroy(),
            });
          }
        });
      });

      const totalDuration = 1280 + Math.max(0, highlightTargets.length - 1) * 120;
      this.time.delayedCall(totalDuration, onComplete);
    }

    private playExplosion(row: number, col: number, symbol: string) {
      const { cellSize } = this.metrics;
      const { x, y } = this.getCellPosition(row, col);
      const centerX = x + cellSize / 2;
      const centerY = y + cellSize / 2;
      const symbolColor = getSymbolColor(symbol || "A");
      const symbolRgb = hexToRgb(symbolColor);
      const flashColor = lightenColor(symbolRgb, 0.55);
      const sparkColor = lightenColor(symbolRgb, 0.35);

      const flash = this.add.circle(centerX, centerY, Math.max(10, cellSize * 0.2), flashColor, 0.9);
      flash.setBlendMode(Phaser.BlendModes.ADD);
      flash.setDepth(1000);
      this.tweens.add({
        targets: flash,
        scale: 2.4,
        alpha: 0,
        duration: 280,
        ease: "Cubic.easeOut",
        onComplete: () => flash.destroy(),
      });

      const sparks = Array.from({ length: 16 }).map((_, idx) => {
        const angle = (Math.PI * 2 * idx) / 16;
        const spark = this.add.circle(centerX, centerY, Math.max(3, cellSize * 0.06), sparkColor, 0.98);
        spark.setBlendMode(Phaser.BlendModes.ADD);
        spark.setDepth(1001);
        const distance = cellSize * (0.3 + Math.random() * 0.35);
        const targetX = centerX + Math.cos(angle) * distance;
        const targetY = centerY + Math.sin(angle) * distance;
        this.tweens.add({
          targets: spark,
          x: targetX,
          y: targetY,
          alpha: 0,
          scale: 0.35,
          duration: 320 + Math.floor(Math.random() * 120),
          ease: "Cubic.easeOut",
          onComplete: () => spark.destroy(),
        });
        return spark;
      });

      const ring = this.add.circle(centerX, centerY, Math.max(8, cellSize * 0.14), flashColor, 0.22);
      ring.setStrokeStyle(Math.max(2, cellSize * 0.04), flashColor, 0.7);
      ring.setDepth(1000);
      this.tweens.add({
        targets: ring,
        scale: 2.6,
        alpha: 0,
        duration: 360,
        ease: "Cubic.easeOut",
        onComplete: () => ring.destroy(),
      });

      this.time.delayedCall(600, () => {
        sparks.forEach((spark) => {
          if (spark.active) {
            spark.destroy();
          }
        });
        if (ring.active) {
          ring.destroy();
        }
      });
    }

    private playMatchContour(cells: Array<{ row: number; col: number }>, symbol: string): number {
      if (cells.length === 0) {
        return 0;
      }

      const { cellSize, gap } = this.metrics;
      const pad = gap / 2;
      const cellSet = new Set(cells.map((cell) => `${cell.row}-${cell.col}`));
      const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

      cells.forEach((cell) => {
        const { x, y } = this.getCellPosition(cell.row, cell.col);
        const left = x - pad;
        const right = x + cellSize + pad;
        const top = y - pad;
        const bottom = y + cellSize + pad;

        if (!cellSet.has(`${cell.row - 1}-${cell.col}`)) {
          segments.push({ x1: left, y1: top, x2: right, y2: top });
        }
        if (!cellSet.has(`${cell.row + 1}-${cell.col}`)) {
          segments.push({ x1: left, y1: bottom, x2: right, y2: bottom });
        }
        if (!cellSet.has(`${cell.row}-${cell.col - 1}`)) {
          segments.push({ x1: left, y1: top, x2: left, y2: bottom });
        }
        if (!cellSet.has(`${cell.row}-${cell.col + 1}`)) {
          segments.push({ x1: right, y1: top, x2: right, y2: bottom });
        }
      });

      if (segments.length === 0) {
        return 0;
      }

      const symbolRgb = hexToRgb(getSymbolColor(symbol || "A"));
      const glowColor = lightenColor(symbolRgb, 0.72);
      const coreColor = lightenColor(symbolRgb, 0.9);

      const glow = this.add.graphics();
      glow.setDepth(1110);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      glow.lineStyle(Math.max(5, cellSize * 0.16), glowColor, 0.32);
      segments.forEach((segment) => {
        glow.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
      });
      glow.setAlpha(0);

      const stroke = this.add.graphics();
      stroke.setDepth(1111);
      stroke.lineStyle(Math.max(2, cellSize * 0.06), coreColor, 0.95);
      segments.forEach((segment) => {
        stroke.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
      });
      stroke.setAlpha(0);

      this.tweens.add({
        targets: [glow, stroke],
        alpha: 1,
        duration: 120,
        yoyo: true,
        repeat: 2,
        ease: "Sine.easeInOut",
      });

      this.tweens.add({
        targets: [glow, stroke],
        scale: 1.02,
        duration: 140,
        yoyo: true,
        repeat: 2,
        ease: "Sine.easeInOut",
      });

      this.time.delayedCall(MATCH_CONTOUR_DURATION, () => {
        glow.destroy();
        stroke.destroy();
      });

      return MATCH_CONTOUR_DURATION;
    }

    renderPlay(play: PlayOutcome) {
      this.time.removeAllEvents();
      this.tweens.killAll();
      this.currentPlay = play;
      this.accumulatedWin = 0;
      const size = pickBoardSize(play, getPreviewMode(), getPreviewSize());
      this.boardSize = {
        rows: Math.max(1, size.rows),
        cols: Math.max(1, size.cols),
      };
      this.grid = normalizeGrid(play.grid0, this.boardSize.rows, this.boardSize.cols);
      this.header?.setText(`Play ${play.playId} - ${play.mode.toUpperCase()} - Win 0`);
      this.drawGrid(this.grid);
      const introDuration = this.playBoardIntro();

      const initialDelay = Math.max(320, introDuration + 120);
      const runStep = (idx: number) => {
        if (!this.grid) {
          return;
        }
        if (idx >= play.cascades.length) {
          gameBus.emit("game:cascade:completed", { playId: play.playId, totalSteps: play.cascades.length });
          return;
        }
        this.animateStep(play.cascades[idx], idx, play.cascades.length, () => {
          this.time.delayedCall(250, () => runStep(idx + 1));
        });
      };
      this.time.delayedCall(initialDelay, () => runStep(0));
    }

    private animateStep(
      step: PlayOutcome["cascades"][number],
      stepIndex: number,
      totalSteps: number,
      onComplete: () => void,
    ) {
      if (!this.grid) {
        onComplete();
        return;
      }

      const removeSet = new Set(step.removeCells.map((cell) => `${cell.row}-${cell.col}`));
      const stepWin = step.winStep ?? 0;
      const removalDuration = 520;

      if (this.currentPlay?.playId) {
        gameBus.emit("game:cascade:step", {
          playId: this.currentPlay.playId,
          stepIndex: stepIndex + 1,
          totalSteps,
        });
      }

      if (step.bonus) {
        const triggerCount = Math.max(1, Math.min(BONUS_HIGHLIGHT_LIMIT, step.bonusData?.triggerCount ?? BONUS_HIGHLIGHT_LIMIT));
        this.playBonusTriggerHighlight(triggerCount, step.bonusData?.triggerCells, () => {
          if (this.currentPlay?.playId) {
            gameBus.emit("game:bonus:triggered", {
              playId: this.currentPlay.playId,
              bonusData: step.bonusData,
            });
          }
          onComplete();
        });
        return;
      }

      const firstRemovedCell = step.removeCells[0];
      const matchSymbol = firstRemovedCell ? this.grid?.[firstRemovedCell.row]?.[firstRemovedCell.col] ?? "" : "";
      const contourDelay = this.playMatchContour(step.removeCells, matchSymbol);

      const startRemoval = () => {
        step.removeCells.forEach((cell) => {
          const sprite = this.cellMap.get(`${cell.row}-${cell.col}`);
          const symbol = this.grid?.[cell.row]?.[cell.col] ?? "";
          this.playExplosion(cell.row, cell.col, symbol);
          if (sprite) {
            this.tweens.add({
              targets: sprite,
              scale: 0.6,
              alpha: 0,
              duration: removalDuration,
              ease: "Cubic.easeIn",
            });
          }
        });

        if (this.currentPlay?.playId && stepWin > 0) {
          this.accumulatedWin += stepWin;
          gameBus.emit("game:win:increment", { playId: this.currentPlay.playId, amount: stepWin });
          this.header?.setText(
            `Play ${this.currentPlay?.playId ?? ""} - Paso ${stepIndex + 1}/${totalSteps} - Win ${this.accumulatedWin}`,
          );
        }

        const applyDelay = removalDuration + 160;

        this.time.delayedCall(applyDelay, () => {
          if (!this.grid) {
            onComplete();
            return;
          }
          const rows = this.boardSize.rows;
          const cols = this.boardSize.cols;
          const nextGrid = step.gridAfter ?? this.grid;
          this.grid = normalizeGrid(nextGrid, rows, cols);
          this.getBoardOffsets();

          const useReplaceAnimation = getFillMode() === "replace";
          if (useReplaceAnimation) {
            const newMap = new Map<string, Phaser.GameObjects.Container>();
            const appearDuration = 280;

            for (let row = 0; row < rows; row += 1) {
              for (let col = 0; col < cols; col += 1) {
                const key = `${row}-${col}`;
                const existing = this.cellMap.get(key);
                const { x, y } = this.getCellPosition(row, col);

                if (!removeSet.has(key) && existing) {
                  existing.setPosition(x, y);
                  existing.setScale(1);
                  existing.setAlpha(1);
                  existing.setData("row", row);
                  existing.setData("col", col);
                  newMap.set(key, existing);
                  continue;
                }

                const container = this.createCellContainer(this.grid[row][col], x, y);
                container.setAlpha(0);
                container.setScale(0.85);
                container.setData("row", row);
                container.setData("col", col);
                newMap.set(key, container);

                this.tweens.add({
                  targets: container,
                  alpha: 1,
                  scale: 1,
                  duration: appearDuration,
                  ease: "Cubic.easeOut",
                });
              }
            }

            this.cellMap.forEach((container, key) => {
              if (newMap.get(key) !== container) {
                container.destroy();
              }
            });
            this.cellMap.clear();
            newMap.forEach((value, key) => this.cellMap.set(key, value));

            if (stepWin === 0) {
              this.header?.setText(
                `Play ${this.currentPlay?.playId ?? ""} - Paso ${stepIndex + 1}/${totalSteps} - Win ${this.accumulatedWin}`,
              );
            }
            this.time.delayedCall(appearDuration + 120, onComplete);
            return;
          }

          const dropDistance = this.metrics.cellSize * (rows + 1);
          const newMap = new Map<string, Phaser.GameObjects.Container>();
          const dropDuration = 480;

          for (let col = 0; col < cols; col += 1) {
            const survivors: Phaser.GameObjects.Container[] = [];
            for (let row = rows - 1; row >= 0; row -= 1) {
              const key = `${row}-${col}`;
              if (removeSet.has(key)) continue;
              const container = this.cellMap.get(key);
              if (container) {
                survivors.push(container);
              }
            }

            let writeRow = rows - 1;
            survivors.forEach((container) => {
              const targetRow = writeRow;
              writeRow -= 1;
              const { x, y } = this.getCellPosition(targetRow, col);
              const prevRow = container.getData("row");
              const prevCol = container.getData("col");
              container.setData("row", targetRow);
              container.setData("col", col);
              newMap.set(`${targetRow}-${col}`, container);
              if (prevRow !== targetRow || prevCol !== col) {
                this.tweens.add({
                  targets: container,
                  x,
                  y,
                  duration: dropDuration,
                  ease: "Cubic.easeOut",
                });
              }
            });

            const dropSymbols = step.dropIn.find((d) => d.col === col)?.symbols ?? [];
            for (let i = dropSymbols.length - 1; i >= 0; i -= 1) {
              const symbol = dropSymbols[i];
              const targetRow = writeRow;
              writeRow -= 1;
              const { x, y } = this.getCellPosition(targetRow, col);
              const startY = y - dropDistance;
              const container = this.createCellContainer(symbol, x, startY);
              container.setAlpha(0);
              container.setData("row", targetRow);
              container.setData("col", col);
              newMap.set(`${targetRow}-${col}`, container);
              this.tweens.add({
                targets: container,
                y,
                alpha: 1,
                duration: dropDuration,
                ease: "Cubic.easeOut",
              });
            }
          }

          this.cellMap.forEach((container, key) => {
            if (removeSet.has(key)) {
              container.destroy();
            }
          });
          this.cellMap.clear();
          newMap.forEach((value, key) => this.cellMap.set(key, value));

          if (stepWin === 0) {
            this.header?.setText(
              `Play ${this.currentPlay?.playId ?? ""} - Paso ${stepIndex + 1}/${totalSteps} - Win ${this.accumulatedWin}`,
            );
          }
          this.time.delayedCall(dropDuration + 120, onComplete);
        });
      };

      if (contourDelay > 0) {
        this.time.delayedCall(contourDelay, startRemoval);
      } else {
        startRemoval();
      }
    }

    private drawGrid(grid: string[][]) {
      this.cellMap.forEach((cell) => cell.destroy());
      this.cellMap.clear();

      const rows = Math.max(1, this.boardSize.rows);
      const cols = Math.max(1, this.boardSize.cols);
      this.grid = normalizeGrid(grid, rows, cols);
      this.boardSize = { rows, cols };

      const { cellSize } = this.metrics;
      const offsets = this.getBoardOffsets();

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = offsets.offsetX + col * (cellSize + this.metrics.gap);
          const y = offsets.offsetY + row * (cellSize + this.metrics.gap);
          const container = this.createCellContainer(grid[row][col], x, y);
          container.setData("row", row);
          container.setData("col", col);
          this.cellMap.set(`${row}-${col}`, container);
        }
      }
    }
  };
}

export function PhaserBoard({ play, mode, symbolPaytable, previewSize, fillMode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<PhaserTypes.Game | null>(null);
  const phaserRef = useRef<PhaserModule | null>(null);
  const metricsRef = useRef<BoardMetrics>(DEFAULT_METRICS);
  const containerWidthRef = useRef<number>(DEFAULT_METRICS.width);
  const playRef = useRef<PlayOutcome | undefined>(undefined);
  const modeRef = useRef<GameMode | undefined>(mode);
  const previewSizeRef = useRef<GridSize | undefined>(previewSize);
  const fillModeRef = useRef<FillMode | undefined>(fillMode);
  const symbolColorRef = useRef<Map<string, string>>(new Map());
  const currentSize = pickBoardSize(play, mode, previewSize);
  const aspectRatio = Math.max(0.5, currentSize.cols / Math.max(1, currentSize.rows));

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    previewSizeRef.current = previewSize;
  }, [previewSize?.rows, previewSize?.cols]);

  useEffect(() => {
    fillModeRef.current = fillMode;
  }, [fillMode]);

  useEffect(() => {
    const map = new Map<string, string>();
    (symbolPaytable ?? []).forEach((entry) => {
      if (entry?.symbol && entry?.color) {
        map.set(entry.symbol, entry.color);
      }
    });
    symbolColorRef.current = map;
  }, [symbolPaytable]);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current || gameRef.current) {
      return;
    }

    let canceled = false;

    const resizeMetrics = () => {
      if (!containerRef.current || !gameRef.current) return;
      containerWidthRef.current = containerRef.current.clientWidth || DEFAULT_METRICS.width;
      metricsRef.current = computeMetrics(
        playRef.current,
        containerWidthRef.current,
        containerRef.current?.clientHeight || DEFAULT_METRICS.height,
        modeRef.current,
        previewSizeRef.current,
      );
      gameRef.current.scale.resize(metricsRef.current.width, metricsRef.current.height);
      const scene = gameRef.current.scene.getScene("BoardScene");
      if (scene?.events) {
        scene.events.emit("metrics-changed", metricsRef.current);
      }
      containerRef.current.style.minHeight = `${metricsRef.current.height + 20}px`;
    };

    (async () => {
      const Phaser = await import("phaser");
      if (canceled || !containerRef.current) return;
      phaserRef.current = Phaser;
      containerWidthRef.current = containerRef.current.clientWidth || DEFAULT_METRICS.width;
      metricsRef.current = computeMetrics(
        playRef.current,
        containerWidthRef.current,
        containerRef.current?.clientHeight || DEFAULT_METRICS.height,
        modeRef.current,
        previewSizeRef.current,
      );
      const BoardScene = createBoardScene(
        Phaser,
        () => metricsRef.current,
        () => playRef.current,
        () => modeRef.current,
        () => previewSizeRef.current,
        () => fillModeRef.current,
        (symbol) => symbolColorRef.current.get(symbol) ?? "#e2e8f0",
      );

      gameRef.current = new Phaser.Game({
        type: Phaser.AUTO,
        scale: {
          mode: Phaser.Scale.NONE,
          width: metricsRef.current.width,
          height: metricsRef.current.height,
        },
        parent: containerRef.current,
        backgroundColor: "#0b1224",
        scene: new BoardScene(),
      });

      resizeMetrics();
      window.addEventListener("resize", resizeMetrics);

      const canvas = gameRef.current.canvas;
      canvas.style.width = `${metricsRef.current.width}px`;
      canvas.style.height = `${metricsRef.current.height}px`;
      canvas.style.maxWidth = "100%";
      canvas.style.margin = "0 auto";
      containerRef.current.style.minHeight = `${metricsRef.current.height + 20}px`;

      if (playRef.current) {
        metricsRef.current = computeMetrics(
          playRef.current,
          containerWidthRef.current,
          containerRef.current?.clientHeight || DEFAULT_METRICS.height,
          modeRef.current,
          previewSizeRef.current,
        );
        gameRef.current.scale.resize(metricsRef.current.width, metricsRef.current.height);
        const scene = gameRef.current.scene.getScene("BoardScene");
        if (scene?.events) {
          scene.events.emit("metrics-changed", metricsRef.current);
          scene.events.emit("render-play", playRef.current);
        }
        containerRef.current.style.minHeight = `${metricsRef.current.height + 20}px`;
      }
    })();

    return () => {
      canceled = true;
      window.removeEventListener("resize", resizeMetrics);
      gameRef.current?.destroy(true);
      gameRef.current = null;
      phaserRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !gameRef.current) {
      return;
    }
    containerWidthRef.current = containerRef.current.clientWidth || DEFAULT_METRICS.width;
    metricsRef.current = computeMetrics(
      play,
      containerWidthRef.current,
      containerRef.current?.clientHeight || DEFAULT_METRICS.height,
      mode,
      previewSize,
    );
    gameRef.current.scale.resize(metricsRef.current.width, metricsRef.current.height);
    const scene = gameRef.current.scene.getScene("BoardScene");
    if (scene?.events) {
      scene.events.emit("metrics-changed", metricsRef.current);
      if (play) {
        scene.events.emit("render-play", play);
      } else {
        scene.events.emit("clear-play");
      }
    }
    const canvas = gameRef.current.canvas;
    canvas.style.width = `${metricsRef.current.width}px`;
    canvas.style.height = `${metricsRef.current.height}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.margin = "0 auto";
    containerRef.current.style.minHeight = `${metricsRef.current.height + 20}px`;
  }, [fillMode, mode, play, previewSize?.rows, previewSize?.cols]);

  return <div ref={containerRef} style={{ width: "100%", aspectRatio: String(aspectRatio) }} />;
}
