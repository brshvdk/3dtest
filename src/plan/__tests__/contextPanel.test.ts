import { describe, expect, it } from "vitest";
import { place, type Box } from "../ContextPanel";
import { notePlanEdit, usePlanUi } from "../planUi";

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

describe("место контекстной панели", () => {
  // Стена внизу плана 800×560, «в комнату» — вверх; панель 300×50.
  const box: Box = { x0: 250, y0: 400, x1: 550, y1: 440 };
  const dir = { x: 0, y: -1 };
  const floor = [
    { x: 250, y: 100 },
    { x: 550, y: 100 },
    { x: 550, y: 400 },
    { x: 250, y: 400 },
  ];
  const pw = 300;
  const ph = 50;

  it("без оверлеев — снаружи стены (под ней), не закрывая пол", () => {
    const p = place(box, dir, pw, ph, 800, 560, [], floor)!;
    expect(p.y).toBeGreaterThanOrEqual(box.y1);
  });

  it("подсказка внизу — панель её не закрывает", () => {
    const hint: Box = { x0: 150, y0: 498, x1: 740, y1: 546 };
    const p = place(box, dir, pw, ph, 800, 560, [], floor, [hint])!;
    expect(overlaps({ x0: p.x, y0: p.y, x1: p.x + pw, y1: p.y + ph }, hint)).toBe(false);
  });

  it("оверлей внутри габарита выделения всё равно учитывается", () => {
    // Сводка комнаты в углу, куда попадает и выделение.
    const summary: Box = { x0: 240, y0: 395, x1: 420, y1: 470 };
    const p = place(box, dir, pw, ph, 800, 560, [], floor, [summary])!;
    expect(overlaps({ x0: p.x, y0: p.y, x1: p.x + pw, y1: p.y + ph }, summary)).toBe(false);
  });
});

describe("место панели, когда рядом с выделением всё занято", () => {
  it("плашки стен по обе стороны полосы — панель отходит дальше, за них", () => {
    // Низ плана 800×400: под стеной места нет, над ней в полосе — плашки двух соседних стен.
    const box: Box = { x0: 250, y0: 300, x1: 550, y1: 390 };
    const labels: Box[] = [
      { x0: 200, y0: 250, x1: 280, y1: 275 },
      { x0: 520, y0: 250, x1: 600, y1: 275 },
    ];
    const floor = [
      { x: 250, y: 60 },
      { x: 550, y: 60 },
      { x: 550, y: 300 },
      { x: 250, y: 300 },
    ];
    const p = place(box, { x: 0, y: -1 }, 300, 50, 800, 400, labels, floor)!;
    const r = { x0: p.x, y0: p.y, x1: p.x + 300, y1: p.y + 50 };
    for (const l of labels) expect(overlaps(r, l)).toBe(false);
    expect(overlaps(r, box)).toBe(false);
  });
});

describe("подсказка плана", () => {
  it("первая правка на плане скрывает подсказку (и без localStorage не падает)", () => {
    usePlanUi.setState({ hintHidden: false });
    notePlanEdit();
    expect(usePlanUi.getState().hintHidden).toBe(true);
    notePlanEdit();
    expect(usePlanUi.getState().hintHidden).toBe(true);
  });
});
