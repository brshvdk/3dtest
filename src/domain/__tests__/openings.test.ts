import { describe, expect, it } from "vitest";
import { createOpening, describeOpening } from "../openings";

describe("describeOpening", () => {
  it("дверь из пресета — как в магазине, с размером проёма", () => {
    expect(describeOpening(createOpening("door", "w", 0, "door-80"))).toBe("Дверь 80 (проём 87×207 см)");
    expect(describeOpening(createOpening("door", "w", 0, "door-70"))).toBe("Дверь 70 (проём 77×207 см)");
    expect(describeOpening(createOpening("door", "w", 0, "door-2x60"))).toBe("Дверь 2×60 (проём 127×207 см)");
    expect(describeOpening(createOpening("door", "w", 0, "door-entry-86"))).toBe("Входная дверь 860 (проём 90×210 см)");
  });

  it("дверь своего размера — только проём", () => {
    const o = { ...createOpening("door", "w", 0, "door-80"), width: 0.95, presetId: null };
    expect(describeOpening(o)).toBe("Дверь, проём 95×207 см");
  });

  it("мебель — длина × глубина (для плинтуса важна глубина)", () => {
    expect(describeOpening(createOpening("furniture", "w", 0, "furn-kitchen"))).toBe("Кухня 240×60 см");
    expect(describeOpening(createOpening("furniture", "w", 0, "furn-bath"))).toBe("Ванна 170×70 см");
    const flat = { ...createOpening("furniture", "w", 0, "furn-other"), depth: 0, label: "  " };
    expect(describeOpening(flat)).toBe("Без плинтуса 100 см");
  });

  it("окно, арка, проём, балкон — ширина × высота", () => {
    expect(describeOpening(createOpening("window", "w", 0, "win-130x140"))).toBe("Окно 130×140 см");
    expect(describeOpening(createOpening("passage", "w", 0, "pass-90"))).toBe("Проём 90×210 см");
    expect(describeOpening(createOpening("passage", "w", 0, "arch-90"))).toBe("Арка 90×210 см");
    expect(describeOpening(createOpening("balcony", "w", 0, "balc-70-130"))).toBe("Балконный блок 200×210 см");
  });
});
