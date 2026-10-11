/**
 * Фурнитура плинтуса (монтаж «на фурнитуру», cornerMethod 'fittings'):
 * внутренние и наружные уголки, заглушки на свободных концах, соединители
 * на стыках кусков — как в жизни: накладки чуть больше сечения плинтуса
 * (выпуклая оболочка профиля, раздутая на пару миллиметров) со скруглёнными
 * краями.
 *
 * Внутренний уголок — короткая «буква Г» с косым резом (накрывает косой рез
 * плинтуса), наружный — сечение, повёрнутое вокруг ребра угла: плинтус под
 * ним режется прямо (см. Skirting), иначе острый запил торчал бы из
 * скругления. Позиции соединителей — из нарезки сметы (куски одного прямого
 * участка идут подряд, по порядку вдоль участка).
 */
import { BufferGeometry, ShapeUtils, Vector2 } from "three";
import type { Piece } from "../../domain/cutting";
import type { RoomSkirtingResult, SkirtingSegment } from "../../domain/skirtingCalc";
import type { Vec2 } from "../../domain/types";
import { MeshBuilder, type V3 } from "./builder";
import { dirOf, miterPoint, profileNormals, segmentNeighbors } from "./skirting";

type P2 = [number, number];

export type Fitting =
  | {
      kind: "inner" | "outer";
      /** Вершина угла на линии стены. */
      at: Vec2;
      /** Направления участка до угла и после. */
      d1: Vec2;
      d2: Vec2;
      /** Длины этих участков, м (уголок не длиннее их). */
      back: number;
      ahead: number;
    }
  | {
      kind: "end";
      at: Vec2;
      /** Направление участка. */
      dir: Vec2;
      /** Конец участка: −1 — начало (наружу против dir), 1 — конец. */
      out: -1 | 1;
      /** Сколько места на участке под заглушку, м. */
      room: number;
    }
  | {
      kind: "connector";
      at: Vec2;
      dir: Vec2;
      /** Место до концов прямого участка, м. */
      back: number;
      ahead: number;
    };

/* ----------------------------- Размеры ----------------------------- */

/** Внутренний уголок заходит за косой рез плинтуса на столько, м. */
const INNER_LEG = 0.01;
/** Плечо наружного уголка от ребра угла, м (не меньше доли глубины). */
const OUTER_LEG = 0.012;
/** Заглушка: длина накладки на плинтус, м. */
const CAP_LEN = 0.014;
/** Лицо заглушки чуть дальше торца плинтуса (без мерцания совпадающих граней), м. */
const CAP_FACE = 0.0008;
/** Соединитель: половина длины, м. */
const CONNECTOR_HALF = 0.012;
/** Сегментов дуги наружного уголка на 90°. */
const ARC_STEPS_90 = 6;
/** Шаги скругления края (четверть окружности). */
const ROUND = [0, 30, 60, 90].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { axial: 1 - Math.cos(a), t: Math.sin(a) };
});
/** Стык ближе к концу участка — соединитель не ставим (там уголок/заглушка), м. */
const CONNECTOR_EDGE = 0.03;

/* --------------------------- Где что стоит --------------------------- */

function pointOnChain(chain: SkirtingSegment[], t: number): { p: Vec2; d: Vec2 } | null {
  let rest = t;
  for (const s of chain) {
    if (rest <= s.length + 1e-9) {
      const d = dirOf(s);
      return { p: { x: s.a.x + d.x * rest, y: s.a.y + d.y * rest }, d };
    }
    rest -= s.length;
  }
  return null;
}

/**
 * Соединители на стыках кусков. Куски прямого участка в нарезке идут
 * подряд с одинаковым segmentIds и по порядку вдоль участка, так что стык
 * k — сумма длин первых k кусков от начала участка. При монтаже на
 * фурнитуру длина куска равна длине по стене (удлинения под запил нет).
 */
export function connectorFittings(result: RoomSkirtingResult, pieces: readonly Piece[]): Fitting[] {
  const own = pieces.filter((p) => p.roomId === result.roomId);
  const byId = new Map(result.segments.map((s) => [s.id, s]));
  const out: Fitting[] = [];
  let i = 0;
  while (i < own.length) {
    const key = own[i].segmentIds.join("\n");
    let j = i + 1;
    while (j < own.length && own[j].segmentIds.join("\n") === key) j++;
    if (j - i > 1) {
      const chain = own[i].segmentIds.map((id) => byId.get(id)).filter((s): s is SkirtingSegment => !!s);
      const total = chain.reduce((acc, s) => acc + s.length, 0);
      let at = 0;
      for (let k = i; k < j - 1; k++) {
        at += own[k].length;
        if (at < CONNECTOR_EDGE || at > total - CONNECTOR_EDGE) continue;
        const pos = pointOnChain(chain, at);
        if (pos) out.push({ kind: "connector", at: pos.p, dir: pos.d, back: at, ahead: total - at });
      }
    }
    i = j;
  }
  return out;
}

/** Вся фурнитура комнаты: углы, заглушки, соединители. */
export function collectFittings(result: RoomSkirtingResult, pieces: readonly Piece[] = []): Fitting[] {
  const out: Fitting[] = [];
  const nbs = segmentNeighbors(result);
  for (const s of result.segments) {
    const D = dirOf(s);
    const next = nbs.get(s.id)?.next ?? null;
    if ((s.endJoint === "inner" || s.endJoint === "outer") && next) {
      out.push({ kind: s.endJoint, at: s.b, d1: D, d2: dirOf(next), back: s.length, ahead: next.length });
    }
    const both = s.startJoint === "end" && s.endJoint === "end";
    const room = both ? s.length / 2 : s.length;
    if (s.startJoint === "end") out.push({ kind: "end", at: s.a, dir: D, out: -1, room });
    if (s.endJoint === "end") out.push({ kind: "end", at: s.b, dir: D, out: 1, room });
  }
  out.push(...connectorFittings(result, pieces));
  return out;
}

/** Подпись набора фурнитуры для мемоизации геометрии. */
export function fittingsSignature(list: readonly Fitting[]): string {
  const r = (v: number) => Math.round(v * 10000);
  const v = (p: Vec2) => `${r(p.x)},${r(p.y)}`;
  return list
    .map((f) => {
      switch (f.kind) {
        case "inner":
        case "outer":
          return `${f.kind[0]}${v(f.at)}:${v(f.d1)}:${v(f.d2)}:${r(f.back)}:${r(f.ahead)}`;
        case "end":
          return `e${v(f.at)}:${v(f.dir)}:${f.out}:${r(f.room)}`;
        case "connector":
          return `c${v(f.at)}:${v(f.dir)}:${r(f.back)}:${r(f.ahead)}`;
      }
    })
    .join(";");
}

/** Наружный угол: следующий участок уходит от комнаты (а не к ней). */
export function isOuterTurn(d1: Vec2, d2: Vec2): boolean {
  // Нормаль в комнату для d1 — (−d1.y, d1.x).
  return -d1.y * d2.x + d1.x * d2.y < -1e-6;
}

/* ----------------------------- Сечение ------------------------------ */

/** Выпуклая оболочка (против часовой, без точек на одной прямой). */
export function convexHull(pts: readonly P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export interface FittingShape {
  /** Сечение накладки, м: оболочка профиля, раздутая на пару миллиметров. */
  body: P2[];
  /** Сечение у скруглённого края: чуть больше плинтуса. */
  rim: P2[];
  /** Радиус скругления края вдоль оси, м. */
  round: number;
  /** Вылет накладки от стены, м. */
  depth: number;
}

/** Сечение фурнитуры по сечению плинтуса (м, против часовой); null — вырожденное. */
export function fittingShape(profile: readonly P2[]): FittingShape | null {
  const hull = convexHull(profile);
  if (hull.length < 3) return null;
  let dMax = 0;
  let hMax = 0;
  for (const [d, h] of hull) {
    dMax = Math.max(dMax, d);
    hMax = Math.max(hMax, h);
  }
  if (dMax < 1e-4 || hMax < 1e-4) return null;
  const gd = Math.min(0.003, Math.max(0.0015, dMax * 0.12));
  const gh = 0.003;
  const grow = (ed: number, eh: number): P2[] =>
    hull.map(([d, h]) => [(d * (dMax + ed)) / dMax, (h * (hMax + eh)) / hMax]);
  return { body: grow(gd, gh), rim: grow(gd * 0.25, gh * 0.25), round: Math.min(0.002, gd), depth: dMax + gd };
}

/* ----------------------------- Геометрия ----------------------------- */

interface Station {
  /** Точка сечения с отступом d от стены (в плане). */
  at: (d: number) => Vec2;
  /** Горизонтальная нормаль сечения (для затенения). */
  n: Vec2;
  /** 0 — сечение края (rim), 1 — тело (body). */
  t: number;
}

const ZERO = 1e-6;

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Протяжка сечения по станциям: боковые грани (кроме прижатых к стене и
 * полу) и закрытые торцы на первой и последней станции.
 */
function sweep(mb: MeshBuilder, shape: FittingShape, st: Station[], startOut: Vec2, endOut: Vec2): void {
  const { body, rim } = shape;
  const n = body.length;
  const normals = profileNormals(body);
  const prof = (t: number): P2[] =>
    t >= 1 ? body : body.map(([d, h], i) => [rim[i][0] + (d - rim[i][0]) * t, rim[i][1] + (h - rim[i][1]) * t]);
  const rings = st.map((s) => {
    const pr = prof(s.t);
    return pr.map(([d, h]): V3 => {
      const p = s.at(d);
      return [p.x, h, p.y];
    });
  });
  const profs = st.map((s) => prof(s.t));
  for (let i = 0; i + 1 < st.length; i++) {
    const A = st[i];
    const B = st[i + 1];
    const ra = rings[i];
    const rb = rings[i + 1];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const p = body[k];
      const q = body[k2];
      if (p[0] < ZERO && q[0] < ZERO) continue; // к стене
      if (p[1] < ZERO && q[1] < ZERO) continue; // к полу
      if (A.t >= 1 && B.t >= 1) {
        mb.quadN(0, ra[k], ra[k2], rb[k2], rb[k], normals.world(k, k, A.n), normals.world(k2, k, A.n), normals.world(k2, k, B.n), normals.world(k, k, B.n));
      } else {
        // Скругление края: плоская грань по фактическому наклону.
        const a = ra[k];
        const b = ra[k2];
        const c = rb[k];
        const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let fn = norm3([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
        const e = normals.edge[k];
        const mid = { x: (A.n.x + B.n.x) / 2, y: (A.n.y + B.n.y) / 2 };
        const ref: V3 = [mid.x * e[0], e[1], mid.y * e[0]];
        if (fn[0] * ref[0] + fn[1] * ref[1] + fn[2] * ref[2] < 0) fn = [-fn[0], -fn[1], -fn[2]];
        mb.quad(0, ra[k], ra[k2], rb[k2], rb[k], fn);
      }
    }
  }
  // Торцы.
  const cap = (ring: V3[], pr: P2[], out: Vec2) => {
    const tris = ShapeUtils.triangulateShape(
      pr.map(([d, h]) => new Vector2(d, h)),
      [],
    );
    const nn: V3 = [out.x, 0, out.y];
    for (const [i, j, k] of tris) mb.tri(0, ring[i], ring[j], ring[k], nn);
  };
  cap(rings[0], profs[0], startOut);
  cap(rings[rings.length - 1], profs[profs.length - 1], endOut);
}

const add = (p: Vec2, d: Vec2, s: number): Vec2 => ({ x: p.x + d.x * s, y: p.y + d.y * s });
const normalOf = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
const neg = (d: Vec2): Vec2 => ({ x: -d.x, y: -d.y });

/** Прямая станция: центр c на линии стены, нормаль N. */
function straight(c: Vec2, N: Vec2, t: number): Station {
  return { at: (d) => add(c, N, d), n: N, t };
}

/**
 * Скруглённый край: станции от торца (t = 0) внутрь до полного сечения.
 * end — точка торца на линии стены, inward — направление внутрь детали.
 */
function roundedEdge(end: Vec2, inward: Vec2, N: Vec2, r: number): Station[] {
  return ROUND.map(({ axial, t }) => straight(add(end, inward, axial * r), N, t));
}

/** Сколько косой рез заходит вдоль d1 назад и вдоль d2 вперёд от вершины (для самого широкого места). */
function miterReach(P: Vec2, d1: Vec2, d2: Vec2, depth: number): { back: number; ahead: number } {
  const m = miterPoint(P, d1, d2, depth);
  const dx = m.x - P.x;
  const dy = m.y - P.y;
  return { back: Math.max(0, -(dx * d1.x + dy * d1.y)), ahead: Math.max(0, dx * d2.x + dy * d2.y) };
}

function cornerStations(f: Extract<Fitting, { kind: "inner" | "outer" }>, shape: FittingShape): Station[] {
  const { at: P, d1, d2 } = f;
  const N1 = normalOf(d1);
  const N2 = normalOf(d2);
  const r = shape.round;
  const outer = isOuterTurn(d1, d2);
  let len1: number;
  let len2: number;
  const mid: Station[] = [];
  if (outer) {
    const leg = Math.max(OUTER_LEG, shape.depth * 0.6);
    len1 = Math.min(leg, Math.max(f.back, r + 0.001));
    len2 = Math.min(leg, Math.max(f.ahead, r + 0.001));
    // Дуга от N1 к N2 (короткой стороной) вокруг ребра угла.
    const ang = Math.atan2(N1.x * N2.y - N1.y * N2.x, N1.x * N2.x + N1.y * N2.y);
    const steps = Math.max(2, Math.ceil((Math.abs(ang) / (Math.PI / 2)) * ARC_STEPS_90));
    for (let k = 0; k <= steps; k++) {
      const a = (ang * k) / steps;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const n = { x: N1.x * c - N1.y * s, y: N1.x * s + N1.y * c };
      mid.push({ at: (d) => add(P, n, d), n, t: 1 });
    }
  } else {
    const reach = miterReach(P, d1, d2, shape.depth);
    len1 = Math.min(reach.back + INNER_LEG, Math.max(f.back, reach.back + r + 0.001));
    len2 = Math.min(reach.ahead + INNER_LEG, Math.max(f.ahead, reach.ahead + r + 0.001));
    const at = (d: number) => miterPoint(P, d1, d2, d);
    mid.push({ at, n: N1, t: 1 }, { at, n: N2, t: 1 });
  }
  const start = add(P, d1, -len1);
  const end = add(P, d2, len2);
  return [...roundedEdge(start, d1, N1, r), ...mid, ...roundedEdge(end, neg(d2), N2, r).reverse()];
}

/** Геометрия одной детали. */
function addFitting(mb: MeshBuilder, f: Fitting, shape: FittingShape): void {
  const r = shape.round;
  switch (f.kind) {
    case "inner":
    case "outer":
      sweep(mb, shape, cornerStations(f, shape), neg(f.d1), f.d2);
      return;
    case "end": {
      const N = normalOf(f.dir);
      const u = f.out > 0 ? f.dir : neg(f.dir); // наружу от плинтуса
      const len = Math.max(r * 2 + 0.001, Math.min(CAP_LEN, f.room));
      const inner = add(f.at, u, -len);
      const face = add(f.at, u, CAP_FACE);
      const st = [...roundedEdge(inner, u, N, r), ...roundedEdge(face, neg(u), N, r).reverse()];
      sweep(mb, shape, st, neg(u), u);
      return;
    }
    case "connector": {
      const N = normalOf(f.dir);
      const half = Math.max(r + 0.001, Math.min(CONNECTOR_HALF, f.back, f.ahead));
      const a = add(f.at, f.dir, -half);
      const b = add(f.at, f.dir, half);
      const st = [...roundedEdge(a, f.dir, N, r), ...roundedEdge(b, neg(f.dir), N, r).reverse()];
      sweep(mb, shape, st, neg(f.dir), f.dir);
      return;
    }
  }
}

/** Вся фурнитура комнаты одним буфером (один материал, один вызов отрисовки). */
export function buildFittingsGeometry(list: readonly Fitting[], profile: readonly P2[]): BufferGeometry | null {
  const shape = fittingShape(profile);
  if (!shape || list.length === 0) return null;
  const mb = new MeshBuilder(1);
  for (const f of list) addFitting(mb, f, shape);
  return mb.isEmpty ? null : mb.build();
}
