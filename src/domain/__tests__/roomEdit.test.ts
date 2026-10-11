import { describe, expect, it } from "vitest";
import {
  getCorners,
  getWalls,
  polygonArea,
  polygonPerimeter,
  signedArea,
} from "../geometry";
import { createOpening, footprint } from "../openings";
import {
  MIN_WALL,
  addOpening,
  applyTemplate,
  clampOpening,
  clampOpenings,
  duplicateOpening,
  findFreeSpot,
  isValidPolygon,
  moveOpening,
  moveVertex,
  moveWall,
  normalizeRoom,
  removeOpening,
  removePoint,
  roomOpeningsOnWall,
  setWallLength,
  setWallThickness,
  splitWall,
  updateOpening,
} from "../roomEdit";
import type { Opening, Room } from "../types";

function mk(pts: Array<[number, number]>, openings: Opening[] = []): Room {
  return {
    id: "r",
    name: "test",
    points: pts.map(([x, y], i) => ({ id: `p${i}`, x, y })),
    height: 2.7,
    wallThickness: 0.2,
    openings,
    shape: "rect",
    skirtingEnabled: true,
    productId: null,
  };
}

const RECT: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
// Г-образная 5×4 с вырезом 2×2 справа снизу
const LSHAPE: Array<[number, number]> = [
  [0, 0],
  [5, 0],
  [5, 2],
  [3, 2],
  [3, 4],
  [0, 4],
];

const door = (wallId: string, offset: number, id = "d1"): Opening => ({
  ...createOpening("door", wallId, offset, "door-80"),
  id,
});
const lengths = (r: Room) => getWalls(r).map((w) => Math.round(w.length * 1e4) / 1e4);
const coords = (r: Room) => r.points.map((p) => [p.x, p.y]);
const overlaps = (a: Opening, b: Opening) => {
  const fa = footprint(a);
  const fb = footprint(b);
  return a.wallId === b.wallId && fa.from < fb.to && fb.from < fa.to;
};

describe("isValidPolygon", () => {
  it("прямоугольник и Г — валидны", () => {
    expect(isValidPolygon(mk(RECT).points)).toBe(true);
    expect(isValidPolygon(mk(LSHAPE).points)).toBe(true);
    // ориентация не важна
    expect(isValidPolygon([...mk(RECT).points].reverse())).toBe(true);
  });
  it("отказ: самопересечение, короткая стена, малая площадь, мусор", () => {
    expect(isValidPolygon(mk([[0, 0], [4, 3], [4, 0], [0, 3]]).points)).toBe(false);
    expect(isValidPolygon(mk([[0, 0], [4, 0], [4, 3], [0.05, 3], [0, 3]]).points)).toBe(false);
    expect(isValidPolygon(mk([[0, 0], [0.6, 0], [0.6, 0.6], [0, 0.6]]).points)).toBe(false);
    expect(isValidPolygon(mk([[0, 0], [4, 0]]).points)).toBe(false);
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
  it("отказ: касание несмежных стен и «шип»", () => {
    // вершина (2,0) лежит на стене нижней части — касание
    const touching = mk([[0, 0], [4, 0], [4, 3], [2, 3], [2, 0.005], [1, 3], [0, 3]]);
    expect(isValidPolygon(touching.points)).toBe(false);
    // стена сложилась обратно на предыдущую
    const spike = mk([[0, 0], [4, 0], [4, 3], [4, 1], [4.0001, 3.5], [0, 3]]);
    expect(isValidPolygon(spike.points)).toBe(false);
  });
});

describe("normalizeRoom", () => {
  it("разворачивает обратную ориентацию и пересчитывает проёмы", () => {
    // Обход против канонического: p0(0,0) → p1(0,3) → p2(4,3) → p3(4,0)
    const room = mk([[0, 0], [0, 3], [4, 3], [4, 0]], [door("p1", 0.5)]);
    room.points[1].thickness = 0.3; // стена p1→p2 (нижняя), толщина 0.3
    expect(signedArea(room.points)).toBeLessThan(0);
    const n = normalizeRoom(room);
    expect(signedArea(n.points)).toBeGreaterThan(0);
    expect(n.points[0].id).toBe("p0");
    // Нижняя стена теперь идёт p2 → p1, её id = p2
    const o = n.openings[0];
    expect(o.wallId).toBe("p2");
    expect(o.offset).toBeCloseTo(4 - 0.5 - 0.87);
    const wall = getWalls(n).find((w) => w.id === "p2")!;
    expect(wall.length).toBeCloseTo(4);
    expect(wall.thickness).toBeCloseTo(0.3);
    expect(wall.b).toEqual({ x: 0, y: 3 });
    // Мировое положение проёма не изменилось: левый край изнутри — x = 0.5 + 0.87 от (4,3)… т.е. центр там же
    const center = wall.a.x + wall.dir.x * (o.offset + o.width / 2);
    expect(center).toBeCloseTo(0.5 + 0.87 / 2);
  });

  it("удаляет нулевые стены и переносит проёмы на соседнюю", () => {
    const room = mk([[0, 0], [4, 0], [4, 0.0004], [4, 3], [0, 3]], [door("p1", 0, "dz")]);
    const n = normalizeRoom(room);
    expect(n.points).toHaveLength(4);
    expect(n.openings[0].wallId).toBe("p2");
    expect(n.openings[0].offset).toBe(0);
  });

  it("округляет координаты и не трогает валидную комнату", () => {
    const room = mk([[0, 0], [4.000000001, 0], [4, 3], [0, 3]]);
    const n = normalizeRoom(room);
    expect(n.points[1].x).toBe(4);
    expect(n.openings).toEqual([]);
  });
});

describe("clampOpening", () => {
  const room = mk(RECT);
  it("ширина ≤ L, offset в пределах", () => {
    const o = door("p1", 10);
    const c = clampOpening(room, { ...o, width: 5 });
    expect(c.width).toBe(3);
    expect(c.offset).toBe(0);
    expect(c.presetId).toBeNull();
    expect(clampOpening(room, { ...o, offset: -1 }).offset).toBe(0);
    expect(clampOpening(room, { ...o, offset: 3.9 }).offset).toBeCloseTo(3 - 0.87);
  });
  it("наличник может выходить за край стены", () => {
    const o = door("p0", 0);
    expect(clampOpening(room, o)).toBe(o);
    expect(footprint(o).from).toBeLessThan(0);
  });
  it("clampOpenings удаляет проёмы без стены", () => {
    const r = clampOpenings({ ...room, openings: [door("nope", 0, "x"), door("p0", 1, "y")] });
    expect(r.openings.map((o) => o.id)).toEqual(["y"]);
    const same = mk(RECT, [door("p0", 1)]);
    expect(clampOpenings(same)).toBe(same);
  });
});

describe("setWallLength", () => {
  it("прямоугольник: A → 5 меняет и C, проём на C остаётся на месте", () => {
    const room = mk(RECT, [door("p2", 2.5)]); // C: (4,3) → (0,3), дверь ближе к левому краю плана
    const r = setWallLength(room, "p0", 5);
    expect(lengths(r)).toEqual([5, 3, 5, 3]);
    expect(coords(r)).toEqual([
      [0, 0],
      [5, 0],
      [5, 3],
      [0, 3],
    ]);
    // начало C сдвинулось, конец — нет: расстояние от конца сохраняется
    expect(r.openings[0].offset).toBeCloseTo(3.5);
    expect(r.shape).toBe("rect");
  });

  it("прямоугольник: B → 4 меняет D", () => {
    const r = setWallLength(mk(RECT), "p1", 4);
    expect(lengths(r)).toEqual([4, 4, 4, 4]);
  });

  it("укорачивание сохраняет проём на A по offset", () => {
    const r = setWallLength(mk(RECT, [door("p0", 1)]), "p0", 3);
    expect(lengths(r)).toEqual([3, 3, 3, 3]);
    expect(r.openings[0].offset).toBe(1);
  });

  it("Г-образная: A → 6 удлиняет C; B → 3 укорачивает D", () => {
    const L = mk(LSHAPE);
    expect(lengths(setWallLength(L, "p0", 6))).toEqual([6, 2, 3, 2, 3, 4]);
    expect(lengths(setWallLength(L, "p1", 3))).toEqual([5, 3, 2, 1, 3, 4]);
    // все углы остаются прямыми
    const r = setWallLength(L, "p1", 3);
    getCorners(r).forEach((c) => expect([90, 270]).toContain(Math.round(c.angle)));
  });

  it("отказ, если стена вывернулась бы или стала короче MIN_WALL", () => {
    const L = mk(LSHAPE);
    expect(setWallLength(L, "p1", 4.5)).toBe(L); // D развернулась бы
    expect(setWallLength(L, "p1", 3.95)).toBe(L); // D = 0.05 < MIN_WALL
    expect(setWallLength(L, "p0", 0.05)).toBe(L);
    expect(setWallLength(L, "p0", Number.NaN)).toBe(L);
    expect(setWallLength(L, "nope", 3)).toBe(L);
    expect(setWallLength(L, "p0", 5)).toBe(L); // без изменений — та же ссылка
  });

  it("следующая стена на той же прямой поглощает изменение", () => {
    const room = mk([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]);
    const r = setWallLength(room, "p0", 2.5);
    expect(lengths(r)).toEqual([2.5, 1.5, 3, 4, 3]);
  });

  it("трапеция: направления всех стен сохраняются", () => {
    const room = mk([[0, 0], [4, 0], [3, 3], [0, 3]]);
    const before = getWalls(room).map((w) => w.dir);
    const r = setWallLength(room, "p0", 5);
    expect(r).not.toBe(room);
    getWalls(r).forEach((w, i) => {
      expect(w.dir.x).toBeCloseTo(before[i].x, 3);
      expect(w.dir.y).toBeCloseTo(before[i].y, 3);
    });
    expect(getWalls(r)[0].length).toBeCloseTo(5);
    expect(getWalls(r)[2].length).toBeCloseTo(getWalls(room)[2].length + 1, 3);
  });
});

describe("moveWall", () => {
  it("сдвиг правой стены наружу и внутрь", () => {
    const room = mk(RECT, [door("p0", 1, "a"), door("p2", 2, "c")]);
    const out = moveWall(room, "p1", -1);
    expect(lengths(out)).toEqual([5, 3, 5, 3]);
    expect(out.openings.find((o) => o.id === "a")!.offset).toBe(1);
    // у C сдвинулось начало — проём остаётся на месте в плане
    expect(out.openings.find((o) => o.id === "c")!.offset).toBeCloseTo(3);
    const inside = moveWall(room, "p1", 0.5);
    expect(lengths(inside)).toEqual([3.5, 3, 3.5, 3]);
  });

  it("отказ при схлопывании комнаты", () => {
    const room = mk(RECT);
    expect(moveWall(room, "p1", 4)).toBe(room);
    expect(moveWall(room, "p1", 3.95)).toBe(room);
    expect(moveWall(room, "p1", 0)).toBe(room);
  });

  it("участок стены на одной прямой: вставляются перемычки (ниша)", () => {
    let room = mk(RECT);
    room = splitWall(room, "p0", 1.5);
    const midId = room.points[1].id;
    room = splitWall(room, midId, 1); // A: 0–1.5, 1.5–2.5, 2.5–4
    expect(room.points).toHaveLength(6);
    const niche = moveWall(room, midId, -0.5);
    expect(niche.points).toHaveLength(8);
    expect(niche.shape).toBe("custom");
    expect(polygonArea(niche.points)).toBeCloseTo(12 + 0.5);
    expect(polygonPerimeter(niche.points)).toBeCloseTo(14 + 1);
    expect(isValidPolygon(niche.points)).toBe(true);
    // стена с этим id — сдвинутый участок
    const w = getWalls(niche).find((x) => x.id === midId)!;
    expect(w.a.y).toBeCloseTo(-0.5);
    expect(w.length).toBeCloseTo(1);
    // повторный сдвиг — без новых точек, перемычки удлиняются
    const deeper = moveWall(niche, midId, -0.25);
    expect(deeper.points).toHaveLength(8);
    expect(polygonArea(deeper.points)).toBeCloseTo(12 + 0.75);
    // слишком маленький сдвиг дал бы перемычку < MIN_WALL
    expect(moveWall(room, midId, -0.05)).toBe(room);
  });

  it("перемычка у стены с индексом 0 не меняет буквы стен", () => {
    let room = mk(RECT);
    room = splitWall(room, "p0", 2); // A: 0–2, A2: 2–4
    const moved = moveWall(room, "p0", -0.5);
    expect(moved.points[0].id).toBe("p0");
    expect(moved.points[0].y).toBeCloseTo(-0.5);
    expect(isValidPolygon(moved.points)).toBe(true);
    expect(signedArea(moved.points)).toBeGreaterThan(0);
    expect(polygonArea(moved.points)).toBeCloseTo(12 + 1);
  });
});

describe("moveVertex", () => {
  it("валидное перемещение, проёмы остаются на месте", () => {
    const room = mk(RECT, [door("p1", 0.5, "b"), door("p2", 0.5, "c")]);
    const r = moveVertex(room, "p2", { x: 5, y: 3 });
    expect(r).not.toBe(room);
    expect(r.shape).toBe("custom");
    expect(r.points[2]).toMatchObject({ x: 5, y: 3 });
    // стена B (конец сдвинут) — offset сохранён; C (начало сдвинуто) — расстояние от конца
    expect(r.openings.find((o) => o.id === "b")!.offset).toBe(0.5);
    const c = r.openings.find((o) => o.id === "c")!;
    const wc = getWalls(r)[2];
    expect(wc.length - c.offset).toBeCloseTo(4 - 0.5);
  });

  it("отказ при самопересечении и вырождении", () => {
    const room = mk(RECT);
    expect(moveVertex(room, "p2", { x: -1, y: -1 })).toBe(room);
    expect(moveVertex(room, "p2", { x: 4, y: 0.05 })).toBe(room);
    expect(moveVertex(room, "p2", { x: 4, y: 3 })).toBe(room);
    expect(moveVertex(room, "nope", { x: 1, y: 1 })).toBe(room);
    // Г: внутренний угол нельзя вытащить за пределы, пересекая стены
    const L = mk(LSHAPE);
    expect(moveVertex(L, "p3", { x: -1, y: 2 })).toBe(L);
  });
});

describe("splitWall / removePoint", () => {
  it("делит стену и переносит проёмы правее точки", () => {
    const room = mk(RECT, [door("p0", 2.5, "right"), door("p0", 0.2, "left")]);
    const r = splitWall(room, "p0", 2);
    expect(r.points).toHaveLength(5);
    const newId = r.points[1].id;
    expect(r.points[1]).toMatchObject({ x: 2, y: 0 });
    expect(r.openings.find((o) => o.id === "right")).toMatchObject({ wallId: newId, offset: 0.5 });
    expect(r.openings.find((o) => o.id === "left")).toMatchObject({ wallId: "p0", offset: 0.2 });
    expect(getCorners(r)[1].kind).toBe("straight");
  });

  it("проём на точке деления остаётся слева и прижимается", () => {
    const room = mk(RECT, [door("p0", 1.6, "x")]);
    const r = splitWall(room, "p0", 2);
    const o = r.openings[0];
    expect(o.wallId).toBe("p0");
    expect(o.offset).toBeCloseTo(2 - 0.87);
  });

  it("отказ у самого края", () => {
    const room = mk(RECT);
    expect(splitWall(room, "p0", MIN_WALL / 2)).toBe(room);
    expect(splitWall(room, "p0", 4 - MIN_WALL / 2)).toBe(room);
  });

  it("удаление точки сливает стены и переносит проёмы проекцией", () => {
    const room = mk(RECT, [door("p0", 2.5, "d")]);
    const split = splitWall(room, "p0", 2);
    const newId = split.points[1].id;
    const merged = removePoint(split, newId);
    expect(merged.points).toHaveLength(4);
    expect(merged.openings[0]).toMatchObject({ wallId: "p0" });
    expect(merged.openings[0].offset).toBeCloseTo(2.5);
  });

  it("удаление угла прямоугольника → треугольник; треугольник не трогаем", () => {
    const room = mk(RECT, [door("p1", 1, "b")]);
    const tri = removePoint(room, "p2");
    expect(tri.points).toHaveLength(3);
    // проём со стены B переехал на гипотенузу p1 → p3
    expect(tri.openings[0].wallId).toBe("p1");
    expect(removePoint(tri, "p1")).toBe(tri);
  });

  it("отказ, если слияние даёт самопересечение", () => {
    // «Наконечник стрелы»: хорда (0,0)→(4,4) пересекает стену (2,1)→(0,4)
    const room = mk([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]]);
    expect(isValidPolygon(room.points)).toBe(true);
    expect(removePoint(room, "p1")).toBe(room);
  });
});

describe("setWallThickness", () => {
  it("задаёт и ограничивает толщину", () => {
    const room = mk(RECT);
    expect(getWalls(setWallThickness(room, "p1", 0.25))[1].thickness).toBe(0.25);
    expect(getWalls(setWallThickness(room, "p1", 5))[1].thickness).toBe(1);
    expect(getWalls(setWallThickness(room, "p1", 0))[1].thickness).toBe(0.02);
    expect(setWallThickness(room, "nope", 0.3)).toBe(room);
  });
});

describe("findFreeSpot", () => {
  const room = mk(RECT);
  it("пустая стена — центр; preferCenter=false — начало", () => {
    expect(findFreeSpot(room, "p0", 1)).toBeCloseTo(1.5);
    expect(findFreeSpot(room, "p0", 1, false)).toBe(0);
    expect(findFreeSpot(room, "p0", 1, false, { extension: 0.04 })).toBeCloseTo(0.04);
  });
  it("обходит занятые места с зазором", () => {
    const r = mk(RECT, [door("p0", 1.5)]); // footprint 1.46–2.41
    const x = findFreeSpot(r, "p0", 0.87, true, { extension: 0.04 })!;
    expect(x).not.toBeNull();
    const probe = { ...door("p0", x, "probe") };
    expect(overlaps(probe, r.openings[0])).toBe(false);
    // ближайшее к центру свободное место — справа: 2.41 + 0.05 + 0.04
    expect(x).toBeCloseTo(2.5);
  });
  it("нет места — null", () => {
    const r = mk(RECT, [door("p1", 1.0)]);
    expect(findFreeSpot(r, "p1", 2, true, { extension: 0.04 })).toBeNull();
    expect(findFreeSpot(room, "p1", 3.5)).toBeNull();
    expect(findFreeSpot(room, "nope", 1)).toBeNull();
  });
  it("excludeId позволяет искать место для перемещаемого проёма", () => {
    const r = mk(RECT, [door("p0", 1.5)]);
    expect(findFreeSpot(r, "p0", 0.87, true, { excludeId: "d1", near: 1.5 })).toBe(1.5);
  });
});

describe("addOpening", () => {
  it("дверь — на самую длинную стену по центру, окно — на стену без дверей", () => {
    const room = mk([[0, 0], [5, 0], [5, 3], [0, 3]]);
    const d = addOpening(room, "door");
    expect(d.openingId).not.toBeNull();
    const dd = d.room.openings[0];
    expect(dd).toMatchObject({ kind: "door", wallId: "p0", presetId: "door-80" });
    expect(dd.offset).toBeCloseTo((5 - 0.87) / 2);
    const w = addOpening(d.room, "window");
    const ww = w.room.openings.find((o) => o.id === w.openingId)!;
    expect(ww.wallId).toBe("p2");
    expect(ww.presetId).toBe("win-130x140");
    expect(ww.elevation).toBeCloseTo(0.85);
  });

  it("на заданную стену: в указанное место или ближайшее свободное", () => {
    const room = mk(RECT, [door("p0", 1.5)]);
    const r = addOpening(room, "door", { wallId: "p0", offset: 1.6 });
    const o = r.room.openings.find((x) => x.id === r.openingId)!;
    expect(o.wallId).toBe("p0");
    expect(overlaps(o, room.openings[0])).toBe(false);
    const free = addOpening(mk(RECT), "passage", { wallId: "p1", offset: 0.3 });
    expect(free.room.openings[0].offset).toBeCloseTo(0.3);
  });

  it("пресет поуже, если стандартный не влезает", () => {
    // Короткая стена B = 0.8 м
    const room = mk([[0, 0], [3, 0], [3, 0.8], [0, 0.8]]);
    const r = addOpening(room, "door", { wallId: "p1" });
    expect(r.room.openings[0].presetId).toBe("door-60");
    // явно выбранный размер не подменяется
    expect(addOpening(room, "door", { wallId: "p1", presetId: "door-90" }).openingId).toBeNull();
  });

  it("мебель подгоняется под свободное место", () => {
    const room = mk([[0, 0], [1.8, 0], [1.8, 1.5], [0, 1.5]]);
    const r = addOpening(room, "furniture");
    const o = r.room.openings[0];
    expect(o.width).toBeCloseTo(1.8);
    expect(o.presetId).toBeNull();
  });

  it("нет места нигде — null и исходная комната", () => {
    const room = mk([[0, 0], [1.2, 0], [1.2, 1], [0, 1]]);
    const r = addOpening(room, "balcony");
    expect(r.openingId).toBeNull();
    expect(r.room).toBe(room);
    expect(addOpening(room, "door", { wallId: "nope" }).openingId).toBeNull();
  });

  it("много дверей подряд не перекрываются", () => {
    let room = mk([[0, 0], [6, 0], [6, 4], [0, 4]]);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = addOpening(room, "door");
      if (r.openingId) ids.push(r.openingId);
      room = r.room;
    }
    expect(ids.length).toBeGreaterThan(4);
    for (const a of room.openings)
      for (const b of room.openings) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });
});

describe("updateOpening / moveOpening / remove / duplicate", () => {
  const room = mk(RECT, [door("p0", 1)]);

  it("смена вида через changeKind сохраняет центр", () => {
    const r = updateOpening(room, "d1", { kind: "window" });
    const o = r.openings[0];
    expect(o.kind).toBe("window");
    expect(o.id).toBe("d1");
    expect(o.offset + o.width / 2).toBeCloseTo(1 + 0.87 / 2);
  });

  it("смена пресета сохраняет центр, ручной размер сбрасывает пресет", () => {
    const r = updateOpening(room, "d1", { presetId: "door-60" });
    const o = r.openings[0];
    expect(o.width).toBeCloseTo(0.67);
    expect(o.offset + o.width / 2).toBeCloseTo(1 + 0.87 / 2);
    const custom = updateOpening(room, "d1", { width: 1.0 });
    expect(custom.openings[0].presetId).toBeNull();
    const same = updateOpening(room, "d1", { width: 0.87, hinge: "right" });
    expect(same.openings[0].presetId).toBe("door-80");
    expect(same.openings[0].hinge).toBe("right");
  });

  it("clamp после правки, id не меняется, несуществующая стена игнорируется", () => {
    const r = updateOpening(room, "d1", { offset: 10, id: "hack", wallId: "nope" });
    expect(r.openings[0]).toMatchObject({ id: "d1", wallId: "p0" });
    expect(r.openings[0].offset).toBeCloseTo(4 - 0.87);
    expect(updateOpening(room, "missing", { width: 1 })).toBe(room);
  });

  it("moveOpening на другую стену с clamp", () => {
    const r = moveOpening(room, "d1", "p1", 2.8);
    expect(r.openings[0]).toMatchObject({ wallId: "p1" });
    expect(r.openings[0].offset).toBeCloseTo(3 - 0.87);
    expect(moveOpening(room, "d1", "nope", 1)).toBe(room);
    expect(moveOpening(room, "d1", "p0", 1)).toBe(room);
  });

  it("remove и duplicate", () => {
    expect(removeOpening(room, "d1").openings).toEqual([]);
    expect(removeOpening(room, "x")).toBe(room);
    const dup = duplicateOpening(room, "d1");
    expect(dup.openingId).not.toBeNull();
    const copy = dup.room.openings.find((o) => o.id === dup.openingId)!;
    expect(copy.wallId).toBe("p0");
    expect(copy.offset).toBeGreaterThan(1 + 0.87);
    expect(overlaps(copy, room.openings[0])).toBe(false);
    expect(roomOpeningsOnWall(dup.room, "p0").map((o) => o.id)).toEqual(["d1", dup.openingId]);
  });

  it("duplicate уходит на другую стену, если на своей нет места", () => {
    const tight = mk([[0, 0], [1.2, 0], [1.2, 3], [0, 3]], [door("p0", 0.2)]);
    const dup = duplicateOpening(tight, "d1");
    const copy = dup.room.openings.find((o) => o.id === dup.openingId)!;
    expect(copy.wallId).not.toBe("p0");
  });
});

describe("applyTemplate", () => {
  it("то же число стен — id и проёмы сохраняются", () => {
    const room = mk(RECT, [door("p2", 1)]);
    const r = applyTemplate(room, "trapezoid", { lengthTop: 5, lengthBottom: 4, width: 3 });
    expect(r.shape).toBe("trapezoid");
    expect(r.points.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(r.openings[0]).toMatchObject({ id: "d1", wallId: "p2", offset: 1 });
  });

  it("другое число стен — проёмы переставляются на стену с тем же индексом", () => {
    const room = mk(RECT, [door("p0", 1), { ...door("p2", 1), id: "d2" }]);
    const r = applyTemplate(room, "L");
    expect(r.points).toHaveLength(6);
    expect(r.shape).toBe("L");
    expect(r.openings).toHaveLength(2);
    const walls = getWalls(r);
    expect(r.openings[0].wallId).toBe(walls[0].id);
    expect(r.openings[0].offset).toBeCloseTo(1);
    expect(r.openings[1].wallId).toBe(walls[2].id);
    expect(isValidPolygon(r.points)).toBe(true);
  });

  it("custom — без изменений", () => {
    const room = mk(RECT);
    expect(applyTemplate(room, "custom")).toBe(room);
  });
});
