import { describe, expect, it } from "vitest";
import { formatLength, formatMoney, parseLength, parseNumber, pluralize } from "../units";

describe("parseLength", () => {
  it.each([
    ["4,2", 4.2],
    ["4.2", 4.2],
    ["4,2 м", 4.2],
    ["420 см", 4.2],
    ["420см", 4.2],
    ["4200 мм", 4.2],
    ["4 м 20 см", 4.2],
    ["1 200 мм", 1.2],
    ["  3 ", 3],
  ])("%s → %s", (s, v) => {
    expect(parseLength(s, "m")).toBeCloseTo(v as number, 6);
  });
  it("default unit applies", () => {
    expect(parseLength("87", "cm")).toBeCloseTo(0.87);
    expect(parseLength("55", "mm")).toBeCloseTo(0.055);
  });
  it("rejects garbage", () => {
    expect(parseLength("", "m")).toBeNull();
    expect(parseLength("abc", "m")).toBeNull();
    expect(parseLength("-3", "m")).toBeNull();
    expect(parseLength("3 кг", "m")).toBeNull();
  });
});

describe("format", () => {
  it("lengths", () => {
    expect(formatLength(4.2)).toBe("4,20 м");
    expect(formatLength(0.87, "cm")).toBe("87 см");
    expect(formatLength(0.055, "mm")).toBe("55 мм");
  });
  it("money", () => {
    expect(formatMoney(2950.4)).toBe("2 950 ₽");
  });
  it("numbers", () => {
    expect(parseNumber("1 200,5")).toBe(1200.5);
    expect(parseNumber("15%")).toBe(15);
  });
  it("plural", () => {
    expect(pluralize(1, ["планка", "планки", "планок"])).toBe("планка");
    expect(pluralize(3, ["планка", "планки", "планок"])).toBe("планки");
    expect(pluralize(11, ["планка", "планки", "планок"])).toBe("планок");
    expect(pluralize(22, ["планка", "планки", "планок"])).toBe("планки");
  });
});
