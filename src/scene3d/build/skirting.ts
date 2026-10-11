/**
 * Плинтус: выдавливание сечения product.profile (мм) вдоль участков
 * RoomSkirtingResult с косым резом на стыках.
 *
 * Сечение: d — от стены в комнату, h — от пола. Для участка a→b с
 * направлением D профиль откладывается по нормали N = (−D.y, D.x) (для
 * стен — внутрь комнаты, для откосов — внутрь проёма). На стыке двух
 * участков точка профиля с отступом d — пересечение линий, смещённых на d
 * от обоих участков: это биссектриса угла, рез без щелей и наложений
 * и для 90°, и для 135°, и для наружных углов, и для откосов.
 */
import { ShapeUtils, Vector2 } from "three";
import type { RoomSkirtingResult, SkirtingSegment } from "../../domain/skirtingCalc";
import type { Vec2 } from "../../domain/types";
import { MeshBuilder, type V3 } from "./builder";

const EPS = 1e-9;
/** Порог сглаживания нормалей сечения (между гранями профиля), градусы. */
const CREASE_DEG = 38;

export interface SegmentNeighbors {
  prev: SkirtingSegment | null;
  next: SkirtingSegment | null;
}

/** Соседи каждого участка по непрерывным цепочкам (через углы). */
export function segmentNeighbors(result: RoomSkirtingResult): Map<string, SegmentNeighbors> {
  const byId = new Map(result.segments.map((s) => [s.id, s]));
  const out = new Map<string, SegmentNeighbors>();
  for (const s of result.segments) out.set(s.id, { prev: null, next: null });
  for (const run of result.runs) {
    const ids = run.segmentIds;
    const n = ids.length;
    for (let k = 0; k < n; k++) {
      const cur = out.get(ids[k]);
      if (!cur) continue;
      const hasPrev = k > 0 || (run.closed && n > 1);
      const hasNext = k < n - 1 || (run.closed && n > 1);
      if (hasPrev) cur.prev = byId.get(ids[(k - 1 + n) % n]) ?? null;
      if (hasNext) cur.next = byId.get(ids[(k + 1) % n]) ?? null;
    }
  }
  // Стык только там, где расчёт его объявил (не торец).
  for (const s of result.segments) {
    const nb = out.get(s.id)!;
    if (s.startJoint === "end") nb.prev = null;
    if (s.endJoint === "end") nb.next = null;
  }
  return out;
}

/** Сечение в метрах, против часовой, без повторов. */
export function normalizeProfile(profile: Array<[number, number]>): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const [d, h] of profile) {
    const p: [number, number] = [Math.max(0, d) / 1000, Math.max(0, h) / 1000];
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) pts.push(p);
  }
  while (
    pts.length > 1 &&
    Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-6 &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-6
  ) {
    pts.pop();
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area < 0 ? pts.reverse() : pts;
}

/** Простое сечение-заглушка, если профиль вырожден. */
export function fallbackProfile(height: number, depth: number): Array<[number, number]> {
  return [
    [0, 0],
    [depth, 0],
    [depth, height * 0.85],
    [depth * 0.6, height],
    [0, height],
  ];
}

export function dirOf(s: SkirtingSegment): Vec2 {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const l = Math.hypot(dx, dy);
  return l < EPS ? { x: 1, y: 0 } : { x: dx / l, y: dy / l };
}

/**
 * Точка сечения с отступом d на стыке P между участком с направлением d1
 * (входящим) и d2 (исходящим). Параллельные — перпендикулярный рез.
 */
export function miterPoint(P: Vec2, d1: Vec2, d2: Vec2, d: number): Vec2 {
  const n1 = { x: -d1.y, y: d1.x };
  const n2 = { x: -d2.y, y: d2.x };
  const den = d1.x * d2.y - d1.y * d2.x;
  const p = { x: P.x + n1.x * d, y: P.y + n1.y * d };
  const q = { x: P.x + n2.x * d, y: P.y + n2.y * d };
  if (Math.abs(den) < 1e-6) return q;
  const s = ((q.x - p.x) * d2.y - (q.y - p.y) * d2.x) / den;
  const x = { x: p.x + d1.x * s, y: p.y + d1.y * s };
  // Очень острый угол — ограничиваем «шип».
  const lim = Math.max(d * 6, 0.02);
  if (Math.hypot(x.x - P.x, x.y - P.y) > lim + d) return q;
  return x;
}

/**
 * Нормали сечения для гладкого затенения: world(k, e, N) — нормаль вершины k
 * на ребре e (k→k+1 или k−1→k) в мире, если сечение откладывается по
 * горизонтальной нормали N. Соседние рёбра с углом меньше CREASE_DEG
 * сглаживаются, острее — остаются гранью.
 */
export function profileNormals(profile: Array<[number, number]>): {
  edge: Array<[number, number]>;
  world: (k: number, e: number, N: Vec2) => V3;
} {
  const n = profile.length;
  // Нормали рёбер сечения (наружу для обхода против часовой).
  const edge: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const p = profile[k];
    const q = profile[(k + 1) % n];
    const ed = q[0] - p[0];
    const eh = q[1] - p[1];
    const l = Math.hypot(ed, eh) || 1;
    edge.push([eh / l, -ed / l]);
  }
  const cosCrease = Math.cos((CREASE_DEG * Math.PI) / 180);
  const world = (k: number, e: number, N: Vec2): V3 => {
    const other = e === k ? (k - 1 + n) % n : (k + 1) % n;
    const a = edge[e];
    const b = edge[other];
    if (a[0] * b[0] + a[1] * b[1] >= cosCrease) {
      const sx = a[0] + b[0];
      const sy = a[1] + b[1];
      const l = Math.hypot(sx, sy) || 1;
      return [(N.x * sx) / l, sy / l, (N.y * sx) / l];
    }
    return [N.x * a[0], a[1], N.y * a[0]];
  };
  return { edge, world };
}

/**
 * Геометрия одного участка плинтуса. Задняя грань (у стены) и нижняя
 * (на полу) не строятся — их не видно. Торцы закрыты на концах 'end'.
 */
export function buildSegmentGeometry(
  seg: SkirtingSegment,
  nb: SegmentNeighbors,
  profile: Array<[number, number]>,
) {
  const mb = new MeshBuilder(1);
  const D = dirOf(seg);
  const N = { x: -D.y, y: D.x };
  const prevD = nb.prev ? dirOf(nb.prev) : null;
  const nextD = nb.next ? dirOf(nb.next) : null;
  const n = profile.length;

  const start: V3[] = [];
  const end: V3[] = [];
  for (const [d, h] of profile) {
    const s = prevD ? miterPoint(seg.a, prevD, D, d) : { x: seg.a.x + N.x * d, y: seg.a.y + N.y * d };
    const e = nextD ? miterPoint(seg.b, D, nextD, d) : { x: seg.b.x + N.x * d, y: seg.b.y + N.y * d };
    start.push([s.x, h, s.y]);
    end.push([e.x, h, e.y]);
  }

  const normals = profileNormals(profile);
  const vertexNormal = (k: number, e: number): V3 => normals.world(k, e, N);

  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const p = profile[k];
    const q = profile[k2];
    if (p[0] < 1e-5 && q[0] < 1e-5) continue; // к стене
    if (p[1] < 1e-5 && q[1] < 1e-5) continue; // к полу
    const na = vertexNormal(k, k);
    const nb2 = vertexNormal(k2, k);
    mb.quadN(0, start[k], start[k2], end[k2], end[k], na, nb2, nb2, na);
  }

  // Торцы.
  if (!nb.prev || !nb.next) {
    const contour = profile.map(([d, h]) => new Vector2(d, h));
    const tris = ShapeUtils.triangulateShape(contour, []);
    if (!nb.prev) {
      const nS: V3 = [-D.x, 0, -D.y];
      for (const [i, j, k] of tris) mb.tri(0, start[i], start[j], start[k], nS);
    }
    if (!nb.next) {
      const nE: V3 = [D.x, 0, D.y];
      for (const [i, j, k] of tris) mb.tri(0, end[i], end[j], end[k], nE);
    }
  }
  return mb.build();
}

/** Подпись участка для мемоизации геометрии. */
export function segmentSignature(seg: SkirtingSegment, nb: SegmentNeighbors, profileKey: string): string {
  const r = (v: number) => Math.round(v * 10000);
  const dk = (s: SkirtingSegment | null) => {
    if (!s) return "-";
    const d = dirOf(s);
    return `${r(d.x)},${r(d.y)}`;
  };
  return `${r(seg.a.x)},${r(seg.a.y)},${r(seg.b.x)},${r(seg.b.y)}|${dk(nb.prev)}|${dk(nb.next)}|${profileKey}`;
}
