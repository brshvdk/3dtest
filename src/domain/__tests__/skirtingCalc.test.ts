import { describe, expect, it } from "vitest";
import { estimateProject } from "../estimate";
import { getCorners, getWalls } from "../geometry";
import { skirtingBlock } from "../openings";
import { computeRoomSkirting, miterExtension } from "../skirtingCalc";
import type { RoomSkirtingResult, SkirtingSegment } from "../skirtingCalc";
import { SKIRTING_CATALOG, getCatalogProduct, resolveProduct } from "../skirtingCatalog";
import type { Corner, Opening, OpeningKind, Room, SkirtingProduct, Wall } from "../types";
import { BAY, L_SHAPE, RECT, makeProject, makeRoom, op, sum } from "./calcFixtures";

const PVC = getCatalogProduct("pvc-55")!; // фурнитура, height 55 мм
const MDF_PAINT = getCatalogProduct("mdf-100-paint")!; // запил, depth 16 мм

const calc = (room: Room, product: SkirtingProduct = PVC) => computeRoomSkirting(room, product);
const seg = (r: RoomSkirtingResult, id: string): SkirtingSegment => {
  const s = r.segments.find((x) => x.id === id);
  if (!s) throw new Error(`нет сегмента ${id}: ${r.segments.map((x) => x.id).join(", ")}`);
  return s;
};
const lengths = (r: RoomSkirtingResult) => r.segments.map((s) => +s.length.toFixed(4));

/** Инварианты, которые должны держаться для любой комнаты. */
function expectConsistent(r: RoomSkirtingResult) {
  const net = r.perimeter - sum(r.deductions.map((d) => d.length)) + sum(r.reveals.map((d) => d.length));
  expect(r.netLength).toBeCloseTo(net, 9);
  expect(r.netLength).toBeCloseTo(sum(r.segments.map((s) => s.length)), 9);
  expect(sum(r.runs.map((x) => x.length))).toBeCloseTo(r.netLength, 9);
  expect(r.runs.flatMap((x) => x.segmentIds).sort()).toEqual(r.segments.map((s) => s.id).sort());
  expect(new Set(r.segments.map((s) => s.id)).size).toBe(r.segments.length);
  for (const s of r.segments) {
    expect(s.length).toBeGreaterThanOrEqual(0.005 - 1e-12);
    expect(s.materialLength).toBeGreaterThanOrEqual(s.length);
    expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(s.length, 9);
  }
  // Стыки согласованы: конец сегмента = начало следующего (по кругу).
  const m = r.segments.length;
  r.segments.forEach((s, i) => {
    const next = r.segments[(i + 1) % m];
    if (s.endJoint !== "end") {
      expect(next.startJoint).toBe(s.endJoint);
      expect(next.startAngle).toBeCloseTo(s.endAngle, 9);
      expect(next.a.x).toBeCloseTo(s.b.x, 9);
      expect(next.a.y).toBeCloseTo(s.b.y, 9);
    }
  });
  const ends = r.segments.filter((s) => s.startJoint === "end").length;
  expect(r.endCaps.left).toBe(ends);
  expect(r.endCaps.right).toBe(r.segments.filter((s) => s.endJoint === "end").length);
  if (m > 0) expect(r.runs.every((x) => x.closed)).toBe(ends === 0);
}

describe("miterExtension", () => {
  it("наружный угол 270° удлиняет на толщину", () => {
    expect(miterExtension(270, 0.02)).toBeCloseTo(0.02, 12);
  });
  it("внутренние и прямые углы не удлиняют", () => {
    expect(miterExtension(90, 0.02)).toBe(0);
    expect(miterExtension(135, 0.02)).toBe(0);
    expect(miterExtension(180, 0.02)).toBe(0);
  });
  it("тупой наружный угол 225° — depth·tan(22,5°)", () => {
    expect(miterExtension(225, 0.016)).toBeCloseTo(0.016 * Math.tan(Math.PI / 8), 12);
  });
  it("вырожденный «шип» ограничен", () => {
    expect(Number.isFinite(miterExtension(359.9, 0.02))).toBe(true);
    expect(miterExtension(359.9, 0.02)).toBeLessThan(0.25);
  });
});

describe("прямоугольник 4×3 без проёмов", () => {
  const r = calc(makeRoom(RECT));

  it("периметр и чистая длина", () => {
    expect(r.perimeter).toBeCloseTo(14, 9);
    expect(r.netLength).toBeCloseTo(14, 9);
    expect(r.deductions).toEqual([]);
    expect(r.reveals).toEqual([]);
    expect(r.warnings).toEqual([]);
    expectConsistent(r);
  });

  it("4 сегмента по стенам, все стыки — внутренние углы 90°", () => {
    expect(r.segments.map((s) => s.label)).toEqual(["A", "B", "C", "D"]);
    expect(r.segments.map((s) => s.id)).toEqual(["r:p0:1", "r:p1:1", "r:p2:1", "r:p3:1"]);
    expect(lengths(r)).toEqual([4, 3, 4, 3]);
    for (const s of r.segments) {
      expect(s.startJoint).toBe("inner");
      expect(s.endJoint).toBe("inner");
      expect(s.startAngle).toBeCloseTo(90, 9);
      expect(s.endAngle).toBeCloseTo(90, 9);
      expect(s.materialLength).toBe(s.length);
      expect(s.isReveal).toBe(false);
      expect(s.openingId).toBeNull();
    }
    expect(seg(r, "r:p0:1").a).toEqual({ x: 0, y: 0 });
    expect(seg(r, "r:p0:1").b).toEqual({ x: 4, y: 0 });
  });

  it("одна замкнутая цепочка, 4 внутренних угла, без заглушек", () => {
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].closed).toBe(true);
    expect(r.runs[0].segmentIds).toHaveLength(4);
    expect(r.runs[0].length).toBeCloseTo(14, 9);
    expect(r.corners).toEqual({ inner: 4, outer: 0, nonRight: 0 });
    expect(r.endCaps).toEqual({ left: 0, right: 0 });
  });

  it("служебные поля", () => {
    expect(r.roomId).toBe("r");
    expect(r.roomName).toBe("Комната");
    expect(r.productId).toBe("pvc-55");
  });
});

describe("двери", () => {
  it("дверь 80 посреди стены: вычет 0,87 + 2·0,04 = 0,95, две заглушки", () => {
    const offset = (4 - 0.87) / 2;
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, offset)]));
    expect(r.deductions).toHaveLength(1);
    expect(r.deductions[0]).toMatchObject({ openingId: "d1", kind: "door", wallLabel: "A" });
    expect(r.deductions[0].label).toBe("Дверь 87×207 см");
    expect(r.deductions[0].length).toBeCloseTo(0.95, 9);
    expect(r.netLength).toBeCloseTo(13.05, 9);

    expect(r.segments.map((s) => s.label)).toEqual(["A", "A2", "B", "C", "D"]);
    const a1 = seg(r, "r:p0:1");
    const a2 = seg(r, "r:p0:2");
    expect(a1.from).toBe(0);
    expect(a1.to).toBeCloseTo(offset - 0.04, 9);
    expect(a1.endJoint).toBe("end");
    expect(a1.endAngle).toBe(180);
    expect(a2.from).toBeCloseTo(offset + 0.87 + 0.04, 9);
    expect(a2.to).toBe(4);
    expect(a2.startJoint).toBe("end");

    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expect(r.corners).toEqual({ inner: 4, outer: 0, nonRight: 0 });
    // Цепочка начинается после двери и обходит комнату до двери.
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].closed).toBe(false);
    expect(r.runs[0].segmentIds).toEqual(["r:p0:2", "r:p1:1", "r:p2:1", "r:p3:1", "r:p0:1"]);
    expectConsistent(r);
  });

  it("дверь в самом углу: наличник за углом обрезается, угол пропадает", () => {
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, 0)]));
    expect(r.deductions[0].length).toBeCloseTo(0.87 + 0.04, 9);
    const a = seg(r, "r:p0:1");
    expect(a.from).toBeCloseTo(0.91, 9);
    expect(a.startJoint).toBe("end");
    expect(seg(r, "r:p3:1").endJoint).toBe("end");
    expect(r.corners.inner).toBe(3);
    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expectConsistent(r);
  });

  it("дверь в конце стены: свободный конец у следующей стены", () => {
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, 4 - 0.87)]));
    expect(r.deductions[0].length).toBeCloseTo(0.91, 9);
    expect(seg(r, "r:p0:1").to).toBeCloseTo(4 - 0.91, 9);
    expect(seg(r, "r:p1:1").startJoint).toBe("end");
    expect(r.corners.inner).toBe(3);
    expectConsistent(r);
  });

  it("огрызок < 5 мм у угла не превращается в кусок, а уходит в вычет", () => {
    // Наличник начинается в 2 мм от угла.
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, 0.042)]));
    expect(r.segments.every((s) => s.length >= 0.005)).toBe(true);
    expect(r.segments.some((s) => s.wallId === "p0" && s.from < 0.01)).toBe(false);
    expect(r.deductions[0].length).toBeCloseTo(0.952, 9);
    expect(r.warnings).toEqual([]);
    expect(seg(r, "r:p3:1").endJoint).toBe("end");
    expectConsistent(r);
  });

  it("короткий участок 3 см — остаётся, но с предупреждением", () => {
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, 0.07)]));
    const a = seg(r, "r:p0:1");
    expect(a.length).toBeCloseTo(0.03, 9);
    expect(a.startJoint).toBe("inner");
    expect(r.warnings.some((w) => w.includes("Короткий участок 3 см на стене A"))).toBe(true);
    expectConsistent(r);
  });

  it("дверь без наличника вычитается по ширине проёма", () => {
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, 1, { casing: 0 })]));
    expect(r.deductions[0].length).toBeCloseTo(0.87, 9);
    expectConsistent(r);
  });

  it("две двери на одной стене — три участка A, A2, A3", () => {
    const r = calc(makeRoom(RECT, [op("d2", "door", 0, 2.5), op("d1", "door", 0, 0.5)]));
    expect(r.segments.filter((s) => s.wallId === "p0").map((s) => s.label)).toEqual(["A", "A2", "A3"]);
    // Вычеты в порядке вдоль стены.
    expect(r.deductions.map((d) => d.openingId)).toEqual(["d1", "d2"]);
    expect(r.endCaps).toEqual({ left: 2, right: 2 });
    expect(r.runs).toHaveLength(2);
    expectConsistent(r);
  });
});

describe("окна, балкон, мебель", () => {
  it("обычное окно (подоконник 85 см) на плинтус не влияет", () => {
    const r = calc(makeRoom(RECT, [op("w1", "window", 0, 1.35)]));
    expect(r.deductions).toEqual([]);
    expect(r.netLength).toBeCloseTo(14, 9);
    expect(r.runs[0].closed).toBe(true);
  });

  it("панорамное окно в пол прерывает плинтус на свою ширину", () => {
    const r = calc(makeRoom(RECT, [op("w1", "window", 0, 1, {}, "win-pano")]));
    expect(r.deductions).toHaveLength(1);
    expect(r.deductions[0].length).toBeCloseTo(2.0, 9);
    expect(r.netLength).toBeCloseTo(12, 9);
    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expectConsistent(r);
  });

  it("окно с подоконником ниже верха плинтуса тоже прерывает", () => {
    const r = calc(makeRoom(RECT, [op("w1", "window", 0, 1, { elevation: 0.05 })]));
    expect(r.deductions[0].length).toBeCloseTo(1.3, 9);
  });

  it("балкон с дверью слева: вычет только ширины двери, слева в блоке", () => {
    const r = calc(makeRoom(RECT, [op("b1", "balcony", 0, 1)])); // 2,0 м, дверь 0,7 слева
    expect(r.deductions[0].length).toBeCloseTo(0.7, 9);
    expect(seg(r, "r:p0:1").to).toBeCloseTo(1, 9);
    expect(seg(r, "r:p0:2").from).toBeCloseTo(1.7, 9);
    expectConsistent(r);
  });

  it("балкон с дверью справа", () => {
    const r = calc(makeRoom(RECT, [op("b1", "balcony", 0, 1, { balconyDoorSide: "right" })]));
    expect(r.deductions[0].length).toBeCloseTo(0.7, 9);
    expect(seg(r, "r:p0:1").to).toBeCloseTo(2.3, 9);
    expect(seg(r, "r:p0:2").from).toBeCloseTo(3, 9);
  });

  it("балкон с подоконником ниже плинтуса — вычет всей ширины блока", () => {
    const r = calc(makeRoom(RECT, [op("b1", "balcony", 0, 1, { balconySillHeight: 0.03 })]));
    expect(r.deductions[0].length).toBeCloseTo(2.0, 9);
  });

  it("мебель (кухня) у угла: плинтуса за ней нет", () => {
    const r = calc(makeRoom(RECT, [op("k1", "furniture", 0, 0)]));
    expect(r.deductions[0]).toMatchObject({ kind: "furniture", label: "Кухня 240×90 см" });
    expect(r.deductions[0].length).toBeCloseTo(2.4, 9);
    expect(seg(r, "r:p0:1").from).toBeCloseTo(2.4, 9);
    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expect(r.corners.inner).toBe(3);
    expectConsistent(r);
  });

  it("мебель во всю стену — у стены нет сегментов, соседи заканчиваются торцами", () => {
    const r = calc(makeRoom(RECT, [op("k1", "furniture", 1, 0, { width: 3 })]));
    expect(r.segments.some((s) => s.wallId === "p1")).toBe(false);
    expect(seg(r, "r:p0:1").endJoint).toBe("end");
    expect(seg(r, "r:p2:1").startJoint).toBe("end");
    expect(r.corners.inner).toBe(2);
    expectConsistent(r);
  });

  it("весь периметр занят — плинтус не нужен", () => {
    const r = calc(
      makeRoom(RECT, [
        op("k1", "furniture", 0, 0, { width: 4 }),
        op("k2", "furniture", 1, 0, { width: 3 }),
        op("k3", "furniture", 2, 0, { width: 4 }),
        op("k4", "furniture", 3, 0, { width: 3 }),
      ]),
    );
    expect(r.segments).toEqual([]);
    expect(r.runs).toEqual([]);
    expect(r.netLength).toBe(0);
    expect(r.endCaps).toEqual({ left: 0, right: 0 });
    expect(r.warnings.some((w) => w.includes("не нужен"))).toBe(true);
    expectConsistent(r);
  });

  it("проём на несуществующей стене игнорируется", () => {
    const r = calc(makeRoom(RECT, [{ ...op("x", "door", 0, 1), wallId: "nope" }]));
    expect(r.deductions).toEqual([]);
    expect(r.netLength).toBeCloseTo(14, 9);
  });
});

describe("перекрывающиеся проёмы", () => {
  it("вычитаются без двойного счёта, с предупреждением", () => {
    const r = calc(
      makeRoom(RECT, [
        op("d1", "door", 0, 1), // [0,96; 1,91]
        op("k1", "furniture", 0, 1.5, { width: 1.5 }), // [1,5; 3,0]
      ]),
    );
    const byId = Object.fromEntries(r.deductions.map((d) => [d.openingId, d.length]));
    expect(byId.d1).toBeCloseTo(0.95, 9);
    expect(byId.k1).toBeCloseTo(3.0 - 1.91, 9);
    expect(sum(r.deductions.map((d) => d.length))).toBeCloseTo(3.0 - 0.96, 9);
    expect(r.segments.filter((s) => s.wallId === "p0")).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes("перекрываются"))).toBe(true);
    expectConsistent(r);
  });

  it("проём целиком внутри другого ничего не добавляет к вычету", () => {
    const r = calc(
      makeRoom(RECT, [op("k1", "furniture", 0, 0.5, { width: 3 }), op("d1", "door", 0, 1)]),
    );
    expect(r.deductions.map((d) => d.openingId)).toEqual(["k1"]);
    expect(r.deductions[0].length).toBeCloseTo(3, 9);
    expectConsistent(r);
  });

  it("касающиеся наличники двух дверей — без предупреждения и без огрызка", () => {
    const r = calc(makeRoom(RECT, [op("d1", "door", 0, 1), op("d2", "door", 0, 1.95)]));
    expect(r.warnings).toEqual([]);
    expect(sum(r.deductions.map((d) => d.length))).toBeCloseTo(1.9, 9);
    expect(r.segments.filter((s) => s.wallId === "p0")).toHaveLength(2);
  });
});

describe("проём с обходом откосов", () => {
  const room = makeRoom(RECT, [op("p1", "passage", 0, 1.55)]); // 0,9 м, стена 0,15
  const r = calc(room);

  it("+2·толщина стены, два наружных угла", () => {
    expect(r.deductions[0].length).toBeCloseTo(0.9, 9);
    expect(r.reveals).toEqual([
      { openingId: "p1", label: "Проём 90×210 см", wallLabel: "A", length: expect.closeTo(0.3, 9) },
    ]);
    expect(r.netLength).toBeCloseTo(14 - 0.9 + 0.3, 9);
    expect(r.corners).toEqual({ inner: 4, outer: 2, nonRight: 0 });
    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expectConsistent(r);
  });

  it("откосы на своих местах в порядке обхода", () => {
    expect(r.segments.map((s) => s.label)).toEqual(["A", "A·откос", "A·откос", "A2", "B", "C", "D"]);
    const left = seg(r, "r:p1:rev-l");
    const right = seg(r, "r:p1:rev-r");
    expect(left).toMatchObject({
      wallId: "p0",
      isReveal: true,
      openingId: "p1",
      from: 0,
      to: 0.15,
      startJoint: "outer",
      startAngle: 270,
      endJoint: "end",
    });
    // Левый откос идёт от стены наружу (normalOut стены A = вверх, y−).
    expect(left.a).toEqual({ x: 1.55, y: 0 });
    expect(left.b.x).toBeCloseTo(1.55, 9);
    expect(left.b.y).toBeCloseTo(-0.15, 9);
    expect(right.a.y).toBeCloseTo(-0.15, 9);
    expect(right.b.x).toBeCloseTo(2.45, 9);
    expect(right.b.y).toBeCloseTo(0, 9);
    expect(right).toMatchObject({ startJoint: "end", endJoint: "outer", endAngle: 270 });
    expect(seg(r, "r:p0:1").endJoint).toBe("outer");
    expect(seg(r, "r:p0:2").startJoint).toBe("outer");
  });

  it("при запиле наружные концы удлиняются на толщину плинтуса", () => {
    const m = calc(room, MDF_PAINT);
    const d = MDF_PAINT.depth;
    expect(seg(m, "r:p0:1").materialLength).toBeCloseTo(1.55 + d, 9);
    expect(seg(m, "r:p1:rev-l").materialLength).toBeCloseTo(0.15 + d, 9);
    expect(seg(m, "r:p1:rev-r").materialLength).toBeCloseTo(0.15 + d, 9);
    expect(seg(m, "r:p0:2").materialLength).toBeCloseTo(1.55 + d, 9);
    expect(seg(m, "r:p1:1").materialLength).toBeCloseTo(3, 9); // только внутренние углы
  });

  it("проём у начала стены — откос только с одной стороны", () => {
    const x = calc(makeRoom(RECT, [op("p1", "passage", 0, 0)]));
    expect(x.segments.filter((s) => s.isReveal).map((s) => s.id)).toEqual(["r:p1:rev-r"]);
    expect(x.reveals[0].length).toBeCloseTo(0.15, 9);
    expect(x.corners.outer).toBe(1);
    expectConsistent(x);
  });

  it("проём с наличником или без флага обхода — без откосов", () => {
    expect(calc(makeRoom(RECT, [op("p1", "passage", 0, 1.5, { casing: 0.07 })])).reveals).toEqual([]);
    expect(calc(makeRoom(RECT, [op("p1", "passage", 0, 1.5, { wrapReveals: false })])).reveals).toEqual([]);
  });

  it("толщина конкретной стены берётся из её точки", () => {
    const thick = makeRoom(RECT, [op("p1", "passage", 0, 1.5)]);
    thick.points[0] = { ...thick.points[0], thickness: 0.25 };
    const x = calc(thick);
    expect(x.reveals[0].length).toBeCloseTo(0.5, 9);
    expectConsistent(x);
  });

  it("два смежных проёма — откосы только по внешним краям", () => {
    const x = calc(makeRoom(RECT, [op("a", "passage", 0, 1), op("b", "passage", 0, 1.9)]));
    expect(x.segments.filter((s) => s.isReveal).map((s) => s.id)).toEqual(["r:a:rev-l", "r:b:rev-r"]);
    expect(sum(x.reveals.map((v) => v.length))).toBeCloseTo(0.3, 9);
    expectConsistent(x);
  });
});

describe("форма комнаты", () => {
  it("Г-образная: 1 наружный угол, удлинение под запил = depth", () => {
    const r = calc(makeRoom(L_SHAPE), MDF_PAINT);
    expect(r.perimeter).toBeCloseTo(18, 9);
    expect(r.corners).toEqual({ inner: 5, outer: 1, nonRight: 0 });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].closed).toBe(true);
    const c = seg(r, "r:p2:1"); // (5,2)→(3,2)
    const d = seg(r, "r:p3:1"); // (3,2)→(3,4)
    expect(c.endJoint).toBe("outer");
    expect(c.endAngle).toBeCloseTo(270, 9);
    expect(c.materialLength).toBeCloseTo(2 + MDF_PAINT.depth, 9);
    expect(d.materialLength).toBeCloseTo(2 + MDF_PAINT.depth, 9);
    expect(seg(r, "r:p0:1").materialLength).toBeCloseTo(5, 9);
    expectConsistent(r);
  });

  it("Г-образная с фурнитурой — без удлинений", () => {
    const r = calc(makeRoom(L_SHAPE));
    expect(r.segments.every((s) => s.materialLength === s.length)).toBe(true);
  });

  it("эркер 135°: два угла не 90°, предупреждение для фурнитуры", () => {
    const r = calc(makeRoom(BAY));
    expect(r.corners).toEqual({ inner: 5, outer: 0, nonRight: 2 });
    expect(r.warnings.some((w) => w.includes("не 90°"))).toBe(true);
    expect(seg(r, "r:p2:1").startAngle).toBeCloseTo(135, 9);
    expectConsistent(r);
  });

  it("эркер с запилом — без предупреждения, внутренние углы не удлиняют", () => {
    const r = calc(makeRoom(BAY), MDF_PAINT);
    expect(r.warnings).toEqual([]);
    expect(r.segments.every((s) => s.materialLength === s.length)).toBe(true);
  });

  it("вершина на прямой — стык straight 180°, не угол", () => {
    const r = calc(makeRoom([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]));
    expect(seg(r, "r:p0:1").endJoint).toBe("straight");
    expect(seg(r, "r:p0:1").endAngle).toBe(180);
    expect(seg(r, "r:p1:1").startJoint).toBe("straight");
    expect(r.corners).toEqual({ inner: 4, outer: 0, nonRight: 0 });
    expect(r.endCaps).toEqual({ left: 0, right: 0 });
    expect(r.runs[0].closed).toBe(true);
    expectConsistent(r);
  });

  it("короб в углу: 1 наружный угол и 5 внутренних", () => {
    // Прямоугольник 4×3 с коробом 0,4×0,4 в правом нижнем углу.
    const r = calc(
      makeRoom([[0, 0], [4, 0], [4, 2.6], [3.6, 2.6], [3.6, 3], [0, 3]]),
    );
    expect(r.corners).toEqual({ inner: 5, outer: 1, nonRight: 0 });
    expect(r.perimeter).toBeCloseTo(14, 9);
    expectConsistent(r);
  });

  it("вырожденный контур (< 3 точек) — пустой результат с предупреждением", () => {
    const r = calc(makeRoom([[0, 0], [1, 0]]));
    expect(r.segments).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("не мутирует вход", () => {
    const room = makeRoom(RECT, [op("d1", "door", 0, 1)]);
    const snapshot = JSON.stringify(room);
    calc(room, resolveProduct("mdf-80", { "mdf-80": { cornerMethod: "miter" } }));
    expect(JSON.stringify(room)).toBe(snapshot);
  });
});

describe("случайные комнаты (fuzz)", () => {
  /** Детерминированный ГПСЧ (LCG). */
  function lcg(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }
  const U_SHAPE: Array<[number, number]> = [
    [0, 0], [5, 0], [5, 4], [3.5, 4], [3.5, 1.5], [1.5, 1.5], [1.5, 4], [0, 4],
  ];
  const SHAPES = [RECT, L_SHAPE, BAY, U_SHAPE];
  const KINDS: OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];

  it("инварианты держатся, смета считается без ошибок", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = lcg(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      const base = makeRoom(pick(SHAPES), [], { wallThickness: pick([0, 0.1, 0.25]) });
      const walls = getWalls(base);
      const openings: Opening[] = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => {
        const wall = pick(walls);
        const width = Math.min(wall.length, 0.3 + rnd() * 1.8);
        return op(`o${i}`, pick(KINDS), wall.index, rnd() * (wall.length - width), {
          width,
          casing: pick([0, 0.07, 0.1]),
          wrapReveals: rnd() < 0.5,
          elevation: pick([0, 0.85]),
          balconyDoorSide: pick(["left", "right"] as const),
        });
      });
      const product = pick(SKIRTING_CATALOG);
      const room: Room = { ...base, openings, productId: product.id };
      const overrides = { [product.id]: { cornerMethod: pick(product.cornerMethods) } };

      const r = computeRoomSkirting(room, resolveProduct(product.id, overrides));
      expectConsistent(r);

      const est = estimateProject(makeProject([room], {}, overrides));
      const p = est.products[0];
      expect(p.netLength).toBeCloseTo(r.netLength, 9);
      expect(p.planksToOrder).toBeGreaterThanOrEqual(p.planksMin);
      expect(p.planksMin).toBeGreaterThanOrEqual(p.cutPlan.lowerBound);
      const material = sum(p.pieces.map((x) => x.length));
      expect(material).toBeGreaterThanOrEqual(r.netLength - 1e-9);
      expect(p.planksMin * p.product.length).toBeGreaterThanOrEqual(material - 1e-6);
      expect(Number.isFinite(est.totalCost)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Состязательные случаи: вырожденные входы, вершины «на прямой»,      */
/* наличники через вершину, откосы у угла, строгие инварианты.         */
/* ------------------------------------------------------------------ */

/** Участок [from, to] стены, где плинтуса быть не может (с переходом через вершину «на прямой»). */
function forbiddenOnWall(
  room: Room,
  product: SkirtingProduct,
  walls: Wall[],
  corners: Corner[],
  wallIndex: number,
): Array<[number, number]> {
  const n = walls.length;
  const wall = walls[wallIndex];
  const out: Array<[number, number]> = [];
  // Проём на стене нулевой длины бессмыслен и в расчёт не попадает.
  const blocksOf = (w: number) =>
    room.openings
      .filter((o) => o.wallId === walls[w].id && walls[w].length > 1e-9)
      .map((o) => skirtingBlock(o, product.height))
      .filter((iv): iv is { from: number; to: number } => !!iv && iv.to - iv.from > 1e-9);
  for (const iv of blocksOf(wallIndex)) out.push([iv.from, iv.to]);
  // Наличник соседней стены, зашедший через вершину «на прямой».
  const prev = (wallIndex - 1 + n) % n;
  if (corners[wallIndex].kind === "straight") {
    const L = walls[prev].length;
    for (const iv of blocksOf(prev)) if (iv.to > L) out.push([Math.max(0, iv.from - L), iv.to - L]);
  }
  const next = (wallIndex + 1) % n;
  if (corners[next].kind === "straight") {
    for (const iv of blocksOf(next)) if (iv.from < 0) out.push([wall.length + iv.from, wall.length + Math.min(0, iv.to)]);
  }
  return out;
}

/** Строгие инварианты для любой комнаты, в том числе с вершинами «на прямой». */
function expectSound(r: RoomSkirtingResult, room: Room, product: SkirtingProduct) {
  const walls = getWalls(room);
  const corners = getCorners(room);
  const deducted = sum(r.deductions.map((d) => d.length));
  const added = sum(r.reveals.map((d) => d.length));
  expect(r.perimeter).toBeCloseTo(sum(walls.map((w) => w.length)), 9);
  expect(r.netLength).toBeCloseTo(r.perimeter - deducted + added, 9);
  expect(r.netLength).toBeCloseTo(sum(r.segments.map((s) => s.length)), 9);
  expect(new Set(r.deductions.map((d) => d.openingId)).size).toBe(r.deductions.length);
  expect(new Set(r.reveals.map((d) => d.openingId)).size).toBe(r.reveals.length);
  for (const d of r.deductions) expect(d.length).toBeGreaterThan(0);

  // Цепочки: покрывают все сегменты ровно один раз; замкнутая — только одна.
  expect(new Set(r.segments.map((s) => s.id)).size).toBe(r.segments.length);
  expect(r.runs.flatMap((x) => x.segmentIds).sort()).toEqual(r.segments.map((s) => s.id).sort());
  expect(sum(r.runs.map((x) => x.length))).toBeCloseTo(r.netLength, 9);
  const breaks = r.runs.filter((x) => !x.closed).length;
  if (r.runs.some((x) => x.closed)) expect(r.runs).toHaveLength(1);
  // Число заглушек = 2 × число разрывов.
  expect(r.endCaps).toEqual({ left: breaks, right: breaks });

  const m = r.segments.length;
  let inner = 0;
  let outer = 0;
  r.segments.forEach((s, i) => {
    const next = r.segments[(i + 1) % m];
    expect(s.length).toBeGreaterThan(0);
    expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(s.length, 9);
    expect(s.isReveal).toBe(s.openingId !== null);
    // Стыки симметричны: торец ⇔ у следующего тоже торец; иначе общая точка и угол.
    expect(next.startJoint === "end").toBe(s.endJoint === "end");
    if (s.endJoint !== "end") {
      expect(next.startJoint).toBe(s.endJoint);
      expect(next.startAngle).toBeCloseTo(s.endAngle, 9);
      expect(next.a.x).toBeCloseTo(s.b.x, 9);
      expect(next.a.y).toBeCloseTo(s.b.y, 9);
    }
    for (const [j, angle] of [[s.startJoint, s.startAngle], [s.endJoint, s.endAngle]] as const) {
      if (j === "end" || j === "straight") expect(angle).toBe(180);
      if (j === "inner") expect(angle).toBeLessThan(180);
      if (j === "outer") expect(angle).toBeGreaterThan(180);
    }
    if (s.endJoint === "inner") inner++;
    if (s.endJoint === "outer") outer++;
    const ext =
      product.cornerMethod === "miter"
        ? miterExtension(s.startAngle, product.depth) + miterExtension(s.endAngle, product.depth)
        : 0;
    expect(s.materialLength).toBeCloseTo(s.length + ext, 12);
    if (s.isReveal) {
      const w = walls[s.wallIndex];
      expect(s.wallId).toBe(w.id);
      expect(s.from).toBe(0);
      expect(s.to).toBeCloseTo(w.thickness, 12);
      expect(s.label).toBe(`${w.label}·откос`);
    }
  });
  expect(r.corners.inner).toBe(inner);
  expect(r.corners.outer).toBe(outer);

  // По стенам: участки внутри стены, не пересекаются, нумерация 1, 2, 3…,
  // не лежат под проёмами и закрывают всё свободное место (кроме огрызков < 5 мм).
  walls.forEach((wall) => {
    const parts = r.segments.filter((s) => !s.isReveal && s.wallId === wall.id);
    expect(parts.map((s) => s.id)).toEqual(parts.map((_, i) => `${room.id}:${wall.id}:${i + 1}`));
    parts.forEach((s, i) => {
      expect(s.wallIndex).toBe(wall.index);
      expect(s.from).toBeGreaterThanOrEqual(0);
      expect(s.to).toBeLessThanOrEqual(wall.length + 1e-12);
      if (i > 0) expect(s.from).toBeGreaterThanOrEqual(parts[i - 1].to - 1e-12);
    });
    const forbidden = forbiddenOnWall(room, product, walls, corners, wall.index);
    for (const s of parts) {
      for (const [f, t] of forbidden) {
        expect(Math.min(s.to, t) - Math.max(s.from, f)).toBeLessThan(1e-9);
      }
    }
    const covered = [
      ...parts.map((s) => [s.from, s.to] as [number, number]),
      ...forbidden
        .map(([f, t]) => [Math.max(0, f), Math.min(wall.length, t)] as [number, number])
        .filter(([f, t]) => t > f),
    ].sort((p, q) => p[0] - q[0]);
    let reach = 0;
    for (const [f, t] of covered) {
      expect(f - reach).toBeLessThan(0.005 + 1e-9);
      reach = Math.max(reach, t);
    }
    if (wall.length > 1e-9) expect(wall.length - reach).toBeLessThan(0.005 + 1e-9);
  });
}

describe("вершина «на прямой» (стена поделена точкой)", () => {
  // Стена A поделена в x = 2: стены A (0→2) и B (2→4) на одной прямой.
  const SPLIT: Array<[number, number]> = [[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]];

  it("наличник двери заходит через вершину на соседнюю стену и вычитается полностью", () => {
    const room = makeRoom(SPLIT, [op("d", "door", 0, 2 - 0.87)]); // дверь прижата к вершине
    const r = calc(room);
    expect(r.deductions).toHaveLength(1);
    expect(r.deductions[0]).toMatchObject({ openingId: "d", wallLabel: "A" });
    expect(r.deductions[0].length).toBeCloseTo(0.95, 9);
    const b = seg(r, "r:p1:1");
    expect(b.from).toBeCloseTo(0.04, 9);
    expect(b.startJoint).toBe("end");
    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expect(r.netLength).toBeCloseTo(14 - 0.95, 9);
    expectSound(r, room, PVC);
  });

  it("проём, упирающийся в вершину, получает оба откоса", () => {
    const room = makeRoom(SPLIT, [op("p", "passage", 0, 2 - 0.9)]);
    const r = calc(room);
    expect(r.reveals).toHaveLength(1);
    expect(r.reveals[0].length).toBeCloseTo(0.3, 9);
    const right = seg(r, "r:p:rev-r");
    expect(right.wallId).toBe("p0"); // стена проёма
    expect(right.b).toEqual({ x: 2, y: 0 });
    expect(seg(r, "r:p1:1").startJoint).toBe("outer");
    expect(r.corners.outer).toBe(2);
    expect(r.segments.map((s) => s.label)).toEqual(["A", "A·откос", "A·откос", "B", "C", "D", "E"]);
    expectSound(r, room, PVC);
  });

  it("участок через вершину — один прямой: без ложного «короткого участка»", () => {
    // Наличник кончается в 2 см до вершины: 2 см на A + вся B — один кусок.
    const room = makeRoom(SPLIT, [op("d", "door", 0, 2 - 0.87 - 0.06)]);
    const r = calc(room);
    expect(r.warnings).toEqual([]);
    const a2 = seg(r, "r:p0:2");
    expect(a2.length).toBeCloseTo(0.02, 9);
    expect(a2.endJoint).toBe("straight");
    expect(seg(r, "r:p1:1").startJoint).toBe("straight");
    expectSound(r, room, PVC);
  });

  it("огрызок < 5 мм у вершины «на прямой» не теряется: кусок идёт через вершину", () => {
    const room = makeRoom(SPLIT, [op("d", "door", 0, 2 - 0.87 - 0.043)]); // 3 мм до вершины
    const r = calc(room);
    expect(r.deductions[0].length).toBeCloseTo(0.95, 9);
    expect(seg(r, "r:p0:2").length).toBeCloseTo(0.003, 9);
    expect(seg(r, "r:p0:2").endJoint).toBe("straight");
    expectSound(r, room, PVC);
  });

  it("дверь на правой стене, наличник заходит назад на левую", () => {
    const room = makeRoom(SPLIT, [op("d", "door", 1, 0)]);
    const r = calc(room);
    expect(r.deductions[0]).toMatchObject({ wallLabel: "B" });
    expect(r.deductions[0].length).toBeCloseTo(0.95, 9);
    expect(seg(r, "r:p0:1").to).toBeCloseTo(1.96, 9);
    expectSound(r, room, PVC);
  });

  it("несколько вершин подряд на прямой и проём во всю среднюю стену", () => {
    const room = makeRoom(
      [[0, 0], [1, 0], [1.9, 0], [4, 0], [4, 3], [0, 3]],
      [op("p", "passage", 1, 0, { width: 0.9 })],
    );
    const r = calc(room);
    expect(r.reveals[0].length).toBeCloseTo(0.3, 9);
    expect(r.corners).toEqual({ inner: 4, outer: 2, nonRight: 0 });
    expectSound(r, room, PVC);
  });
});

describe("вырожденные входы", () => {
  it("стена нулевой длины (повтор точки) не ломает угол", () => {
    const room = makeRoom([[0, 0], [4, 0], [4, 0], [4, 3], [0, 3]]);
    const r = calc(room);
    expect(r.corners).toEqual({ inner: 4, outer: 0, nonRight: 0 });
    expect(r.endCaps).toEqual({ left: 0, right: 0 });
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].closed).toBe(true);
    expect(r.segments.some((s) => s.wallId === "p1")).toBe(false);
    expectSound(r, room, PVC);
  });

  it("все точки совпадают — пустой результат без ошибок", () => {
    const r = calc(makeRoom([[1, 1], [1, 1], [1, 1]]));
    expect(r.segments).toEqual([]);
    expect(r.netLength).toBe(0);
  });

  it("многоугольник без настоящих углов (окружность из 400 точек) — одно кольцо", () => {
    const pts = Array.from({ length: 400 }, (_, i): [number, number] => {
      const t = (i / 400) * 2 * Math.PI;
      return [2 + 2 * Math.cos(t), 2 + 2 * Math.sin(t)];
    });
    const room = makeRoom(pts);
    const r = calc(room);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].closed).toBe(true);
    expect(r.corners).toEqual({ inner: 0, outer: 0, nonRight: 0 });
    expectSound(r, room, PVC);
    const withDoor = makeRoom(pts, [op("d", "door", 10, 0, { width: 0.05, casing: 0 })]);
    const d = calc(withDoor);
    expect(d.endCaps).toEqual({ left: 1, right: 1 });
    expectSound(d, withDoor, PVC);
  });

  it("мусор в проёме (NaN, отрицательная ширина) игнорируется", () => {
    const room = makeRoom(RECT, [
      op("a", "door", 0, 1, { width: Number.NaN }),
      op("b", "furniture", 1, Number.NaN),
      op("c", "furniture", 2, 2, { width: -1 }),
    ]);
    const r = calc(room);
    expect(r.deductions).toEqual([]);
    expect(r.netLength).toBeCloseTo(14, 9);
  });

  it("дверь шире стены — вычет ровно длина стены, соседи кончаются торцами", () => {
    const room = makeRoom(RECT, [op("d", "door", 1, -0.5, { width: 5 })]);
    const r = calc(room);
    expect(r.deductions[0].length).toBeCloseTo(3, 9);
    expect(r.segments.some((s) => s.wallId === "p1")).toBe(false);
    expect(r.corners.inner).toBe(2);
    expectSound(r, room, PVC);
  });

  it("комната полностью закрыта проёмами (двери шире стен) — плинтус не нужен", () => {
    const room = makeRoom(RECT, [0, 1, 2, 3].map((w) => op(`d${w}`, "door", w, -1, { width: 6 })));
    const r = calc(room);
    expect(r.segments).toEqual([]);
    expect(r.netLength).toBe(0);
    expect(sum(r.deductions.map((d) => d.length))).toBeCloseTo(14, 9);
    expect(r.warnings.some((w) => w.includes("не нужен"))).toBe(true);
    const p = estimateProject(makeProject([room])).products[0];
    expect(p.lines).toEqual([]);
    expect(p.planksToOrder).toBe(0);
  });

  it("проём на стене нулевой толщины или тоньше 5 мм — без откосов", () => {
    for (const t of [0, 0.003]) {
      const room = makeRoom(RECT, [op("p", "passage", 0, 1.5)], { wallThickness: t });
      const r = calc(room);
      expect(r.reveals).toEqual([]);
      expectSound(r, room, PVC);
    }
  });
});

describe("двери и проёмы впритык, у угла, внахлёст", () => {
  it("две двери с наложением наличников: предупреждение, вычет без двойного счёта", () => {
    // Наличники: [0,96; 1,91] и [1,89; 2,84] — наложение 2 см.
    const room = makeRoom(RECT, [op("d1", "door", 0, 1), op("d2", "door", 0, 1.93)]);
    const r = calc(room);
    expect(sum(r.deductions.map((d) => d.length))).toBeCloseTo(2.84 - 0.96, 9);
    expect(r.warnings.filter((w) => w.includes("перекрываются"))).toHaveLength(1);
    expect(r.endCaps).toEqual({ left: 1, right: 1 });
    expectSound(r, room, PVC);
  });

  it("две двери с зазором 3 мм — огрызок уходит в вычет, без короткого куска", () => {
    const room = makeRoom(RECT, [op("d1", "door", 0, 1), op("d2", "door", 0, 1.953)]);
    const r = calc(room);
    expect(r.segments.filter((s) => s.wallId === "p0")).toHaveLength(2);
    expect(sum(r.deductions.map((d) => d.length))).toBeCloseTo(1.903, 9);
    expect(r.warnings).toEqual([]);
    expectSound(r, room, PVC);
  });

  it("две двери с зазором 2 см — короткий кусок с понятным предупреждением", () => {
    const room = makeRoom(RECT, [op("d1", "door", 0, 1), op("d2", "door", 0, 1.97)]);
    const r = calc(room);
    expect(seg(r, "r:p0:2").length).toBeCloseTo(0.02, 9);
    expect(r.warnings.some((w) => w.includes("Короткий участок 2 см") && w.includes("друг к другу"))).toBe(true);
    expectSound(r, room, PVC);
  });

  it("проём с обходом откосов у самого угла: 3 мм, 8 мм и 2 см от угла", () => {
    // 3 мм — огрызок в вычет, слева откоса нет, стена D кончается торцом.
    const a = makeRoom(RECT, [op("p", "passage", 0, 0.003)]);
    const ra = calc(a);
    expect(ra.segments.filter((s) => s.isReveal).map((s) => s.id)).toEqual(["r:p:rev-r"]);
    expect(seg(ra, "r:p3:1").endJoint).toBe("end");
    expect(ra.deductions[0].length).toBeCloseTo(0.903, 9);
    expectSound(ra, a, PVC);
    // 8 мм — кусок остаётся (с предупреждением), но для откоса мало места.
    const b = makeRoom(RECT, [op("p", "passage", 0, 0.008)]);
    const rb = calc(b);
    expect(seg(rb, "r:p0:1").length).toBeCloseTo(0.008, 9);
    expect(seg(rb, "r:p0:1").endJoint).toBe("end");
    expect(rb.segments.filter((s) => s.isReveal)).toHaveLength(1);
    expect(rb.warnings.some((w) => w.includes("Короткий участок 0,8 см"))).toBe(true);
    expectSound(rb, b, PVC);
    // 2 см — кусок от угла и откос: внутренний угол, затем наружный.
    const c = makeRoom(RECT, [op("p", "passage", 0, 0.02)]);
    const rc = calc(c);
    const first = seg(rc, "r:p0:1");
    expect(first).toMatchObject({ startJoint: "inner", endJoint: "outer" });
    expect(rc.reveals[0].length).toBeCloseTo(0.3, 9);
    expect(rc.corners).toEqual({ inner: 4, outer: 2, nonRight: 0 });
    expectSound(rc, c, PVC);
    // С запилом короткий кусок с наружным углом удлиняется на толщину плинтуса.
    const rm = calc(c, MDF_PAINT);
    expect(seg(rm, "r:p0:1").materialLength).toBeCloseTo(0.02 + MDF_PAINT.depth, 9);
    expectSound(rm, c, MDF_PAINT);
  });

  it("проём у наружного угла Г-образной комнаты", () => {
    // Стена D (3,2)→(3,4) начинается наружным углом; проём сразу за ним.
    const room = makeRoom(L_SHAPE, [op("p", "passage", 3, 0.3)]);
    const r = calc(room, MDF_PAINT);
    expect(r.corners.outer).toBe(3);
    expect(seg(r, "r:p3:1").materialLength).toBeCloseTo(0.3 + 2 * MDF_PAINT.depth, 9);
    expectSound(r, room, MDF_PAINT);
  });

  it("наличник выходит за наружный угол — обрезается по углу", () => {
    const room = makeRoom(L_SHAPE, [op("d", "door", 3, 0)]); // дверь от самого наружного угла
    const r = calc(room);
    expect(r.deductions[0].length).toBeCloseTo(0.91, 9);
    expect(seg(r, "r:p2:1").endJoint).toBe("end");
    expect(r.corners.outer).toBe(0);
    expectSound(r, room, PVC);
  });
});

describe("случайные комнаты с вершинами «на прямой» и мусором (fuzz)", () => {
  function lcg(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }
  const SHAPES: Array<Array<[number, number]>> = [
    RECT,
    L_SHAPE,
    BAY,
    [[0, 0], [1.5, 0], [2.5, 0], [4, 0], [4, 3], [0, 3]], // A поделена дважды
    [[0, 0], [5, 0], [5, 2], [3, 2], [3, 3], [3, 4], [0, 4], [0, 2]], // Г с точками на прямой
    [[2, 0], [4, 0], [4, 3], [0, 3], [0, 0]], // вершина на прямой в точке 0
    [[0, 0], [4, 0], [4, 0], [4, 3], [0, 3]], // повтор точки
  ];
  const KINDS: OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];

  it("строгие инварианты на 600 комнатах", () => {
    for (let seed = 1; seed <= 600; seed++) {
      const rnd = lcg(seed * 7919);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      const base = makeRoom(pick(SHAPES), [], { wallThickness: pick([0, 0.003, 0.12, 0.25]) });
      if (rnd() < 0.3) base.points[0] = { ...base.points[0], thickness: 0.4 };
      const walls = getWalls(base);
      const openings: Opening[] = Array.from({ length: Math.floor(rnd() * 7) }, (_, i) => {
        const wall = pick(walls);
        const width = pick([0.05, 0.3, 0.87, 1.5, wall.length, wall.length * 1.3]);
        // Сдвиг: от «за левым углом» до «у правого края», с прилипанием к краям.
        const offset = pick([-0.1, 0, 0.003, 0.008, 0.02, rnd() * wall.length, wall.length - width, wall.length - width - 0.004]);
        return op(`o${i}`, pick(KINDS), wall.index, offset, {
          width,
          casing: pick([0, 0.07, 0.1]),
          wrapReveals: rnd() < 0.6,
          elevation: pick([0, 0.85, 0.03]),
          balconyDoorSide: pick(["left", "right"] as const),
          balconyDoorWidth: pick([0.7, 0.9, 3]),
        });
      });
      const room: Room = { ...base, openings };
      const product = pick(SKIRTING_CATALOG);
      const variant = resolveProduct(product.id, { [product.id]: { cornerMethod: pick(product.cornerMethods) } });
      const r = computeRoomSkirting(room, variant);
      try {
        expectSound(r, room, variant);
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).message}`);
      }
    }
  });
});
