import { describe, expect, it } from "vitest";
import { getCorners, getWalls } from "../../domain/geometry";
import { CASING_INSET, createOpening } from "../../domain/openings";
import type { Opening, OpeningKind, Room } from "../../domain/types";
import { FREE_SIDES, clipExtent, openingSides } from "../build/sides";
import { casingSpan } from "../models/Door";

function makeRoom(pts: Array<[number, number]>, openings: Opening[] = []): Room {
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
  };
}

const op = (kind: OpeningKind, wall: number, offset: number, patch: Partial<Opening> = {}): Opening => ({
  ...createOpening(kind, `p${wall}`, offset),
  id: "o",
  ...patch,
});

function sidesOf(room: Room, o: Opening) {
  const walls = getWalls(room);
  const wall = walls.find((w) => w.id === o.wallId)!;
  return openingSides(walls, getCorners(room), wall, o);
}

const RECT: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
/** Г-образная: наружный угол в точке 3 (3; 2). */
const L_SHAPE: Array<[number, number]> = [
  [0, 0],
  [5, 0],
  [5, 2],
  [3, 2],
  [3, 4],
  [0, 4],
];

describe("openingSides / наличник у угла", () => {
  it("дверь вплотную к внутреннему углу: слева наличник подрезан по соседней стене", () => {
    const door = op("door", 0, 0, { width: 0.8, casing: 0.07 });
    const sides = sidesOf(makeRoom(RECT, [door]), door);
    expect(sides.left).toEqual({ room: 0, slope: 0 });
    expect(sides.right.room).toBeCloseTo(3.2, 9);
    const span = casingSpan(door, sides);
    expect(span.left).toBe(0);
    expect(span.right).toBeCloseTo(0.07 - CASING_INSET, 9);
  });

  it("до угла меньше выступа — наличник ровно до угла", () => {
    const door = op("door", 0, 0.015, { width: 0.8, casing: 0.07 });
    const span = casingSpan(door, sidesOf(makeRoom(RECT, [door]), door));
    expect(span.left).toBeCloseTo(0.015, 9);
  });

  it("у наружного угла наличник не висит за углом", () => {
    // Стена 2: (5; 2) → (3; 2), длина 2; конец — наружный угол.
    const door = op("door", 2, 2 - 0.8, { width: 0.8, casing: 0.07 });
    const sides = sidesOf(makeRoom(L_SHAPE, [door]), door);
    expect(sides.right.room).toBeCloseTo(0, 9);
    expect(casingSpan(door, sides).right).toBeCloseTo(0, 9);
  });

  it("вершина «на прямой» углом не считается — место продолжается по соседней стене", () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ];
    const door = op("door", 1, 0, { width: 0.8, casing: 0.07 });
    const sides = sidesOf(makeRoom(pts, [door]), door);
    expect(sides.left.room).toBeCloseTo(2, 9);
    expect(casingSpan(door, sides).left).toBeCloseTo(0.07 - CASING_INSET, 9);
  });

  it("острый внутренний угол сдвигает границу на толщину детали · cot θ", () => {
    // Треугольник с углом 60° в точке 0.
    const h = Math.sqrt(3) * 2;
    const pts: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [2, h],
    ];
    const door = op("door", 0, 0.03, { width: 0.8, casing: 0.07 });
    const sides = sidesOf(makeRoom(pts, [door]), door);
    expect(sides.left.slope).toBeCloseTo(1 / Math.tan(Math.PI / 3), 6);
    expect(clipExtent(0.04, sides.left, 0.013)).toBeCloseTo(0.03 - 0.013 / Math.sqrt(3), 6);
  });

  it("clipExtent: без угла — как есть, не меньше нуля", () => {
    expect(clipExtent(0.04, FREE_SIDES.left, 0.012)).toBe(0.04);
    expect(clipExtent(0.04, { room: -0.1, slope: 0 }, 0.012)).toBe(0);
    expect(clipExtent(0, { room: 1, slope: 0 }, 0.012)).toBe(0);
  });
});
