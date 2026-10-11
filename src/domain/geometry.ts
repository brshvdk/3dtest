/**
 * Геометрическое ядро: векторы, многоугольники, стены, углы.
 * Чистые функции без зависимостей от React/three. См. соглашения в types.ts.
 */
import type { Corner, CornerKind, Point, Room, Vec2, Wall } from "./types";

export const EPS = 1e-9;
/** Допуск на «совпадение» длин в метрах (1 мм). */
export const LEN_EPS = 1e-3;
/** Допуск для классификации угла как «прямого продолжения», градусы. */
export const STRAIGHT_TOL_DEG = 1;

/* ------------------------------ Векторы ------------------------------ */

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** z-компонента векторного произведения. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
/** Поворот на +90° в математическом смысле: (x, y) → (−y, x). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const vecEquals = (a: Vec2, b: Vec2, eps = LEN_EPS): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Внутренняя нормаль стены с направлением dir (для канонической ориентации). */
export const inwardNormal = (dir: Vec2): Vec2 => ({ x: -dir.y, y: dir.x });
/** Внешняя нормаль стены с направлением dir. */
export const outwardNormal = (dir: Vec2): Vec2 => ({ x: dir.y, y: -dir.x });

export const toDeg = (rad: number): number => (rad * 180) / Math.PI;
export const toRad = (deg: number): number => (deg * Math.PI) / 180;

/* --------------------------- Многоугольники -------------------------- */

/**
 * Площадь со знаком (формула шнуровки). > 0 — каноническая ориентация
 * проекта (на экране с y вниз — обход по часовой стрелке).
 */
export function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polygonArea = (pts: readonly Vec2[]): number =>
  Math.abs(signedArea(pts));

export function polygonPerimeter(pts: readonly Vec2[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    p += distance(pts[i], pts[(i + 1) % pts.length]);
  }
  return p;
}

export const isCanonical = (pts: readonly Vec2[]): boolean =>
  signedArea(pts) > 0;

export function centroid(pts: readonly Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), vec(0, 0));
    return scale(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function bbox(pts: readonly Vec2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!pts.length) minX = minY = maxX = maxY = 0;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Пересечение прямых p + s·d и q + t·e. null, если параллельны.
 */
export function lineIntersection(
  p: Vec2,
  d: Vec2,
  q: Vec2,
  e: Vec2,
): Vec2 | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const s = cross(sub(q, p), e) / den;
  return add(p, scale(d, s));
}

/** Собственное пересечение отрезков ab и cd (касание концами не считается). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  const e = 1e-12;
  if (
    ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) &&
    ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))
  ) {
    return true;
  }
  return false;
}

/** Есть ли у многоугольника самопересечения несмежных рёбер. */
export function polygonSelfIntersects(pts: readonly Vec2[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // смежные рёбра пропускаем
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Точка внутри многоугольника (even-odd). */
export function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Projection {
  /** Параметр вдоль отрезка 0..1 (обрезан). */
  t: number;
  /** Расстояние вдоль отрезка от a, м (обрезано к [0, |ab|]). */
  along: number;
  point: Vec2;
  /** Расстояние от p до ближайшей точки отрезка. */
  dist: number;
  /** Знаковое расстояние до прямой ab по нормали perp(dir) (>0 — внутрь комнаты). */
  signed: number;
}

export function projectToSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const len = Math.sqrt(L2);
  let t = L2 < EPS ? 0 : dot(sub(p, a), ab) / L2;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  const dir = len < EPS ? vec(1, 0) : scale(ab, 1 / len);
  return {
    t,
    along: t * len,
    point,
    dist: distance(p, point),
    signed: dot(sub(p, a), inwardNormal(dir)),
  };
}

/** Удаляет подряд идущие совпадающие точки и точки на одной прямой не трогает. */
export function dedupePoints<T extends Vec2>(pts: readonly T[], eps = LEN_EPS): T[] {
  const out: T[] = [];
  for (const p of pts) {
    if (!out.length || !vecEquals(out[out.length - 1], p, eps)) out.push(p);
  }
  while (out.length > 1 && vecEquals(out[0], out[out.length - 1], eps)) out.pop();
  return out;
}

/* ------------------------------ Стены -------------------------------- */

/** A, B, …, Z, AA, AB, … */
export function wallLabel(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function wallThicknessAt(room: Room, index: number): number {
  const p = room.points[index];
  return p.thickness ?? room.wallThickness;
}

/**
 * Внешний контур стен: вершина i — пересечение внешних линий стен i−1 и i
 * (каждая сдвинута наружу на свою толщину). Для параллельных соседей —
 * точка, сдвинутая по нормали стены i.
 */
export function outerPolygon(room: Room): Vec2[] {
  const pts = room.points;
  const n = pts.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prevI = (i - 1 + n) % n;
    const p0 = pts[prevI];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d1 = normalize(sub(p1, p0));
    const d2 = normalize(sub(p2, p1));
    const t1 = wallThicknessAt(room, prevI);
    const t2 = wallThicknessAt(room, i);
    const o1 = add(p1, scale(outwardNormal(d1), t1));
    const o2 = add(p1, scale(outwardNormal(d2), t2));
    const x = lineIntersection(o1, d1, o2, d2);
    // Очень острые углы дают «шип» — ограничиваем вылет.
    if (!x || distance(x, p1) > 6 * Math.max(t1, t2)) {
      out.push(o2);
    } else {
      out.push(x);
    }
  }
  return out;
}

export function getWalls(room: Room): Wall[] {
  const pts = room.points;
  const n = pts.length;
  const outer = outerPolygon(room);
  const walls: Wall[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dv = sub(b, a);
    const len = length(dv);
    const dir = normalize(dv);
    walls.push({
      id: a.id,
      index: i,
      label: wallLabel(i),
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      length: len,
      dir,
      normalIn: inwardNormal(dir),
      normalOut: outwardNormal(dir),
      thickness: wallThicknessAt(room, i),
      startPointId: a.id,
      endPointId: b.id,
      outerA: outer[i],
      outerB: outer[(i + 1) % n],
    });
  }
  return walls;
}

export function getWall(room: Room, wallId: string): Wall | undefined {
  const idx = room.points.findIndex((p) => p.id === wallId);
  if (idx < 0) return undefined;
  return getWalls(room)[idx];
}

export function wallIndexOf(room: Room, wallId: string): number {
  return room.points.findIndex((p) => p.id === wallId);
}

/** Точка на внутренней грани стены на расстоянии `along` от её начала. */
export function pointOnWall(wall: Wall, along: number): Vec2 {
  return add(wall.a, scale(wall.dir, along));
}

/**
 * Угол между стеной i−1 и стеной i в точке i.
 * Поворот τ = atan2(cross(d1, d2), dot(d1, d2)); внутренний угол = 180° − τ.
 */
export function cornerAt(room: Room, index: number): Corner {
  const pts = room.points;
  const n = pts.length;
  const prevI = (index - 1 + n) % n;
  const p0 = pts[prevI];
  const p1 = pts[index];
  const p2 = pts[(index + 1) % n];
  const d1 = normalize(sub(p1, p0));
  const d2 = normalize(sub(p2, p1));
  const turn = toDeg(Math.atan2(cross(d1, d2), dot(d1, d2)));
  const angle = 180 - turn;
  let kind: CornerKind = "straight";
  if (angle < 180 - STRAIGHT_TOL_DEG) kind = "inner";
  else if (angle > 180 + STRAIGHT_TOL_DEG) kind = "outer";
  return {
    index,
    pointId: p1.id,
    position: { x: p1.x, y: p1.y },
    kind,
    angle,
    prevWallIndex: prevI,
    nextWallIndex: index,
  };
}

export function getCorners(room: Room): Corner[] {
  return room.points.map((_, i) => cornerAt(room, i));
}

/** Полезно для UI: угол близок к прямому (90° или 270°). */
export function isRightAngle(angleDeg: number, tolDeg = 1): boolean {
  return (
    Math.abs(angleDeg - 90) <= tolDeg || Math.abs(angleDeg - 270) <= tolDeg
  );
}

/** Приводит точки к канонической ориентации (signedArea > 0). */
export function toCanonical<T extends Vec2>(pts: readonly T[]): T[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : [...pts];
}

/** Сдвиг всех точек так, чтобы bbox начинался в (0, 0). */
export function translateToOrigin<T extends Point>(pts: readonly T[]): T[] {
  const b = bbox(pts);
  return pts.map((p) => ({ ...p, x: p.x - b.minX, y: p.y - b.minY }));
}

/** Округление координаты до сетки (м). */
export const snap = (v: number, step: number): number =>
  step > 0 ? Math.round(v / step) * step : v;

/** Округление до 0.1 мм — гасим накопление ошибок плавающей точки. */
export const roundCoord = (v: number): number => Math.round(v * 10000) / 10000;

export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
