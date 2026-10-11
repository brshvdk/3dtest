/**
 * Геометрия для отрисовки плана: куски стен между проёмами, координаты
 * «вдоль стены / поперёк», смещённые линии плинтуса, попадание указателя.
 * Всё в мировых метрах (как в домене); в пиксели переводят компоненты.
 */
import {
  add,
  bbox,
  clamp,
  distance,
  lineIntersection,
  normalize,
  outerPolygon,
  pointInPolygon,
  projectToSegment,
  scale,
  segmentsIntersect,
  signedArea,
  sub,
  type BBox,
} from "../domain/geometry";
import { casingExtension, doorLeafWidth, DOOR_FRAME } from "../domain/openings";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import type { Opening, Room, Vec2, Wall } from "../domain/types";

export interface Interval {
  from: number;
  to: number;
}

/**
 * Точка в системе стены: along — от начала стены вдоль неё,
 * perp — от внутренней грани (+ в комнату, − в толщу стены и наружу).
 */
export function onWall(w: Wall, along: number, perp: number): Vec2 {
  return {
    x: w.a.x + w.dir.x * along + w.normalIn.x * perp,
    y: w.a.y + w.dir.y * along + w.normalIn.y * perp,
  };
}

/** Прямоугольник в системе стены (4 точки). */
export function wallRect(w: Wall, a0: number, a1: number, p0: number, p1: number): Vec2[] {
  return [onWall(w, a0, p0), onWall(w, a1, p0), onWall(w, a1, p1), onWall(w, a0, p1)];
}

/** Участок стены, где она «вырезана» проёмом (мебель стену не режет). */
export function openingCut(o: Opening): Interval | null {
  if (o.kind === "furniture") return null;
  return { from: o.offset, to: o.offset + o.width };
}

/** Объединённые вырезы стены, обрезанные по её длине. */
export function wallCuts(w: Wall, openings: readonly Opening[]): Interval[] {
  const list: Interval[] = [];
  for (const o of openings) {
    if (o.wallId !== w.id) continue;
    const c = openingCut(o);
    if (!c) continue;
    const from = clamp(c.from, 0, w.length);
    const to = clamp(c.to, 0, w.length);
    if (to - from > 1e-4) list.push({ from, to });
  }
  list.sort((p, q) => p.from - q.from);
  const merged: Interval[] = [];
  for (const c of list) {
    const last = merged[merged.length - 1];
    if (last && c.from <= last.to + 1e-6) last.to = Math.max(last.to, c.to);
    else merged.push({ ...c });
  }
  return merged;
}

const EDGE = 1e-6;

function piece(w: Wall, s: number, e: number): Vec2[] {
  const iS = onWall(w, s, 0);
  const iE = onWall(w, e, 0);
  const oS = s <= EDGE ? w.outerA : onWall(w, s, -w.thickness);
  const oE = e >= w.length - EDGE ? w.outerB : onWall(w, e, -w.thickness);
  return [iS, iE, oE, oS];
}

/** Ориентация всех кусков одна и та же — иначе в одном path они «вычтутся». */
function oriented(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/**
 * Многоугольники массива стены за вычетом вырезов. Угловые треугольники
 * (сопряжение по outerPolygon) рисуются всегда — иначе проём у самого угла
 * «откусывает» угол соседней стены.
 */
export function wallPieces(w: Wall, cuts: readonly Interval[]): Vec2[][] {
  const out: Vec2[][] = [];
  let s = 0;
  for (const c of cuts) {
    if (c.from - s > 1e-4) out.push(piece(w, s, c.from));
    s = Math.max(s, c.to);
  }
  if (w.length - s > 1e-4) out.push(piece(w, s, w.length));
  if (cuts.length) {
    if (cuts[0].from <= 1e-4) out.push([w.a, w.outerA, onWall(w, 0, -w.thickness)]);
    const last = cuts[cuts.length - 1];
    if (last.to >= w.length - 1e-4) out.push([w.b, onWall(w, w.length, -w.thickness), w.outerB]);
  }
  return out.map(oriented);
}

/** SVG path из многоугольников (мировые метры × масштаб s). */
export function polysToPath(polys: readonly Vec2[][], s: number): string {
  let d = "";
  for (const poly of polys) {
    if (poly.length < 2) continue;
    d += `M${r(poly[0].x * s)} ${r(poly[0].y * s)}`;
    for (let i = 1; i < poly.length; i++) d += `L${r(poly[i].x * s)} ${r(poly[i].y * s)}`;
    d += "Z";
  }
  return d;
}

/** Округление до 0,01 px — короче строки, без потери чёткости. */
export const r = (v: number): number => Math.round(v * 100) / 100;

/* ------------------------------ Двери ------------------------------- */

export interface DoorLeaf {
  /** Петля (ось вращения). */
  hinge: Vec2;
  /** Конец открытого полотна. */
  tip: Vec2;
  /** Конец полотна в закрытом положении. */
  closed: Vec2;
  radius: number;
  /** Единичные векторы: куда открыто полотно и куда «закрывается». */
  openDir: Vec2;
  closeDir: Vec2;
}

function leaf(w: Wall, hingeAlong: number, closeSign: 1 | -1, radius: number, swingIn: boolean): DoorLeaf {
  const base = swingIn ? 0 : -w.thickness;
  const hinge = onWall(w, hingeAlong, base);
  const openDir = swingIn ? w.normalIn : w.normalOut;
  const closeDir = scale(w.dir, closeSign);
  return {
    hinge,
    tip: add(hinge, scale(openDir, radius)),
    closed: add(hinge, scale(closeDir, radius)),
    radius,
    openDir,
    closeDir,
  };
}

/** Полотна двери (1 или 2) в открытом на 90° положении. */
export function doorLeaves(o: Opening, w: Wall): DoorLeaf[] {
  const swingIn = o.swing === "in";
  const total = doorLeafWidth(o);
  const left = o.offset + DOOR_FRAME;
  const right = o.offset + o.width - DOOR_FRAME;
  if (o.leaves === 2) {
    const rad = total / 2;
    return [leaf(w, left, 1, rad, swingIn), leaf(w, right, -1, rad, swingIn)];
  }
  return o.hinge === "left" ? [leaf(w, left, 1, total, swingIn)] : [leaf(w, right, -1, total, swingIn)];
}

/** Части балконного блока вдоль стены: дверь и окно. */
export function balconyParts(o: Opening): { door: Interval; window: Interval } {
  const dw = Math.min(o.balconyDoorWidth, o.width);
  return o.balconyDoorSide === "left"
    ? { door: { from: o.offset, to: o.offset + dw }, window: { from: o.offset + dw, to: o.offset + o.width } }
    : {
        door: { from: o.offset + o.width - dw, to: o.offset + o.width },
        window: { from: o.offset, to: o.offset + o.width - dw },
      };
}

/** Полотно балконной двери (открывается внутрь, петли — у края блока). */
export function balconyLeaf(o: Opening, w: Wall): DoorLeaf {
  const { door } = balconyParts(o);
  const radius = Math.max(0.2, door.to - door.from - 2 * DOOR_FRAME);
  return o.balconyDoorSide === "left"
    ? leaf(w, door.from + DOOR_FRAME, 1, radius, true)
    : leaf(w, door.to - DOOR_FRAME, -1, radius, true);
}

/**
 * Габарит проёма в системе стены (для попадания и выделения):
 * вдоль — с наличниками, поперёк — от внешней грани до самого дальнего
 * элемента в комнате (полотно, подоконник, мебель).
 */
export function openingExtent(o: Opening, w: Wall): { a0: number; a1: number; p0: number; p1: number } {
  const ext = casingExtension(o);
  let p0 = -w.thickness;
  let p1 = 0.02;
  if (o.kind === "door") {
    const rad = o.leaves === 2 ? doorLeafWidth(o) / 2 : doorLeafWidth(o);
    if (o.swing === "in") p1 = Math.max(p1, rad);
    else p0 = -w.thickness - rad;
  } else if (o.kind === "balcony") {
    p1 = Math.max(p1, balconyLeaf(o, w).radius);
  } else if (o.kind === "window") {
    p1 = 0.06;
  } else if (o.kind === "furniture") {
    p0 = 0;
    p1 = Math.max(0.05, o.depth);
  }
  return { a0: o.offset - ext, a1: o.offset + o.width + ext, p0, p1 };
}

/* ----------------------------- Плинтус ------------------------------ */

export interface SkirtLine {
  id: string;
  label: string;
  wallId: string;
  length: number;
  /** Начало и конец линии, смещённой внутрь от грани (мировые м). */
  p: Vec2;
  q: Vec2;
  /** Нормаль в сторону комнаты (куда смещена линия). */
  n: Vec2;
  startCap: boolean;
  endCap: boolean;
  /** Конец — стык «на прямой» (стена разделена точкой). */
  endStraight: boolean;
  isReveal: boolean;
  openingId: string | null;
}

/**
 * Линии плинтуса, смещённые от внутренней грани на off (м). Соседние в
 * цепочке сегменты сопрягаются в точке пересечения смещённых прямых.
 */
export function skirtingLines(result: RoomSkirtingResult, off: number): SkirtLine[] {
  const lines = new Map<string, SkirtLine>();
  const dirs = new Map<string, Vec2>();
  for (const seg of result.segments) {
    const d = normalize(sub(seg.b, seg.a));
    const n = { x: -d.y, y: d.x };
    dirs.set(seg.id, d);
    lines.set(seg.id, {
      id: seg.id,
      label: seg.label,
      wallId: seg.wallId,
      length: seg.length,
      p: add(seg.a, scale(n, off)),
      q: add(seg.b, scale(n, off)),
      n,
      startCap: seg.startJoint === "end",
      endCap: seg.endJoint === "end",
      endStraight: seg.endJoint === "straight",
      isReveal: seg.isReveal,
      openingId: seg.openingId,
    });
  }
  const byId = new Map(result.segments.map((s) => [s.id, s]));
  for (const run of result.runs) {
    const ids = run.segmentIds;
    const pairs = run.closed ? ids.length : ids.length - 1;
    for (let k = 0; k < pairs; k++) {
      const s1 = byId.get(ids[k]);
      const s2 = byId.get(ids[(k + 1) % ids.length]);
      if (!s1 || !s2 || s1 === s2 || s1.endJoint === "end") continue;
      if (distance(s1.b, s2.a) > 2e-3) continue;
      const l1 = lines.get(s1.id)!;
      const l2 = lines.get(s2.id)!;
      const x = lineIntersection(l1.p, dirs.get(s1.id)!, l2.p, dirs.get(s2.id)!);
      // Почти параллельные (стык «на прямой») или очень острые — без сопряжения.
      if (!x || distance(x, s1.b) > 4 * off + 1e-6) continue;
      l1.q = x;
      l2.p = x;
    }
  }
  // В порядке цепочек — чтобы ломаная рисовалась без разрывов на стыках.
  const ordered: SkirtLine[] = [];
  const seen = new Set<string>();
  for (const run of result.runs) {
    for (const id of run.segmentIds) {
      const l = lines.get(id);
      if (l && !seen.has(id)) {
        ordered.push(l);
        seen.add(id);
      }
    }
  }
  for (const seg of result.segments) if (!seen.has(seg.id)) ordered.push(lines.get(seg.id)!);
  return ordered;
}

/* -------------------------- Попадание указателя ------------------------- */

export type PlanTarget =
  | { type: "point"; id: string }
  | { type: "opening"; id: string }
  | { type: "wall"; id: string; along: number }
  | { type: "room" }
  | null;

export interface HitOptions {
  /** Допуск попадания по стенам/проёмам, м. */
  tol: number;
  /** Радиус попадания в вершину, м. */
  pointTol: number;
}

/** Что под указателем: вершина → проём → стена → пол комнаты → пусто. */
export function hitTest(room: Room, walls: readonly Wall[], p: Vec2, o: HitOptions): PlanTarget {
  let best: { id: string; d: number } | null = null;
  for (const pt of room.points) {
    const d = distance(pt, p);
    if (d <= o.pointTol && (!best || d < best.d)) best = { id: pt.id, d };
  }
  if (best) return { type: "point", id: best.id };

  const wallById = new Map(walls.map((w) => [w.id, w]));
  let opBest: { id: string; d: number } | null = null;
  for (const op of room.openings) {
    const w = wallById.get(op.wallId);
    if (!w) continue;
    const e = openingExtent(op, w);
    const rel = sub(p, w.a);
    const along = rel.x * w.dir.x + rel.y * w.dir.y;
    const perp = rel.x * w.normalIn.x + rel.y * w.normalIn.y;
    if (along < e.a0 - o.tol || along > e.a1 + o.tol) continue;
    if (perp < e.p0 - o.tol || perp > e.p1 + o.tol) continue;
    // Ближе к центру проёма — приоритетнее (перекрывающиеся проёмы).
    const d = Math.abs(along - (op.offset + op.width / 2));
    if (!opBest || d < opBest.d) opBest = { id: op.id, d };
  }
  if (opBest) return { type: "opening", id: opBest.id };

  let wBest: { id: string; along: number; d: number } | null = null;
  for (const w of walls) {
    const pr = projectToSegment(p, w.a, w.b);
    const rel = sub(p, w.a);
    const along = rel.x * w.dir.x + rel.y * w.dir.y;
    if (along < -o.tol || along > w.length + o.tol) continue;
    const perp = pr.signed;
    if (perp > o.tol || perp < -w.thickness - o.tol) continue;
    // Расстояние до «тела» стены (0 — внутри толщи).
    const d = perp > 0 ? perp : perp < -w.thickness ? -w.thickness - perp : 0;
    if (!wBest || d < wBest.d) wBest = { id: w.id, along: clamp(along, 0, w.length), d };
  }
  if (wBest) return { type: "wall", id: wBest.id, along: wBest.along };

  if (pointInPolygon(p, room.points)) return { type: "room" };
  return null;
}

/** Ближайшая линия плинтуса в пределах tol (м). */
export function hitSkirting(lines: readonly SkirtLine[], p: Vec2, tol: number): SkirtLine | null {
  let best: SkirtLine | null = null;
  let bd = tol;
  for (const l of lines) {
    const d = projectToSegment(p, l.p, l.q).dist;
    if (d <= bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}

/* --------------------------- Размерные линии --------------------------- */

export interface DimLine {
  wall: Wall;
  /** Концы размерной линии (мировые м). */
  a: Vec2;
  b: Vec2;
  /** Конец «обрезан» о размерную линию соседней стены (у наружного угла) — без засечки и выноски. */
  openA: boolean;
  openB: boolean;
}

/**
 * Размерные линии стен снаружи на расстоянии off(w) от внутренней грани.
 * У наружных (входящих) углов линии соседних стен пересекаются крестом —
 * обрезаем обе в точке пересечения, получается аккуратный «уголок».
 */
export function wallDimLines(walls: readonly Wall[], off: (w: Wall) => number): Array<DimLine | null> {
  const lines: Array<DimLine | null> = walls.map((w) => {
    const o = off(w);
    if (!(o > 0)) return null;
    return { wall: w, a: onWall(w, 0, -o), b: onWall(w, w.length, -o), openA: false, openB: false };
  });
  const n = lines.length;
  if (n < 3) return lines;
  for (let i = 0; i < n; i++) {
    const l1 = lines[i];
    const l2 = lines[(i + 1) % n];
    if (!l1 || !l2 || !segmentsIntersect(l1.a, l1.b, l2.a, l2.b)) continue;
    const x = lineIntersection(l1.a, sub(l1.b, l1.a), l2.a, sub(l2.b, l2.a));
    if (!x) continue;
    l1.b = x;
    l1.openB = true;
    l2.a = x;
    l2.openA = true;
  }
  return lines;
}

/** Габарит комнаты со стенами — для вписывания в экран. */
export function roomBounds(room: Room): BBox {
  return bbox([...outerPolygon(room), ...room.points]);
}

/**
 * Угол стены для подписей, приведённый к «читаемому» [−90°…90°):
 * вертикальные подписи читаются снизу вверх, как на чертежах.
 */
export function uprightAngle(dir: Vec2): number {
  let a = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (a >= 89.5) a -= 180;
  if (a < -90.5) a += 180;
  return a;
}
