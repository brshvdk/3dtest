import { describe, expect, it } from "vitest";
import { getWalls, polygonArea } from "../../domain/geometry";
import { createOpening } from "../../domain/openings";
import { createRoom } from "../../domain/project";
import { computeRoomSkirting } from "../../domain/skirtingCalc";
import { getCatalogProduct } from "../../domain/skirtingCatalog";
import type { Room } from "../../domain/types";
import {
  doorLeaves,
  hitSkirting,
  hitTest,
  onWall,
  openingExtent,
  skirtingLines,
  uprightAngle,
  wallCuts,
  wallPieces,
} from "../geom";
import { boxVisible, fitView, niceScaleLength, toScreen, toWorld, zoomAt } from "../viewport";

const product = getCatalogProduct("pvc-55")!;

function demo(): Room {
  const room = createRoom({ params: { length: 4, width: 3 } });
  const [a, , c] = getWalls(room);
  const door = { ...createOpening("door", c.id, 1, "door-80") };
  const win = { ...createOpening("window", a.id, 1.35, "win-130x140") };
  return { ...room, openings: [door, win] };
}

describe("стены", () => {
  it("вырезы объединяются и обрезаются по длине стены", () => {
    const room = demo();
    const w = getWalls(room)[0];
    const extra = { ...createOpening("passage", w.id, 3.5, "pass-80") }; // 3.5..4.3 → до 4
    const cuts = wallCuts(w, [...room.openings, extra]);
    expect(cuts).toEqual([
      { from: 1.35, to: 1.35 + 1.3 },
      { from: 3.5, to: 4 },
    ]);
  });

  it("куски стены покрывают кольцо за вычетом проёмов", () => {
    const room = createRoom({ params: { length: 4, width: 3 } });
    const walls = getWalls(room);
    const full = walls.flatMap((w) => wallPieces(w, []));
    const ring = full.reduce((s, p) => s + polygonArea(p), 0);
    // Внешний контур (4,3 × 3,3) минус внутренний (4 × 3).
    expect(ring).toBeCloseTo(4.3 * 3.3 - 12, 6);
    const w = walls[0];
    const cut = wallPieces(w, [{ from: 1, to: 2 }]);
    const area = cut.reduce((s, p) => s + polygonArea(p), 0);
    const whole = wallPieces(w, []).reduce((s, p) => s + polygonArea(p), 0);
    expect(area).toBeCloseTo(whole - 1 * w.thickness, 6);
  });

  it("проём у самого угла не «откусывает» угол", () => {
    const room = createRoom({ params: { length: 4, width: 3 } });
    const w = getWalls(room)[0];
    const pieces = wallPieces(w, [{ from: 0, to: 1 }]);
    const area = pieces.reduce((s, p) => s + polygonArea(p), 0);
    const whole = wallPieces(w, []).reduce((s, p) => s + polygonArea(p), 0);
    expect(area).toBeCloseTo(whole - 1 * w.thickness, 6);
  });
});

describe("двери", () => {
  it("внутрь — полотно в комнату, петли слева у начала проёма", () => {
    const room = demo();
    const w = getWalls(room)[0];
    const o = { ...createOpening("door", w.id, 1, "door-80"), hinge: "left" as const, swing: "in" as const };
    const [leaf] = doorLeaves(o, w);
    // Стена A идёт вправо, комната — ниже (y больше).
    expect(leaf.tip.y).toBeGreaterThan(leaf.hinge.y);
    expect(leaf.closed.x).toBeGreaterThan(leaf.hinge.x);
    expect(openingExtent(o, w).p1).toBeCloseTo(leaf.radius, 6);
  });

  it("наружу — от внешней грани; две створки — две дуги навстречу", () => {
    const room = demo();
    const w = getWalls(room)[0];
    const out = { ...createOpening("door", w.id, 1, "door-80"), swing: "out" as const };
    const [leaf] = doorLeaves(out, w);
    expect(leaf.hinge.y).toBeCloseTo(-w.thickness, 6);
    expect(leaf.tip.y).toBeLessThan(leaf.hinge.y);
    const dbl = createOpening("door", w.id, 1, "door-2x60");
    const leaves = doorLeaves(dbl, w);
    expect(leaves).toHaveLength(2);
    expect(leaves[0].closeDir.x).toBe(1);
    expect(leaves[1].closeDir.x).toBe(-1);
  });
});

describe("плинтус", () => {
  it("линии смещены внутрь и сопряжены в углах; у двери — засечки", () => {
    const room = demo();
    const res = computeRoomSkirting(room, product);
    const off = 0.01;
    const lines = skirtingLines(res, off);
    expect(lines).toHaveLength(res.segments.length);
    // Все точки — внутри комнаты на расстоянии off от стен.
    for (const l of lines) {
      for (const p of [l.p, l.q]) {
        expect(p.x).toBeGreaterThanOrEqual(off - 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(off - 1e-9);
        expect(p.x).toBeLessThanOrEqual(4 - off + 1e-9);
        expect(p.y).toBeLessThanOrEqual(3 - off + 1e-9);
      }
    }
    // Угол A/B: конец A совпадает с началом B (общая точка сопряжения).
    const a = lines.find((l) => l.label === "A")!;
    const b = lines.find((l) => l.label === "B")!;
    expect(a.q).toBe(b.p);
    expect(a.q.x).toBeCloseTo(4 - off, 9);
    expect(a.q.y).toBeCloseTo(off, 9);
    expect(lines.filter((l) => l.startCap).length).toBe(1);
    expect(lines.filter((l) => l.endCap).length).toBe(1);
  });

  it("наведение находит ближайший участок", () => {
    const res = computeRoomSkirting(demo(), product);
    const lines = skirtingLines(res, 0.01);
    const hit = hitSkirting(lines, { x: 3.99, y: 1.5 }, 0.05);
    expect(hit?.label).toBe("B");
    expect(hitSkirting(lines, { x: 2, y: 1.5 }, 0.05)).toBeNull();
  });
});

describe("попадание указателя", () => {
  const room = demo();
  const walls = getWalls(room);
  const opts = { tol: 0.05, pointTol: 0.1 };

  it("приоритет: вершина → проём → стена → пол → пусто", () => {
    expect(hitTest(room, walls, { x: 0.03, y: 0.02 }, opts)).toEqual({ type: "point", id: room.points[0].id });
    const win = room.openings.find((o) => o.kind === "window")!;
    expect(hitTest(room, walls, { x: 2, y: -0.05 }, opts)).toEqual({ type: "opening", id: win.id });
    const t = hitTest(room, walls, { x: 4.07, y: 1.5 }, opts);
    expect(t).toMatchObject({ type: "wall", id: walls[1].id });
    expect(t && t.type === "wall" ? t.along : -1).toBeCloseTo(1.5, 6);
    expect(hitTest(room, walls, { x: 2, y: 1.5 }, opts)).toEqual({ type: "room" });
    expect(hitTest(room, walls, { x: -2, y: 1.5 }, opts)).toBeNull();
  });

  it("дуга двери тоже выделяет дверь", () => {
    const door = room.openings.find((o) => o.kind === "door")!;
    const c = walls[2];
    const inside = onWall(c, door.offset + door.width / 2, 0.4);
    expect(hitTest(room, walls, inside, opts)).toEqual({ type: "opening", id: door.id });
  });
});

describe("подписи и вид", () => {
  it("вертикальные подписи читаются снизу вверх", () => {
    expect(uprightAngle({ x: 1, y: 0 })).toBe(0);
    expect(uprightAngle({ x: -1, y: 0 })).toBeCloseTo(0, 9);
    expect(uprightAngle({ x: 0, y: 1 })).toBe(-90);
    expect(uprightAngle({ x: 0, y: -1 })).toBe(-90);
  });

  it("зум сохраняет точку под курсором, вписывание — в отступах", () => {
    const v = { s: 100, tx: 10, ty: 20 };
    const w0 = toWorld(v, 300, 200);
    const z = zoomAt(v, 300, 200, 1.7);
    const back = toScreen(z, w0);
    expect(back.x).toBeCloseTo(300, 9);
    expect(back.y).toBeCloseTo(200, 9);
    const box = { minX: 0, minY: 0, maxX: 4, maxY: 3, width: 4, height: 3 };
    const f = fitView(box, 800, 600, { top: 50, right: 50, bottom: 50, left: 50 });
    expect(boxVisible(box, f, 800, 600, -49)).toBe(true);
    expect(f.s).toBeCloseTo(Math.min(700 / 4, 500 / 3), 9);
  });

  it("линейка масштаба — «круглая» длина", () => {
    expect(niceScaleLength(100)).toBe(1);
    expect(niceScaleLength(400)).toBe(0.25);
    expect(niceScaleLength(20)).toBe(5);
  });
});

describe("размерные линии и плашки стен", () => {
  it("у входящего угла Г-образной комнаты линии соседних стен сходятся, а не перекрещиваются", async () => {
    const { wallDimLines } = await import("../geom");
    const { segmentsIntersect } = await import("../../domain/geometry");
    const room = createRoom({ shape: "L" });
    const walls = getWalls(room);
    const lines = wallDimLines(walls, (w) => w.thickness + 0.3);
    const n = lines.length;
    let clipped = 0;
    for (let i = 0; i < n; i++) {
      const l1 = lines[i]!;
      const l2 = lines[(i + 1) % n]!;
      expect(segmentsIntersect(l1.a, l1.b, l2.a, l2.b)).toBe(false);
      if (l1.openB) {
        clipped++;
        expect(l2.openA).toBe(true);
        expect(Math.hypot(l1.b.x - l2.a.x, l1.b.y - l2.a.y)).toBeLessThan(1e-9);
      }
    }
    expect(clipped).toBe(1); // один входящий угол
  });

  it("плашки стен П-образной комнаты не накладываются даже при мелком масштабе", async () => {
    const { layoutWallLabels } = await import("../Labels");
    const room = createRoom({ shape: "U" });
    const walls = getWalls(room);
    for (const along of [false, true]) {
      const spots = [...layoutWallLabels(walls, 45, along).values()];
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const a = spots[i].rect;
          const b = spots[j].rect;
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect(overlap).toBe(false);
        }
      }
    }
  });
});
