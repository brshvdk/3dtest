import { describe, expect, it } from "vitest";
import { FIT_TOLERANCE } from "../cutting";
import { estimateProject, fastenersForRun } from "../estimate";
import type { OrderLine, ProductEstimate } from "../estimate";
import { CLIP_DOWEL_NAME, CLIP_DOWEL_PRICE, SKIRTING_CATALOG } from "../skirtingCatalog";
import type { AccessoryPrices, Project, Room } from "../types";
import { L_SHAPE, RECT, makeProject, makeRoom, op, sum } from "./calcFixtures";

/** Неразрывные пробелы из formatLength → обычные, чтобы сравнивать строки. */
const plain = (s: string) => s.replace(/ /g, " ");
const line = (p: ProductEstimate, kind: OrderLine["kind"]) => p.lines.find((l) => l.kind === kind);
const kinds = (p: ProductEstimate) => p.lines.map((l) => l.kind);

/** Прямоугольник 4×3 с дверью 80 посреди стены A. */
const rectWithDoor = (opts: Partial<Room> = {}) =>
  makeRoom(RECT, [op("d1", "door", 0, (4 - 0.87) / 2)], opts);

describe("fastenersForRun", () => {
  it("шаг + по точке на краях, минимум 2, короткие не крепим", () => {
    expect(fastenersForRun(4, 0.5)).toBe(9);
    expect(fastenersForRun(3, 0.5)).toBe(7);
    expect(fastenersForRun(1.2, 0.4)).toBe(4); // 1,2/0,4 = 2,9999… → 3 + 1
    // Кусок 10–30 см держит одна точка, короче 10 см — фурнитура или клей.
    expect(fastenersForRun(0.3, 0.5)).toBe(2);
    expect(fastenersForRun(0.15, 0.5)).toBe(1);
    expect(fastenersForRun(0.06, 0.5)).toBe(0);
    expect(fastenersForRun(0.04, 0.5)).toBe(0);
  });
});

describe("ПВХ 55 с фурнитурой", () => {
  const est = estimateProject(makeProject([rectWithDoor()]));
  const p = est.products[0];

  it("одна группа, длины и планки", () => {
    expect(est.products).toHaveLength(1);
    expect(p.product.id).toBe("pvc-55");
    expect(p.roomIds).toEqual(["r"]);
    expect(p.netLength).toBeCloseTo(13.05, 9);
    // Куски: 2,5×3 + 1,525×2 + 1,5 + 0,5×2 → 6 планок (3 целых + 3 с раскроем).
    expect(p.planksMin).toBe(6);
    expect(p.cutPlan.bars).toHaveLength(6);
    expect(p.cutPlan.optimal).toBe(true);
    expect(p.planksNaive).toBe(6); // ceil(13,05 / 2,5)
    expect(p.planksToOrder).toBe(7); // ceil(6 · 1,05)
    expect(p.reservePlanks).toBe(1);
    expect(p.lengthToOrder).toBeCloseTo(17.5, 9);
    expect(p.joints).toBe(3);
  });

  it("фурнитура и крепёж", () => {
    expect(p.accessories).toEqual({
      innerCorners: 4,
      outerCorners: 0,
      endCapsLeft: 1,
      endCapsRight: 1,
      connectors: 3,
      // прямые участки 1,525·2 + 3 + 4 + 3 → 5+5+7+9+7 = 33, + 3 стыка (у каждого торца
      // планки — своя точка) = 36 → ×1,1 = 39,6 → 40
      fasteners: 40,
      dowels: 0,
      glue: 0,
    });
  });

  it("строки заказа понятны покупателю, нулевых нет", () => {
    expect(kinds(p)).toEqual(["plank", "innerCorner", "endCapLeft", "endCapRight", "connector", "fastener"]);
    const plank = line(p, "plank")!;
    expect(plain(plank.name)).toBe("Плинтус ПВХ 55 мм с кабель-каналом, 2,5 м — Белый");
    expect(plank).toMatchObject({ qty: 7, unit: "шт", unitPrice: 200, total: 1400, productId: "pvc-55" });
    expect(plank.note).toContain("6 по раскрою + 1 запас");
    expect(line(p, "innerCorner")).toMatchObject({ name: "Угол внутренний", qty: 4, total: 180 });
    expect(line(p, "endCapLeft")).toMatchObject({ name: "Заглушка левая", qty: 1, total: 35 });
    expect(line(p, "endCapRight")).toMatchObject({ name: "Заглушка правая", qty: 1, total: 35 });
    expect(line(p, "connector")).toMatchObject({ name: "Соединитель", qty: 3, total: 105 });
    expect(line(p, "fastener")).toMatchObject({ name: "Дюбель-гвоздь 6×40", qty: 40, total: 120 });
    expect(new Set(p.lines.map((l) => l.id)).size).toBe(p.lines.length);
  });

  it("итоги проекта", () => {
    expect(p.cost).toBe(1400 + 180 + 35 + 35 + 105 + 120);
    expect(est.totalCost).toBe(p.cost);
    expect(est.lines).toEqual(p.lines);
    expect(est.netLength).toBeCloseTo(13.05, 9);
    expect(est.planksToOrder).toBe(7);
    expect(est.rooms).toHaveLength(1);
    expect(est.warnings).toEqual([]);
  });
});

describe("материалы", () => {
  it("МДФ 80 на клипсах: клипсы и дюбели к ним в одном количестве", () => {
    const p = estimateProject(makeProject([rectWithDoor({ productId: "mdf-80" })])).products[0];
    expect(p.product.id).toBe("mdf-80");
    expect(kinds(p)).toEqual([
      "plank", "innerCorner", "endCapLeft", "endCapRight", "connector", "fastener", "dowel",
    ]);
    const clip = line(p, "fastener")!;
    const dowel = line(p, "dowel")!;
    expect(clip.name).toBe("Клипса для плинтуса МДФ");
    expect(dowel).toMatchObject({ name: CLIP_DOWEL_NAME, unitPrice: CLIP_DOWEL_PRICE });
    expect(dowel.qty).toBe(clip.qty);
    expect(p.accessories.dowels).toBe(p.accessories.fasteners);
    expect(plain(line(p, "plank")!.name)).toBe("Плинтус МДФ 80 мм ламинированный, 2,4 м — Дуб светлый");
  });

  it("полиуретан на клей: тубы по расходу, углы — запил, без фурнитуры", () => {
    const est = estimateProject(makeProject([makeRoom(RECT)], { productId: "polyurethane-120" }));
    const p = est.products[0];
    // Монтажный клей + клей для стыков и запилов + акриловый герметик под покраску.
    expect(kinds(p)).toEqual(["plank", "glue", "jointGlue", "sealant"]);
    expect(line(p, "glue")).toMatchObject({ qty: 3, unit: "туб", unitPrice: 600 }); // ceil(14 / 6)
    expect(line(p, "jointGlue")).toMatchObject({ qty: 1, unit: "туб" }); // 4 угла + 2 стыка
    expect(line(p, "sealant")).toMatchObject({ qty: 1, unit: "туб" }); // ceil(14 / 15)
    expect(line(p, "sealant")!.name).toContain("акриловый");
    expect(line(p, "plank")!.note).toContain("углы — запил 45°");
    expect(p.accessories).toMatchObject({ innerCorners: 0, connectors: 0, fasteners: 0, glue: 3 });
    // 4 → 2+2, 3 → 2+1; два куска по 1,0 с пропилом не влезают в 2,0 → 8 планок.
    expect(p.planksMin).toBe(8);
    expect(p.planksToOrder).toBe(9);
  });

  it("керамика: элементы 0,6 м, плиточный клей мешками, затирка", () => {
    const p = estimateProject(makeProject([makeRoom(RECT)], { productId: "ceramic-80" })).products[0];
    expect(kinds(p)).toEqual(["plank", "glue", "grout"]);
    // Расход ceil(14·0,4) = 6 кг → 2 мешка по 5 кг; цена мешка = 5 × цена кг.
    expect(p.accessories.glue).toBe(6);
    expect(line(p, "glue")).toMatchObject({ qty: 2, unit: "шт", name: "Клей плиточный (мешок 5 кг)", unitPrice: 300 });
    expect(line(p, "glue")!.note).toContain("6 кг");
    expect(line(p, "grout")).toMatchObject({ qty: 1, unit: "шт" });
    // 4 м → 6×0,6 + 0,4; 3 м → 5×0,6 ровно → 22 целых + 2 по 0,4 (вместе с пропилом > 0,6).
    expect(p.pieces).toHaveLength(24);
    expect(p.planksMin).toBe(24);
    expect(p.planksToOrder).toBe(26); // ceil(24 · 1,05 = 25,2)
    expect(plain(line(p, "plank")!.name)).toContain(", 0,6 м — Белый глянец");
  });

  it("алюминий: универсальные заглушки одной строкой", () => {
    const p = estimateProject(makeProject([rectWithDoor({ productId: "aluminum-60" })])).products[0];
    expect(line(p, "endCap")).toMatchObject({ name: "Заглушка торцевая", qty: 2 });
    expect(line(p, "endCapLeft")).toBeUndefined();
    expect(line(p, "dowel")).toBeDefined();
  });

  it("МДФ на запил с наружным углом: заготовки длиннее, фурнитуры нет", () => {
    const p = estimateProject(makeProject([makeRoom(L_SHAPE, [], { productId: "mdf-100-paint" })]))
      .products[0];
    expect(p.accessories.outerCorners).toBe(0);
    expect(sum(p.pieces.map((x) => x.length))).toBeCloseTo(18 + 2 * 0.016, 9);
    expect(line(p, "glue")!.qty).toBe(3); // ceil(18 / 7)
  });

  it("углы не 90° — отдельная строка регулируемых уголков, обычных меньше", () => {
    const bay = makeRoom([[0, 0], [4, 0], [4, 2], [3, 3], [0, 3]]);
    const p = estimateProject(makeProject([bay])).products[0];
    const corners = p.lines.filter((l) => l.kind === "innerCorner");
    expect(corners.map((l) => [l.name, l.qty])).toEqual([
      ["Угол внутренний", 3],
      ["Угол внутренний регулируемый", 2],
    ]);
    expect(plain(corners[1].note!)).toBe("в цвет «Белый»; 2 угла 135° — обычный уголок не встанет");
    expect(corners[1].id).not.toBe(corners[0].id);
    expect(p.accessories.innerCorners).toBe(5);
    expect(p.warnings.some((w) => w.startsWith("Комната: "))).toBe(true);
  });
});

describe("правила проекта", () => {
  it("запас 5 % округляется вверх, 0 % — без запаса, 10 % от 10 — ровно 11", () => {
    const room = makeRoom([[0, 0], [10, 0], [10, 2.5], [0, 2.5]]); // 25 м = 10 целых планок
    expect(estimateProject(makeProject([room], { reservePct: 5 })).products[0].planksToOrder).toBe(11);
    expect(estimateProject(makeProject([room], { reservePct: 0 })).products[0].planksToOrder).toBe(10);
    expect(estimateProject(makeProject([room], { reservePct: 10 })).products[0].planksToOrder).toBe(11);
    expect(estimateProject(makeProject([room], { reservePct: 15 })).products[0].planksToOrder).toBe(12);
  });

  it("комнаты с выключенным плинтусом пропускаются", () => {
    const a = { ...rectWithDoor(), id: "a", name: "Гостиная" };
    const b = { ...makeRoom(RECT), id: "b", name: "Кладовая", skirtingEnabled: false };
    const est = estimateProject(makeProject([a, b]));
    expect(est.rooms.map((r) => r.roomId)).toEqual(["a"]);
    expect(est.products[0].roomIds).toEqual(["a"]);
  });

  it("всё выключено — пустая смета с подсказкой", () => {
    const est = estimateProject(makeProject([{ ...makeRoom(RECT), skirtingEnabled: false }]));
    expect(est.products).toEqual([]);
    expect(est.lines).toEqual([]);
    expect(est.totalCost).toBe(0);
    expect(est.warnings).toHaveLength(1);
  });

  it("группировка по эффективному продукту комнаты", () => {
    const rooms = [
      { ...makeRoom(RECT), id: "a", name: "Гостиная" },
      { ...makeRoom(RECT), id: "b", name: "Кухня", productId: "ceramic-80" },
      { ...makeRoom(RECT), id: "c", name: "Спальня" },
      { ...makeRoom(RECT), id: "d", name: "Детская", productId: "unknown-id" },
    ];
    const est = estimateProject(makeProject(rooms));
    expect(est.products.map((p) => p.product.id)).toEqual(["pvc-55", "ceramic-80"]);
    expect(est.products[0].roomIds).toEqual(["a", "c", "d"]);
    expect(est.products[1].roomIds).toEqual(["b"]);
    expect(est.lines.length).toBe(sum(est.products.map((p) => p.lines.length)));
    expect(est.totalCost).toBeCloseTo(sum(est.products.map((p) => p.cost)), 6);
    expect(est.planksToOrder).toBe(sum(est.products.map((p) => p.planksToOrder)));
    expect(est.netLength).toBeCloseTo(56, 9);
  });

  it("правки продукта влияют на цену и длину планки", () => {
    const base = estimateProject(makeProject([rectWithDoor()])).products[0];
    const est = estimateProject(
      makeProject([rectWithDoor()], {}, { "pvc-55": { price: 300, length: 3.0, prices: { innerCorner: 100 } as AccessoryPrices } }),
    );
    const p = est.products[0];
    expect(p.product.length).toBe(3.0);
    expect(line(p, "plank")!.unitPrice).toBe(300);
    expect(line(p, "innerCorner")!.total).toBe(400);
    expect(p.lengthToOrder).toBeCloseTo(p.planksToOrder * 3, 9);
    expect(p.cost).not.toBe(base.cost);
  });

  it("обмен обрезками между комнатами экономит планки", () => {
    // Ниша 1,2×1,2, одна стена занята шкафом: 3 куска по 1,2 на комнату.
    const rooms = [0, 1, 2].map((i) => ({
      // Глубина 0 — «просто участок без плинтуса»: боковины не закрывают соседние стены.
      ...makeRoom([[0, 0], [1.2, 0], [1.2, 1.2], [0, 1.2]], [op(`k${i}`, "furniture", 0, 0, { width: 1.2, depth: 0 })]),
      id: `n${i}`,
      name: `Ниша ${i + 1}`,
    }));
    const shared = estimateProject(makeProject(rooms, { shareOffcuts: true })).products[0];
    const separate = estimateProject(makeProject(rooms, { shareOffcuts: false })).products[0];
    // В планку 2,5 входят два куска 1,2: вместе 9 кусков → 5 планок, по комнатам 3 × 2 = 6.
    expect(shared.planksMin).toBe(5);
    expect(separate.planksMin).toBe(6);
    expect(separate.cutPlan.lowerBound).toBe(6);
    expect(separate.cutPlan.bars.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("плинтус в комнате не нужен — ноль планок и без строк", () => {
    const room = makeRoom(RECT, [0, 1, 2, 3].map((w) => op(`k${w}`, "furniture", w, 0, { width: 4 })));
    const p = estimateProject(makeProject([room])).products[0];
    expect(p.netLength).toBe(0);
    expect(p.planksToOrder).toBe(0);
    expect(p.planksNaive).toBe(0);
    expect(p.lengthToOrder).toBe(0);
    expect(p.lines).toEqual([]);
    expect(p.cost).toBe(0);
    expect(p.warnings.some((w) => w.includes("не нужен"))).toBe(true);
  });

  it("откосы проёма увеличивают длину и дают наружные уголки", () => {
    const room = makeRoom(RECT, [op("p1", "passage", 0, 1.55)]);
    const p = estimateProject(makeProject([room])).products[0];
    expect(p.netLength).toBeCloseTo(13.4, 9);
    expect(line(p, "outerCorner")).toMatchObject({ name: "Угол наружный", qty: 2 });
  });

  it("не мутирует проект", () => {
    const project = makeProject([rectWithDoor()], {}, { "pvc-55": { price: 1 } });
    const snapshot = JSON.stringify(project);
    estimateProject(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});

/* ------------------------------------------------------------------ */
/* Состязательные случаи сметы                                           */
/* ------------------------------------------------------------------ */

describe("инварианты сметы на случайных проектах", () => {
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
    [[0, 0], [4, 0], [4, 2], [3, 3], [0, 3]],
    [[0, 0], [2, 0], [6.2, 0], [6.2, 3.1], [0, 3.1]],
    [[0, 0], [1.2, 0], [1.2, 0.9], [0, 0.9]],
  ];
  const KINDS = ["door", "window", "passage", "balcony", "furniture"] as const;
  const PRODUCTS = SKIRTING_CATALOG.map((p) => p.id);

  function expectSoundProduct(p: ProductEstimate, reservePct: number) {
    const L = p.product.length;
    expect(p.planksMin).toBe(p.cutPlan.bars.length);
    expect(p.planksMin).toBeGreaterThanOrEqual(p.cutPlan.lowerBound);
    expect(p.planksToOrder).toBeGreaterThanOrEqual(p.planksMin);
    expect(p.planksToOrder).toBe(p.netLength > 0 ? Math.ceil(p.planksMin * (1 + reservePct / 100) - 1e-9) : 0);
    expect(p.reservePlanks).toBe(p.planksToOrder - p.planksMin);
    expect(p.lengthToOrder).toBeCloseTo(p.planksToOrder * L, 9);
    expect(p.netLength).toBeCloseTo(sum(p.rooms.map((r) => r.netLength)), 9);
    expect(p.planksNaive).toBe(p.netLength > 0 ? Math.ceil(p.netLength / L - 1e-9) : 0);
    // Все куски разложены ровно один раз; материала не меньше чистой длины.
    const placed = p.cutPlan.bars.flatMap((b) => b.pieces.map((x) => x.id)).sort();
    expect(placed).toEqual(p.pieces.map((x) => x.id).sort());
    const material = sum(p.pieces.map((x) => x.length));
    // На фурнитуре участок до L + FIT_TOLERANCE закрывают целые планки (недостачу прячут уголки/заглушки).
    const slack = p.product.cornerMethod === "fittings" ? p.pieces.length * FIT_TOLERANCE : 0;
    expect(material).toBeGreaterThanOrEqual(p.netLength - slack - 1e-6);
    // Ни один кусок не длиннее планки.
    for (const x of p.pieces) expect(x.length).toBeLessThanOrEqual(L + 1e-6);
    expect(p.planksMin * L).toBeGreaterThanOrEqual(material - 1e-6);
    // Строки: только ненулевые, итог = Σ, у плашек — количество к заказу.
    for (const l of p.lines) {
      expect(Number.isInteger(l.qty)).toBe(true);
      expect(l.qty).toBeGreaterThan(0);
      expect(l.total).toBeCloseTo(l.qty * l.unitPrice, 2);
      expect(l.productId).toBe(p.product.id);
    }
    expect(new Set(p.lines.map((l) => l.id)).size).toBe(p.lines.length);
    expect(p.cost).toBeCloseTo(sum(p.lines.map((l) => l.total)), 2);
    if (p.planksToOrder > 0) expect(line(p, "plank")!.qty).toBe(p.planksToOrder);
    else expect(line(p, "plank")).toBeUndefined();
    // Фурнитура — по комнатам; при запиле уголков нет, а заглушки и соединители
    // остаются только у ПВХ с кабель-каналом.
    const a = p.accessories;
    if (p.netLength <= 0) {
      expect(Object.values(a).every((v) => v === 0)).toBe(true);
    } else if (p.product.cornerMethod === "fittings") {
      expect(a.innerCorners).toBe(sum(p.rooms.map((r) => r.corners.inner)));
      expect(a.outerCorners).toBe(sum(p.rooms.map((r) => r.corners.outer)));
      expect(a.endCapsLeft).toBe(sum(p.rooms.map((r) => r.endCaps.left)));
      expect(a.endCapsRight).toBe(a.endCapsLeft);
      expect(a.connectors).toBe(p.joints);
      const cornerQty = sum(p.lines.filter((l) => l.kind === "innerCorner" || l.kind === "outerCorner").map((l) => l.qty));
      expect(cornerQty).toBe(a.innerCorners + a.outerCorners);
    } else {
      expect([a.innerCorners, a.outerCorners]).toEqual([0, 0]);
      expect(kinds(p).some((k) => k.endsWith("Corner"))).toBe(false);
      if (p.product.cableChannel) {
        expect(a.endCapsLeft).toBe(sum(p.rooms.map((r) => r.endCaps.left)));
        expect(a.connectors).toBe(p.joints);
      } else {
        expect([a.endCapsLeft, a.endCapsRight, a.connectors]).toEqual([0, 0, 0]);
        expect(kinds(p).some((k) => k.startsWith("endCap") || k === "connector")).toBe(false);
      }
    }
    if (p.product.fastening === "clips") expect(a.dowels).toBe(a.fasteners);
    else expect(a.dowels).toBe(0);
  }

  it("300 проектов из нескольких комнат и плинтусов", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = lcg(seed * 104729);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      const rooms: Room[] = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => {
        const pts = pick(SHAPES);
        const n = pts.length;
        const openings = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => {
          const w = Math.floor(rnd() * n);
          const [x0, y0] = pts[w];
          const [x1, y1] = pts[(w + 1) % n];
          const len = Math.hypot(x1 - x0, y1 - y0);
          return op(`o${k}-${i}`, pick(KINDS), w, rnd() * len - 0.1, { width: pick([0.6, 0.87, 1.5, len + 0.5]) });
        });
        return {
          ...makeRoom(pts, openings, { productId: rnd() < 0.5 ? null : pick(PRODUCTS) }),
          id: `r${k}`,
          name: `Комната ${k + 1}`,
          skirtingEnabled: rnd() < 0.9,
        };
      });
      const reservePct = pick([0, 5, 7.5, 10]);
      const settings = { reservePct, kerf: pick([0, 0.003]), minPiece: pick([0, 0.3, 0.5]), shareOffcuts: rnd() < 0.5 };
      const overrides: Project["productOverrides"] =
        rnd() < 0.3 ? { "pvc-55": { cornerMethod: "miter", length: 3 } } : {};
      const est = estimateProject(makeProject(rooms, settings, overrides));
      try {
        for (const p of est.products) expectSoundProduct(p, reservePct);
        expect(est.rooms.map((r) => r.roomId)).toEqual(rooms.filter((r) => r.skirtingEnabled).map((r) => r.id));
        expect(est.lines).toEqual(est.products.flatMap((p) => p.lines));
        expect(est.totalCost).toBeCloseTo(sum(est.products.map((p) => p.cost)), 2);
        expect(est.planksToOrder).toBe(sum(est.products.map((p) => p.planksToOrder)));
        expect(est.netLength).toBeCloseTo(sum(est.rooms.map((r) => r.netLength)), 9);
        expect(new Set(est.lines.map((l) => l.id)).size).toBe(est.lines.length);
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).message}`);
      }
    }
  });

  it("общий раскрой никогда не хуже раскроя по комнатам (когда он доказанно оптимален)", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = lcg(seed);
      const rooms = [0, 1, 2].map((k) => ({
        ...makeRoom([[0, 0], [0.5 + rnd() * 3, 0], [0.5 + rnd() * 3, 0.5 + rnd() * 2], [0, 1.5]]),
        id: `r${k}`,
      }));
      const shared = estimateProject(makeProject(rooms, { shareOffcuts: true })).products[0];
      const separate = estimateProject(makeProject(rooms, { shareOffcuts: false })).products[0];
      if (shared.cutPlan.optimal) expect(shared.planksMin).toBeLessThanOrEqual(separate.planksMin);
      expect(separate.cutPlan.bars.map((b) => b.index)).toEqual(separate.cutPlan.bars.map((_, i) => i));
    }
  });

  it("мусор в настройках не ломает расчёт", () => {
    const est = estimateProject(
      makeProject([rectWithDoor()], { kerf: Number.NaN, minPiece: -1, reservePct: Number.NaN }),
    );
    const p = est.products[0];
    expect(p.cutPlan.kerf).toBe(0);
    expect(p.planksToOrder).toBe(p.planksMin);
    expect(Number.isFinite(est.totalCost)).toBe(true);
  });

  it("дверь у вершины «на прямой»: наличник вычтен с обеих стен", () => {
    const room = makeRoom([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]], [op("d", "door", 0, 2 - 0.87)]);
    const p = estimateProject(makeProject([room])).products[0];
    expect(p.netLength).toBeCloseTo(14 - 0.95, 9);
    expect(p.accessories).toMatchObject({ innerCorners: 4, endCapsLeft: 1, endCapsRight: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Находки аудита: раскрой, допуски, фурнитура, расходники              */
/* ------------------------------------------------------------------ */

describe("стыки на длинных стенах подбираются под обрезки", () => {
  const rect = (w: number, h: number) => makeRoom([[0, 0], [w, 0], [w, h], [0, h]]);

  it("2,60×2,70, ПВХ 55: 5 планок, а не 8 (стены не делятся пополам)", () => {
    const p = estimateProject(makeProject([rect(2.6, 2.7)])).products[0];
    expect(p.planksMin).toBe(5);
    expect(p.planksToOrder).toBe(6);
    expect(p.joints).toBe(4);
    // Каждый кусок ≥ мин. куска 30 см, каждая стена собрана из своих кусков.
    for (const x of p.pieces) expect(x.length).toBeGreaterThanOrEqual(0.3 - 1e-9);
    for (const id of ["r:p0:1", "r:p1:1", "r:p2:1", "r:p3:1"]) {
      const wall = p.rooms[0].segments.find((s) => s.id === id)!;
      const parts = p.pieces.filter((x) => x.segmentIds[0] === id);
      expect(parts).toHaveLength(2);
      expect(sum(parts.map((x) => x.length))).toBeCloseTo(wall.length, 6);
    }
  });

  it("Г-образная 5×4 (вырез 2×1,5), МДФ 80: 8 планок по раскрою, 9 заказать", () => {
    const room = makeRoom([[0, 0], [5, 0], [5, 2.5], [3, 2.5], [3, 4], [0, 4]]);
    const p = estimateProject(makeProject([room], { productId: "mdf-80" })).products[0];
    expect(p.planksMin).toBe(8);
    expect(p.planksToOrder).toBe(9);
  });

  it("5,1×3, ПВХ 55: 7 планок", () => {
    expect(estimateProject(makeProject([rect(5.1, 3)])).products[0].planksMin).toBe(7);
  });

  it("обмен обрезками и раздельный раскрой: общий не хуже раздельного", () => {
    const rooms = [rect(2.6, 2.7), rect(5.1, 3)].map((r, i) => ({ ...r, id: `r${i}`, name: `К${i}` }));
    const shared = estimateProject(makeProject(rooms, { shareOffcuts: true })).products[0];
    const separate = estimateProject(makeProject(rooms, { shareOffcuts: false })).products[0];
    expect(separate.planksMin).toBe(12);
    expect(shared.planksMin).toBeLessThanOrEqual(separate.planksMin);
  });
});

describe("монтаж на фурнитуру: допуск на длину участка", () => {
  const square = (a: number) => makeRoom([[0, 0], [a, 0], [a, a], [0, a]]);

  it("стена на 5–10 мм длиннее планки закрывается одной планкой, без соединителей", () => {
    for (const a of [2.5, 2.505, 2.51]) {
      const p = estimateProject(makeProject([square(a)])).products[0];
      expect(p.planksMin).toBe(4);
      expect(p.planksToOrder).toBe(5);
      expect(p.joints).toBe(0);
      expect(p.accessories.connectors).toBe(0);
    }
  });

  it("при запиле допуска нет: стык на каждой стене", () => {
    const p = estimateProject(makeProject([square(2.505)], {}, { "pvc-55": { cornerMethod: "miter" } })).products[0];
    expect(p.joints).toBe(4);
  });
});

describe("цена планки зависит от длины", () => {
  it("МДФ 80: 2,4 м по 550 ₽, 2,8 м — по цене погонного метра", () => {
    const at = (length: number) =>
      estimateProject(makeProject([makeRoom(RECT)], { productId: "mdf-80" }, { "mdf-80": { length } })).products[0];
    const short = at(2.4);
    const long = at(2.8);
    expect(line(short, "plank")!.unitPrice).toBe(550);
    expect(line(long, "plank")!.unitPrice).toBe(Math.round((550 / 2.4) * 2.8));
    // Та же комната: заказ длиннее — не дешевле.
    expect(line(long, "plank")!.total).toBeGreaterThanOrEqual(line(short, "plank")!.total);
  });

  it("керамика 0,3 / 0,6 / 1,2 м: стоимость плитки различается только обрезками", () => {
    const bath = makeRoom([[0, 0], [1.7, 0], [1.7, 1.5], [0, 1.5]]);
    const totals = [0.3, 0.6, 1.2].map(
      (length) =>
        line(
          estimateProject(makeProject([bath], { productId: "ceramic-80" }, { "ceramic-80": { length } })).products[0],
          "plank",
        )!.total,
    );
    // Было 6 090 / 3 340 / 1 840 ₽ (в 3,3 раза); теперь разброс — запас и обрезки, не больше 20 %.
    expect(Math.max(...totals) / Math.min(...totals)).toBeLessThan(1.2);
  });

  it("своя цена пользователя не пересчитывается", () => {
    const p = estimateProject(
      makeProject([makeRoom(RECT)], { productId: "mdf-80" }, { "mdf-80": { length: 2.8, price: 500 } }),
    ).products[0];
    expect(line(p, "plank")!.unitPrice).toBe(500);
  });
});

describe("керамика: пропил уходит в шов", () => {
  it("ванная 1,7×1,5, элемент 0,6: две половины 0,3 — из одного элемента", () => {
    const p = estimateProject(
      makeProject([makeRoom([[0, 0], [1.7, 0], [1.7, 1.5], [0, 1.5]])], { productId: "ceramic-80", kerf: 0.003 }),
    ).products[0];
    expect(p.planksMin).toBe(11);
    expect(p.cutPlan.kerf).toBe(0);
    const halves = p.cutPlan.bars.find((b) => b.pieces.length === 2 && b.pieces.every((x) => Math.abs(x.length - 0.3) < 1e-9));
    expect(halves).toBeDefined();
    expect(halves!.waste).toBe(0);
  });

  it("ванна в комнате — санитарный герметик", () => {
    const room = makeRoom([[0, 0], [2, 0], [2, 1.7], [0, 1.7]], [op("b", "furniture", 0, 0, {}, "furn-bath")]);
    const p = estimateProject(makeProject([room], { productId: "ceramic-80" })).products[0];
    expect(kinds(p)).toEqual(["plank", "glue", "grout", "sealant"]);
    expect(line(p, "sealant")!.name).toContain("санитарный");
  });
});

describe("запил у ПВХ с кабель-каналом", () => {
  const room = makeRoom([[0, 0], [5, 0], [5, 2.5], [3, 2.5], [3, 4], [0, 4]], [op("d", "door", 0, 1.5)]);

  it("уголков нет, а заглушки у двери и соединители на стыках остаются", () => {
    const p = estimateProject(makeProject([room], {}, { "pvc-55": { cornerMethod: "miter" } })).products[0];
    expect(kinds(p)).toEqual(["plank", "endCapLeft", "endCapRight", "connector", "fastener"]);
    expect(line(p, "endCapLeft")!.qty).toBe(1);
    expect(line(p, "endCapRight")!.qty).toBe(1);
    expect(line(p, "connector")!.qty).toBe(p.joints);
    expect(p.joints).toBeGreaterThan(0);
  });

  it("МДФ под покраску на запиле — без заглушек и соединителей", () => {
    const p = estimateProject(makeProject([room], { productId: "mdf-100-paint" })).products[0];
    expect(kinds(p).some((k) => k.startsWith("endCap") || k === "connector")).toBe(false);
    expect(kinds(p)).toContain("sealant");
    expect(kinds(p)).not.toContain("jointGlue");
  });
});

describe("углы не 90°", () => {
  it("эркер: регулируемые уголки внутренние и наружные отдельными строками", () => {
    // Эркер 2,6×0,8 на стене 5 м: 2 угла 135° внутренних, 2 — наружных (225°).
    const room = makeRoom([[0, 0], [5, 0], [5, 4], [3.8, 4], [3, 4.8], [2, 4.8], [1.2, 4], [0, 4]]);
    const p = estimateProject(makeProject([room])).products[0];
    const names = p.lines.filter((l) => l.kind === "innerCorner" || l.kind === "outerCorner").map((l) => [l.name, l.qty]);
    expect(names).toEqual([
      ["Угол внутренний", 4],
      ["Угол внутренний регулируемый", 2],
      ["Угол наружный регулируемый", 2],
    ]);
    const miter = estimateProject(makeProject([room], {}, { "pvc-55": { cornerMethod: "miter" } })).products[0];
    expect(line(miter, "plank")!.note).toContain("углы 135° — запил 22,5°");
  });

  it("отклонение 1–3° — обычный угол: без регулируемых уголков и предупреждения", () => {
    // Правый нижний угол сдвинут на 7 см: углы 91,3° и 88,7°.
    const room = makeRoom([[0, 0], [4, 0], [4.07, 3], [0, 3]]);
    const p = estimateProject(makeProject([room])).products[0];
    expect(p.rooms[0].corners.nonRight).toBe(0);
    expect(p.lines.filter((l) => l.kind === "innerCorner").map((l) => l.qty)).toEqual([4]);
    expect(p.warnings).toEqual([]);
  });
});

describe("крепёж по кускам", () => {
  it("4×3 ПВХ: (32 + 4 стыка) · 1,1 → 40", () => {
    const p = estimateProject(makeProject([makeRoom(RECT)])).products[0];
    expect(p.joints).toBe(4);
    expect(p.accessories.fasteners).toBe(40);
  });

  it("кусок 6 см у двери не крепится, 15 см — одна точка", () => {
    // Наличник выступает на 4 см: дверь в offset 0,10 оставляет у угла 6 см, в 0,19 — 15 см.
    const at = (offset: number) =>
      estimateProject(makeProject([makeRoom(RECT, [op("d", "door", 0, offset)])])).products[0].accessories.fasteners;
    // 0 + 7 (2,99) + 7 + 9 + 7 + 4 стыка = 34 → 37,4 → 38
    expect(at(0.1)).toBe(38);
    // 1 + 7 (2,90) + 7 + 9 + 7 + 4 стыка = 35 → 38,5 → 39
    expect(at(0.19)).toBe(39);
  });
});

describe("мебель в углу в смете", () => {
  it("кухня 3 м на стене B комнаты 4×3: 9,8 м, 4 планки по раскрою, 5 заказать", () => {
    const p = estimateProject(makeProject([makeRoom(RECT, [op("k", "furniture", 1, 0, { width: 3 })])])).products[0];
    expect(p.netLength).toBeCloseTo(9.8, 9);
    expect(p.planksMin).toBe(4);
    expect(p.planksToOrder).toBe(5);
  });
});
