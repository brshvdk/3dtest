/**
 * Фикстуры для тестов модуля CALC: комнаты и проёмы строим прямо здесь
 * (объекты по types.ts), без зависимости от модуля комнат.
 */
import { createOpening } from "../openings";
import type { Opening, OpeningKind, Project, Room, SkirtingSettings } from "../types";

/** Комната из точек; id точек (и стен) — p0, p1, … */
export function makeRoom(
  pts: Array<[number, number]>,
  openings: Opening[] = [],
  opts: Partial<Room> = {},
): Room {
  return {
    id: "r",
    name: "Комната",
    points: pts.map(([x, y], i) => ({ id: `p${i}`, x, y })),
    height: 2.7,
    wallThickness: 0.15,
    openings,
    shape: "custom",
    skirtingEnabled: true,
    productId: null,
    ...opts,
  };
}

/** Проём со стандартным размером пресета и детерминированным id. */
export function op(
  id: string,
  kind: OpeningKind,
  wall: number,
  offset: number,
  patch: Partial<Opening> = {},
  presetId?: string,
): Opening {
  return { ...createOpening(kind, `p${wall}`, offset, presetId), id, ...patch };
}

export function makeProject(
  rooms: Room[],
  skirting: Partial<SkirtingSettings> = {},
  productOverrides: Project["productOverrides"] = {},
): Project {
  return {
    schemaVersion: 1,
    id: "prj",
    name: "Тест",
    createdAt: 0,
    updatedAt: 0,
    rooms,
    skirting: {
      productId: "pvc-55",
      reservePct: 5,
      minPiece: 0.3,
      kerf: 0.003,
      shareOffcuts: true,
      ...skirting,
    },
    productOverrides,
    appearance: { wallColor: "#e9e4da", floorPattern: "deck", floorTint: "#c89567" },
  };
}

/** Прямоугольник 4×3 (стены A=4, B=3, C=4, D=3). */
export const RECT: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];

/** Г-образная 5×4 с вырезом 2×2 справа снизу: наружный угол в точке 3. */
export const L_SHAPE: Array<[number, number]> = [
  [0, 0],
  [5, 0],
  [5, 2],
  [3, 2],
  [3, 4],
  [0, 4],
];

/** Эркер: два угла по 135° (точки 2 и 3). */
export const BAY: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 2],
  [3, 3],
  [0, 3],
];

/** Сумма чисел. */
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
