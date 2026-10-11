/**
 * Статичный план комнаты, вписанный в width×height: для печати и превью.
 * Без интерактива; размеры — архитектурные размерные линии снаружи стен,
 * плинтус — линия с засечками на концах. Цвета — через CSS-переменные,
 * при печати (и в .print-only/.print-preview) — чёрно-белая палитра.
 */
import { useId, useMemo } from "react";
import { getWalls } from "../domain/geometry";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import { resolveProduct } from "../domain/skirtingCatalog";
import type { Room, Vec2, Wall } from "../domain/types";
import { formatLength } from "../domain/units";
import { useAppStore } from "../state/store";
import { onWall, r, roomBounds, skirtingLines, uprightAngle, wallCuts, wallDimLines, wallPieces } from "./geom";
import { HatchPattern, RoomShapes } from "./Shapes";
import "./plan.css";

export interface PlanSvgProps {
  room: Room;
  result?: RoomSkirtingResult;
  width: number;
  height: number;
  showDims?: boolean;
  showSkirting?: boolean;
  padding?: number;
}

/** px: на сколько размерные линии отстоят от стены, и место под них. */
const DIM_GAP = 12;
const DIM_SPACE = 30;
/** px: строка подписи «Стены: D · 1,50 м» под схемой. */
const LEGEND_ROW = 13;
const LEGEND_HEAD = "Стены:";

/** Оценка ширины подписи (10,5 px, цифры табличные), px. */
const textWidth = (t: string): number => t.length * 5.9 + 4;

const fullLabel = (w: Wall): string => `${w.label} · ${formatLength(w.length)}`;

/** Подпись размерной линии: полная, если влезает вдоль стены; иначе буква (длина — в подписи под схемой). */
function dimText(w: Wall, s: number): { text: string; full: boolean } {
  const lenPx = w.length * s;
  const full = fullLabel(w);
  if (lenPx >= textWidth(full) + 8) return { text: full, full: true };
  return { text: lenPx > 18 ? w.label : "", full: false };
}

/** Строки подписи «Стены: …» для стен, длина которых не уместилась на схеме. */
function legendRows(walls: readonly Wall[], s: number, width: number): string[] {
  const items = walls.filter((w) => !dimText(w, s).full).map(fullLabel);
  if (!items.length) return [];
  const rows: string[] = [];
  let cur = LEGEND_HEAD;
  for (const it of items) {
    const next = cur === LEGEND_HEAD ? `${cur} ${it}` : `${cur}, ${it}`;
    if (cur !== LEGEND_HEAD && textWidth(next) > width - 8) {
      rows.push(`${cur},`);
      cur = it;
    } else cur = next;
  }
  rows.push(cur);
  return rows;
}

function StaticDims({ walls, s }: { walls: readonly Wall[]; s: number }) {
  // У входящих углов линии соседних стен сходятся уголком, а не крестом.
  const lines = wallDimLines(walls, (w) => w.thickness + DIM_GAP / s);
  const seg = (p: Vec2, q: Vec2) => `M${r(p.x * s)} ${r(p.y * s)}L${r(q.x * s)} ${r(q.y * s)}`;
  return (
    <g className="psvg-dims">
      {lines.map((l) => {
        if (!l) return null;
        const w = l.wall;
        const off = w.thickness + DIM_GAP / s;
        const c = onWall(w, w.length / 2, -off);
        const ang = uprightAngle(w.dir);
        const { text } = dimText(w, s);
        // Выносные линии и засечки 45° — только на «настоящих» концах.
        const t = 3.5;
        const k = { x: (w.dir.x + w.normalIn.x) * t, y: (w.dir.y + w.normalIn.y) * t };
        let ext = "";
        let ticks = "";
        const end = (p: Vec2, along: number) => {
          ext += seg(onWall(w, along, -w.thickness - 2 / s), onWall(w, along, -off - 4 / s));
          ticks += `M${r(p.x * s - k.x)} ${r(p.y * s - k.y)}L${r(p.x * s + k.x)} ${r(p.y * s + k.y)}`;
        };
        if (!l.openA) end(l.a, 0);
        if (!l.openB) end(l.b, w.length);
        return (
          <g key={w.id}>
            <path className="psvg-dims__line" d={ext + seg(l.a, l.b)} />
            <path className="psvg-dims__tick" d={ticks} />
            {text ? (
              <text
                className="psvg-dims__text"
                x={r(c.x * s)}
                y={r(c.y * s)}
                transform={`rotate(${r(ang)} ${r(c.x * s)} ${r(c.y * s)})`}
              >
                {text}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

export function PlanSvg({
  room,
  result,
  width,
  height,
  showDims = true,
  showSkirting = true,
  padding = 8,
}: PlanSvgProps): JSX.Element {
  const hatchId = `psvg-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const walls = useMemo(() => getWalls(room), [room]);
  const pieces = useMemo(() => walls.flatMap((w) => wallPieces(w, wallCuts(w, room.openings))), [walls, room]);
  // Сечение плинтуса — с правками пользователя (толщина задаёт отступ линии от стены).
  const overrides = useAppStore((st) => st.project.productOverrides);
  const product = useMemo(
    () => (result ? resolveProduct(result.productId, overrides) : undefined),
    [result, overrides],
  );

  const box = useMemo(() => roomBounds(room), [room]);
  const margin = padding + (showDims ? DIM_SPACE : 4);
  const fitScale = (h: number) =>
    Math.max(1, Math.min((width - 2 * margin) / Math.max(box.width, 0.5), (h - 2 * margin) / Math.max(box.height, 0.5)));
  // Длины коротких стен (вырез Г-комнаты и т.п.) на бумаге нужнее всего: не
  // влезают на размерную линию — пишем их строкой под схемой, уменьшив её.
  let s = fitScale(height);
  let legend: string[] = [];
  if (showDims) {
    legend = legendRows(walls, s, width);
    if (legend.length) {
      s = fitScale(height - legend.length * LEGEND_ROW);
      legend = legendRows(walls, s, width);
    }
  }
  const planH = height - legend.length * LEGEND_ROW;
  const ox = width / 2 - (box.minX + box.width / 2) * s;
  const oy = planH / 2 - (box.minY + box.height / 2) * s;

  const skirtW = Math.min(4, Math.max(2, (product?.depth ?? 0.015) * s));
  const lines = useMemo(
    () => (showSkirting && result ? skirtingLines(result, (skirtW / 2 + 1.2) / s) : undefined),
    [showSkirting, result, skirtW, s],
  );

  return (
    <svg
      className="psvg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`План: ${room.name}. ${walls.map(fullLabel).join(", ")}`}
    >
      <defs>
        <HatchPattern id={hatchId} />
      </defs>
      <g transform={`translate(${r(ox)} ${r(oy)})`}>
        <RoomShapes
          room={room}
          walls={walls}
          pieces={pieces}
          s={s}
          lines={lines}
          skirtWidth={skirtW}
          skirtH={product?.height ?? 0.06}
          hatchId={hatchId}
        />
        {showDims ? <StaticDims walls={walls} s={s} /> : null}
      </g>
      {legend.map((row, i) => (
        <text key={i} className="psvg-legend" x={r(width / 2)} y={r(planH + (i + 0.5) * LEGEND_ROW)}>
          {row}
        </text>
      ))}
    </svg>
  );
}
