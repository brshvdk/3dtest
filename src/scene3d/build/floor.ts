/**
 * Пол: многоугольник комнаты с UV в мировых метрах и процедурные текстуры
 * раскладки (ламинат вразбежку, ёлочка 45°, плитка 60×60, однотонный).
 *
 * Текстура — бесшовный «тайл» периода раскладки в оттенках серого около
 * белого; цвет (floorTint) задаёт материал умножением. Поэтому смена
 * оттенка не перегенерирует текстуру, а холсты кэшируются по виду
 * раскладки. Разрешение ≤ 2048 px.
 */
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from "three";
import type { FloorPattern, Vec2 } from "../../domain/types";

export interface FloorTile {
  canvas: HTMLCanvasElement;
  /** Размер тайла в метрах (вдоль u, вдоль v). */
  width: number;
  height: number;
}

/* ------------------------------ Шум ---------------------------------- */

function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Хэш «точки мира» по модулю тайла — одинаковый у повторяющихся плашек. */
function cellHash(cx: number, cy: number, tw: number, th: number): number {
  const mx = ((cx % tw) + tw) % tw;
  const my = ((cy % th) + th) % th;
  return hash2(Math.round(mx * 1000), Math.round(my * 1000));
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** Периодический value-noise (период px × py ячеек). */
function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const w = (i: number, j: number) =>
    hash2((((xi + i) % px) + px) % px + seed * 131, (((yi + j) % py) + py) % py + seed * 71);
  const a = w(0, 0);
  const b = w(1, 0);
  const c = w(0, 1);
  const d = w(1, 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/* --------------------------- Генераторы ------------------------------ */

type Shade = (x: number, y: number, px: number) => [number, number, number];

function render(widthM: number, heightM: number, resX: number, shade: Shade): FloorTile {
  const resY = Math.max(16, Math.round((resX * heightM) / widthM));
  const canvas = document.createElement("canvas");
  canvas.width = resX;
  canvas.height = resY;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(resX, resY);
  const data = img.data;
  const pxM = widthM / resX; // метров в пикселе
  let o = 0;
  for (let j = 0; j < resY; j++) {
    const y = (j + 0.5) * pxM;
    for (let i = 0; i < resX; i++) {
      const x = (i + 0.5) * pxM;
      const [r, g, b] = shade(x, y, pxM);
      const n = (hash2(i, j) - 0.5) * 0.025; // мелкое зерно
      data[o] = Math.max(0, Math.min(255, (r + n) * 255));
      data[o + 1] = Math.max(0, Math.min(255, (g + n) * 255));
      data[o + 2] = Math.max(0, Math.min(255, (b + n) * 255));
      data[o + 3] = 255;
      o += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, width: widthM, height: heightM };
}

/** Древесный рисунок вдоль плашки: along/across — в метрах, h — хэш плашки. */
function wood(along: number, across: number, w: number, h: number): number {
  const t = across / w;
  const warp = 0.9 * Math.sin(along * 2.3 + h * 40) + 0.45 * Math.sin(along * 7.1 + h * 17);
  const rings = Math.sin((t * (9 + h * 6) + warp) * Math.PI);
  const fine = Math.sin((t * 61 + warp * 2.5 + along * 0.6) * Math.PI);
  const knot = vnoise(along * 3.2 + h * 50, t * 2.5, 997, 997, 3);
  return 1 - 0.07 * Math.pow(rings * 0.5 + 0.5, 3) - 0.025 * (fine * 0.5 + 0.5) - 0.05 * Math.max(0, knot - 0.72) * 3;
}

/** Фаска/шов: 0 — на шве, 1 — вдали. dist и seam — в метрах. */
function seamFactor(dist: number, seam: number): number {
  if (dist < seam) return 0.5;
  if (dist < seam * 2.2) return 0.82 + 0.18 * ((dist - seam) / (seam * 1.2));
  return 1;
}

function plankTone(h: number): [number, number, number] {
  const l = 0.86 + h * 0.14;
  const warm = (hash2(Math.floor(h * 1e6), 7) - 0.5) * 0.04;
  return [l + warm, l, l - warm * 1.4];
}

/** Ламинат вразбежку: плашка 1,2 × 0,2 м, 6 рядов в тайле со сдвигами. */
function deckTile(): FloorTile {
  const L = 1.2;
  const W = 0.2;
  const rows = 6;
  const offsets = [0, 0.42, 0.81, 0.19, 0.63, 0.31].map((k) => k * L);
  const TW = 2 * L;
  const TH = rows * W;
  return render(TW, TH, 1536, (x, y, px) => {
    const row = Math.floor(y / W);
    const ay = y - row * W;
    const off = offsets[row % rows];
    const xx = x - off;
    const col = Math.floor(xx / L);
    const ax = xx - col * L;
    const h = cellHash(off + col * L + L / 2, row * W + W / 2, TW, TH);
    const tone = plankTone(h);
    const g = wood(ax, ay, W, h);
    const sf = seamFactor(Math.min(ax, L - ax, ay, W - ay), px * 1.3);
    return [tone[0] * g * sf, tone[1] * g * sf, tone[2] * g * sf];
  });
}

/**
 * Ёлочка (английская, прямой торец): плашка 0,6 × 0,1 м, поворот 45°.
 * В «прямой» системе (единица — ширина плашки, длина n ширин) клетка (i, j)
 * принадлежит горизонтальной плашке, если (i − j) mod 2n < n, иначе вертикальной.
 */
function herringboneTile(): FloorTile {
  const W = 0.1;
  const n = 6;
  const S = Math.SQRT2 * W;
  const TW = 12 * S; // 12 шагов «лесенки»
  const TH = 2 * n * S; // два периода вдоль ёлочки
  const toWorld = (i: number, j: number): [number, number] => [
    (W * (i + j)) / Math.SQRT2,
    (W * (i - j)) / Math.SQRT2,
  ];
  return render(TW, TH, 1280, (x, y, px) => {
    const fi = (x + y) / S;
    const fj = (x - y) / S;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const m = (((i - j) % (2 * n)) + 2 * n) % (2 * n);
    let along: number;
    let across: number;
    let cx: number;
    let cy: number;
    if (m < n) {
      // Горизонтальная плашка ряда j.
      along = (m + (fi - i)) * W;
      across = (fj - j) * W;
      const i0 = i - m;
      [cx, cy] = toWorld(i0 + n / 2, j + 0.5);
    } else {
      // Вертикальная плашка столбца i.
      const e = m - n; // 0..n-1 — номер клетки снизу
      const jTop = j - (n - 1 - e);
      along = (fj - jTop) * W;
      across = (fi - i) * W;
      [cx, cy] = toWorld(i + 0.5, jTop + n / 2);
    }
    const h = cellHash(cx, cy, TW, TH);
    const tone = plankTone(h);
    const g = wood(along, across, W, h);
    const sf = seamFactor(Math.min(along, n * W - along, across, W - across), px * 1.2);
    return [tone[0] * g * sf, tone[1] * g * sf, tone[2] * g * sf];
  });
}

/** Плитка 60×60 см, шов 3 мм, лёгкие «облака» камня. */
function tileTile(): FloorTile {
  const T = 0.6;
  const TW = 2 * T;
  return render(TW, TW, 1024, (x, y, px) => {
    const ci = Math.floor(x / T);
    const cj = Math.floor(y / T);
    const ax = x - ci * T;
    const ay = y - cj * T;
    const h = hash2(ci & 1, cj & 1);
    const cloud =
      vnoise((x / TW) * 6, (y / TW) * 6, 6, 6, 1) * 0.6 + vnoise((x / TW) * 18, (y / TW) * 18, 18, 18, 2) * 0.4;
    const base = 0.9 + h * 0.06 + (cloud - 0.5) * 0.07;
    const dist = Math.min(ax, T - ax, ay, T - ay);
    const grout = 0.0015;
    if (dist < grout) return [0.66, 0.66, 0.65];
    const bevel = dist < grout + px * 2 ? 0.86 : 1;
    const v = base * bevel;
    return [v, v, v];
  });
}

/** Однотонное покрытие: едва заметная неоднородность. */
function plainTile(): FloorTile {
  const TW = 2;
  return render(TW, TW, 256, (x, y) => {
    const v = 0.96 + (vnoise((x / TW) * 4, (y / TW) * 4, 4, 4, 5) - 0.5) * 0.025 + (vnoise((x / TW) * 24, (y / TW) * 24, 24, 24, 6) - 0.5) * 0.012;
    return [v, v, v];
  });
}

const tileCache = new Map<FloorPattern, FloorTile>();

export function getFloorTile(pattern: FloorPattern): FloorTile {
  let t = tileCache.get(pattern);
  if (!t) {
    t =
      pattern === "herringbone"
        ? herringboneTile()
        : pattern === "tile"
          ? tileTile()
          : pattern === "plain"
            ? plainTile()
            : deckTile();
    tileCache.set(pattern, t);
  }
  return t;
}

/* ----------------------------- Геометрия ----------------------------- */

/**
 * Пол комнаты: треугольники многоугольника на y = 0, UV — мировые метры,
 * повёрнутые на angle (раскладка вдоль длинной стены) и делённые на тайл.
 */
export function buildFloorGeometry(points: Vec2[], angle: number, tileW: number, tileH: number) {
  const contour = points.map((p) => new Vector2(p.x, p.y));
  const tris = ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(points.length * 3);
  const uv = new Float32Array(points.length * 2);
  const uv1 = new Float32Array(points.length * 2);
  const bb = boundsOf(points);
  const nrm = new Float32Array(points.length * 3);
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  points.forEach((p, i) => {
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = p.y;
    nrm[i * 3 + 1] = 1;
    uv[i * 2] = (p.x * c - p.y * s) / tileW;
    uv[i * 2 + 1] = (p.x * s + p.y * c) / tileH;
    uv1[i * 2] = (p.x - bb.x) / bb.w;
    uv1[i * 2 + 1] = 1 - (p.y - bb.y) / bb.h;
  });
  const index: number[] = [];
  for (const [a, b, d] of tris) {
    // Нормаль вверх: в мире (x, y, z=plan.y) обход должен быть по часовой в плане.
    const pa = points[a];
    const pb = points[b];
    const pd = points[d];
    const cr = (pb.x - pa.x) * (pd.y - pa.y) - (pb.y - pa.y) * (pd.x - pa.x);
    if (cr > 0) index.push(a, d, b);
    else index.push(a, b, d);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("uv1", new Float32BufferAttribute(uv1, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

function boundsOf(points: Vec2[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0) };
}

/**
 * Карта затенения пола (ambient occlusion): темнее у стен и сильнее в
 * углах. Канал uv1 — габарит комнаты 0..1 (y снизу вверх, как у текстур).
 */
export function buildFloorAO(points: Vec2[]): HTMLCanvasElement {
  const bb = boundsOf(points);
  const res = 256;
  const W = bb.w >= bb.h ? res : Math.max(16, Math.round((res * bb.w) / bb.h));
  const H = bb.h >= bb.w ? res : Math.max(16, Math.round((res * bb.h) / bb.w));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const n = points.length;
  const R = 0.2; // м — радиус затенения у стены
  for (let j = 0; j < H; j++) {
    const y = bb.y + ((j + 0.5) / H) * bb.h;
    for (let i = 0; i < W; i++) {
      const x = bb.x + ((i + 0.5) / W) * bb.w;
      // Сумма вкладов ближайших стен — в углах темнее.
      let occ = 0;
      for (let k = 0; k < n; k++) {
        const a = points[k];
        const b = points[(k + 1) % n];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
        const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        occ += Math.exp(-d / R);
      }
      const v = Math.round(255 * Math.max(0.3, 1 - 0.42 * Math.min(1.5, occ)));
      const o = (j * W + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Радиальная «тень» под моделью (чёрный с прозрачностью к краям). */
let shadowCanvas: HTMLCanvasElement | null = null;
export function getSoftShadowCanvas(): HTMLCanvasElement {
  if (shadowCanvas) return shadowCanvas;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.45, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  shadowCanvas = c;
  return c;
}
