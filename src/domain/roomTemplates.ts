/**
 * Шаблоны формы комнаты: прямоугольник, Г, П, Т, короб в углу, эркер, трапеция.
 *
 * Каждый шаблон строит многоугольник по внутренней грани стен в канонической
 * ориентации (см. types.ts): первая точка — левый верхний угол, первая стена
 * (A) идёт по верхней стороне слева направо. Параметры прижимаются к
 * допустимым диапазонам, поэтому build() всегда даёт корректную комнату.
 */
import { clamp, roundCoord, toCanonical, toRad, translateToOrigin } from "./geometry";
import { createId } from "./ids";
import type { Point, RoomShapeId, Vec2 } from "./types";

export interface ShapeParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
}

export interface RoomTemplate {
  id: RoomShapeId;
  name: string;
  description: string;
  params: ShapeParam[];
  build(params: Record<string, number>): Vec2[];
}

/** м, минимальный остаток стены рядом с вырезом/выступом. */
const MIN_SIDE = 0.3;
/** м, предел размеров комнаты. */
const MAX_SIZE = 30;
/** Градусы: минимальный острый угол скошенной стены трапеции. */
const MIN_SKEW_DEG = 10;

const sizeParam = (key: string, label: string, def: number): ShapeParam => ({
  key,
  label,
  default: def,
  min: 1,
  max: MAX_SIZE,
});

const partParam = (key: string, label: string, def: number, min = MIN_SIDE): ShapeParam => ({
  key,
  label,
  default: def,
  min,
  max: MAX_SIZE - MIN_SIDE,
});

/** Прижимает v к [min, max]; если диапазон пуст — берёт min. */
const fit = (v: number, min: number, max: number): number =>
  max < min ? min : clamp(v, min, max);

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    id: "rect",
    name: "Прямоугольная",
    description: "Обычная комната с четырьмя прямыми углами.",
    params: [sizeParam("length", "Длина", 4.5), sizeParam("width", "Ширина", 3.6)],
    build: ({ length: L, width: W }) => [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: W },
      { x: 0, y: W },
    ],
  },
  {
    id: "L",
    name: "Г-образная",
    description: "Один угол вырезан: кухня-гостиная, комната с нишей.",
    params: [
      sizeParam("length", "Длина", 5),
      sizeParam("width", "Ширина", 4),
      partParam("cutLength", "Вырез: длина", 2),
      partParam("cutWidth", "Вырез: ширина", 1.5),
    ],
    build: (p) => {
      const L = p.length;
      const W = p.width;
      const cl = fit(p.cutLength, MIN_SIDE, L - MIN_SIDE);
      const cw = fit(p.cutWidth, MIN_SIDE, W - MIN_SIDE);
      return [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: W - cw },
        { x: L - cl, y: W - cw },
        { x: L - cl, y: W },
        { x: 0, y: W },
      ];
    },
  },
  {
    id: "U",
    name: "П-образная",
    description: "Посередине нижней стены — выступ внутрь комнаты.",
    params: [
      sizeParam("length", "Длина", 6),
      sizeParam("width", "Ширина", 4.5),
      partParam("notchWidth", "Выступ: ширина", 2),
      partParam("notchDepth", "Выступ: глубина", 1.5),
    ],
    build: (p) => {
      const L = p.length;
      const W = p.width;
      const nw = fit(p.notchWidth, MIN_SIDE, L - 2 * MIN_SIDE);
      const nd = fit(p.notchDepth, MIN_SIDE, W - MIN_SIDE);
      const a = (L - nw) / 2;
      return [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: W },
        { x: a + nw, y: W },
        { x: a + nw, y: W - nd },
        { x: a, y: W - nd },
        { x: a, y: W },
        { x: 0, y: W },
      ];
    },
  },
  {
    id: "T",
    name: "Т-образная",
    description: "Широкая верхняя часть и узкая нижняя по центру.",
    params: [
      sizeParam("length", "Длина", 6),
      sizeParam("width", "Ширина", 5),
      partParam("barDepth", "Верхняя часть: глубина", 2.5),
      partParam("stemWidth", "Нижняя часть: ширина", 3),
    ],
    build: (p) => {
      const L = p.length;
      const W = p.width;
      const h = fit(p.barDepth, MIN_SIDE, W - MIN_SIDE);
      const s = fit(p.stemWidth, MIN_SIDE, L - 2 * MIN_SIDE);
      const x0 = (L - s) / 2;
      return [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: L, y: h },
        { x: x0 + s, y: h },
        { x: x0 + s, y: W },
        { x: x0, y: W },
        { x: x0, y: h },
        { x: 0, y: h },
      ];
    },
  },
  {
    id: "corner-box",
    name: "С коробом в углу",
    description: "Прямоугольник с вентиляционным коробом или колонной в углу.",
    params: [
      sizeParam("length", "Длина", 4.5),
      sizeParam("width", "Ширина", 3.6),
      partParam("boxLength", "Короб: ширина", 0.6, 0.1),
      partParam("boxDepth", "Короб: глубина", 0.4, 0.1),
    ],
    build: (p) => {
      const L = p.length;
      const W = p.width;
      const bl = fit(p.boxLength, 0.1, L - MIN_SIDE);
      const bd = fit(p.boxDepth, 0.1, W - MIN_SIDE);
      return [
        { x: 0, y: 0 },
        { x: L - bl, y: 0 },
        { x: L - bl, y: bd },
        { x: L, y: bd },
        { x: L, y: W },
        { x: 0, y: W },
      ];
    },
  },
  {
    id: "bay",
    name: "С эркером",
    description: "Эркер на верхней стене: боковые стены эркера под 135°.",
    params: [
      sizeParam("length", "Длина", 5),
      sizeParam("width", "Ширина", 4),
      partParam("bayWidth", "Эркер: ширина", 2.6, 0.5),
      partParam("bayDepth", "Эркер: глубина", 0.8, 0.1),
    ],
    build: (p) => {
      const L = p.length;
      const W = p.width;
      const bw = fit(p.bayWidth, 0.5, L - 2 * MIN_SIDE);
      // Передняя стена эркера = bw − 2·d должна оставаться ≥ MIN_SIDE.
      const d = fit(p.bayDepth, 0.1, (bw - MIN_SIDE) / 2);
      const a = (L - bw) / 2;
      // Эркер выступает вверх (y < 0); translateToOrigin вернёт bbox в (0,0).
      return [
        { x: 0, y: 0 },
        { x: a, y: 0 },
        { x: a + d, y: -d },
        { x: a + bw - d, y: -d },
        { x: a + bw, y: 0 },
        { x: L, y: 0 },
        { x: L, y: W },
        { x: 0, y: W },
      ];
    },
  },
  {
    id: "trapezoid",
    name: "Со скошенной стеной",
    description: "Правая стена идёт под углом — комната-трапеция.",
    params: [
      sizeParam("lengthTop", "Длина сверху", 4.5),
      sizeParam("lengthBottom", "Длина снизу", 3.5),
      sizeParam("width", "Ширина", 3.6),
    ],
    build: ({ lengthTop, lengthBottom, width: W }) => {
      // Скос не круче MIN_SKEW_DEG к стене A: иначе острый угол «шип»
      // (комната невалидна и не пережила бы перезагрузку).
      const maxSkew = W / Math.tan(toRad(MIN_SKEW_DEG));
      const bottom = fit(lengthBottom, Math.max(1, lengthTop - maxSkew), lengthTop + maxSkew);
      return [
        { x: 0, y: 0 },
        { x: lengthTop, y: 0 },
        { x: bottom, y: W },
        { x: 0, y: W },
      ];
    },
  },
];

export function getTemplate(id: RoomShapeId): RoomTemplate | undefined {
  return ROOM_TEMPLATES.find((t) => t.id === id);
}

/** Значения параметров шаблона: дефолты + переданные, прижатые к [min, max]. */
export function resolveTemplateParams(
  template: RoomTemplate,
  params: Partial<Record<string, number>> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of template.params) {
    const v = params[p.key];
    out[p.key] =
      typeof v === "number" && Number.isFinite(v) ? clamp(v, p.min, p.max) : p.default;
  }
  return out;
}

/**
 * Точки шаблона с id, в канонической ориентации, bbox начинается в (0,0).
 * Для неизвестного шаблона и 'custom' строится прямоугольник.
 */
export function buildTemplatePoints(
  id: RoomShapeId,
  params?: Partial<Record<string, number>>,
): Point[] {
  const template = getTemplate(id) ?? ROOM_TEMPLATES[0];
  const raw = template.build(resolveTemplateParams(template, params));
  const pts: Point[] = toCanonical(raw).map((p) => ({ id: createId("pt"), x: p.x, y: p.y }));
  return translateToOrigin(pts).map((p) => ({ ...p, x: roundCoord(p.x), y: roundCoord(p.y) }));
}

export const ROOM_NAME_SUGGESTIONS: string[] = [
  "Гостиная",
  "Спальня",
  "Кухня",
  "Детская",
  "Кабинет",
  "Прихожая",
  "Коридор",
  "Ванная",
  "Санузел",
  "Гардеробная",
  "Балкон",
];
