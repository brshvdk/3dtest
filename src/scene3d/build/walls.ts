/**
 * Геометрия стен с реальной толщиной: внутренняя и внешняя грани с вырезами
 * проёмов, откосы, верхний торец («разрез»), порог в дверных проёмах.
 *
 * Координаты стены: u — вдоль стены от её начала (м), v — от пола вверх,
 * s — от внутренней грани наружу (0..толщина). Мир: план (x, y) → (x, v, y).
 *
 * Отверстие проёма описывается «u-монотонным» контуром: список отсчётов
 * {u, b, t} (низ и верх отверстия) по возрастанию u; ступенька (балконный
 * блок) — два отсчёта с одинаковым u. Так одинаково строятся прямоугольники,
 * арки и Г-образный балконный блок.
 */
import type { Opening, Vec2, Wall } from "../../domain/types";
import { MeshBuilder, type V3 } from "./builder";

/** Высота «пенька» стены, скрытой в режиме кукольного домика, м. */
export const STUB_HEIGHT = 0.03;
/** Высота стен в режиме «Низкие», м. */
export const LOW_WALL_HEIGHT = 0.35;

/** Группы материалов геометрии стены. */
export const WALL_GROUP = { inner: 0, outer: 1, reveal: 2, cap: 3, threshold: 4 } as const;
const GROUPS = 5;

const EPS = 1e-6;
const ARCH_SEGMENTS = 20;

export interface HoleSample {
  u: number;
  /** Низ отверстия, м от пола. */
  b: number;
  /** Верх отверстия, м от пола. */
  t: number;
}
export type Hole = HoleSample[];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Контур отверстия проёма в стене длиной L (без учёта среза), null — проём не режет стену. */
export function openingHole(o: Opening, L: number): Hole | null {
  if (o.kind === "furniture") return null;
  const u0 = clamp(o.offset, 0, L);
  const u1 = clamp(o.offset + o.width, 0, L);
  if (u1 - u0 < 0.01 || o.height < 0.01) return null;

  if (o.kind === "window") {
    const b = Math.max(0, o.elevation);
    return [
      { u: u0, b, t: b + o.height },
      { u: u1, b, t: b + o.height },
    ];
  }
  if (o.kind === "balcony") {
    const h = o.height;
    const sill = clamp(o.balconySillHeight, 0, h);
    const dw = clamp(Math.min(o.balconyDoorWidth, o.width), 0, u1 - u0);
    if (o.balconyDoorSide === "left") {
      const m = u0 + dw;
      return [
        { u: u0, b: 0, t: h },
        { u: m, b: 0, t: h },
        { u: m, b: sill, t: h },
        { u: u1, b: sill, t: h },
      ];
    }
    const m = u1 - dw;
    return [
      { u: u0, b: sill, t: h },
      { u: m, b: sill, t: h },
      { u: m, b: 0, t: h },
      { u: u1, b: 0, t: h },
    ];
  }
  if (o.kind === "passage" && o.arch) {
    return archSamples(u0, u1, o.height);
  }
  // Дверь, проём.
  return [
    { u: u0, b: 0, t: o.height },
    { u: u1, b: 0, t: o.height },
  ];
}

/** Арка: вертикальные откосы + полуэллипс сверху (для узких/низких — сплюснутый). */
export function archSamples(u0: number, u1: number, h: number): Hole {
  const rx = (u1 - u0) / 2;
  const ry = Math.min(rx, h * 0.6);
  const spring = h - ry;
  const c = (u0 + u1) / 2;
  const out: Hole = [];
  for (let k = 0; k <= ARCH_SEGMENTS; k++) {
    const u = u0 + ((u1 - u0) * k) / ARCH_SEGMENTS;
    const x = (u - c) / rx;
    out.push({ u, b: 0, t: spring + ry * Math.sqrt(Math.max(0, 1 - x * x)) });
  }
  return out;
}

/** Обрезает отверстие по высоте среза стены; null — отверстие целиком выше среза. */
export function clipHole(h: Hole, top: number): Hole | null {
  const out: HoleSample[] = [];
  for (let i = 0; i < h.length; i++) {
    const s = h[i];
    if (i > 0) {
      const p = h[i - 1];
      const du = s.u - p.u;
      if (du > EPS) {
        const cuts: number[] = [];
        for (const key of ["t", "b"] as const) {
          const d0 = p[key] - top;
          const d1 = s[key] - top;
          if ((d0 < -EPS && d1 > EPS) || (d0 > EPS && d1 < -EPS)) {
            cuts.push(d0 / (d0 - d1));
          }
        }
        cuts.sort((x, y) => x - y);
        for (const k of cuts) {
          out.push({ u: p.u + du * k, b: p.b + (s.b - p.b) * k, t: p.t + (s.t - p.t) * k });
        }
      }
    }
    out.push({ ...s });
  }
  for (const s of out) {
    s.b = Math.min(s.b, top);
    s.t = Math.min(s.t, top);
  }
  return out.some((s) => s.t - s.b > EPS) ? out : null;
}

/** Отрезок отверстия, содержащий u (с ненулевой длиной), или -1. */
function segmentAt(h: Hole, u: number): number {
  for (let i = 0; i < h.length - 1; i++) {
    if (h[i + 1].u - h[i].u > EPS && h[i].u - EPS <= u && u <= h[i + 1].u + EPS) return i;
  }
  return -1;
}

function lerpSample(a: HoleSample, b: HoleSample, u: number): { b: number; t: number } {
  const k = (u - a.u) / (b.u - a.u);
  return { b: a.b + (b.b - a.b) * k, t: a.t + (b.t - a.t) * k };
}

/** Сплошной участок столбца: низ/верх на левой (a) и правой (b) границе. */
interface Span {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/**
 * Раскладка грани [u0, u1] × [0, top] на столбцы между точками отверстий.
 * bounds[k] — все высоты вершин на границе столбцов xs[k] (с обеих сторон):
 * по ним грани, откосы и торец режутся одинаково — без Т-образных стыков,
 * которые дают «проколы» фона в местах примыкания.
 */
interface FaceLayout {
  xs: number[];
  spans: Span[][];
  bounds: number[][];
}

function uniqSorted(values: number[]): number[] {
  values.sort((x, y) => x - y);
  const out: number[] = [];
  for (const v of values) if (!out.length || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

function faceLayout(holes: Hole[], u0: number, u1: number, top: number, extraU: number[], levels: number[]): FaceLayout | null {
  if (u1 - u0 <= EPS) return null;
  const cuts = [u0, u1];
  for (const c of extraU) if (c > u0 + EPS && c < u1 - EPS) cuts.push(c);
  for (const h of holes) for (const s of h) if (s.u > u0 + EPS && s.u < u1 - EPS) cuts.push(s.u);
  const xs = uniqSorted(cuts);

  const spans: Span[][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const ua = xs[i];
    const ub = xs[i + 1];
    const um = (ua + ub) / 2;
    const active: Array<{ ba: number; ta: number; bb: number; tb: number }> = [];
    for (const h of holes) {
      const k = segmentAt(h, um);
      if (k < 0) continue;
      const A = lerpSample(h[k], h[k + 1], ua);
      const B = lerpSample(h[k], h[k + 1], ub);
      if (A.t - A.b <= EPS && B.t - B.b <= EPS) continue;
      active.push({ ba: A.b, ta: A.t, bb: B.b, tb: B.t });
    }
    active.sort((p, q) => p.ba + p.bb - (q.ba + q.bb));
    const col: Span[] = [];
    let ca = 0;
    let cb = 0;
    for (const a of active) {
      if ((a.ba + a.bb) / 2 > (ca + cb) / 2 + EPS) col.push({ a0: ca, a1: a.ba, b0: cb, b1: a.bb });
      ca = Math.max(ca, a.ta);
      cb = Math.max(cb, a.tb);
    }
    if (top > (ca + cb) / 2 + EPS) col.push({ a0: ca, a1: top, b0: cb, b1: top });
    spans.push(col);
  }

  const bounds: number[][] = xs.map(() => [...levels]);
  spans.forEach((col, i) => {
    for (const sp of col) {
      bounds[i].push(sp.a0, sp.a1);
      bounds[i + 1].push(sp.b0, sp.b1);
    }
  });
  return { xs, spans, bounds: bounds.map(uniqSorted) };
}

/** Точки цепочки: концы lo, hi и значения values строго между ними. */
function chain(values: number[], lo: number, hi: number): number[] {
  const out = [lo];
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const mid = values.filter((v) => v > a + EPS && v < b - EPS);
  if (hi < lo) mid.reverse();
  out.push(...mid, hi);
  return out;
}

interface ZipPoint {
  /** Параметр вдоль цепочки (возрастает). */
  t: number;
  p: V3;
  c?: V3;
}

/** Триангуляция полосы между двумя цепочками («молния»). */
function zip(mb: MeshBuilder, g: number, A: ZipPoint[], B: ZipPoint[], n: V3): void {
  const tri = (x: ZipPoint, y: ZipPoint, z: ZipPoint) => {
    if (x.c && y.c && z.c) mb.triC(g, x.p, y.p, z.p, n, x.c, y.c, z.c);
    else mb.tri(g, x.p, y.p, z.p, n);
  };
  let i = 0;
  let j = 0;
  while (i < A.length - 1 || j < B.length - 1) {
    const advA = j >= B.length - 1 || (i < A.length - 1 && A[i + 1].t <= B[j + 1].t);
    if (advA) {
      tri(A[i], B[j], A[i + 1]);
      i++;
    } else {
      tri(A[i], B[j], B[j + 1]);
      j++;
    }
  }
}

/** Грань по раскладке: каждый сплошной участок — полоса между цепочками левой и правой границ. */
function emitFace(
  mb: MeshBuilder,
  g: number,
  layout: FaceLayout,
  P: (u: number, v: number) => V3,
  n: V3,
  color?: (u: number, v: number) => V3,
): void {
  const { xs, spans, bounds } = layout;
  spans.forEach((col, i) => {
    const ua = xs[i];
    const ub = xs[i + 1];
    for (const sp of col) {
      const A = chain(bounds[i], sp.a0, sp.a1).map((v) => ({ t: v, p: P(ua, v), c: color?.(ua, v) }));
      const B = chain(bounds[i + 1], sp.b0, sp.b1).map((v) => ({ t: v, p: P(ub, v), c: color?.(ub, v) }));
      zip(mb, g, A, B, n);
    }
  });
}

/** Параметры s ∈ [0, 1] вершин грани, лежащих на ребре p→q контура отверстия. */
function edgeParams(layout: FaceLayout | null, p: [number, number], q: [number, number]): number[] {
  const out = [0, 1];
  if (!layout) return out;
  const du = q[0] - p[0];
  const dv = q[1] - p[1];
  if (Math.abs(du) > EPS) {
    for (const x of layout.xs) {
      const s = (x - p[0]) / du;
      if (s > EPS && s < 1 - EPS) out.push(s);
    }
  } else if (Math.abs(dv) > EPS) {
    const k = layout.xs.findIndex((x) => Math.abs(x - p[0]) <= EPS);
    if (k >= 0) {
      for (const v of layout.bounds[k]) {
        const s = (v - p[1]) / dv;
        if (s > EPS && s < 1 - EPS) out.push(s);
      }
    }
  }
  return uniqSorted(out);
}

/** Отверстия проёмов стены (по исходным проёмам), обрезанные по высоте top. */
export function wallHoles(wall: Wall, openings: Opening[], top: number): Hole[] {
  const out: Hole[] = [];
  for (const o of openings) {
    if (o.wallId !== wall.id) continue;
    const h = openingHole(o, wall.length);
    if (!h) continue;
    const c = clipHole(h, top);
    if (c) out.push(c);
  }
  return out;
}

/** Затенение внутренней грани у пола, во внутренних углах и у потолка. */
export interface WallShade {
  /** В начале/конце стены — внутренний угол комнаты (< 180°). */
  startInner: boolean;
  endInner: boolean;
  /** Высота потолка, если стена доходит до него (иначе null). */
  ceiling: number | null;
}

const FLOOR_AO = 0.32;
const CORNER_AO = 0.45;
const CEIL_AO = 0.3;

function shadeAt(u: number, v: number, L: number, o: WallShade): number {
  const f = Math.max(0, 1 - v / FLOOR_AO);
  let k = 1 - 0.26 * f * f;
  if (o.startInner) {
    const c = Math.max(0, 1 - u / CORNER_AO);
    k *= 1 - 0.24 * c * c;
  }
  if (o.endInner) {
    const c = Math.max(0, 1 - (L - u) / CORNER_AO);
    k *= 1 - 0.24 * c * c;
  }
  if (o.ceiling !== null) {
    const c = Math.max(0, 1 - (o.ceiling - v) / CEIL_AO);
    k *= 1 - 0.1 * c * c;
  }
  return k;
}

/**
 * Геометрия стены высотой top с отверстиями holes (уже обрезанными по top).
 * Группы: WALL_GROUP. Внутренняя грань — с цветами вершин (мягкое затенение).
 */
export function buildWallGeometry(wall: Wall, holes: Hole[], top: number, shade: WallShade) {
  const mb = new MeshBuilder(GROUPS);
  const { a, dir, normalIn, normalOut, thickness: th, length: L } = wall;
  const at = (u: number, s: number, v: number): V3 => [
    a.x + dir.x * u + normalOut.x * s,
    v,
    a.y + dir.y * u + normalOut.y * s,
  ];
  const nIn: V3 = [normalIn.x, 0, normalIn.y];
  const nOut: V3 = [normalOut.x, 0, normalOut.y];

  // Внутренняя грань: дополнительные разрезы у углов и по высоте — для плавного затенения.
  const uCuts: number[] = [];
  for (const d of [0.05, 0.14, 0.27, CORNER_AO]) uCuts.push(d, L - d);
  const vCuts = [0.04, 0.12, 0.22, FLOOR_AO].filter((v) => v < top - EPS);
  if (shade.ceiling !== null) vCuts.push(shade.ceiling - CEIL_AO, shade.ceiling - 0.12);
  const col = (u: number, v: number): V3 => {
    const k = shadeAt(u, v, L, shade);
    return [k, k, k];
  };
  const inner = faceLayout(holes, 0, L, top, uCuts, vCuts);
  if (inner) emitFace(mb, WALL_GROUP.inner, inner, (u, v) => at(u, 0, v), nIn, col);

  // Внешняя грань — по сопряжённым внешним углам.
  const uA = (wall.outerA.x - a.x) * dir.x + (wall.outerA.y - a.y) * dir.y;
  const uB = (wall.outerB.x - a.x) * dir.x + (wall.outerB.y - a.y) * dir.y;
  const outer = faceLayout(holes, uA, uB, top, [], []);
  if (outer) emitFace(mb, WALL_GROUP.outer, outer, (u, v) => at(u, th, v), nOut);

  // Откосы: рёбра контура отверстия, вытянутые на толщину стены.
  for (const h of holes) {
    const ring: Array<[number, number]> = [];
    for (const s of h) ring.push([s.u, s.b]);
    for (let i = h.length - 1; i >= 0; i--) ring.push([h[i].u, h[i].t]);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const du = q[0] - p[0];
      const dv = q[1] - p[1];
      const len = Math.hypot(du, dv);
      if (len < EPS) continue;
      if (p[1] >= top - EPS && q[1] >= top - EPS) continue; // открыто до среза
      // Контур обходится против часовой (u вправо, v вверх) — внутрь отверстия смотрит (−dv, du).
      const nu = -dv / len;
      const nv = du / len;
      const n: V3 = [dir.x * nu, nv, dir.y * nu];
      const g = p[1] <= EPS && q[1] <= EPS ? WALL_GROUP.threshold : WALL_GROUP.reveal;
      const pt = (s: number, depth: number): ZipPoint => ({
        t: s,
        p: at(p[0] + du * s, depth, p[1] + dv * s),
      });
      zip(
        mb,
        g,
        edgeParams(inner, p, q).map((s) => pt(s, 0)),
        edgeParams(outer, p, q).map((s) => pt(s, th)),
        n,
      );
    }
  }

  // Верхний торец: там, где отверстие не доходит до среза.
  const blocked: Array<[number, number]> = [];
  for (const h of holes) {
    for (let i = 0; i < h.length - 1; i++) {
      const p = h[i];
      const q = h[i + 1];
      if (q.u - p.u <= EPS) continue;
      const open = p.t >= top - EPS && q.t >= top - EPS && (p.t - p.b > EPS || q.t - q.b > EPS);
      if (open) blocked.push([p.u, q.u]);
    }
  }
  blocked.sort((x, y) => x[0] - y[0]);
  let cur = 0;
  const caps: Array<[number, number]> = [];
  for (const [f, t] of blocked) {
    if (f > cur + EPS) caps.push([cur, Math.min(f, L)]);
    cur = Math.max(cur, t);
  }
  if (L > cur + EPS) caps.push([cur, L]);
  const up: V3 = [0, 1, 0];
  for (const [c0, c1] of caps) {
    // Снаружи торец доходит до сопряжённых углов (у концов стены).
    const o0 = c0 <= EPS ? uA : c0;
    const o1 = c1 >= L - EPS ? uB : c1;
    const innerChain = chain(inner ? inner.xs : [], c0, c1).map((u) => ({ t: u, p: at(u, 0, top) }));
    const outerChain = chain(outer ? outer.xs : [], o0, o1).map((u) => ({ t: u, p: at(u, th, top) }));
    zip(mb, WALL_GROUP.cap, innerChain, outerChain, up);
  }

  return mb.build();
}

/**
 * Торец стены в углу (виден, когда соседняя стена ниже — скрыта или срезана):
 * вертикальная грань между внутренним и внешним углом от y0 до y1.
 */
export function buildWallEndCap(wall: Wall, end: "start" | "end", y0: number, y1: number) {
  const mb = new MeshBuilder(1);
  const inner: Vec2 = end === "start" ? wall.a : wall.b;
  const outer: Vec2 = end === "start" ? wall.outerA : wall.outerB;
  let nx = outer.y - inner.y;
  let ny = -(outer.x - inner.x);
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  const sign = end === "start" ? -1 : 1;
  if ((nx * wall.dir.x + ny * wall.dir.y) * sign < 0) {
    nx = -nx;
    ny = -ny;
  }
  mb.quad(
    0,
    [inner.x, y0, inner.y],
    [outer.x, y0, outer.y],
    [outer.x, y1, outer.y],
    [inner.x, y1, inner.y],
    [nx, 0, ny],
  );
  return mb.build();
}

/** Подпись геометрии стены для мемоизации (меняется только когда меняется форма). */
export function wallSignature(wall: Wall, holes: Hole[], top: number, shade: WallShade): string {
  const r = (v: number) => Math.round(v * 10000);
  let s = `${shade.startInner ? 1 : 0}${shade.endInner ? 1 : 0}${shade.ceiling === null ? "-" : r(shade.ceiling)}|${r(wall.a.x)},${r(wall.a.y)},${r(wall.b.x)},${r(wall.b.y)},${r(wall.outerA.x)},${r(wall.outerA.y)},${r(wall.outerB.x)},${r(wall.outerB.y)},${r(wall.thickness)},${r(top)}`;
  for (const h of holes) {
    s += "|";
    for (const p of h) s += `${r(p.u)}:${r(p.b)}:${r(p.t)};`;
  }
  return s;
}
