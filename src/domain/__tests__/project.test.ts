import { describe, expect, it } from "vitest";
import { getWalls, polygonArea, signedArea } from "../geometry";
import {
  DEFAULT_ROOM_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  SCHEMA_VERSION,
  cloneRoom,
  createDemoProject,
  createProject,
  createRoom,
  defaultAppearance,
  defaultSkirtingSettings,
  migrateProject,
} from "../project";
import { footprint } from "../openings";
import { DEFAULT_PRODUCT_ID, getCatalogProduct } from "../skirtingCatalog";

describe("фабрики", () => {
  it("настройки по умолчанию", () => {
    expect(defaultSkirtingSettings()).toEqual({
      productId: DEFAULT_PRODUCT_ID,
      reservePct: 5,
      minPiece: 0.3,
      kerf: 0.003,
      shareOffcuts: true,
    });
    expect(defaultAppearance()).toEqual({ wallColor: "#e9e4da", floorPattern: "deck", floorTint: "#c89567" });
  });

  it("createRoom: прямоугольник 4,5×3,6 по умолчанию", () => {
    const r = createRoom();
    expect(r.shape).toBe("rect");
    expect(polygonArea(r.points)).toBeCloseTo(16.2);
    expect(r.height).toBe(DEFAULT_ROOM_HEIGHT);
    expect(r.wallThickness).toBe(DEFAULT_WALL_THICKNESS);
    expect(r).toMatchObject({ openings: [], skirtingEnabled: true, productId: null });
    const l = createRoom({ name: "Кухня", shape: "L", height: 3 });
    expect(l).toMatchObject({ name: "Кухня", shape: "L", height: 3 });
    expect(l.points).toHaveLength(6);
  });

  it("createProject: одна комната «Комната 1»", () => {
    const p = createProject();
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.rooms).toHaveLength(1);
    expect(p.rooms[0].name).toBe("Комната 1");
    expect(p.productOverrides).toEqual({});
    expect(createProject({ name: "Дача" }).name).toBe("Дача");
  });

  it("демо: гостиная с дверью на C у угла и окном по центру A", () => {
    const p = createDemoProject();
    expect(p.name).toBe("Моя квартира");
    const room = p.rooms[0];
    expect(room.name).toBe("Гостиная");
    expect(polygonArea(room.points)).toBeCloseTo(16.2);
    const walls = getWalls(room);
    const win = room.openings.find((o) => o.kind === "window")!;
    const door = room.openings.find((o) => o.kind === "door")!;
    expect(win.wallId).toBe(walls[0].id);
    expect(win.presetId).toBe("win-130x140");
    expect(win.offset + win.width / 2).toBeCloseTo(walls[0].length / 2);
    expect(door.wallId).toBe(walls[2].id);
    expect(door.presetId).toBe("door-80");
    // ближе к углу: наличник не дальше 30 см от конца стены, но внутри стены
    const fp = footprint(door);
    expect(walls[2].length - fp.to).toBeGreaterThan(0);
    expect(walls[2].length - fp.to).toBeLessThan(0.3);
  });
});

describe("cloneRoom", () => {
  it("новые id, wallId переназначены", () => {
    const src = createDemoProject().rooms[0];
    const c = cloneRoom(src);
    expect(c.id).not.toBe(src.id);
    expect(c.name).toBe("Гостиная (копия)");
    const pointIds = new Set(c.points.map((p) => p.id));
    c.points.forEach((p, i) => {
      expect(p.id).not.toBe(src.points[i].id);
      expect(p.x).toBe(src.points[i].x);
    });
    c.openings.forEach((o, i) => {
      expect(o.id).not.toBe(src.openings[i].id);
      expect(pointIds.has(o.wallId)).toBe(true);
      // стена с тем же индексом
      const idx = c.points.findIndex((p) => p.id === o.wallId);
      expect(src.points[idx].id).toBe(src.openings[i].wallId);
    });
    expect(cloneRoom(src, "Спальня").name).toBe("Спальня");
  });
});

describe("migrateProject", () => {
  it("не проект → null", () => {
    for (const raw of [null, undefined, 42, "x", [], {}, { rooms: "nope" }]) {
      expect(migrateProject(raw)).toBeNull();
    }
  });

  it("валидный проект проходит без потерь", () => {
    const p = createDemoProject();
    const m = migrateProject(JSON.parse(JSON.stringify(p)))!;
    expect(m).toEqual(p);
  });

  it("мусор отбрасывается, недостающее — дефолты", () => {
    const m = migrateProject({
      name: 123,
      rooms: [
        "garbage",
        { points: [{ x: 0, y: 0 }, { x: 1 }] }, // мало точек
        { points: [{ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 4, y: 0 }, { x: 0, y: 3 }] }, // самопересечение
        {
          id: "ok",
          name: "Спальня",
          height: 99,
          wallThickness: "thick",
          points: [
            { id: "a", x: 0, y: 0 },
            { id: "b", x: 3, y: 0 },
            { id: "c", x: 3, y: 3 },
            { id: "d", x: 0, y: 3, thickness: -1 },
          ],
          openings: [
            { kind: "door", wallId: "a", offset: 1, presetId: "door-80" },
            { kind: "spaceship", wallId: "a" },
            { kind: "window", wallId: "zzz" },
            { kind: "window", wallId: "b", offset: 100, width: 1.2, hinge: "up" },
          ],
          shape: "hexagon",
        },
      ],
      skirting: { reservePct: -5, kerf: "x", shareOffcuts: false },
      productOverrides: {
        "pvc-55": { price: 250, color: "red", prices: { endCap: 40, glue: "x" }, bogus: 1 },
        "no-such-product": { price: 1 },
        "mdf-80": "x",
      },
      appearance: { wallColor: "#ABCDEF", floorPattern: "lava" },
    })!;
    expect(m).not.toBeNull();
    expect(m.name).toBe("Мой проект");
    expect(m.rooms).toHaveLength(1);
    const r = m.rooms[0];
    expect(r).toMatchObject({ id: "ok", name: "Спальня", height: 10, wallThickness: DEFAULT_WALL_THICKNESS, shape: "custom" });
    expect(r.points[3].thickness).toBe(0.02);
    expect(r.openings).toHaveLength(2);
    expect(r.openings[0]).toMatchObject({ kind: "door", wallId: "a", offset: 1, width: 0.87, casing: 0.07 });
    const w = r.openings[1];
    expect(w).toMatchObject({ kind: "window", wallId: "b", width: 1.2, hinge: "left" });
    expect(w.offset).toBeCloseTo(3 - 1.2); // clamp по стене
    expect(m.skirting).toEqual({ ...defaultSkirtingSettings(), reservePct: 0, shareOffcuts: false });
    expect(Object.keys(m.productOverrides)).toEqual(["pvc-55"]);
    const ov = m.productOverrides["pvc-55"];
    expect(ov.price).toBe(250);
    expect(ov.color).toBeUndefined();
    expect(ov.prices).toEqual({ ...getCatalogProduct("pvc-55")!.prices, endCap: 40 });
    expect(m.appearance).toEqual({ wallColor: "#abcdef", floorPattern: "deck", floorTint: "#c89567" });
  });

  it("без валидных комнат — одна пустая комната", () => {
    const m = migrateProject({ rooms: [{ points: [] }] })!;
    expect(m.rooms).toHaveLength(1);
    expect(m.rooms[0].name).toBe("Комната 1");
  });

  it("нормализует ориентацию и дубликаты id", () => {
    const m = migrateProject({
      rooms: [
        {
          id: "r",
          points: [
            { id: "a", x: 0, y: 0 },
            { id: "a", x: 0, y: 3 },
            { id: "c", x: 4, y: 3 },
            { id: "d", x: 4, y: 0 },
          ],
        },
        { id: "r", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] },
      ],
    })!;
    expect(m.rooms).toHaveLength(2);
    expect(m.rooms[0].id).not.toBe(m.rooms[1].id);
    expect(signedArea(m.rooms[0].points)).toBeGreaterThan(0);
    expect(new Set(m.rooms[0].points.map((p) => p.id)).size).toBe(4);
  });
});
