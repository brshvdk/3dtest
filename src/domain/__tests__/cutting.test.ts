import { describe, expect, it } from "vitest";
import { mergeCutPlans, optimizeCuts, splitIntoPieces } from "../cutting";
import type { CutPlan, Piece } from "../cutting";
import { computeRoomSkirting } from "../skirtingCalc";
import type { RoomSkirtingResult } from "../skirtingCalc";
import { getCatalogProduct } from "../skirtingCatalog";
import { L_SHAPE, RECT, makeRoom, op, sum } from "./calcFixtures";

const PVC = getCatalogProduct("pvc-55")!;
const MDF_PAINT = getCatalogProduct("mdf-100-paint")!;

const pieces = (lengths: number[]): Piece[] =>
  lengths.map((length, i) => ({
    id: `x${i}`,
    roomId: "r",
    segmentIds: [`s${i}`],
    label: `П${i + 1}`,
    length,
    full: false,
  }));

const barLengths = (plan: CutPlan) =>
  plan.bars.map((b) => b.pieces.map((p) => +p.length.toFixed(4)));

/** Детерминированный ГПСЧ (LCG) — тесты не зависят от Math.random. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Проверка корректности любого плана: всё разложено, планки не переполнены. */
function expectValidPlan(plan: CutPlan, input: Piece[], L: number, kerf: number) {
  const ids = plan.bars.flatMap((b) => b.pieces.map((p) => p.id)).sort();
  expect(ids).toEqual(input.filter((p) => p.length > 0).map((p) => p.id).sort());
  plan.bars.forEach((b, i) => {
    expect(b.index).toBe(i);
    const s = sum(b.pieces.map((p) => p.length)) + (b.pieces.length - 1) * kerf;
    // Перебор, «спрятанный» в округлении до мкм, — меньше 1 мкм на кусок.
    expect(s).toBeLessThanOrEqual(L + 1e-6 * b.pieces.length);
    expect(b.used + b.waste).toBeCloseTo(L, 9);
    expect(b.waste).toBeGreaterThanOrEqual(0);
    if (i > 0) expect(plan.bars[i - 1].used).toBeGreaterThanOrEqual(b.used);
  });
  expect(plan.piecesLength).toBeCloseTo(sum(input.map((p) => p.length)), 9);
  expect(plan.totalWaste).toBeCloseTo(sum(plan.bars.map((b) => b.waste)), 9);
  const valid = input.filter((p) => p.length > 0);
  const naiveLb = Math.ceil((sum(valid.map((p) => p.length + kerf)) - 1e-6 * valid.length) / (L + kerf) - 1e-9);
  expect(plan.lowerBound).toBeGreaterThanOrEqual(naiveLb);
  expect(plan.bars.length).toBeGreaterThanOrEqual(plan.lowerBound);
  expect(plan.optimal).toBe(plan.bars.length === plan.lowerBound);
}

describe("splitIntoPieces", () => {
  it("прямоугольник 4×3, планка 2,5: 4→2,5+1,5; 3→2,5+0,5", () => {
    const r = computeRoomSkirting(makeRoom(RECT), PVC);
    const { pieces: ps, joints, straightRuns } = splitIntoPieces(r, 2.5, 0.3);
    expect(ps.map((p) => p.length)).toEqual([2.5, 1.5, 2.5, 0.5, 2.5, 1.5, 2.5, 0.5]);
    expect(ps.map((p) => p.label)).toEqual([
      "A 1/2", "A 2/2", "B 1/2", "B 2/2", "C 1/2", "C 2/2", "D 1/2", "D 2/2",
    ]);
    expect(ps.map((p) => p.full)).toEqual([true, false, true, false, true, false, true, false]);
    expect(joints).toBe(4);
    expect(straightRuns).toEqual([4, 3, 4, 3]);
    expect(ps[0].segmentIds).toEqual(["r:p0:1"]);
    expect(ps[0].roomId).toBe("r");
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
  });

  it("короткий остаток < minPiece — две последние делятся поровну", () => {
    const r = computeRoomSkirting(makeRoom([[0, 0], [5.1, 0], [5.1, 1], [0, 1]]), PVC);
    const { pieces: ps } = splitIntoPieces(r, 2.5, 0.3);
    const a = ps.filter((p) => p.segmentIds[0] === "r:p0:1").map((p) => +p.length.toFixed(6));
    expect(a).toEqual([2.5, 1.3, 1.3]);
  });

  it("стена ровно в планку — один целый кусок; две планки — один стык", () => {
    const r = computeRoomSkirting(makeRoom([[0, 0], [5, 0], [5, 2.5], [0, 2.5]]), PVC);
    const { pieces: ps, joints } = splitIntoPieces(r, 2.5, 0.3);
    expect(ps.every((p) => p.full && p.length === 2.5)).toBe(true);
    expect(ps).toHaveLength(6);
    expect(joints).toBe(2);
  });

  it("короткая стена < minPiece остаётся одним куском", () => {
    const r = computeRoomSkirting(makeRoom(RECT, [op("d", "door", 0, 0.07)]), PVC);
    const { pieces: ps } = splitIntoPieces(r, 2.5, 0.3);
    expect(ps[0].length).toBeCloseTo(0.03, 9);
  });

  it("вершина на прямой — сегменты сливаются, лишнего стыка нет", () => {
    const r = computeRoomSkirting(makeRoom([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]), PVC);
    const { pieces: ps, joints, straightRuns } = splitIntoPieces(r, 2.5, 0.3);
    expect(straightRuns).toEqual([4, 3, 4, 3]);
    expect(joints).toBe(4);
    expect(ps[0].label).toBe("A+B 1/2");
    expect(ps[0].segmentIds).toEqual(["r:p0:1", "r:p1:1"]);
    expect(ps.map((p) => p.length)).toEqual([2.5, 1.5, 2.5, 0.5, 2.5, 1.5, 2.5, 0.5]);
  });

  it("слияние через начало обхода (прямая вершина в точке 0)", () => {
    const r = computeRoomSkirting(makeRoom([[2, 0], [4, 0], [4, 3], [0, 3], [0, 0]]), PVC);
    const { straightRuns, pieces: ps } = splitIntoPieces(r, 2.5, 0.3);
    expect(straightRuns.sort()).toEqual([3, 3, 4, 4]);
    expect(ps.some((p) => p.label.startsWith("E+A"))).toBe(true);
  });

  it("запил: кусок считается по длине заготовки", () => {
    const r = computeRoomSkirting(makeRoom(L_SHAPE), MDF_PAINT);
    const { pieces: ps, straightRuns } = splitIntoPieces(r, 2.4, 0.3);
    const c = ps.find((p) => p.segmentIds[0] === "r:p2:1")!;
    expect(c.length).toBeCloseTo(2 + MDF_PAINT.depth, 9);
    expect(straightRuns[2]).toBeCloseTo(2, 9); // крепёж — по длине стены
  });

  it("откосы — отдельные куски", () => {
    const r = computeRoomSkirting(makeRoom(RECT, [op("p", "passage", 0, 1.55)]), PVC);
    const { pieces: ps } = splitIntoPieces(r, 2.5, 0.3);
    const rev = ps.filter((p) => p.label === "A·откос");
    expect(rev).toHaveLength(2);
    rev.forEach((p) => expect(p.length).toBeCloseTo(0.15, 9));
  });

  it("пустая комната без плинтуса — нет кусков", () => {
    const r = computeRoomSkirting(
      makeRoom(RECT, [0, 1, 2, 3].map((w) => op(`k${w}`, "furniture", w, 0, { width: 4 }))),
      PVC,
    );
    expect(splitIntoPieces(r, 2.5, 0.3)).toEqual({ pieces: [], joints: 0, straightRuns: [] });
  });
});

describe("optimizeCuts", () => {
  it("прямоугольник 4×3: 6 планок, оптимально", () => {
    const r = computeRoomSkirting(makeRoom(RECT), PVC);
    const { pieces: ps } = splitIntoPieces(r, 2.5, 0.3);
    const plan = optimizeCuts(ps, 2.5, 0.003);
    expect(plan.bars).toHaveLength(6);
    expect(plan.lowerBound).toBe(6);
    expect(plan.optimal).toBe(true);
    expect(barLengths(plan)).toEqual([[2.5], [2.5], [2.5], [2.5], [1.5, 0.5], [1.5, 0.5]]);
    // 2,5 − 1,5 − 0,5 − пропил между кусками − последний рез.
    expect(plan.bars[5].waste).toBeCloseTo(0.494, 9);
    expect(plan.bars[5].used).toBeCloseTo(2.006, 9);
    expect(plan.bars[0].waste).toBe(0);
    expect(plan.efficiency).toBeCloseTo(14 / 15, 9);
    expectValidPlan(plan, ps, 2.5, 0.003);
  });

  it("находит оптимум там, где FFD/BFD ошибаются", () => {
    // FFD даёт 4 планки: [.5 .5] [.4 .4] [.3 .3 .3] [.3]; оптимум 3: [.5 .5] [.4 .3 .3] [.4 .3 .3].
    const ps = pieces([0.5, 0.5, 0.4, 0.4, 0.3, 0.3, 0.3, 0.3]);
    const plan = optimizeCuts(ps, 1, 0);
    expect(plan.bars).toHaveLength(3);
    expect(plan.optimal).toBe(true);
    expectValidPlan(plan, ps, 1, 0);
  });

  it("известный оптимум на кусках плинтуса", () => {
    // Σ = 7,5 при L = 2,5: только идеальные тройки/пары дают 3 планки.
    const ps = pieces([1.2, 1.3, 0.9, 0.8, 0.8, 1.0, 0.7, 0.8]);
    const plan = optimizeCuts(ps, 2.5, 0);
    expect(plan.bars).toHaveLength(3);
    expect(plan.bars.every((b) => b.waste === 0)).toBe(true);
    expectValidPlan(plan, ps, 2.5, 0);
  });

  it("пропил учитывается: 1,25 + 1,25 не влезают в 2,5 при пропиле 3 мм", () => {
    expect(optimizeCuts(pieces([1.25, 1.25]), 2.5, 0).bars).toHaveLength(1);
    expect(optimizeCuts(pieces([1.25, 1.25]), 2.5, 0.003).bars).toHaveLength(2);
    // n кусков → n − 1 резов: 1,2485·2 + 0,003 = 2,5 ровно.
    const exact = optimizeCuts(pieces([1.2485, 1.2485]), 2.5, 0.003);
    expect(exact.bars).toHaveLength(1);
    expect(exact.bars[0].waste).toBe(0);
  });

  it("кусок = вся планка: без остатка", () => {
    const plan = optimizeCuts(pieces([2.5]), 2.5, 0.003);
    expect(plan.bars).toHaveLength(1);
    expect(plan.bars[0]).toMatchObject({ index: 0, used: 2.5, waste: 0 });
    expect(plan.efficiency).toBe(1);
    expect(plan.optimal).toBe(true);
  });

  it("своя длина планки с точностью выше 0,1 мм: кусок во всю планку допустим", () => {
    const L = 2.4567891;
    const plan = optimizeCuts(pieces([L, L / 2, L / 2]), L, 0);
    expect(plan.bars).toHaveLength(2);
    expect(plan.optimal).toBe(true);
  });

  it("кусок длиннее планки — ошибка входа", () => {
    expect(() => optimizeCuts(pieces([2.6]), 2.5, 0)).toThrow(/длиннее/);
    expect(() => optimizeCuts(pieces([1]), 0, 0)).toThrow();
  });

  it("пустой вход", () => {
    const plan = optimizeCuts([], 2.5, 0.003);
    expect(plan).toMatchObject({ bars: [], piecesLength: 0, totalWaste: 0, lowerBound: 0, optimal: true, efficiency: 0 });
  });

  it("нижняя граница сильнее наивной: три куска по 1,3 — по планке на каждый", () => {
    const plan = optimizeCuts(pieces([1.3, 1.3, 1.3]), 2.5, 0);
    expect(plan.bars).toHaveLength(3);
    expect(plan.lowerBound).toBe(3);
    expect(plan.optimal).toBe(true);
  });

  it("полный перебор доказывает оптимум там, где граница слаба", () => {
    // Σ = 2,0 → наивная граница 2, но по три куска 0,4 в планку 1,0 не влезают.
    const plan = optimizeCuts(pieces([0.4, 0.4, 0.4, 0.4, 0.4]), 1, 0);
    expect(plan.bars).toHaveLength(3);
    expect(plan.lowerBound).toBe(3);
    expect(plan.optimal).toBe(true);
  });

  it("детерминизм: тот же вход — тот же план; перестановка входа — та же раскладка", () => {
    const rnd = lcg(7);
    const ps = pieces(Array.from({ length: 40 }, () => +(0.2 + rnd() * 2.3).toFixed(3)));
    const a = optimizeCuts(ps, 2.5, 0.003);
    const b = optimizeCuts(ps, 2.5, 0.003);
    expect(b).toEqual(a);
    const shuffled = [...ps].reverse();
    expect(barLengths(optimizeCuts(shuffled, 2.5, 0.003))).toEqual(barLengths(a));
  });

  it("корректность на случайных задачах", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rnd = lcg(seed);
      const n = 5 + Math.floor(rnd() * 60);
      const L = [2.5, 2.4, 2.0, 3.0][seed % 4];
      const ps = pieces(Array.from({ length: n }, () => +(0.05 + rnd() * (L - 0.05)).toFixed(4)));
      const plan = optimizeCuts(ps, L, 0.003);
      expectValidPlan(plan, ps, L, 0.003);
    }
  });

  it("быстро: 200 кусков ≤ 20 мс", () => {
    const rnd = lcg(42);
    const ps = pieces(Array.from({ length: 200 }, () => +(0.1 + rnd() * 2.4).toFixed(3)));
    optimizeCuts(ps, 2.5, 0.003); // прогрев JIT
    const times: number[] = [];
    let plan: CutPlan | null = null;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      plan = optimizeCuts(ps, 2.5, 0.003);
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(20);
    expectValidPlan(plan!, ps, 2.5, 0.003);
  });

  it("быстро: трудная задача из 30 кусков с точным перебором", () => {
    const rnd = lcg(3);
    const ps = pieces(Array.from({ length: 30 }, () => +(0.6 + rnd() * 0.9).toFixed(3)));
    optimizeCuts(ps, 2.5, 0.003);
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      optimizeCuts(ps, 2.5, 0.003);
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(20);
  });

  it("не мутирует вход", () => {
    const ps = pieces([1, 2, 0.5]);
    const snapshot = JSON.stringify(ps);
    optimizeCuts(ps, 2.5, 0.003);
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});

describe("mergeCutPlans", () => {
  it("склеивает планы комнат и пересортировывает планки", () => {
    const a = optimizeCuts(pieces([1.0, 0.5]), 2.5, 0);
    const b = optimizeCuts(pieces([2.5, 2.0]), 2.5, 0);
    const m = mergeCutPlans([a, b], 2.5, 0);
    expect(m.bars).toHaveLength(a.bars.length + b.bars.length);
    expect(m.bars.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(m.bars.map((x) => x.used)).toEqual([2.5, 2.0, 1.5]);
    expect(m.piecesLength).toBeCloseTo(6, 9);
    expect(m.lowerBound).toBe(a.lowerBound + b.lowerBound);
    expect(m.optimal).toBe(true);
    expect(m.efficiency).toBeCloseTo(6 / 7.5, 9);
  });
});

/* ------------------------------------------------------------------ */
/* Состязательные случаи раскроя и нарезки                              */
/* ------------------------------------------------------------------ */

/** Точный оптимум перебором (для малых задач; длины — целые мм). */
function bruteForceBars(lengthsMm: number[], stockMm: number, kerfMm: number): number {
  const sizes = lengthsMm.map((l) => l + kerfMm).sort((a, b) => b - a);
  const cap = stockMm + kerfMm;
  const loads: number[] = [];
  let best = sizes.length;
  const dfs = (i: number) => {
    if (loads.length >= best) return;
    if (i === sizes.length) {
      best = loads.length;
      return;
    }
    for (let b = 0; b < loads.length; b++) {
      if (loads[b] + sizes[i] > cap) continue;
      loads[b] += sizes[i];
      dfs(i + 1);
      loads[b] -= sizes[i];
    }
    loads.push(sizes[i]);
    dfs(i + 1);
    loads.pop();
  };
  dfs(0);
  return best;
}

/** Инварианты нарезки для любой комнаты. */
function expectValidSplit(r: RoomSkirtingResult, L: number, minPiece: number) {
  const { pieces: ps, joints, straightRuns } = splitIntoPieces(r, L, minPiece);
  // Материал сохраняется: Σ кусков = Σ заготовок сегментов.
  expect(sum(ps.map((p) => p.length))).toBeCloseTo(sum(r.segments.map((s) => s.materialLength)), 5);
  expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
  for (const p of ps) {
    expect(p.length).toBeGreaterThan(0);
    expect(p.length).toBeLessThanOrEqual(L);
    expect(p.full).toBe(Math.abs(p.length - L) < 1e-6);
  }
  // Куски одного прямого участка идут подряд с одним и тем же набором сегментов.
  const groups = new Map<string, Piece[]>();
  for (const p of ps) {
    const key = p.segmentIds.join("|");
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  // Кольцо без углов и торцов замыкается само на себя — ещё один стык.
  const ring = r.segments.length > 0 && r.segments.every((s) => s.startJoint === "straight");
  expect(sum([...groups.values()].map((g) => g.length - 1)) + (ring ? 1 : 0)).toBe(joints);
  expect(straightRuns).toHaveLength(groups.size);
  const covered = [...groups.keys()].flatMap((k) => k.split("|"));
  expect(new Set(covered).size).toBe(covered.length);
  for (const [key, g] of groups) {
    const segs = key.split("|").map((id) => r.segments.find((s) => s.id === id)!);
    const M = sum(segs.map((s) => s.materialLength));
    expect(g).toHaveLength(Math.max(1, Math.ceil((M - 1e-6) / L)));
    // Все, кроме двух последних, — целые планки; последние две — либо L и хвост ≥ minPiece, либо поровну.
    g.slice(0, -2).forEach((p) => expect(p.length).toBe(L));
    if (g.length >= 2) {
      const [x, y] = g.slice(-2).map((p) => p.length);
      if (x !== L) expect(x).toBeCloseTo(y, 12);
      else expect(y >= minPiece - 1e-9 || Math.abs(y - x) < 1e-9).toBe(true);
    }
  }
  return ps;
}

describe("splitIntoPieces: допуски и инварианты", () => {
  it("перебор на шум плавающей точки не даёт лишнего куска и стыка", () => {
    const r = computeRoomSkirting(makeRoom([[0, 0], [5.0000005, 0], [5.0000005, 1], [0, 1]]), PVC);
    const { pieces: ps, joints } = splitIntoPieces(r, 2.5, 0.3);
    expect(ps.filter((p) => p.segmentIds[0] === "r:p0:1").map((p) => p.length)).toEqual([2.5, 2.5]);
    expect(joints).toBe(2);
  });

  it("реальный перебор (0,1 мм) — честный третий кусок", () => {
    const r = computeRoomSkirting(makeRoom([[0, 0], [5.0001, 0], [5.0001, 1], [0, 1]]), PVC);
    const { pieces: ps } = splitIntoPieces(r, 2.5, 0.3);
    const a = ps.filter((p) => p.segmentIds[0] === "r:p0:1").map((p) => +p.length.toFixed(6));
    expect(a).toEqual([2.5, 1.25005, 1.25005]);
  });

  it("кольцо без углов (окружность из 400 точек): стыков столько же, сколько кусков", () => {
    const pts = Array.from({ length: 400 }, (_, i): [number, number] => {
      const t = (i / 400) * 2 * Math.PI;
      return [2 + 2 * Math.cos(t), 2 + 2 * Math.sin(t)];
    });
    const r = computeRoomSkirting(makeRoom(pts), PVC);
    const ps = expectValidSplit(r, 2.5, 0.3);
    expect(ps).toHaveLength(6); // ≈ 12,57 м: 4 целых + две половины хвоста
    expect(splitIntoPieces(r, 2.5, 0.3).joints).toBe(6);
    expect(splitIntoPieces(r, 13, 0.3).joints).toBe(1); // одна гибкая планка, концы встречаются
  });

  it("минимальный кусок больше половины планки — делим поровну, но не длиннее планки", () => {
    const r = computeRoomSkirting(makeRoom([[0, 0], [3, 0], [3, 1], [0, 1]]), PVC);
    const ps = expectValidSplit(r, 2.5, 2);
    expect(ps.filter((p) => p.segmentIds[0] === "r:p0:1").map((p) => p.length)).toEqual([1.5, 1.5]);
  });

  it("инварианты на комнатах с дверями, откосами, вершинами на прямой, запилом", () => {
    const rooms = [
      makeRoom(RECT, [op("d", "door", 0, 1), op("p", "passage", 2, 1)]),
      makeRoom(L_SHAPE, [op("p", "passage", 3, 0.3)]),
      makeRoom([[0, 0], [2, 0], [7.3, 0], [7.3, 3], [0, 3]], [op("d", "door", 0, 2 - 0.87)]),
      makeRoom([[0, 0], [12.4, 0], [12.4, 0.6], [0, 0.6]]),
    ];
    for (const room of rooms) {
      for (const product of [PVC, MDF_PAINT]) {
        const r = computeRoomSkirting(room, product);
        for (const [L, minPiece] of [[2.5, 0.3], [2.4, 0.5], [0.6, 0.1], [3, 0]] as const) {
          const ps = expectValidSplit(r, L, minPiece);
          expectValidPlan(optimizeCuts(ps, L, 0.003), ps, L, 0.003);
        }
      }
    }
  });
});

describe("optimizeCuts: состязательные случаи", () => {
  it("куски чуть длиннее половины планки не «влезают» за счёт допуска", () => {
    // 1,25002 + 1,25002 = 2,50004 > 2,5 — нужны две планки (нижняя граница по формуле = 2).
    const plan = optimizeCuts(pieces([1.25002, 1.25002]), 2.5, 0);
    expect(plan.bars).toHaveLength(2);
    expect(plan.lowerBound).toBe(2);
  });

  it("куски ровно на планку с пропилом влезают при «неровной» длине планки", () => {
    const L = 2.4567891;
    const kerf = 0.0032;
    for (const k of [2, 3, 4, 5, 7]) {
      const len = (L - (k - 1) * kerf) / k;
      const plan = optimizeCuts(pieces(Array(k).fill(len)), L, kerf);
      expect(plan.bars).toHaveLength(1);
      expect(plan.bars[0].waste).toBe(0);
    }
  });

  it("кусок длиннее планки на шум — принимается, на 0,01 мм — ошибка", () => {
    expect(optimizeCuts(pieces([2.5 + 5e-7]), 2.5, 0.003).bars).toHaveLength(1);
    expect(() => optimizeCuts(pieces([2.50001]), 2.5, 0.003)).toThrow(/длиннее/);
    expect(() => optimizeCuts(pieces([1]), Number.POSITIVE_INFINITY, 0)).toThrow();
    expect(() => optimizeCuts(pieces([1]), Number.NaN, 0)).toThrow();
  });

  it("куски нулевой, отрицательной и NaN длины пропускаются; мусорный пропил = 0", () => {
    const ps = pieces([0, -1, Number.NaN, 1]);
    const plan = optimizeCuts(ps, 2.5, Number.NaN);
    expect(plan.kerf).toBe(0);
    expect(plan.bars).toHaveLength(1);
    expect(plan.bars[0].pieces.map((p) => p.id)).toEqual(["x3"]);
    expect(plan.piecesLength).toBe(1);
  });

  it("каждая планка целиком — без резов и без отходов", () => {
    const plan = optimizeCuts(pieces([2.5, 2.5, 2.5]), 2.5, 0.003);
    expect(plan.bars.map((b) => [b.used, b.waste])).toEqual([[2.5, 0], [2.5, 0], [2.5, 0]]);
    expect(plan.totalWaste).toBe(0);
  });

  it("остаток не длиннее пропила уходит в опилки", () => {
    const plan = optimizeCuts(pieces([1.2, 1.296]), 2.5, 0.003); // 2,496 + 0,003 рез → остаток 0,001
    expect(plan.bars).toHaveLength(1);
    expect(plan.bars[0].waste).toBe(0);
    expect(plan.bars[0].used).toBe(2.5);
  });

  it("совпадает с точным оптимумом на 300 малых задачах; граница не завышена", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = lcg(seed * 31);
      const n = 2 + Math.floor(rnd() * 8);
      const stockMm = [2500, 2400, 2000, 600][seed % 4];
      const kerfMm = [0, 3, 5][seed % 3];
      const mm = Array.from({ length: n }, () => 5 + Math.floor(rnd() * (stockMm - 5)));
      const ps = pieces(mm.map((x) => x / 1000));
      const plan = optimizeCuts(ps, stockMm / 1000, kerfMm / 1000);
      const opt = bruteForceBars(mm, stockMm, kerfMm);
      expect(plan.lowerBound).toBeLessThanOrEqual(opt);
      expect(plan.bars).toHaveLength(opt);
      expect(plan.optimal).toBe(true);
      expectValidPlan(plan, ps, stockMm / 1000, kerfMm / 1000);
    }
  });

  it("порядок входа не меняет число планок", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = lcg(seed);
      const ps = pieces(Array.from({ length: 25 }, () => +(0.1 + rnd() * 2.3).toFixed(3)));
      const a = optimizeCuts(ps, 2.5, 0.003).bars.length;
      const rotated = [...ps.slice(7), ...ps.slice(0, 7)];
      expect(optimizeCuts(rotated, 2.5, 0.003).bars.length).toBe(a);
      expect(optimizeCuts([...ps].reverse(), 2.5, 0.003).bars.length).toBe(a);
    }
  });

  it("большой проект: 1500 кусков считаются быстро и корректно", () => {
    const rnd = lcg(2024);
    const ps = pieces(Array.from({ length: 1500 }, () => +(0.05 + rnd() * 2.45).toFixed(3)));
    const t0 = performance.now();
    const plan = optimizeCuts(ps, 2.5, 0.003);
    expect(performance.now() - t0).toBeLessThan(500);
    expectValidPlan(plan, ps, 2.5, 0.003);
  });

  it("много одинаковых мелких кусков (керамика): плотная укладка", () => {
    const ps = pieces(Array(40).fill(0.197)); // по 3 в элемент 0,6 с пропилом 3 мм
    const plan = optimizeCuts(ps, 0.6, 0.003);
    expect(plan.bars).toHaveLength(14);
    expect(plan.optimal).toBe(true);
    expectValidPlan(plan, ps, 0.6, 0.003);
  });
});
