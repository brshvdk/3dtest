import { describe, expect, it } from "vitest";
import {
  cornerAt,
  getCorners,
  getWalls,
  lineIntersection,
  outerPolygon,
  polygonArea,
  polygonPerimeter,
  polygonSelfIntersects,
  signedArea,
  toCanonical,
  wallLabel,
  projectToSegment,
} from "../geometry";
import type { Room } from "../types";

function room(pts: Array<[number, number]>, t = 0.2): Room {
  return {
    id: "r",
    name: "test",
    points: pts.map(([x, y], i) => ({ id: `p${i}`, x, y })),
    height: 2.7,
    wallThickness: t,
    openings: [],
    shape: "custom",
    skirtingEnabled: true,
    productId: null,
  };
}

// Прямоугольник 4×3, канонический обход (по часовой на экране, y вниз)
const rect = room([
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]);

// Г-образная: 5×4 с вырезом 2×2 в правом нижнем углу
const L = room([
  [0, 0],
  [5, 0],
  [5, 2],
  [3, 2],
  [3, 4],
  [0, 4],
]);

describe("polygon basics", () => {
  it("canonical orientation has positive signed area", () => {
    expect(signedArea(rect.points)).toBeCloseTo(12);
    expect(signedArea([...rect.points].reverse())).toBeCloseTo(-12);
    expect(signedArea(toCanonical([...rect.points].reverse()))).toBeCloseTo(12);
  });
  it("area & perimeter", () => {
    expect(polygonArea(L.points)).toBeCloseTo(16);
    expect(polygonPerimeter(L.points)).toBeCloseTo(18);
  });
  it("self intersection", () => {
    expect(polygonSelfIntersects(rect.points)).toBe(false);
    expect(
      polygonSelfIntersects([
        { x: 0, y: 0 },
        { x: 4, y: 3 },
        { x: 4, y: 0 },
        { x: 0, y: 3 },
      ]),
    ).toBe(true);
  });
  it("line intersection", () => {
    const x = lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: -1 }, { x: 0, y: 1 });
    expect(x).toEqual({ x: 2, y: 0 });
    expect(lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe("walls", () => {
  it("labels", () => {
    expect(wallLabel(0)).toBe("A");
    expect(wallLabel(25)).toBe("Z");
    expect(wallLabel(26)).toBe("AA");
  });
  it("normals point inside", () => {
    const walls = getWalls(rect);
    expect(walls[0].dir).toEqual({ x: 1, y: 0 });
    expect(walls[0].normalIn.x).toBeCloseTo(0);
    expect(walls[0].normalIn.y).toBeCloseTo(1); // внутрь = вниз
    expect(walls[1].normalIn.x).toBeCloseTo(-1); // правая стена → внутрь влево
    expect(walls.map((w) => w.length)).toEqual([4, 3, 4, 3]);
  });
  it("outer polygon offsets by thickness", () => {
    const o = outerPolygon(rect);
    expect(o[0].x).toBeCloseTo(-0.2);
    expect(o[0].y).toBeCloseTo(-0.2);
    expect(o[2].x).toBeCloseTo(4.2);
    expect(o[2].y).toBeCloseTo(3.2);
  });
  it("projection signed distance is positive inside", () => {
    const w = getWalls(rect)[0];
    const pr = projectToSegment({ x: 1, y: 0.5 }, w.a, w.b);
    expect(pr.along).toBeCloseTo(1);
    expect(pr.signed).toBeCloseTo(0.5);
  });
});

describe("corners", () => {
  it("rectangle has 4 inner 90° corners", () => {
    const c = getCorners(rect);
    expect(c.every((k) => k.kind === "inner")).toBe(true);
    c.forEach((k) => expect(k.angle).toBeCloseTo(90));
  });
  it("L shape has one outer 270° corner", () => {
    const c = getCorners(L);
    const outer = c.filter((k) => k.kind === "outer");
    expect(outer).toHaveLength(1);
    expect(outer[0].index).toBe(3);
    expect(outer[0].angle).toBeCloseTo(270);
    expect(c.filter((k) => k.kind === "inner")).toHaveLength(5);
  });
  it("straight vertex", () => {
    const r = room([
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
    expect(cornerAt(r, 1).kind).toBe("straight");
  });
  it("bay 135°", () => {
    const r = room([
      [0, 0],
      [4, 0],
      [4, 2],
      [3, 3],
      [0, 3],
    ]);
    expect(cornerAt(r, 2).angle).toBeCloseTo(135);
    expect(cornerAt(r, 3).angle).toBeCloseTo(135);
  });
});
