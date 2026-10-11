/**
 * Вид плана: масштаб s (px на метр) и сдвиг (tx, ty) в пикселях.
 * Экран = мир × s + t. Чистые функции — без React.
 */
import type { BBox } from "../domain/geometry";
import type { Vec2 } from "../domain/types";

export interface View {
  s: number;
  tx: number;
  ty: number;
}

/** px/м: от «квартира целиком» до «видно миллиметры». */
export const MIN_SCALE = 8;
export const MAX_SCALE = 2400;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const toWorld = (v: View, sx: number, sy: number): Vec2 => ({
  x: (sx - v.tx) / v.s,
  y: (sy - v.ty) / v.s,
});

export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: p.x * v.s + v.tx, y: p.y * v.s + v.ty });

/** Зум с сохранением точки экрана (px, py) под курсором. */
export function zoomAt(v: View, px: number, py: number, factor: number): View {
  const s = clampScale(v.s * factor);
  const k = s / v.s;
  return { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Вид, при котором box целиком помещается в w×h с отступами pad. */
export function fitView(box: BBox, w: number, h: number, pad: Pad): View {
  const aw = Math.max(40, w - pad.left - pad.right);
  const ah = Math.max(40, h - pad.top - pad.bottom);
  const s = clampScale(Math.min(aw / Math.max(box.width, 0.5), ah / Math.max(box.height, 0.5)));
  const cx = box.minX + box.width / 2;
  const cy = box.minY + box.height / 2;
  return {
    s,
    tx: pad.left + aw / 2 - cx * s,
    ty: pad.top + ah / 2 - cy * s,
  };
}

/** Мировая точка в центре экрана w×h. */
export const viewCenter = (v: View, w: number, h: number): Vec2 => toWorld(v, w / 2, h / 2);

/** Интерполяция видов: центр — линейно, масштаб — логарифмически (без «уплывания»). */
export function lerpView(a: View, b: View, t: number, w: number, h: number): View {
  const ca = viewCenter(a, w, h);
  const cb = viewCenter(b, w, h);
  const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t);
  const cx = ca.x + (cb.x - ca.x) * t;
  const cy = ca.y + (cb.y - ca.y) * t;
  return { s, tx: w / 2 - cx * s, ty: h / 2 - cy * s };
}

/** «Красивая» длина масштабной линейки (м), чтобы она была ~target px. */
export function niceScaleLength(s: number, target = 96): number {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
  let best = steps[0];
  for (const m of steps) {
    if (m * s <= target * 1.35) best = m;
  }
  return best;
}

/** Бокс на экране целиком виден в w×h (с допуском margin px). */
export function boxVisible(box: BBox, v: View, w: number, h: number, margin = 0): boolean {
  const x0 = box.minX * v.s + v.tx;
  const y0 = box.minY * v.s + v.ty;
  const x1 = box.maxX * v.s + v.tx;
  const y1 = box.maxY * v.s + v.ty;
  return x0 >= -margin && y0 >= -margin && x1 <= w + margin && y1 <= h + margin;
}
