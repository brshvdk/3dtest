/**
 * Состязательные тесты редактора комнаты: вырожденные входы, численная
 * устойчивость, неизменяемость входа и инварианты после любой операции.
 */
import { describe, expect, it } from "vitest";
import { bbox, dot, getWalls, pointOnWall, roundCoord, signedArea, vecEquals } from "../geometry";
import { createOpening, footprint } from "../openings";
import { createRoom } from "../project";
import {
  MAX_ROOM_EXTENT,
  MAX_ROOM_POINTS,
  MIN_WALL,
  addOpening,
  applyTemplate,
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
  setWallLength,
  setWallThickness,
  splitWall,
  updateOpening,
} from "../roomEdit";
import { ROOM_TEMPLATES, buildTemplatePoints } from "../roomTemplates";
import type { Opening, OpeningKind, Room, RoomShapeId, Vec2 } from "../types";

/** mulberry32 — детерминированный ГПСЧ. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

function mk(pts: Array<[number, number]>, openings: Opening[] = []): Room {
  return {
    id: "r",
    name: "test",
    points: pts.map(([x, y], i) => ({ id: `p${i}`, x, y })),
    height: 2.7,
    wallThickness: 0.2,
    openings,
    shape: "custom",
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

const SHAPES = ROOM_TEMPLATES.map((t) => t.id);
const KINDS: OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];

/** Отрезок проёма в плане (неупорядоченная пара концов). */
function openingSegment(room: Room, o: Opening): [Vec2, Vec2] {
  const w = getWalls(room).find((x) => x.id === o.wallId)!;
  return [pointOnWall(w, o.offset), pointOnWall(w, o.offset + o.width)];
}

function sameSegment(s: [Vec2, Vec2], t: [Vec2, Vec2], eps = 2e-4): boolean {
  return (
    (vecEquals(s[0], t[0], eps) && vecEquals(s[1], t[1], eps)) ||
    (vecEquals(s[0], t[1], eps) && vecEquals(s[1], t[0], eps))
  );
}

/** Инварианты любой комнаты, полученной из редактора. */
function expectRoomInvariants(room: Room, ctx = "") {
  const msg = `${ctx} ${JSON.stringify(room.points.map((p) => [p.x, p.y]))}`;
  expect(isValidPolygon(room.points), msg).toBe(true);
  expect(signedArea(room.points), msg).toBeGreaterThan(0);
  expect(room.points.length, msg).toBeLessThanOrEqual(MAX_ROOM_POINTS);
  expect(new Set(room.points.map((p) => p.id)).size, msg).toBe(room.points.length);
  for (const p of room.points) {
    expect(p.x, msg).toBe(roundCoord(p.x));
    expect(p.y, msg).toBe(roundCoord(p.y));
  }
  const walls = new Map(getWalls(room).map((w) => [w.id, w]));
  for (const w of walls.values()) expect(w.length, msg).toBeGreaterThanOrEqual(MIN_WALL - 1e-6);
  expect(new Set(room.openings.map((o) => o.id)).size, msg).toBe(room.openings.length);
  for (const o of room.openings) {
    const w = walls.get(o.wallId);
    expect(w, `${msg} wallId ${o.wallId}`).toBeDefined();
    for (const key of ["offset", "width", "height", "elevation", "casing", "balconyDoorWidth", "balconySillHeight", "depth"] as const) {
      expect(Number.isFinite(o[key]), `${msg} ${key}=${o[key]}`).toBe(true);
    }
    expect(o.casing, msg).toBeGreaterThanOrEqual(0);
    expect(o.offset, msg).toBeGreaterThanOrEqual(0);
    expect(o.width, msg).toBeGreaterThan(0);
    expect(o.offset + o.width, msg).toBeLessThanOrEqual(w!.length + 1e-9);
    expect(o.balconyDoorWidth, msg).toBeLessThanOrEqual(o.width + 1e-9);
  }
}

describe("шаблоны: любые параметры дают валидную комнату", () => {
  it.each(SHAPES.map((s, i) => [s, 7 + i]))("%s (сид %i)", (shape, seed) => {
    const rnd = rng(seed as number);
    const t = ROOM_TEMPLATES.find((x) => x.id === shape)!;
    for (let k = 0; k < 2000; k++) {
      const params: Record<string, number> = {};
      for (const p of t.params) {
        const r = rnd();
        // границы диапазона и случайные значения, в т.ч. за пределами
        params[p.key] = r < 0.2 ? p.min : r < 0.4 ? p.max : r < 0.45 ? -5 : p.min + rnd() * (p.max - p.min);
      }
      const pts = buildTemplatePoints(shape as RoomShapeId, params);
      const ctx = `${shape} ${JSON.stringify(params)}`;
      expect(isValidPolygon(pts), ctx).toBe(true);
      expect(signedArea(pts), ctx).toBeGreaterThan(0);
      const b = bbox(pts);
      expect(b.minX).toBe(0);
      expect(b.minY).toBe(0);
      // стена A — верхняя (у эркера — левее выступа), слева направо
      expect(pts[1].x, ctx).toBeGreaterThan(pts[0].x);
      expect(pts[1].y, ctx).toBe(pts[0].y);
      expect(pts[0].x, ctx).toBe(0);
    }
  });

  it("трапеция с экстремальным скосом не даёт «шипа»", () => {
    const pts = buildTemplatePoints("trapezoid", { lengthTop: 30, lengthBottom: 1, width: 1 });
    expect(isValidPolygon(pts)).toBe(true);
    // длина сверху (стена A) сохраняется, подгоняется низ
    expect(pts[1].x - pts[0].x).toBeCloseTo(30);
  });
});

describe("isValidPolygon: вырожденные и враждебные входы", () => {
  it("огромные координаты и комнаты больше предела", () => {
    const huge = mk([[0, 0], [1e300, 0], [1e300, 1e300], [0, 1e300]]);
    expect(isValidPolygon(huge.points)).toBe(false);
    const big = MAX_ROOM_EXTENT + 1;
    expect(isValidPolygon(mk([[0, 0], [big, 0], [big, 3], [0, 3]]).points)).toBe(false);
    expect(isValidPolygon(mk([[0, 0], [MAX_ROOM_EXTENT, 0], [MAX_ROOM_EXTENT, 3], [0, 3]]).points)).toBe(true);
  });

  it("слишком много точек — отказ (и без квадратичного зависания)", () => {
    const n = MAX_ROOM_POINTS * 40;
    const R = (n * 0.2) / (2 * Math.PI);
    const pts = Array.from({ length: n }, (_, i) => ({
      x: R * Math.cos((2 * Math.PI * i) / n),
      y: R * Math.sin((2 * Math.PI * i) / n),
    }));
    const t0 = performance.now();
    expect(isValidPolygon(pts)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("пустой массив, бесконечности, повторяющиеся точки", () => {
    expect(isValidPolygon([])).toBe(false);
    expect(isValidPolygon(mk([[0, 0], [Infinity, 0], [4, 3]]).points)).toBe(false);
    expect(isValidPolygon(mk([[0, 0], [4, 0], [4, 0], [4, 3], [0, 3]]).points)).toBe(false);
  });
});

describe("неизменяемость входа", () => {
  it("ни одна операция не мутирует замороженную комнату", () => {
    const base = mk(RECT, [
      { ...createOpening("door", "p0", 1, "door-80"), id: "d" },
      { ...createOpening("window", "p2", 1), id: "w" },
    ]);
    const room = deepFreeze(base);
    const snapshot = JSON.stringify(room);
    const ops: Array<() => unknown> = [
      () => normalizeRoom(room),
      () => normalizeRoom({ ...room, points: [...room.points].reverse() }),
      () => clampOpenings(room),
      () => setWallLength(room, "p0", 5),
      () => moveWall(room, "p1", -0.5),
      () => moveVertex(room, "p2", { x: 5, y: 4 }),
      () => splitWall(room, "p0", 2),
      () => removePoint(room, "p2"),
      () => setWallThickness(room, "p1", 0.3),
      () => addOpening(room, "passage"),
      () => updateOpening(room, "d", { kind: "passage", width: 1.2 }),
      () => updateOpening(room, "d", { presetId: "door-60" }),
      () => moveOpening(room, "d", "p1", 0.5),
      () => removeOpening(room, "d"),
      () => duplicateOpening(room, "d"),
      () => applyTemplate(room, "L"),
      () => applyTemplate(room, "trapezoid"),
      () => findFreeSpot(room, "p0", 0.9),
    ];
    for (const op of ops) expect(op).not.toThrow();
    expect(JSON.stringify(room)).toBe(snapshot);
  });
});

describe("setWallLength: длина действительно становится L", () => {
  it.each(SHAPES.map((s) => [s]))("%s: все стены, разные длины", (shape) => {
    const room = createRoom({ shape: shape as RoomShapeId });
    for (const w of getWalls(room)) {
      for (const k of [0.5, 0.8, 1.1, 1.7]) {
        const target = Math.max(MIN_WALL, Math.round(w.length * k * 1000) / 1000);
        const r = setWallLength(room, w.id, target);
        if (r === room) continue; // отказ допустим (стена вывернулась бы)
        expectRoomInvariants(r, `${shape} ${w.label}→${target}`);
        const after = getWalls(r).find((x) => x.id === w.id)!;
        expect(after.length, `${shape} ${w.label}→${target}`).toBeCloseTo(target, 3);
        // направления всех стен сохраняются
        const before = getWalls(room);
        for (const b of before) {
          const a = getWalls(r).find((x) => x.id === b.id)!;
          expect(dot(a.dir, b.dir)).toBeGreaterThan(0.9999);
        }
      }
    }
  });

  it("абсурдная длина (опечатка 4500 вместо 4,5) отклоняется", () => {
    const room = createRoom();
    expect(setWallLength(room, room.points[0].id, 4500)).toBe(room);
    expect(setWallLength(room, room.points[0].id, Infinity)).toBe(room);
    expect(setWallLength(room, room.points[0].id, -1)).toBe(room);
  });
});

describe("операции без изменений возвращают исходный объект", () => {
  const room = mk(RECT, [{ ...createOpening("door", "p0", 1, "door-80"), id: "d" }]);
  it("updateOpening с теми же значениями", () => {
    const o = room.openings[0];
    expect(updateOpening(room, "d", {})).toBe(room);
    expect(updateOpening(room, "d", { hinge: o.hinge, width: o.width, offset: o.offset })).toBe(room);
    expect(updateOpening(room, "d", { presetId: "door-80" })).toBe(room);
    expect(updateOpening(room, "d", { kind: "door" })).toBe(room);
  });
  it("applyTemplate с теми же параметрами", () => {
    const rect = createRoom();
    expect(applyTemplate(rect, "rect")).toBe(rect);
    expect(applyTemplate(rect, "rect", { length: 5 })).not.toBe(rect);
  });
  it("setWallThickness, равная толщине комнаты по умолчанию", () => {
    expect(setWallThickness(room, "p1", room.wallThickness)).toBe(room);
    const thick = setWallThickness(room, "p1", 0.3);
    expect(setWallThickness(thick, "p1", 0.3)).toBe(thick);
    // явная толщина возвращается к значению комнаты — это правка
    expect(getWalls(setWallThickness(thick, "p1", room.wallThickness))[1].thickness).toBe(room.wallThickness);
  });
});

describe("пресеты проёма", () => {
  it("повторный выбор того же пресета возвращает его размеры", () => {
    // presetId остался, а высота разошлась (старые данные)
    const drifted = { ...createOpening("door", "p0", 1, "door-80"), id: "d", height: 2.3 };
    const room = mk(RECT, [drifted]);
    const r = updateOpening(room, "d", { presetId: "door-80" });
    expect(r.openings[0]).toMatchObject({ presetId: "door-80", width: 0.87, height: 2.07 });
  });
  it("ручная правка размера сбрасывает пресет, возврат к размеру пресета — нет", () => {
    const room = mk(RECT, [{ ...createOpening("window", "p0", 1), id: "w" }]);
    expect(updateOpening(room, "w", { elevation: 0.9 }).openings[0].presetId).toBeNull();
    expect(updateOpening(room, "w", { elevation: 0.85 })).toBe(room);
  });
});

describe("числовой мусор в правках проёма", () => {
  const room = mk(RECT, [{ ...createOpening("door", "p0", 1, "door-80"), id: "d" }]);
  it.each([Number.NaN, Infinity, -Infinity, -1])("значение %s не ломает проём", (v) => {
    const patches: Array<Partial<Opening>> = [
      { casing: v },
      { width: v },
      { offset: v },
      { height: v },
      { elevation: v },
      { depth: v },
      { balconyDoorWidth: v },
      { balconySillHeight: v },
    ];
    for (const patch of patches) {
      const r = updateOpening(room, "d", patch);
      expectRoomInvariants(r, JSON.stringify(patch));
      const fp = footprint(r.openings[0]);
      expect(Number.isFinite(fp.from) && Number.isFinite(fp.to)).toBe(true);
    }
  });
  it("addOpening с мусорным offset ставит проём по центру", () => {
    const r = addOpening(mk(RECT), "door", { wallId: "p0", offset: Number.NaN });
    expect(r.room.openings[0].offset).toBeCloseTo((4 - 0.87) / 2);
  });
});

/**
 * Та же комната с обходом против канонического (как могла прийти из старых
 * данных): стена p_i → p_{i+1} становится p_{i+1} → p_i с id p_{i+1},
 * offset отсчитывается от другого конца. Независимая от roomEdit реализация.
 */
function reverseByHand(room: Room): Room {
  const pts = room.points;
  const n = pts.length;
  const walls = getWalls(room);
  const points = [...pts].reverse().map((p) => {
    const i = pts.indexOf(p);
    const prev = pts[(i - 1 + n) % n]; // стена prev → p в новом обходе идёт p → prev
    const { thickness: _drop, ...rest } = p;
    return prev.thickness === undefined ? rest : { ...rest, thickness: prev.thickness };
  });
  const openings = room.openings.map((o) => {
    const i = pts.findIndex((p) => p.id === o.wallId);
    return { ...o, wallId: pts[(i + 1) % n].id, offset: walls[i].length - o.offset - o.width };
  });
  return { ...room, points, openings };
}

describe("normalizeRoom: разворот сохраняет положение проёмов в плане", () => {
  it.each(SHAPES.map((s, i) => [s, 300 + i]))("%s (сид %i)", (shape, seed) => {
    const rnd = rng(seed as number);
    let room = createRoom({ shape: shape as RoomShapeId });
    for (let i = 0; i < 6; i++) room = addOpening(room, KINDS[Math.floor(rnd() * KINDS.length)]).room;
    room = setWallThickness(room, room.points[1].id, 0.31);
    const reversed = reverseByHand(room);
    expect(signedArea(reversed.points)).toBeLessThan(0);
    for (const o of room.openings) {
      const r = reversed.openings.find((x) => x.id === o.id)!;
      expect(sameSegment(openingSegment(room, o), openingSegment(reversed, r))).toBe(true);
    }
    const n = normalizeRoom(reversed);
    expectRoomInvariants(n, shape as string);
    expect(n.openings).toHaveLength(room.openings.length);
    for (const o of room.openings) {
      const m = n.openings.find((x) => x.id === o.id)!;
      expect(sameSegment(openingSegment(room, o), openingSegment(n, m)), o.kind).toBe(true);
      expect(m.width).toBe(o.width);
      // offset — от ЛЕВОГО угла (изнутри) той же физической стены
      expect(m.wallId).toBe(o.wallId);
      expect(m.offset).toBeCloseTo(o.offset, 9);
    }
    // толщина переехала вместе со стеной
    const thick = getWalls(n).filter((w) => w.thickness === 0.31);
    expect(thick.map((w) => w.id)).toEqual([room.points[1].id]);
    // идемпотентность
    expect(normalizeRoom(n)).toEqual(n);
  });
});

describe("splitWall → removePoint: проёмы на месте", () => {
  it.each(SHAPES.map((s, i) => [s, 500 + i]))("%s (сид %i)", (shape, seed) => {
    const rnd = rng(seed as number);
    let room = createRoom({ shape: shape as RoomShapeId });
    for (let i = 0; i < 5; i++) room = addOpening(room, KINDS[Math.floor(rnd() * KINDS.length)]).room;
    for (const w of getWalls(room)) {
      const at = Math.round(w.length * (0.2 + rnd() * 0.6) * 1000) / 1000;
      const split = splitWall(room, w.id, at);
      if (split === room) continue;
      expectRoomInvariants(split, `${shape} split ${w.label}@${at}`);
      // проёмы, не пересекающие точку деления, остаются на месте в плане
      for (const o of room.openings) {
        if (o.wallId === w.id && o.offset < at && o.offset + o.width > at) continue;
        const m = split.openings.find((x) => x.id === o.id)!;
        expect(sameSegment(openingSegment(room, o), openingSegment(split, m))).toBe(true);
      }
      const newPoint = split.points[split.points.findIndex((p) => p.id === w.id) + 1];
      const merged = removePoint(split, newPoint.id);
      expectRoomInvariants(merged, `${shape} merge ${w.label}`);
      expect(merged.points.map((p) => [p.x, p.y])).toEqual(room.points.map((p) => [p.x, p.y]));
    }
  });
});

describe("moveWall: перемычки на краях списка точек", () => {
  it("последняя стена, следующая (стена 0) на той же прямой", () => {
    // Верхняя сторона разделена точкой p0: последняя стена p4 (0,0)→p0 (2,0) и стена 0 p0→p1 (4,0)
    const room = mk([[2, 0], [4, 0], [4, 3], [0, 3], [0, 0]]);
    const r = moveWall(room, "p4", -0.5); // наружу (вверх)
    expectRoomInvariants(r, "last");
    expect(r.points).toHaveLength(6);
    // буквы стен не съехали: p0 по-прежнему первая и на месте
    expect(r.points[0]).toMatchObject({ id: "p0", x: 2, y: 0 });
    const w = getWalls(r).find((x) => x.id === "p4")!;
    expect(w.a).toEqual({ x: 0, y: -0.5 });
    expect(w.b).toEqual({ x: 2, y: -0.5 });
    expect(signedArea(r.points)).toBeCloseTo(12 + 1);
  });

  it("предыдущая стена на той же прямой", () => {
    // Левая сторона разделена: p3 (0,3) → p4 (0,1.5) → p0 (0,0)
    const room = mk([[0, 0], [4, 0], [4, 3], [0, 3], [0, 1.5]]);
    const r = moveWall(room, "p4", -0.5); // наружу (влево)
    expectRoomInvariants(r, "prev");
    expect(r.points).toHaveLength(6);
    const w = getWalls(r).find((x) => x.id === "p4")!;
    expect(w.a).toEqual({ x: -0.5, y: 1.5 });
    expect(w.b).toEqual({ x: -0.5, y: 0 });
  });

  it("обе соседние стены на той же прямой — две перемычки", () => {
    const room = mk([[0, 0], [1, 0], [3, 0], [4, 0], [4, 3], [0, 3]]);
    const r = moveWall(room, "p1", 0.4); // ниша внутрь комнаты
    expectRoomInvariants(r, "both");
    expect(r.points).toHaveLength(8);
    expect(signedArea(r.points)).toBeCloseTo(12 - 0.8);
  });

  it("ниша с проёмом на сдвигаемом участке — проём едет вместе со стеной", () => {
    const room = mk([[0, 0], [1, 0], [3, 0], [4, 0], [4, 3], [0, 3]], [
      { ...createOpening("window", "p1", 0.5), id: "w", width: 1 },
    ]);
    const r = moveWall(room, "p1", -0.6);
    const o = r.openings.find((x) => x.id === "w")!;
    expect(o.wallId).toBe("p1");
    expect(o.offset).toBeCloseTo(0.5);
    const [a, b] = openingSegment(r, o);
    expect(a.y).toBeCloseTo(-0.6);
    expect(b.y).toBeCloseTo(-0.6);
  });
});

describe("случайные правки: расширенный набор операций", () => {
  function step(room: Room, rnd: () => number): Room {
    const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
    const walls = getWalls(room);
    const wall = pick(walls);
    const opening = room.openings.length ? pick(room.openings) : null;
    const r = rnd();
    if (room.points.length > 16 && r < 0.5) return removePoint(room, pick(room.points).id);
    if (room.openings.length > 10 && opening && r < 0.5) return removeOpening(room, opening.id);
    if (r < 0.1) return setWallLength(room, wall.id, Math.round(wall.length * (0.5 + rnd()) * 1000) / 1000);
    if (r < 0.2) return moveWall(room, wall.id, (rnd() - 0.5) * 1.5);
    if (r < 0.3) {
      const p = pick(room.points);
      return moveVertex(room, p.id, { x: p.x + (rnd() - 0.5), y: p.y + (rnd() - 0.5) });
    }
    if (r < 0.36) return splitWall(room, wall.id, rnd() * wall.length);
    if (r < 0.4) return removePoint(room, pick(room.points).id);
    if (r < 0.43) return setWallThickness(room, wall.id, rnd() * 0.6);
    if (r < 0.46) return applyTemplate(room, pick(SHAPES), { length: 2 + rnd() * 6, width: 2 + rnd() * 5 });
    if (r < 0.56) return addOpening(room, pick(KINDS), rnd() < 0.5 ? { wallId: wall.id, offset: rnd() * wall.length } : {}).room;
    if (!opening) return room;
    if (r < 0.62) return duplicateOpening(room, opening.id).room;
    if (r < 0.7) return moveOpening(room, opening.id, wall.id, (rnd() - 0.2) * wall.length);
    if (r < 0.78) return updateOpening(room, opening.id, { kind: pick(KINDS) });
    if (r < 0.86) {
      const values = [rnd() * 3, -1, Number.NaN, 0, 1e9];
      return updateOpening(room, opening.id, {
        width: pick(values),
        casing: pick([0, 0.07, 0.1, Number.NaN, -0.2]),
        balconyDoorWidth: pick(values),
      });
    }
    if (r < 0.93) return normalizeRoom({ ...room, points: [...room.points].reverse() });
    return removeOpening(room, opening.id);
  }

  it.each(SHAPES.map((s, i) => [s, 9000 + i]))("%s (сид %i)", (shape, seed) => {
    const rnd = rng(seed as number);
    let room = createRoom({ shape: shape as RoomShapeId });
    let applied = 0;
    for (let i = 0; i < 300; i++) {
      const next = step(room, rnd);
      if (next !== room) applied++;
      room = next;
      expectRoomInvariants(room, `#${i}`);
    }
    expect(applied).toBeGreaterThan(80);
  });
});

describe("findFreeSpot: найденное место действительно свободно", () => {
  it("случайные стены и проёмы", () => {
    const rnd = rng(42);
    for (let k = 0; k < 300; k++) {
      let room = mk([[0, 0], [2 + rnd() * 6, 0], [2 + rnd() * 6, 3], [0, 3]]);
      room = normalizeRoom(room);
      if (!isValidPolygon(room.points)) continue;
      for (let i = 0; i < 4; i++) room = addOpening(room, rnd() < 0.5 ? "door" : "passage", { wallId: "p0" }).room;
      const width = 0.3 + rnd() * 1.2;
      const ext = rnd() < 0.5 ? 0.04 : 0;
      const x = findFreeSpot(room, "p0", width, rnd() < 0.5, { extension: ext });
      if (x === null) continue;
      const L = getWalls(room)[0].length;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(L + 1e-4);
      for (const o of room.openings) {
        const fp = footprint(o);
        const overlap = Math.min(fp.to, x + width + ext) - Math.max(fp.from, x - ext);
        // зазор FREE_GAP соблюдён (с точностью округления координат)
        expect(overlap).toBeLessThanOrEqual(-0.05 + 1e-4);
      }
    }
  });
});
