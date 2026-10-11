import { describe, expect, it } from "vitest";
import { estimateProject } from "../../domain/estimate";
import { createDemoProject, createRoom } from "../../domain/project";
import type { Project } from "../../domain/types";
import { formatMoney } from "../../domain/units";
import { describePiece, isMinimalCut, joinRu, numberRanges, pieceText, splitPieceLabel, typo, unitForms, unitWords, wasteLen } from "../format";
import { buildOrderText } from "../orderText";

const NBSP = " ";

describe("buildOrderText", () => {
  it("демо: строки заказа, итог и пояснение расчёта", () => {
    const p = createDemoProject();
    const e = estimateProject(p);
    const text = buildOrderText(e, p);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Плинтус — «Моя квартира»");
    expect(text).toContain("Комната: Гостиная (15,25");
    // Каждая строка заказа пронумерована и есть в тексте.
    e.lines.forEach((l, i) => expect(text).toContain(`${i + 1}. ${l.name}`));
    expect(text).toContain(`Итого: ${formatMoney(e.totalCost)}`);
    expect(text).toContain(`раскрой — 7${NBSP}планок по 2,5`);
    expect(text).toContain("плюс 1 в запас (5");
    expect(text).not.toContain("Без плинтуса");
    expect(text.trim().endsWith("Цены ориентировочные. Посчитано в «Мерке».")).toBe(true);
  });

  it("несколько плинтусов: группы с суммами и сквозная нумерация", () => {
    const demo = createDemoProject();
    const bath = { ...createRoom({ name: "Ванная", params: { length: 2, width: 1.6 } }), productId: "ceramic-80" };
    const balcony = { ...createRoom({ name: "Балкон" }), skirtingEnabled: false };
    const p: Project = { ...demo, rooms: [...demo.rooms, bath, balcony] };
    const e = estimateProject(p);
    expect(e.products).toHaveLength(2);
    const text = buildOrderText(e, p);
    expect(text).toContain("ПВХ 55 — Гостиная");
    expect(text).toContain("Керамика 80 — Ванная");
    expect(text.match(/^Сумма: /gm)).toHaveLength(2);
    expect(text).toContain(`${e.lines.length}. `);
    expect(text).toContain(`элементов по 0,6`);
    expect(text).toContain("Без плинтуса: Балкон.");
  });

  it("фурнитура — с серией и цветом, крепёж — с пояснением (строка понятна без таблицы)", () => {
    const demo = createDemoProject();
    const p: Project = {
      ...demo,
      skirting: { ...demo.skirting, productId: "mdf-80" },
      productOverrides: { "mdf-80": { color: "#3b2a21" } },
    };
    const e = estimateProject(p);
    const text = buildOrderText(e, p);
    const lines = text.split("\n");
    const corner = lines.find((l) => /^\d+\. Угол внутренний/.test(l));
    expect(corner).toMatch(/^\d+\. Угол внутренний МДФ 80 \(в цвет «Венге»\): \d+ шт × /);
    const cap = lines.find((l) => /^\d+\. Заглушка/.test(l));
    expect(cap).toContain("МДФ 80 (в цвет «Венге»)");
    const fastener = e.lines.find((l) => l.kind === "fastener")!;
    expect(text).toContain(`${fastener.name} (${fastener.note}): `);
    // У планок пометка «по раскрою + запас» не дублируется: её объясняет строка «Расчёт».
    const plank = lines.find((l) => /^1\. /.test(l));
    expect(plank).not.toContain("по раскрою");
  });

  it("всё выключено — короткое объяснение без строк", () => {
    const demo = createDemoProject();
    const p: Project = { ...demo, rooms: demo.rooms.map((r) => ({ ...r, skirtingEnabled: false })) };
    const text = buildOrderText(estimateProject(p), p);
    expect(text).toContain("Расчёт плинтуса выключен во всех комнатах.");
    expect(text).not.toContain("Итого");
  });
});

describe("format", () => {
  it("wasteLen округляет обрезок вниз до сантиметра", () => {
    // 2,4 − 2,10 − пропил 3 мм = 0,297: не «0,30» рядом с порогом «пригодится от 30 см».
    expect(wasteLen(0.297)).toBe("0,29");
    expect(wasteLen(0.3)).toBe("0,30");
    expect(wasteLen(0.5 - 1e-12)).toBe("0,50");
  });
  it("splitPieceLabel / describePiece", () => {
    expect(splitPieceLabel("A 1/2")).toEqual({ main: "A", part: "1/2", reveal: false });
    expect(splitPieceLabel("C2")).toEqual({ main: "C2", part: "", reveal: false });
    expect(splitPieceLabel("B·откос")).toEqual({ main: "B", part: "", reveal: true });
    expect(describePiece("A 2/3")).toBe("стена A, кусок 2 из 3");
    expect(describePiece("A+B")).toBe("стены A и B (одна линия)");
    expect(describePiece("B·откос")).toBe("откос у стены B");
    // Участок стены («C2») не путается с куском («C 2/2»).
    expect(describePiece("C2")).toBe("стена C, участок 2");
    expect(describePiece("C 2/2")).toBe("стена C, кусок 2 из 2");
    expect(describePiece("A3+B 1/2")).toBe("стены A (участок 3) и B (одна линия), кусок 1 из 2");
    expect(describePiece("C2·откос")).toBe("откос у стены C");
    // Стена из нескольких участков: первый участок тоже с номером.
    const split = new Set(["A"]);
    expect(describePiece("A 2/2", split)).toBe("стена A, участок 1, кусок 2 из 2");
    expect(describePiece("A2", split)).toBe("стена A, участок 2");
    expect(describePiece("B 2/2", split)).toBe("стена B, кусок 2 из 2");
    expect(describePiece("A+B 1/2", split)).toBe("стены A (участок 1) и B (одна линия), кусок 1 из 2");
  });

  it("pieceText: часть куска не путается с участком стены", () => {
    expect(pieceText("A 2/2")).toBe("A кусок 2 из 2");
    expect(pieceText("A2")).toBe("A2");
    expect(pieceText("B·откос")).toBe("откос B");
  });

  it("isMinimalCut: «оптимален» — только если меньше планок не хватит по длине материала", () => {
    const bars = (n: number) => Array.from({ length: n }, (_, index) => ({ index, pieces: [], used: 0, waste: 0 }));
    // 9,4 м материала на планках 2,5 м: меньше 4 планок не бывает.
    expect(isMinimalCut({ bars: bars(4), piecesLength: 9.4, stockLength: 2.5 })).toBe(true);
    // Стены по 2,6–2,7 м поделены пополам: 7 кусков по 1,3 м не ложатся по два — 7 планок.
    // Для таких кусков раскрой минимален (cutPlan.optimal), но «оптимальным» его называть нельзя.
    expect(isMinimalCut({ bars: bars(7), piecesLength: 9.4, stockLength: 2.5 })).toBe(false);
    // Шум плавающей точки не добавляет планку: 10 м ровно на 4 планки.
    expect(isMinimalCut({ bars: bars(4), piecesLength: 10.000000001, stockLength: 2.5 })).toBe(true);
    expect(isMinimalCut(estimateProject(createDemoProject()).products[0].cutPlan)).toBe(true);
  });

  it("numberRanges и падежи единицы", () => {
    expect(numberRanges([4, 1, 2, 3, 7])).toBe("1–4, 7");
    expect(numberRanges([1, 2, 5])).toBe("1, 2, 5");
    expect(numberRanges([])).toBe("");
    expect(unitWords({ material: "ceramic" }).fromOne).toBe("из одного элемента");
    expect(unitWords({ material: "mdf" }).gen).toBe("планки");
  });

  it("typo ставит неразрывный пробел перед единицами", () => {
    expect(typo("Плинтус ПВХ 55 мм, 2,5 м — 5 %")).toBe(`Плинтус ПВХ 55${NBSP}мм, 2,5${NBSP}м${NBSP}— 5${NBSP}%`);
    expect(typo("Дюбель 6×40")).toBe("Дюбель 6×40");
  });

  it("joinRu и формы слова", () => {
    expect(joinRu(["A"])).toBe("A");
    expect(joinRu(["A", "B", "C"])).toBe("A, B и C");
    expect(unitForms({ material: "ceramic" })[2]).toBe("элементов");
    expect(unitForms({ material: "pvc" })[0]).toBe("планка");
  });
});
