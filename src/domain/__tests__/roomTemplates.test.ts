import { describe, expect, it } from "vitest";
import {
  bbox,
  getCorners,
  polygonArea,
  polygonPerimeter,
  polygonSelfIntersects,
  signedArea,
} from "../geometry";
import { isValidPolygon } from "../roomEdit";
import {
  ROOM_NAME_SUGGESTIONS,
  ROOM_TEMPLATES,
  buildTemplatePoints,
  getTemplate,
  resolveTemplateParams,
} from "../roomTemplates";
import type { Room, RoomShapeId } from "../types";

const asRoom = (id: RoomShapeId, params?: Record<string, number>): Room => ({
  id: "r",
  name: "t",
  points: buildTemplatePoints(id, params),
  height: 2.7,
  wallThickness: 0.15,
  openings: [],
  shape: id,
  skirtingEnabled: true,
  productId: null,
});

describe("ROOM_TEMPLATES", () => {
  it("содержит все формы, кроме custom", () => {
    expect(ROOM_TEMPLATES.map((t) => t.id).sort()).toEqual(
      ["L", "T", "U", "bay", "corner-box", "rect", "trapezoid"].sort(),
    );
    expect(getTemplate("custom")).toBeUndefined();
    expect(getTemplate("L")?.name).toBe("Г-образная");
  });

  it.each(ROOM_TEMPLATES.map((t) => [t.id]))("%s: каноничен, без самопересечений, bbox в (0,0)", (id) => {
    const pts = buildTemplatePoints(id as RoomShapeId);
    expect(signedArea(pts)).toBeGreaterThan(0);
    expect(polygonSelfIntersects(pts)).toBe(false);
    expect(isValidPolygon(pts)).toBe(true);
    const b = bbox(pts);
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.minY).toBeCloseTo(0, 9);
    // уникальные id точек
    expect(new Set(pts.map((p) => p.id)).size).toBe(pts.length);
  });

  it.each(ROOM_TEMPLATES.map((t) => [t.id]))("%s: стена A — верхняя, слева направо", (id) => {
    const pts = buildTemplatePoints(id as RoomShapeId);
    const [a, b] = pts;
    expect(b.x).toBeGreaterThan(a.x);
    expect(a.y).toBeCloseTo(b.y, 9);
    // Изнутри комнаты — внутренняя нормаль стены A смотрит вниз (y+)
    expect(a.x).toBeCloseTo(0, 9);
  });

  it.each(ROOM_TEMPLATES.map((t) => [t.id]))("%s: валиден на границах параметров", (id) => {
    const t = getTemplate(id as RoomShapeId)!;
    const mins = Object.fromEntries(t.params.map((p) => [p.key, p.min]));
    const maxs = Object.fromEntries(t.params.map((p) => [p.key, p.max]));
    // Крупная комната с крайними вырезами
    const big = { ...maxs, length: 8, width: 7, lengthTop: 8, lengthBottom: 6 };
    const small = { ...mins, length: 2, width: 2, lengthTop: 2, lengthBottom: 2 };
    for (const params of [mins, maxs, big, small]) {
      const pts = buildTemplatePoints(id as RoomShapeId, params);
      expect(isValidPolygon(pts), JSON.stringify(params)).toBe(true);
      expect(signedArea(pts)).toBeGreaterThan(0);
    }
  });
});

describe("площади и периметры", () => {
  it("прямоугольник по умолчанию 4.5×3.6", () => {
    const pts = buildTemplatePoints("rect");
    expect(polygonArea(pts)).toBeCloseTo(16.2);
    expect(polygonPerimeter(pts)).toBeCloseTo(16.2);
    expect(getCorners(asRoom("rect")).every((c) => c.kind === "inner")).toBe(true);
  });

  it("прямоугольник с параметрами", () => {
    const pts = buildTemplatePoints("rect", { length: 4, width: 3 });
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
  });

  it("Г-образная: площадь = L·W − вырез, один наружный угол", () => {
    const pts = buildTemplatePoints("L", { length: 5, width: 4, cutLength: 2, cutWidth: 1.5 });
    expect(polygonArea(pts)).toBeCloseTo(20 - 3);
    expect(polygonPerimeter(pts)).toBeCloseTo(18);
    const corners = getCorners(asRoom("L", { length: 5, width: 4, cutLength: 2, cutWidth: 1.5 }));
    expect(corners.filter((c) => c.kind === "outer")).toHaveLength(1);
    expect(corners.filter((c) => c.kind === "inner")).toHaveLength(5);
  });

  it("П-образная", () => {
    const pts = buildTemplatePoints("U", { length: 6, width: 4.5, notchWidth: 2, notchDepth: 1.5 });
    expect(pts).toHaveLength(8);
    expect(polygonArea(pts)).toBeCloseTo(27 - 3);
    expect(polygonPerimeter(pts)).toBeCloseTo(21 + 3);
  });

  it("Т-образная", () => {
    const pts = buildTemplatePoints("T", { length: 6, width: 5, barDepth: 2.5, stemWidth: 3 });
    expect(pts).toHaveLength(8);
    expect(polygonArea(pts)).toBeCloseTo(6 * 2.5 + 3 * 2.5);
    expect(polygonPerimeter(pts)).toBeCloseTo(22);
  });

  it("короб в углу", () => {
    const room = asRoom("corner-box", { length: 4.5, width: 3.6, boxLength: 0.6, boxDepth: 0.4 });
    expect(polygonArea(room.points)).toBeCloseTo(16.2 - 0.24);
    expect(polygonPerimeter(room.points)).toBeCloseTo(16.2);
    expect(getCorners(room).filter((c) => c.kind === "outer")).toHaveLength(1);
  });

  it("эркер: углы 135° и 225°", () => {
    const room = asRoom("bay", { length: 5, width: 4, bayWidth: 2.6, bayDepth: 0.8 });
    expect(polygonArea(room.points)).toBeCloseTo(20 + (2.6 - 0.8) * 0.8);
    const angles = getCorners(room).map((c) => Math.round(c.angle));
    expect(angles.filter((a) => a === 135)).toHaveLength(2);
    expect(angles.filter((a) => a === 225)).toHaveLength(2);
    expect(angles.filter((a) => a === 90)).toHaveLength(4);
    expect(bbox(room.points).height).toBeCloseTo(4.8);
  });

  it("трапеция", () => {
    const pts = buildTemplatePoints("trapezoid", { lengthTop: 4.5, lengthBottom: 3.5, width: 3.6 });
    expect(polygonArea(pts)).toBeCloseTo(((4.5 + 3.5) / 2) * 3.6);
  });
});

describe("параметры", () => {
  it("прижимаются к диапазону, мусор → дефолт", () => {
    const t = getTemplate("rect")!;
    expect(resolveTemplateParams(t, { length: 1000, width: Number.NaN })).toEqual({
      length: 30,
      width: 3.6,
    });
  });

  it("вырез больше комнаты подрезается", () => {
    const pts = buildTemplatePoints("L", { length: 3, width: 3, cutLength: 10, cutWidth: 10 });
    expect(isValidPolygon(pts)).toBe(true);
    expect(polygonArea(pts)).toBeGreaterThan(0.5);
  });

  it("custom/неизвестный → прямоугольник", () => {
    expect(buildTemplatePoints("custom")).toHaveLength(4);
  });

  it("подсказки имён", () => {
    expect(ROOM_NAME_SUGGESTIONS).toContain("Гостиная");
    expect(ROOM_NAME_SUGGESTIONS).toContain("Санузел");
  });
});
