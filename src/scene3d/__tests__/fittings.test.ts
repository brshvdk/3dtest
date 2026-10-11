import { describe, expect, it } from "vitest";
import { estimateProject } from "../../domain/estimate";
import { createOpening } from "../../domain/openings";
import { computeRoomSkirting } from "../../domain/skirtingCalc";
import { getCatalogProduct } from "../../domain/skirtingCatalog";
import type { Opening, Project, Room } from "../../domain/types";
import {
  buildFittingsGeometry,
  collectFittings,
  connectorFittings,
  convexHull,
  fittingShape,
  fittingsSignature,
  isOuterTurn,
} from "../build/fittings";
import { normalizeProfile } from "../build/skirting";

const PVC = getCatalogProduct("pvc-55")!;

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

function makeProject(rooms: Room[]): Project {
  return {
    schemaVersion: 1,
    id: "prj",
    name: "Тест",
    createdAt: 0,
    updatedAt: 0,
    rooms,
    skirting: { productId: "pvc-55", reservePct: 5, minPiece: 0.3, kerf: 0.003, shareOffcuts: true },
    productOverrides: {},
    appearance: { wallColor: "#e9e4da", floorPattern: "deck", floorTint: "#c89567" },
  };
}

const RECT: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
const L_SHAPE: Array<[number, number]> = [
  [0, 0],
  [5, 0],
  [5, 2],
  [3, 2],
  [3, 4],
  [0, 4],
];

const count = (list: ReturnType<typeof collectFittings>, kind: string) => list.filter((f) => f.kind === kind).length;

describe("collectFittings", () => {
  it("прямоугольник без проёмов: 4 внутренних уголка, без заглушек", () => {
    const list = collectFittings(computeRoomSkirting(makeRoom(RECT), PVC));
    expect(count(list, "inner")).toBe(4);
    expect(count(list, "outer")).toBe(0);
    expect(count(list, "end")).toBe(0);
  });

  it("Г-образная: 5 внутренних и 1 наружный уголок (в точке 3; 2)", () => {
    const list = collectFittings(computeRoomSkirting(makeRoom(L_SHAPE), PVC));
    expect(count(list, "inner")).toBe(5);
    const outer = list.filter((f) => f.kind === "outer");
    expect(outer).toHaveLength(1);
    expect(outer[0].at).toEqual({ x: 3, y: 2 });
    if (outer[0].kind === "outer") expect(isOuterTurn(outer[0].d1, outer[0].d2)).toBe(true);
    for (const f of list) if (f.kind === "inner") expect(isOuterTurn(f.d1, f.d2)).toBe(false);
  });

  it("дверь: две заглушки у наличников, наружу от плинтуса", () => {
    const door: Opening = { ...createOpening("door", "p0", 1), id: "d" };
    const r = computeRoomSkirting(makeRoom(RECT, [door]), PVC);
    const ends = collectFittings(r).filter((f) => f.kind === "end");
    expect(ends).toHaveLength(2);
    // Слева от двери — конец участка (наружу +x), справа — начало (наружу −x).
    const xs = ends.map((f) => (f.kind === "end" ? [+f.at.x.toFixed(4), f.out * f.dir.x] : [])).sort();
    const ext = Math.max(0, door.casing - 0.03);
    expect(xs[0][0]).toBeCloseTo(1 - ext, 6);
    expect(xs[0][1]).toBe(1);
    expect(xs[1][0]).toBeCloseTo(1 + door.width + ext, 6);
    expect(xs[1][1]).toBe(-1);
  });

  it("соединители — на стыках кусков нарезки (сумма длин кусков от начала участка)", () => {
    const room = makeRoom(RECT);
    const est = estimateProject(makeProject([room]));
    const result = est.rooms[0];
    const pieces = est.products[0].pieces;
    const conns = connectorFittings(result, pieces);
    // Стены по 4 и 3 м при планке 2,5 м: каждая из 4 стен — 2 куска, 1 стык.
    expect(conns).toHaveLength(est.products[0].joints);
    expect(conns).toHaveLength(4);
    for (const c of conns) {
      if (c.kind !== "connector") continue;
      // Стык лежит на стене, между её концами.
      const onWall = result.segments.some((s) => {
        const t = (c.at.x - s.a.x) * c.dir.x + (c.at.y - s.a.y) * c.dir.y;
        const off = Math.abs((c.at.x - s.a.x) * -c.dir.y + (c.at.y - s.a.y) * c.dir.x);
        return off < 1e-9 && t > 0 && t < s.length;
      });
      expect(onWall).toBe(true);
      expect(c.back + c.ahead).toBeGreaterThan(2.5);
    }
    // Первый кусок стены A — от угла (0; 0): стык там, где кончается первый кусок.
    const first = pieces.find((p) => p.segmentIds[0] === result.segments[0].id)!;
    const onA = conns.find((c) => c.kind === "connector" && Math.abs(c.at.y) < 1e-9)!;
    expect(onA.at.x).toBeCloseTo(first.length, 9);
  });

  it("без нарезки соединителей нет; чужие куски не учитываются", () => {
    const r = computeRoomSkirting(makeRoom(RECT), PVC);
    expect(connectorFittings(r, [])).toHaveLength(0);
    const alien = [
      { id: "x:pc1", roomId: "x", segmentIds: [r.segments[0].id], label: "A 1/2", length: 2.5, full: true },
      { id: "x:pc2", roomId: "x", segmentIds: [r.segments[0].id], label: "A 2/2", length: 1.5, full: false },
    ];
    expect(connectorFittings(r, alien)).toHaveLength(0);
  });

  it("подпись меняется вместе с набором", () => {
    const a = collectFittings(computeRoomSkirting(makeRoom(RECT), PVC));
    const b = collectFittings(computeRoomSkirting(makeRoom(L_SHAPE), PVC));
    expect(fittingsSignature(a)).toBe(fittingsSignature(collectFittings(computeRoomSkirting(makeRoom(RECT), PVC))));
    expect(fittingsSignature(a)).not.toBe(fittingsSignature(b));
  });
});

describe("сечение и геометрия фурнитуры", () => {
  const profile = normalizeProfile(PVC.profile);

  it("выпуклая оболочка: против часовой, без вогнутостей", () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [1, 0.5],
      [2, 2],
      [0, 2],
    ]);
    expect(hull).toHaveLength(4);
    let area = 0;
    hull.forEach((p, i) => {
      const q = hull[(i + 1) % hull.length];
      area += p[0] * q[1] - q[0] * p[1];
    });
    expect(area).toBeGreaterThan(0);
  });

  it("накладка больше сечения плинтуса и охватывает его", () => {
    const shape = fittingShape(profile)!;
    expect(shape).not.toBeNull();
    const dMax = Math.max(...profile.map((p) => p[0]));
    const hMax = Math.max(...profile.map((p) => p[1]));
    expect(shape.depth).toBeGreaterThan(dMax);
    expect(Math.max(...shape.body.map((p) => p[1]))).toBeGreaterThan(hMax);
    // Каждая точка профиля — внутри (или на границе) сечения накладки.
    const inside = (pt: [number, number]) =>
      shape.body.every((p, i) => {
        const q = shape.body[(i + 1) % shape.body.length];
        return (q[0] - p[0]) * (pt[1] - p[1]) - (q[1] - p[1]) * (pt[0] - p[0]) >= -1e-12;
      });
    for (const pt of profile) expect(inside(pt)).toBe(true);
    expect(fittingShape([[0, 0], [0, 0.05]])).toBeNull();
  });

  it("геометрия: конечные координаты, в пределах комнаты и высоты накладки", () => {
    const door: Opening = { ...createOpening("door", "p2", 0.5), id: "d" };
    const room = makeRoom(L_SHAPE, [door]);
    const est = estimateProject(makeProject([room]));
    const list = collectFittings(est.rooms[0], est.products[0].pieces);
    const geom = buildFittingsGeometry(list, profile)!;
    expect(geom).not.toBeNull();
    const pos = geom.getAttribute("position");
    const nrm = geom.getAttribute("normal");
    expect(pos.count).toBeGreaterThan(0);
    expect(pos.count % 3).toBe(0);
    const hTop = Math.max(...fittingShape(profile)!.body.map((p) => p[1]));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(x).toBeGreaterThan(-0.05);
      expect(x).toBeLessThan(5.05);
      expect(z).toBeGreaterThan(-0.05);
      expect(z).toBeLessThan(4.05);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(hTop + 1e-9);
      expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 3);
    }
    geom.dispose();
    expect(buildFittingsGeometry([], profile)).toBeNull();
  });
});
