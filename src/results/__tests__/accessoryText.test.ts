import { describe, expect, it } from "vitest";
import { estimateProject, type ProductEstimate } from "../../domain/estimate";
import { getWalls } from "../../domain/geometry";
import { createOpening } from "../../domain/openings";
import { createDemoProject, createRoom } from "../../domain/project";
import { clampOpenings } from "../../domain/roomEdit";
import { SKIRTING_CATALOG } from "../../domain/skirtingCatalog";
import type { CornerMethod, Project } from "../../domain/types";
import { accessoryRows } from "../accessoryText";
import { isUsefulOffcut, offcutCm, typo, wasteLen } from "../format";

const NBSP = " ";

function estimateFor(productId: string, cornerMethod: CornerMethod, ring = false): ProductEstimate {
  const demo = createDemoProject();
  const rooms = ring ? [createRoom({ name: "Кольцо", params: { length: 4.5, width: 3.6 } })] : demo.rooms;
  const p: Project = {
    ...demo,
    rooms,
    skirting: { ...demo.skirting, productId },
    productOverrides: { [productId]: { cornerMethod } },
  };
  return estimateProject(p).products[0];
}

const row = (pe: ProductEstimate, id: string) => accessoryRows(pe).find((r) => r.id === id);
const hasKind = (pe: ProductEstimate, ...kinds: string[]) => pe.lines.some((l) => kinds.includes(l.kind));

describe("accessoryRows: пояснения сходятся со списком покупок", () => {
  const cases = SKIRTING_CATALOG.flatMap((p) => p.cornerMethods.map((m) => [p.id, m] as const));

  it.each(cases)("%s, углы: %s", (id, method) => {
    const pe = estimateFor(id, method);
    expect(pe.product.cornerMethod).toBe(method);
    const caps = hasKind(pe, "endCap", "endCapLeft", "endCapRight");
    const ends = row(pe, "ends")!;
    // В демо есть дверь — у плинтуса два конца.
    expect(ends.v).toBe("2 шт");
    if (caps) {
      expect(ends.k).toBe("Заглушки");
      expect(ends.hint).not.toContain("подрезается");
    } else {
      expect(ends.k).toBe("Торцы");
      expect(ends.hint).toContain("торец подрезается к наличнику");
    }
    const joints = row(pe, "joints")!;
    expect(pe.joints).toBeGreaterThan(0);
    expect(joints.hint.includes("соединител")).toBe(hasKind(pe, "connector"));
    const inner = row(pe, "inner")!;
    expect(inner.hint.includes("уголку")).toBe(hasKind(pe, "innerCorner"));

    const fastener = row(pe, "fastener");
    expect(!!fastener).toBe(hasKind(pe, "fastener"));
    if (fastener) {
      expect(fastener.hint).toMatch(new RegExp(`^шаг ≈ \\d+${NBSP}см, по краям участков и у каждого стыка, \\+10${NBSP}% запас$`));
      expect(fastener.v).toBe(`${pe.lines.find((l) => l.kind === "fastener")!.qty} шт`);
    }
  });

  it("ПВХ с кабель-каналом при запиле: заглушки и соединители в списке — «торец подрезается» не пишем", () => {
    const pe = estimateFor("pvc-55", "miter");
    expect(hasKind(pe, "innerCorner")).toBe(false);
    expect(hasKind(pe, "endCapLeft")).toBe(true);
    expect(row(pe, "inner")!.hint).toBe("запил 45° — уголки не нужны");
    expect(row(pe, "ends")!).toMatchObject({ k: "Заглушки", hint: "у дверей и проёмов: 1 левая и 1 правая" });
    expect(row(pe, "joints")!.hint).toContain("по соединителю на стык");
  });

  it("МДФ при запиле: заглушек нет — торец подрезается", () => {
    const pe = estimateFor("mdf-80", "miter");
    expect(hasKind(pe, "endCapLeft", "endCapRight", "endCap", "connector")).toBe(false);
    expect(row(pe, "ends")!).toMatchObject({ k: "Торцы", hint: "у дверей и проёмов: торец подрезается к наличнику" });
    expect(row(pe, "joints")!.hint).toContain("стык встык или на ус");
  });

  it("кольцо без проёмов: концов нет", () => {
    const pe = estimateFor("pvc-55", "fittings", true);
    expect(row(pe, "ends")!).toMatchObject({ k: "Заглушки", hint: "плинтус идёт кольцом без разрывов", v: "0 шт" });
  });

  it("ванна вдоль стены: торец у мебели — без «к наличнику»", () => {
    const demo = createDemoProject();
    const room = createRoom({ name: "Ванная", params: { length: 2.4, width: 1.8 } });
    const bath = createOpening("furniture", getWalls(room)[0].id, 0, "furn-bath");
    bath.offset = 0.35;
    const p: Project = {
      ...demo,
      rooms: [clampOpenings({ ...room, openings: [bath] })],
      skirting: { ...demo.skirting, productId: "ceramic-80" },
    };
    const pe = estimateProject(p).products[0];
    expect(row(pe, "ends")!).toMatchObject({ k: "Торцы", hint: "у дверей, проёмов и мебели: торец подрезается вплотную", v: "2 шт" });
  });

  it("плиточный клей: расход в кг и мешки из списка", () => {
    const pe = estimateFor("ceramic-80", "miter");
    const glue = row(pe, "glue")!;
    const bags = pe.lines.find((l) => l.kind === "glue")!.qty;
    expect(glue.v).toMatch(/кг$/);
    expect(glue.hint).toContain(`в списке — ${bags} мешк`);
  });

  it("плинтус не нужен — строк нет", () => {
    const pe = estimateFor("pvc-55", "fittings");
    expect(accessoryRows({ ...pe, netLength: 0 })).toEqual([]);
  });
});

it("typo: неразрывный пробел и перед «мл»", () => {
  expect(typo("Герметик (туба 280 мл)")).toBe("Герметик (туба 280\u00a0мл)");
  expect(typo("Клей плиточный (мешок 5 кг)")).toBe("Клей плиточный (мешок 5\u00a0кг)");
});

describe("обрезки: подпись и «пригодится» из одного округления вниз", () => {
  it("никогда не завышаем длину", () => {
    expect(offcutCm(0.297)).toBe(29);
    expect(offcutCm(2.5 - 2.2 - 0.003)).toBe(29);
    expect(offcutCm(0.30999)).toBe(30);
    expect(offcutCm(0)).toBe(0);
    expect(wasteLen(0.297)).toBe("0,29");
    expect(wasteLen(0.0999)).toBe("0,09");
  });
  it("порог 30 см — по фактической длине, с допуском только на погрешность float", () => {
    expect(isUsefulOffcut(0.297)).toBe(false);
    expect(isUsefulOffcut(0.2999)).toBe(false);
    expect(isUsefulOffcut(0.3)).toBe(true);
    // 2,5 − 2,197 − 0,003 в float: 0,29999999999999977 — это 30 см.
    expect(isUsefulOffcut(2.5 - 2.197 - 0.003)).toBe(true);
    expect(wasteLen(2.5 - 2.197 - 0.003)).toBe("0,30");
    // Подпись «0,29» никогда не бывает с пометкой, «0,30» — всегда с ней.
    for (let mm = 250; mm <= 350; mm++) {
      const m = mm / 1000 + (mm % 3) * 1e-12 - (mm % 2) * 1e-12;
      expect(isUsefulOffcut(m)).toBe(Number(wasteLen(m).replace(",", ".")) >= 0.3);
    }
  });
});
