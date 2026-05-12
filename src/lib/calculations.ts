/**
 * Расчёты материалов для комнаты.
 * Все размеры — в метрах.
 */

export interface PaintCalc {
  wallArea: number; // м²
  litres: number; // л с учётом числа слоёв
}

export function calcPaint(
  length: number,
  width: number,
  height: number,
  coverage: number, // м²/л на 1 слой
  coats: number,
): PaintCalc {
  const wallArea = 2 * (length + width) * height;
  const litres = (wallArea / coverage) * coats;
  return { wallArea, litres };
}

/** Периметр комнаты в погонных метрах. */
export function calcSkirting(length: number, width: number): number {
  return 2 * (length + width);
}

export interface PlanksCalc {
  floorArea: number;
  plankArea: number;
  base: number;
  withReserve: number;
}

export function calcPlanks(
  length: number,
  width: number,
  plankL: number,
  plankW: number,
  reservePct: number,
): PlanksCalc {
  const floorArea = length * width;
  const plankArea = plankL * plankW;
  const base = Math.ceil(floorArea / plankArea);
  const withReserve = Math.ceil(base * (1 + reservePct / 100));
  return { floorArea, plankArea, base, withReserve };
}
