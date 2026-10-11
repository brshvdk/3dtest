import { describe, expect, it } from "vitest";
import { computeProjectMetrics, computeRoomMetrics } from "../roomMetrics";
import { L_SHAPE, RECT, makeProject, makeRoom, op } from "./calcFixtures";

describe("computeRoomMetrics", () => {
  it("прямоугольник 4×3, высота 2,7 — без проёмов", () => {
    const m = computeRoomMetrics(makeRoom(RECT));
    expect(m.floorArea).toBeCloseTo(12, 9);
    expect(m.ceilingArea).toBeCloseTo(12, 9);
    expect(m.perimeter).toBeCloseTo(14, 9);
    expect(m.wallAreaGross).toBeCloseTo(37.8, 9);
    expect(m.openingsArea).toBe(0);
    expect(m.wallAreaNet).toBeCloseTo(37.8, 9);
    expect(m.volume).toBeCloseTo(32.4, 9);
    expect(m).toMatchObject({ innerCorners: 4, outerCorners: 0, walls: 4 });
  });

  it("проёмы вычитаются из стен, мебель — нет", () => {
    const room = makeRoom(RECT, [
      op("d1", "door", 0, 1), // 0,87 × 2,07
      op("w1", "window", 2, 1), // 1,3 × 1,4
      op("k1", "furniture", 1, 0),
    ]);
    const m = computeRoomMetrics(room);
    const openings = 0.87 * 2.07 + 1.3 * 1.4;
    expect(m.openingsArea).toBeCloseTo(openings, 9);
    expect(m.wallAreaNet).toBeCloseTo(37.8 - openings, 9);
  });

  it("арка и балконный блок — по своим формулам", () => {
    const arch = op("a", "passage", 0, 1, {}, "arch-90"); // 0,9 × 2,1
    const balcony = op("b", "balcony", 2, 1); // 2,0 × 2,1, дверь 0,7, подоконник 0,8
    const m = computeRoomMetrics(makeRoom(RECT, [arch, balcony]));
    const archArea = 0.9 * 2.1 - (1 - Math.PI / 4) * (0.9 * 0.9) / 4;
    const balconyArea = 0.7 * 2.1 + 1.3 * (2.1 - 0.8);
    expect(m.openingsArea).toBeCloseTo(archArea + balconyArea, 9);
  });

  it("проём выше потолка и шире стены обрезается", () => {
    const room = makeRoom(RECT, [op("d1", "door", 1, 0, { width: 5, height: 4 })], { height: 2.5 });
    const m = computeRoomMetrics(room);
    expect(m.openingsArea).toBeCloseTo(3 * 2.5, 9);
  });

  it("проём на несуществующей стене не считается", () => {
    const room = makeRoom(RECT, [{ ...op("d1", "door", 0, 1), wallId: "nope" }]);
    expect(computeRoomMetrics(room).openingsArea).toBe(0);
  });

  it("Г-образная: 1 наружный угол", () => {
    const m = computeRoomMetrics(makeRoom(L_SHAPE));
    expect(m.floorArea).toBeCloseTo(16, 9);
    expect(m.perimeter).toBeCloseTo(18, 9);
    expect(m).toMatchObject({ innerCorners: 5, outerCorners: 1, walls: 6 });
  });

  it("вырожденная комната — нули", () => {
    const m = computeRoomMetrics(makeRoom([[0, 0], [1, 0]]));
    expect(Object.values(m).every((v) => v === 0)).toBe(true);
  });
});

describe("computeProjectMetrics", () => {
  it("по комнатам и итог — суммы", () => {
    const a = { ...makeRoom(RECT), id: "a", name: "Гостиная" };
    const b = { ...makeRoom(L_SHAPE, [op("d", "door", 0, 1)]), id: "b", name: "Спальня", skirtingEnabled: false };
    const { rooms, total } = computeProjectMetrics(makeProject([a, b]));
    expect(rooms.map((r) => [r.roomId, r.name])).toEqual([
      ["a", "Гостиная"],
      ["b", "Спальня"],
    ]);
    expect(total.floorArea).toBeCloseTo(28, 9);
    expect(total.perimeter).toBeCloseTo(32, 9);
    expect(total.volume).toBeCloseTo(28 * 2.7, 9);
    expect(total.openingsArea).toBeCloseTo(0.87 * 2.07, 9);
    expect(total).toMatchObject({ innerCorners: 9, outerCorners: 1, walls: 10 });
  });

  it("пустой проект", () => {
    const { rooms, total } = computeProjectMetrics(makeProject([]));
    expect(rooms).toEqual([]);
    expect(total.floorArea).toBe(0);
  });
});

describe("computeRoomMetrics: состязательные случаи", () => {
  it("проём, частично вышедший за край стены, считается только в пределах стены", () => {
    // Стена A = 4 м, окно 1,3 м начинается в 3,5 м: в стене только 0,5 м.
    const room = makeRoom(RECT, [op("w", "window", 0, 3.5)]);
    expect(computeRoomMetrics(room).openingsArea).toBeCloseTo(0.5 * 1.4, 9);
    // Сдвиг за левый угол.
    const left = makeRoom(RECT, [op("w", "window", 0, -1)]);
    expect(computeRoomMetrics(left).openingsArea).toBeCloseTo(0.3 * 1.4, 9);
    // Целиком за стеной — ноль.
    const out = makeRoom(RECT, [op("w", "window", 0, 5)]);
    expect(computeRoomMetrics(out).openingsArea).toBe(0);
  });

  it("окно выше потолка — ноль, подоконник у потолка — только видимая часть", () => {
    const high = makeRoom(RECT, [op("w", "window", 0, 1, { elevation: 3 })]);
    expect(computeRoomMetrics(high).openingsArea).toBe(0);
    const top = makeRoom(RECT, [op("w", "window", 0, 1, { elevation: 2 })]); // 1,3 × (2,7 − 2)
    expect(computeRoomMetrics(top).openingsArea).toBeCloseTo(1.3 * 0.7, 9);
  });

  it("мусор в размерах проёма не даёт NaN и отрицательной площади", () => {
    const room = makeRoom(RECT, [
      op("a", "door", 0, 1, { width: Number.NaN }),
      op("b", "door", 1, 1, { height: -2 }),
      op("c", "window", 2, 1, { width: -1 }),
      op("d", "door", 3, Number.NaN),
    ]);
    const m = computeRoomMetrics(room);
    expect(m.openingsArea).toBe(0);
    expect(m.wallAreaNet).toBeCloseTo(m.wallAreaGross, 9);
  });

  it("повтор точки (стена нулевой длины) не съедает угол", () => {
    const m = computeRoomMetrics(makeRoom([[0, 0], [4, 0], [4, 0], [4, 3], [0, 3]]));
    expect(m).toMatchObject({ innerCorners: 4, outerCorners: 0, walls: 4 });
    expect(m.perimeter).toBeCloseTo(14, 9);
  });

  it("площадь стен за вычетом проёмов не уходит в минус", () => {
    const room = makeRoom(RECT, [0, 1, 2, 3].map((w) => op(`d${w}`, "door", w, 0, { width: 10, height: 10 })));
    const m = computeRoomMetrics(room);
    expect(m.openingsArea).toBeCloseTo(m.wallAreaGross, 9);
    expect(m.wallAreaNet).toBe(0);
  });
});
