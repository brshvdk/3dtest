import { describe, expect, it } from "vitest";
import { polygonSelfIntersects, signedArea } from "../geometry";
import {
  CUSTOM_PRODUCT_ID,
  DEFAULT_PRODUCT_ID,
  MATERIAL_META,
  SKIRTING_CATALOG,
  getCatalogProduct,
  priceForLength,
  pricePerMeter,
  getColorName,
  getProductLengths,
  hasOverride,
  resolveProduct,
} from "../skirtingCatalog";
import type { AccessoryPrices, SkirtingProduct } from "../types";

/** В ProductOverride цены — полный AccessoryPrices, но из хранилища могут прийти частичные. */
const partialPrices = (p: Partial<AccessoryPrices>) => p as AccessoryPrices;

const EXPECTED_IDS = [
  "pvc-55",
  "pvc-85",
  "mdf-80",
  "mdf-100-paint",
  "wood-pine-45",
  "duropolymer-100",
  "polyurethane-120",
  "aluminum-60",
  "shadow-alu",
  "ceramic-80",
  "custom",
];

describe("каталог", () => {
  it("состав и порядок показа", () => {
    expect(SKIRTING_CATALOG.map((p) => p.id)).toEqual(EXPECTED_IDS);
    expect(DEFAULT_PRODUCT_ID).toBe("pvc-55");
    expect(CUSTOM_PRODUCT_ID).toBe("custom");
    expect(getCatalogProduct(DEFAULT_PRODUCT_ID)).toBe(SKIRTING_CATALOG[0]);
    expect(getCatalogProduct("nope")).toBeUndefined();
  });

  it("у каждого материала есть описание", () => {
    for (const p of SKIRTING_CATALOG) {
      const meta = MATERIAL_META[p.material];
      expect(meta.name).toBeTruthy();
      expect(meta.short).toBeTruthy();
      expect(meta.description.length).toBeGreaterThan(20);
    }
  });

  it("каталог заморожен", () => {
    const p = SKIRTING_CATALOG[0];
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.profile)).toBe(true);
    expect(Object.isFrozen(p.prices)).toBe(true);
  });

  describe.each(SKIRTING_CATALOG.map((p) => [p.id, p] as [string, SkirtingProduct]))("%s", (_id, p) => {
    it("тексты и цены", () => {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.shortName.length).toBeGreaterThan(1);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.price).toBeGreaterThan(0);
      for (const v of Object.values(p.prices)) expect(v).toBeGreaterThanOrEqual(0);
      expect(p.fastenerName.length).toBeGreaterThan(3);
    });

    it("длины и размеры", () => {
      expect(p.lengths.length).toBeGreaterThan(0);
      expect(p.lengths[0]).toBe(p.length);
      for (const l of p.lengths) expect(l).toBeGreaterThan(0.2);
      expect(p.height).toBeGreaterThan(0.03);
      expect(p.height).toBeLessThan(0.2);
      expect(p.depth).toBeGreaterThan(0);
      expect(p.depth).toBeLessThan(0.05);
    });

    it("цвета: 4–8, выбран первый", () => {
      expect(p.colors.length).toBeGreaterThanOrEqual(4);
      expect(p.colors.length).toBeLessThanOrEqual(8);
      expect(p.color).toBe(p.colors[0].hex);
      for (const c of p.colors) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(p.colors.map((c) => c.hex)).size).toBe(p.colors.length);
    });

    it("стыковка углов и крепёж согласованы", () => {
      expect(p.cornerMethods).toContain(p.cornerMethod);
      if (p.cornerMethods.includes("fittings")) {
        expect(p.prices.innerCorner).toBeGreaterThan(0);
        expect(p.prices.outerCorner).toBeGreaterThan(0);
        expect(p.prices.endCap).toBeGreaterThan(0);
        expect(p.prices.connector).toBeGreaterThan(0);
      }
      if (p.fastening === "glue" || p.fastening === "adhesive") {
        expect(p.glueRate).toBeGreaterThan(0);
        expect(p.prices.glue).toBeGreaterThan(0);
      } else {
        expect(p.fastenerStep).toBeGreaterThan(0.1);
        expect(p.prices.fastener).toBeGreaterThan(0);
      }
    });

    it("профиль: замкнутый, против часовой, от (0,0), по габаритам", () => {
      const pts = p.profile.map(([d, h]) => ({ x: d, y: h }));
      expect(pts.length).toBeGreaterThanOrEqual(4);
      expect(p.profile[0]).toEqual([0, 0]);
      expect(signedArea(pts)).toBeGreaterThan(0);
      expect(polygonSelfIntersects(pts)).toBe(false);
      const ds = p.profile.map(([d]) => d);
      const hs = p.profile.map(([, h]) => h);
      expect(Math.min(...ds)).toBe(0);
      expect(Math.min(...hs)).toBe(0);
      expect(Math.max(...hs)).toBeCloseTo(p.height * 1000, 6);
      expect(Math.max(...ds)).toBeCloseTo(p.depth * 1000, 6);
      // Без повторяющихся соседних точек и без явного замыкания.
      p.profile.forEach(([d, h], i) => {
        const [d2, h2] = p.profile[(i + 1) % p.profile.length];
        expect(d !== d2 || h !== h2).toBe(true);
      });
    });
  });

  it("ключевые параметры из ТЗ", () => {
    const pvc = getCatalogProduct("pvc-55")!;
    expect(pvc).toMatchObject({
      lengths: [2.5, 2.2, 3.0],
      height: 0.055,
      handedEndCaps: true,
      fastening: "dowels",
      fastenerStep: 0.5,
      cornerMethod: "fittings",
      cableChannel: true,
    });
    expect(getCatalogProduct("mdf-80")).toMatchObject({ lengths: [2.4, 2.07, 2.8], fastening: "clips" });
    expect(getCatalogProduct("mdf-100-paint")).toMatchObject({ cornerMethod: "miter", paintable: true });
    expect(getCatalogProduct("wood-pine-45")).toMatchObject({ fastening: "nails", cornerMethod: "miter" });
    expect(getCatalogProduct("duropolymer-100")).toMatchObject({ fastening: "glue", glueRate: 8 });
    expect(getCatalogProduct("polyurethane-120")).toMatchObject({ fastening: "glue", glueRate: 6, height: 0.12 });
    expect(getCatalogProduct("aluminum-60")).toMatchObject({
      handedEndCaps: false,
      fastening: "clips",
      fastenerStep: 0.4,
      cornerMethods: ["fittings"],
    });
    expect(getCatalogProduct("shadow-alu")).toMatchObject({ material: "shadow", fastenerStep: 0.4 });
    expect(getCatalogProduct("ceramic-80")).toMatchObject({
      length: 0.6,
      lengths: [0.6, 0.3, 1.2],
      fastening: "adhesive",
      glueRate: 0.4,
    });
  });
});

describe("resolveProduct", () => {
  it("неизвестный id → продукт по умолчанию", () => {
    expect(resolveProduct("nope", {}).id).toBe(DEFAULT_PRODUCT_ID);
  });

  it("без правок — сам продукт каталога", () => {
    expect(resolveProduct("mdf-80", {})).toBe(getCatalogProduct("mdf-80"));
    expect(resolveProduct("mdf-80", { "pvc-55": { price: 1 } })).toBe(getCatalogProduct("mdf-80"));
  });

  it("правки применяются, цены фурнитуры мёржатся поштучно", () => {
    const p = resolveProduct("pvc-55", {
      "pvc-55": { price: 250, length: 3.0, color: "#3E2C23", prices: partialPrices({ innerCorner: 60 }) },
    });
    expect(p.price).toBe(250);
    expect(p.length).toBe(3.0);
    expect(p.color).toBe("#3e2c23");
    expect(p.prices.innerCorner).toBe(60);
    expect(p.prices.outerCorner).toBe(45);
    expect(p.prices.endCap).toBe(35);
    // Каталог не изменился.
    expect(getCatalogProduct("pvc-55")!.price).toBe(200);
    expect(getCatalogProduct("pvc-55")!.prices.innerCorner).toBe(45);
  });

  it("цена планки без правки — по цене погонного метра выбранной длины", () => {
    const base = getCatalogProduct("mdf-80")!;
    expect(priceForLength(base, 2.4)).toBe(550);
    expect(priceForLength(base, 2.8)).toBe(642); // 550 / 2,4 · 2,8
    expect(priceForLength(base, 2.07)).toBe(474);
    expect(resolveProduct("mdf-80", { "mdf-80": { length: 2.8 } }).price).toBe(642);
    expect(resolveProduct("ceramic-80", { "ceramic-80": { length: 1.2 } }).price).toBe(500);
    expect(resolveProduct("ceramic-80", { "ceramic-80": { length: 0.3 } }).price).toBe(125);
    // Своя цена — именно за эту планку.
    expect(resolveProduct("mdf-80", { "mdf-80": { length: 2.8, price: 600 } }).price).toBe(600);
    expect(pricePerMeter(resolveProduct("mdf-80", { "mdf-80": { length: 2.8 } }))).toBeCloseTo(229.29, 2);
  });

  it("мусорные значения игнорируются", () => {
    const p = resolveProduct("pvc-55", {
      "pvc-55": {
        price: -5,
        length: Number.NaN,
        height: 0,
        color: "red",
        name: "   ",
        cornerMethod: "miter" as const,
        fastenerStep: -1,
        prices: partialPrices({ connector: -1, endCap: Number.POSITIVE_INFINITY }),
      },
    });
    const base = getCatalogProduct("pvc-55")!;
    expect(p.price).toBe(base.price);
    expect(p.length).toBe(base.length);
    expect(p.height).toBe(base.height);
    expect(p.color).toBe(base.color);
    expect(p.name).toBe(base.name);
    expect(p.fastenerStep).toBe(base.fastenerStep);
    expect(p.prices).toEqual(base.prices);
    // miter для ПВХ допустим.
    expect(p.cornerMethod).toBe("miter");
  });

  it("способ стыковки, которого нет у продукта, игнорируется", () => {
    expect(resolveProduct("aluminum-60", { "aluminum-60": { cornerMethod: "miter" } }).cornerMethod).toBe(
      "fittings",
    );
  });

  it("свой плинтус: название и размеры; профиль масштабируется", () => {
    const p = resolveProduct(CUSTOM_PRODUCT_ID, {
      custom: { name: "Плинтус из магазина у дома", height: 0.08, depth: 0.02 },
    });
    expect(p.name).toBe("Плинтус из магазина у дома");
    const hs = p.profile.map(([, h]) => h);
    const ds = p.profile.map(([d]) => d);
    expect(Math.max(...hs)).toBeCloseTo(80, 6);
    expect(Math.max(...ds)).toBeCloseTo(20, 6);
    expect(p.profile[0]).toEqual([0, 0]);
  });
});

describe("хелперы", () => {
  it("getColorName", () => {
    const p = getCatalogProduct("pvc-55")!;
    expect(getColorName(p)).toBe("Белый");
    expect(getColorName(p, "#3E2C23")).toBe("Венге");
    expect(getColorName(p, "#123456")).toBe("цвет #123456");
  });

  it("getProductLengths добавляет свою длину", () => {
    const p = resolveProduct("pvc-55", { "pvc-55": { length: 2.7 } });
    expect(getProductLengths(p)).toEqual([2.5, 2.2, 3.0, 2.7]);
    expect(getProductLengths(getCatalogProduct("pvc-55")!)).toEqual([2.5, 2.2, 3.0]);
  });

  it("hasOverride", () => {
    expect(hasOverride("pvc-55", {})).toBe(false);
    expect(hasOverride("pvc-55", { "pvc-55": {} })).toBe(false);
    expect(hasOverride("pvc-55", { "pvc-55": { price: 1 } })).toBe(true);
  });
});

describe("resolveProduct: крайние размеры", () => {
  it("профиль остаётся корректным при любых допустимых высоте и толщине", () => {
    for (const base of SKIRTING_CATALOG) {
      for (const height of [0.01, 0.0137, 0.5]) {
        for (const depth of [0.002, 0.0031, 0.1]) {
          const p = resolveProduct(base.id, { [base.id]: { height, depth } });
          const pts = p.profile.map(([d, h]) => ({ x: d, y: h }));
          expect(p.profile[0]).toEqual([0, 0]);
          expect(signedArea(pts)).toBeGreaterThan(0);
          expect(polygonSelfIntersects(pts)).toBe(false);
          p.profile.forEach(([d, h], i) => {
            const [d2, h2] = p.profile[(i + 1) % p.profile.length];
            expect(d !== d2 || h !== h2).toBe(true);
          });
          // Округление до 0,1 мм.
          expect(Math.abs(Math.max(...p.profile.map(([, h]) => h)) - height * 1000)).toBeLessThanOrEqual(0.05 + 1e-9);
          expect(Math.abs(Math.max(...p.profile.map(([d]) => d)) - depth * 1000)).toBeLessThanOrEqual(0.05 + 1e-9);
        }
      }
    }
  });
});
