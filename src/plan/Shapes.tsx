/**
 * Статичные слои плана в архитектурной нотации: пол, стены с вырезами,
 * проёмы (дверь с дугой открывания, окно, проём/арка, балконный блок,
 * мебель), линия плинтуса с торцевыми засечками.
 * Общие для интерактивного PlanView и печатного PlanSvg.
 * Координаты — мировые метры × s (сдвиг задаёт родительский <g>).
 */
import { memo } from "react";
import { cross, sub } from "../domain/geometry";
import {
  CASING_INSET,
  DOOR_FRAME,
  isFloorLevelWindow,
  windowSashCount,
} from "../domain/openings";
import type { Opening, Room, Vec2, Wall } from "../domain/types";
import {
  balconyLeaf,
  balconyParts,
  doorLeaves,
  onWall,
  polysToPath,
  r,
  uprightAngle,
  wallRect,
  type DoorLeaf,
  type SkirtLine,
} from "./geom";

const pts = (poly: readonly Vec2[], s: number): string =>
  poly.map((p) => `${r(p.x * s)},${r(p.y * s)}`).join(" ");

const X = (p: Vec2, s: number) => r(p.x * s);
const Y = (p: Vec2, s: number) => r(p.y * s);

/** Узор штриховки мебели. id должен быть уникален в документе. */
export function HatchPattern({ id }: { id: string }) {
  return (
    <pattern id={id} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1={0} y1={0} x2={0} y2={7} className="pl-hatch" />
    </pattern>
  );
}

/* ------------------------------ Проёмы ------------------------------ */

function LeafSymbol({ leaf, s }: { leaf: DoorLeaf; s: number }) {
  const R = r(leaf.radius * s);
  const sweep = cross(sub(leaf.tip, leaf.hinge), sub(leaf.closed, leaf.hinge)) > 0 ? 1 : 0;
  // Толщина полотна: ~4 см, но не тоньше 2 px.
  const t = Math.max(0.035, 2.2 / s);
  const body: Vec2[] = [
    leaf.hinge,
    leaf.tip,
    { x: leaf.tip.x + leaf.closeDir.x * t, y: leaf.tip.y + leaf.closeDir.y * t },
    { x: leaf.hinge.x + leaf.closeDir.x * t, y: leaf.hinge.y + leaf.closeDir.y * t },
  ];
  const arc = `M${X(leaf.tip, s)} ${Y(leaf.tip, s)}A${R} ${R} 0 0 ${sweep} ${X(leaf.closed, s)} ${Y(leaf.closed, s)}`;
  return (
    <>
      <path className="pl-door__sweep" d={`M${X(leaf.hinge, s)} ${Y(leaf.hinge, s)}L${arc.slice(1)}Z`} />
      <path className="pl-door__arc" d={arc} />
      <polygon className="pl-door__leaf" points={pts(body, s)} />
    </>
  );
}

function Casings({ o, w, s, cls }: { o: Opening; w: Wall; s: number; cls: string }) {
  if (o.casing <= 0) return null;
  // Наличник — тонкая доска на стене с комнатной стороны (~16 мм).
  const t = Math.max(0.016, 2.5 / s);
  const l0 = o.offset + CASING_INSET - o.casing;
  const r1 = o.offset + o.width - CASING_INSET;
  return (
    <>
      <polygon className={cls} points={pts(wallRect(w, l0, o.offset + CASING_INSET, 0, t), s)} />
      <polygon className={cls} points={pts(wallRect(w, r1, r1 + o.casing, 0, t), s)} />
    </>
  );
}

function Jambs({ w, s, from, to }: { w: Wall; s: number; from: number; to: number }) {
  const th = w.thickness;
  return (
    <>
      <polygon className="pl-door__jamb" points={pts(wallRect(w, from, from + DOOR_FRAME, -th, 0), s)} />
      <polygon className="pl-door__jamb" points={pts(wallRect(w, to - DOOR_FRAME, to, -th, 0), s)} />
    </>
  );
}

function WindowBody({
  w,
  s,
  from,
  to,
  sill,
}: {
  w: Wall;
  s: number;
  from: number;
  to: number;
  sill: boolean;
}) {
  const th = w.thickness;
  const width = to - from;
  const mid = -th / 2;
  const n = windowSashCount(width);
  const sillD = Math.max(0.05, 4 / s);
  const a = onWall(w, from, mid);
  const b = onWall(w, to, mid);
  const ticks: JSX.Element[] = [];
  for (let k = 1; k < n; k++) {
    const al = from + (width * k) / n;
    const p = onWall(w, al, -th * 0.22);
    const q = onWall(w, al, -th * 0.78);
    ticks.push(<line key={k} className="pl-win__line" x1={X(p, s)} y1={Y(p, s)} x2={X(q, s)} y2={Y(q, s)} />);
  }
  return (
    <>
      {sill ? (
        <polygon className="pl-win__sill" points={pts(wallRect(w, from - 0.03, to + 0.03, 0, sillD), s)} />
      ) : null}
      <polygon className="pl-win__body" points={pts(wallRect(w, from, to, -th, 0), s)} />
      <line className="pl-win__line" x1={X(a, s)} y1={Y(a, s)} x2={X(b, s)} y2={Y(b, s)} />
      {ticks}
    </>
  );
}

function OpeningSymbol({ o, w, s, skirtH }: { o: Opening; w: Wall; s: number; skirtH: number }) {
  const th = w.thickness;
  switch (o.kind) {
    case "door":
      return (
        <g className="pl-door">
          <polygon className="pl-gap" points={pts(wallRect(w, o.offset, o.offset + o.width, -th, 0), s)} />
          <Jambs w={w} s={s} from={o.offset} to={o.offset + o.width} />
          <Casings o={o} w={w} s={s} cls="pl-door__casing" />
          {doorLeaves(o, w).map((l, i) => (
            <LeafSymbol key={i} leaf={l} s={s} />
          ))}
        </g>
      );
    case "window":
      return (
        <g className="pl-win">
          <WindowBody w={w} s={s} from={o.offset} to={o.offset + o.width} sill={!isFloorLevelWindow(o, skirtH)} />
        </g>
      );
    case "passage": {
      const i0 = onWall(w, o.offset, 0);
      const i1 = onWall(w, o.offset + o.width, 0);
      const e0 = onWall(w, o.offset, -th);
      const e1 = onWall(w, o.offset + o.width, -th);
      let arch: JSX.Element | null = null;
      if (o.arch) {
        const rx = r((o.width / 2) * s);
        const ry = r(Math.min(o.width * 0.22, 0.3) * s);
        const rot = r((Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI);
        arch = (
          <path
            className="pl-pass__line"
            d={`M${X(i0, s)} ${Y(i0, s)}A${rx} ${ry} ${rot} 0 0 ${X(i1, s)} ${Y(i1, s)}`}
          />
        );
      }
      return (
        <g className="pl-pass">
          <polygon className="pl-gap" points={pts([i0, i1, e1, e0], s)} />
          <line className="pl-pass__line" x1={X(i0, s)} y1={Y(i0, s)} x2={X(i1, s)} y2={Y(i1, s)} />
          <line className="pl-pass__line" x1={X(e0, s)} y1={Y(e0, s)} x2={X(e1, s)} y2={Y(e1, s)} />
          {arch}
          <Casings o={o} w={w} s={s} cls="pl-pass__casing" />
        </g>
      );
    }
    case "balcony": {
      const parts = balconyParts(o);
      const sill = o.balconySillHeight >= skirtH + 0.005;
      return (
        <g className="pl-balc">
          <g className="pl-door">
            <polygon className="pl-gap" points={pts(wallRect(w, parts.door.from, parts.door.to, -th, 0), s)} />
            <Jambs w={w} s={s} from={parts.door.from} to={parts.door.to} />
            <LeafSymbol leaf={balconyLeaf(o, w)} s={s} />
          </g>
          {parts.window.to - parts.window.from > 0.05 ? (
            <g className="pl-win">
              <WindowBody w={w} s={s} from={parts.window.from} to={parts.window.to} sill={sill} />
            </g>
          ) : null}
        </g>
      );
    }
    case "furniture":
      return null; // мебель рисуется отдельным слоем — под стенами
  }
}

function FurnitureSymbol({ o, w, s, hatch }: { o: Opening; w: Wall; s: number; hatch: string }) {
  const depth = Math.max(0.05, o.depth);
  const poly = wallRect(w, o.offset, o.offset + o.width, 0, depth);
  const c = onWall(w, o.offset + o.width / 2, depth / 2);
  const label = o.label || "Без плинтуса";
  const lenPx = o.width * s;
  const depPx = depth * s;
  // Подпись — вдоль стены; только если влезает.
  const fits = lenPx > label.length * 6.2 + 12 && depPx > 15;
  return (
    <g className="pl-furn">
      <polygon className="pl-furn__body" points={pts(poly, s)} style={{ fill: `url(#${hatch})` }} />
      <polygon className="pl-furn__edge" points={pts(poly, s)} />
      {fits ? (
        <text
          className="pl-furn__label"
          x={X(c, s)}
          y={Y(c, s)}
          transform={`rotate(${r(uprightAngle(w.dir))} ${X(c, s)} ${Y(c, s)})`}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/* ----------------------------- Плинтус ------------------------------ */

/** Непрерывные ломаные по цепочкам (стыки уже сопряжены в geom.skirtingLines). */
export function skirtPath(lines: readonly SkirtLine[], s: number): string {
  const same = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  let d = "";
  let last: Vec2 | null = null;
  let start: Vec2 | null = null;
  for (const l of lines) {
    const joined = !!last && same(last, l.p);
    if (!joined) {
      d += `M${X(l.p, s)} ${Y(l.p, s)}`;
      start = l.p;
    }
    // Замкнутое кольцо закрываем Z — тогда и последний угол со скосом.
    if (joined && start && same(l.q, start)) d += "Z";
    else d += `L${X(l.q, s)} ${Y(l.q, s)}`;
    last = l.q;
  }
  return d;
}

/**
 * Засечки поперёк линии: на свободных концах (у проёмов) — до стены,
 * на стыках «на прямой» (стена разделена точкой) — короткие.
 */
export function capsPath(lines: readonly SkirtLine[], s: number, half: number): string {
  let d = "";
  const tick = (p: Vec2, n: Vec2, h: number) => {
    const k = h / s;
    d += `M${r((p.x - n.x * k) * s)} ${r((p.y - n.y * k) * s)}L${r((p.x + n.x * k) * s)} ${r((p.y + n.y * k) * s)}`;
  };
  for (const l of lines) {
    if (l.startCap) tick(l.p, l.n, half);
    if (l.endCap) tick(l.q, l.n, half);
    else if (l.endStraight) tick(l.q, l.n, half * 0.6);
  }
  return d;
}

/* ------------------------------ Комната ----------------------------- */

export interface RoomShapesProps {
  room: Room;
  walls: readonly Wall[];
  /** Куски стен (мировые многоугольники). */
  pieces: readonly Vec2[][];
  s: number;
  /** Линии плинтуса (уже смещённые); undefined — плинтус не показываем. */
  lines?: readonly SkirtLine[];
  /** Толщина линии плинтуса, px. */
  skirtWidth: number;
  /** Высота плинтуса, м (окно «в пол» и балкон без подоконника). */
  skirtH: number;
  hatchId: string;
}

export const RoomShapes = memo(function RoomShapes({
  room,
  walls,
  pieces,
  s,
  lines,
  skirtWidth,
  skirtH,
  hatchId,
}: RoomShapesProps) {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const furniture = room.openings.filter((o) => o.kind === "furniture");
  const others = room.openings.filter((o) => o.kind !== "furniture");
  return (
    <g className="pl-shapes">
      <polygon className="pl-floor" points={pts(room.points, s)} />
      {furniture.map((o) => {
        const w = wallById.get(o.wallId);
        return w ? <FurnitureSymbol key={o.id} o={o} w={w} s={s} hatch={hatchId} /> : null;
      })}
      <path className="pl-wall" d={polysToPath(pieces, s)} />
      {others.map((o) => {
        const w = wallById.get(o.wallId);
        return w ? <OpeningSymbol key={o.id} o={o} w={w} s={s} skirtH={skirtH} /> : null;
      })}
      {/* Плинтус — поверх проёмов: виден и под окном, и в откосах проёма. */}
      {lines && lines.length ? (
        <g className="pl-skirt">
          <path className="pl-skirt__line" d={skirtPath(lines, s)} style={{ strokeWidth: skirtWidth }} />
          <path className="pl-skirt__cap" d={capsPath(lines, s, Math.max(4, skirtWidth + 2))} />
        </g>
      ) : null}
    </g>
  );
});
