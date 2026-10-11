/**
 * migrateProject на любом мусоре: не падает, а результат — валидный проект,
 * с которым безопасно работать редактору и расчёту.
 */
import { describe, expect, it } from "vitest";
import { estimateProject } from "../estimate";
import { getWalls, signedArea } from "../geometry";
import { MAX_PROJECT_ROOMS, createDemoProject, createRoom, migrateProject } from "../project";
import { MAX_ROOM_OPENINGS, MAX_ROOM_POINTS, addOpening, isValidPolygon } from "../roomEdit";
import { decodeProject, encodeProject } from "../share";
import type { Project } from "../types";

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

const JUNK: unknown[] = [
  null,
  undefined,
  0,
  -1,
  Number.NaN,
  Infinity,
  1e308,
  "",
  "x",
  "#ffffff",
  true,
  false,
  [],
  [1, 2, 3],
  {},
  { x: 1 },
  [{ x: 0, y: 0 }],
];

/** Проект с несколькими комнатами и проёмами всех видов. */
function richProject(): Project {
  const p = createDemoProject();
  let l = createRoom({ name: "Кухня", shape: "L" });
  for (const kind of ["door", "window", "passage", "balcony", "furniture"] as const) l = addOpening(l, kind).room;
  const bay = createRoom({ name: "Эркер", shape: "bay" });
  return {
    ...p,
    rooms: [...p.rooms, l, bay],
    productOverrides: { "pvc-55": { price: 250, prices: { ...getPrices(), endCap: 40 } } },
  };
}

function getPrices() {
  return { innerCorner: 1, outerCorner: 2, endCap: 3, connector: 4, fastener: 5, glue: 6 };
}

/** Случайная порча JSON: замена значения мусором, удаление ключа, обрезка массива. */
function corrupt(value: unknown, rnd: () => number, depth = 0): unknown {
  if (rnd() < 0.04 + depth * 0.01) return JUNK[Math.floor(rnd() * JUNK.length)];
  if (Array.isArray(value)) {
    let arr = value.map((v) => corrupt(v, rnd, depth + 1));
    if (rnd() < 0.1) arr = arr.slice(0, Math.floor(rnd() * arr.length));
    if (rnd() < 0.05) arr = [...arr, ...arr]; // дубликаты id
    return arr;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (rnd() < 0.05) continue;
      out[k] = corrupt(v, rnd, depth + 1);
    }
    return out;
  }
  if (typeof value === "number" && rnd() < 0.1) return value * (rnd() < 0.5 ? -1 : 1e6);
  return value;
}

function expectSaneProject(p: Project, ctx: string) {
  expect(p.schemaVersion, ctx).toBe(1);
  expect(typeof p.id, ctx).toBe("string");
  expect(typeof p.name, ctx).toBe("string");
  expect(Number.isFinite(p.createdAt) && Number.isFinite(p.updatedAt), ctx).toBe(true);
  expect(p.rooms.length, ctx).toBeGreaterThan(0);
  expect(p.rooms.length, ctx).toBeLessThanOrEqual(MAX_PROJECT_ROOMS);
  expect(new Set(p.rooms.map((r) => r.id)).size, ctx).toBe(p.rooms.length);
  for (const r of p.rooms) {
    expect(isValidPolygon(r.points), ctx).toBe(true);
    expect(signedArea(r.points), ctx).toBeGreaterThan(0);
    expect(r.points.length, ctx).toBeLessThanOrEqual(MAX_ROOM_POINTS);
    expect(r.openings.length, ctx).toBeLessThanOrEqual(MAX_ROOM_OPENINGS);
    expect(new Set(r.points.map((q) => q.id)).size, ctx).toBe(r.points.length);
    expect(new Set(r.openings.map((o) => o.id)).size, ctx).toBe(r.openings.length);
    expect(Number.isFinite(r.height) && Number.isFinite(r.wallThickness), ctx).toBe(true);
    const walls = new Map(getWalls(r).map((w) => [w.id, w]));
    for (const o of r.openings) {
      const w = walls.get(o.wallId);
      expect(w, ctx).toBeDefined();
      expect(o.offset, ctx).toBeGreaterThanOrEqual(0);
      expect(o.offset + o.width, ctx).toBeLessThanOrEqual(w!.length + 1e-9);
      for (const v of [o.height, o.elevation, o.casing, o.depth, o.balconyDoorWidth, o.balconySillHeight]) {
        expect(Number.isFinite(v), ctx).toBe(true);
      }
    }
  }
  for (const v of Object.values(p.skirting)) {
    if (typeof v === "number") expect(Number.isFinite(v), ctx).toBe(true);
  }
}

describe("migrateProject: мусор на входе", () => {
  it("примитивы и обрезанные объекты не роняют миграцию", () => {
    const inputs: unknown[] = [
      ...JUNK,
      { rooms: null },
      { rooms: [null, 1, "x", [], {}] },
      { rooms: [{ points: null }, { points: [null, null, null] }, { points: "abc" }] },
      { rooms: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], openings: "x" }] },
      { rooms: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], openings: [null, 1, {}] }] },
      { rooms: [], skirting: null, productOverrides: [], appearance: 5 },
      { rooms: [], productOverrides: { "pvc-55": { prices: null, length: -1, cornerMethod: "glue" } } },
      Object.create(null),
    ];
    for (const raw of inputs) {
      const m = migrateProject(raw);
      if (m) expectSaneProject(m, JSON.stringify(raw) ?? String(raw));
    }
  });

  it("случайно испорченный проект → валидный проект или null", () => {
    const rnd = rng(2024);
    const source = JSON.parse(JSON.stringify(richProject()));
    for (let k = 0; k < 400; k++) {
      const raw = corrupt(source, rnd);
      let m: Project | null = null;
      expect(() => (m = migrateProject(raw))).not.toThrow();
      if (!m) continue;
      expectSaneProject(m, `#${k}`);
      // повторная миграция ничего не меняет, расчёт не падает
      expect(migrateProject(JSON.parse(JSON.stringify(m)))).toEqual(m);
      expect(() => estimateProject(m!)).not.toThrow();
    }
  });

  it("огромные координаты и абсурдные размеры комнаты отбрасываются", () => {
    const m = migrateProject({
      rooms: [
        { id: "huge", points: [{ x: 0, y: 0 }, { x: 1e300, y: 0 }, { x: 1e300, y: 1e300 }, { x: 0, y: 1e300 }] },
        { id: "km", points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3 }, { x: 0, y: 3 }] },
        { id: "ok", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }] },
      ],
    })!;
    expect(m.rooms.map((r) => r.id)).toEqual(["ok"]);
  });

  it("слишком много точек, комнат и проёмов — без зависания", () => {
    const n = 20_000;
    const R = (n * 0.2) / (2 * Math.PI);
    const circle = Array.from({ length: n }, (_, i) => ({
      x: R + R * Math.cos((-2 * Math.PI * i) / n),
      y: R + R * Math.sin((-2 * Math.PI * i) / n),
    }));
    const rect = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 3 }, { x: 0, y: 3 }];
    const raw = {
      rooms: [
        { id: "circle", points: circle },
        {
          id: "many-openings",
          points: rect.map((p, i) => ({ ...p, id: `w${i}` })),
          openings: Array.from({ length: 5000 }, (_, i) => ({ kind: "furniture", wallId: "w0", offset: i * 0.001, width: 0.3 })),
        },
        ...Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, points: rect })),
      ],
    };
    const t0 = performance.now();
    const m = migrateProject(raw)!;
    expect(performance.now() - t0).toBeLessThan(3000);
    // смотрим только первые MAX_PROJECT_ROOMS комнат; «круг» из 20 000 точек отброшен
    expect(m.rooms.some((r) => r.id === "circle")).toBe(false);
    expect(m.rooms.length).toBe(MAX_PROJECT_ROOMS - 1);
    expect(m.rooms[0].openings.length).toBe(MAX_ROOM_OPENINGS);
  });
});

describe("decodeProject: враждебная ссылка", () => {
  it("испорченные сжатые данные → null или валидный проект", async () => {
    const enc = await encodeProject(richProject());
    const rnd = rng(77);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let k = 0; k < 60; k++) {
      const chars = enc.split("");
      for (let j = 0; j < 3; j++) chars[Math.floor(rnd() * chars.length)] = alphabet[Math.floor(rnd() * 64)];
      const s = rnd() < 0.3 ? chars.join("").slice(0, Math.floor(rnd() * chars.length)) : chars.join("");
      const p = await decodeProject(s);
      if (p) expectSaneProject(p, `#${k}`);
    }
  });

  it("«zip-бомба» и слишком длинная строка → null", async () => {
    const zeros = "0".repeat(20_000_000);
    const bomb = await encodeProject(zeros as unknown as Project); // JSON строки из нулей
    expect(bomb.length).toBeLessThan(100_000);
    expect(await decodeProject(bomb)).toBeNull();
    expect(await decodeProject("A".repeat(2_000_000))).toBeNull();
  });
});

describe("migrateProject: id плинтусов", () => {
  it("неизвестный плинтус проекта → по умолчанию, комнаты → null", () => {
    const m = migrateProject({
      rooms: [
        { productId: "no-such", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] },
        { productId: "mdf-80", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] },
      ],
      skirting: { productId: 42 },
    })!;
    expect(m.skirting.productId).toBe("pvc-55");
    expect(m.rooms.map((r) => r.productId)).toEqual([null, "mdf-80"]);
    expect(migrateProject({ rooms: [], skirting: { productId: "wood-pine-45" } })!.skirting.productId).toBe(
      "wood-pine-45",
    );
  });
});
