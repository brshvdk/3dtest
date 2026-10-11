/**
 * Нарезка плинтуса на куски и раскрой планок (одномерный bin packing).
 *
 * Внутри раскроя длины переводятся в целые микрометры (с округлением вниз):
 * сравнения точные, результат детерминирован и не зависит от погрешностей
 * плавающей точки. Округление вниз гарантирует, что куски, сумма которых
 * ровно равна планке, в неё влезают; перебор, который может «спрятаться»
 * в округлении, — меньше 1 мкм на кусок.
 */
import type { RoomSkirtingResult, SkirtingSegment } from "./skirtingCalc";

export interface Piece {
  id: string;
  roomId: string;
  segmentIds: string[];
  label: string;
  /** м, длина заготовки (с удлинением под запил). */
  length: number;
  /** Кусок — целая планка (резать не нужно). */
  full: boolean;
}

export interface CutBar {
  /** Порядковый номер планки в плане, с 0. */
  index: number;
  pieces: Piece[];
  /** м, израсходовано: куски + пропилы (+ огрызок ≤ пропила). used + waste = длина планки. */
  used: number;
  /** м, остаток планки после всех резов (полезный обрезок). */
  waste: number;
}

export interface CutPlan {
  stockLength: number;
  kerf: number;
  /** Сначала самые заполненные. */
  bars: CutBar[];
  piecesLength: number;
  totalWaste: number;
  /** piecesLength / (bars · stockLength), 0..1. */
  efficiency: number;
  /**
   * Доказанная нижняя граница числа планок: ≥ ceil(Σ(len+kerf)/(L+kerf));
   * уточняется границей Мартелло–Тота L2 и полным перебором для малых задач.
   */
  lowerBound: number;
  /** bars.length === lowerBound — доказанно меньше нельзя. */
  optimal: boolean;
}

/* ------------------------ Нарезка на куски ------------------------- */

/** м, допуск на шум плавающей точки при сравнении длин. */
const LEN_TOL = 1e-6;

interface StraightRun {
  segments: SkirtingSegment[];
  /** Σ materialLength — сколько материала нужно. */
  material: number;
  /** Σ length — длина по стене (для крепежа). */
  length: number;
}

/** Сливает сегменты, соединённые стыком 'straight', в прямые участки (с учётом цикла). */
function straightRuns(segments: SkirtingSegment[]): StraightRun[] {
  const m = segments.length;
  if (!m) return [];
  // Начинаем с сегмента, который не продолжает предыдущий по прямой.
  let base = segments.findIndex((s) => s.startJoint !== "straight");
  if (base < 0) base = 0;
  const runs: StraightRun[] = [];
  let cur: StraightRun | null = null;
  for (let k = 0; k < m; k++) {
    const s = segments[(base + k) % m];
    if (!cur) cur = { segments: [], material: 0, length: 0 };
    cur.segments.push(s);
    cur.material += s.materialLength;
    cur.length += s.length;
    if (s.endJoint !== "straight") {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/**
 * Режет сегменты на куски ≤ stockLength. Сегменты, соединённые стыком 'straight' (вершина на прямой),
 * сначала сливаются в один прямой участок. Участок длиной M ≤ L → 1 кусок. Иначе n = ceil(M/L):
 * (n−1) целых планок + остаток r; если r < minPiece — две последние делятся поровну ((L+r)/2).
 * joints = Σ(n−1) по участкам (стыки внутри прямых участков — под соединители).
 * Исключение — кольцо без единого угла и торца (все вершины «на прямой»): его куски
 * замыкаются друг на друга, поэтому стыков столько же, сколько кусков.
 */
export function splitIntoPieces(
  result: RoomSkirtingResult,
  stockLength: number,
  minPiece: number,
): { pieces: Piece[]; joints: number; straightRuns: number[] } {
  if (!(stockLength > 0 && Number.isFinite(stockLength))) {
    throw new Error("Длина планки должна быть конечным числом больше нуля");
  }
  const L = stockLength;
  const pieces: Piece[] = [];
  const lengths: number[] = [];
  let joints = 0;

  const add = (run: StraightRun, label: string, length: number) => {
    pieces.push({
      id: `${result.roomId}:pc${pieces.length + 1}`,
      roomId: result.roomId,
      segmentIds: run.segments.map((s) => s.id),
      label,
      length,
      full: Math.abs(length - L) < LEN_TOL,
    });
  };

  const ring = result.segments.length > 0 && result.segments.every((s) => s.startJoint === "straight");
  for (const run of straightRuns(result.segments)) {
    const M = run.material;
    if (M <= LEN_TOL) continue;
    lengths.push(run.length);
    const label = run.segments.map((s) => s.label).join("+");
    // Тот же допуск, что и для «влезает в одну планку»: перебор на шум
    // плавающей точки не должен давать лишнюю планку и лишний стык.
    const n = Math.max(1, Math.ceil((M - LEN_TOL) / L));
    if (ring) joints += 1;
    if (n === 1) {
      add(run, label, Math.min(M, L));
      continue;
    }
    const r = Math.min(L, M - (n - 1) * L);
    const parts: number[] = [];
    if (r < minPiece) {
      // Короткий хвост некрасив и плохо держится — делим две последние поровну.
      for (let i = 0; i < n - 2; i++) parts.push(L);
      const half = (L + r) / 2;
      parts.push(half, half);
    } else {
      for (let i = 0; i < n - 1; i++) parts.push(L);
      parts.push(r);
    }
    parts.forEach((len, i) => add(run, `${label} ${i + 1}/${n}`, len));
    joints += n - 1;
  }
  return { pieces, joints, straightRuns: lengths };
}

/* ------------------------------ Раскрой ------------------------------ */

/** Единиц на метр: 1 мкм. */
const UNITS = 1_000_000;
/** Точный перебор — только для задач до стольких «нетривиальных» кусков. */
const EXACT_MAX_ITEMS = 30;
/** Предел узлов перебора: детерминированный «таймаут» (≈ единицы мс). */
const EXACT_NODE_BUDGET = 25_000;
/** Сколько наименее заполненных планок пробуем опустошить за шаг улучшения. */
const IMPROVE_TARGETS = 8;

/** Метры → мкм вниз; +1 нм гасит шум вида 2999.9999999999995. */
const toUnits = (m: number): number => Math.max(0, Math.floor(m * UNITS + 1e-3));

interface Item {
  /** Индекс во входном массиве (стабильность). */
  idx: number;
  /** Размер с пропилом, ед. */
  size: number;
}

/** Решение: планки как списки позиций в массиве items. */
type Packing = number[][];

function loadsOf(packing: Packing, items: Item[]): number[] {
  return packing.map((bin) => bin.reduce((acc, i) => acc + items[i].size, 0));
}

/** First Fit / Best Fit Decreasing (items уже отсортированы по убыванию). */
function greedyPack(items: Item[], cap: number, best: boolean): Packing {
  const bins: Packing = [];
  const loads: number[] = [];
  items.forEach((it, i) => {
    let target = -1;
    for (let b = 0; b < bins.length; b++) {
      if (loads[b] + it.size > cap) continue;
      if (!best) {
        target = b;
        break;
      }
      if (target < 0 || loads[b] > loads[target]) target = b;
    }
    if (target < 0) {
      bins.push([i]);
      loads.push(it.size);
    } else {
      bins[target].push(i);
      loads[target] += it.size;
    }
  });
  return bins;
}

/** Меньше планок лучше; при равенстве — загрузка «кучнее» (больше крупных обрезков). */
function betterPacking(a: Packing, b: Packing, items: Item[]): Packing {
  if (a.length !== b.length) return a.length < b.length ? a : b;
  const sq = (p: Packing) => loadsOf(p, items).reduce((acc, l) => acc + l * l, 0);
  return sq(b) > sq(a) ? b : a;
}

/**
 * Нижняя граница L2 (Martello & Toth, 1990). sizes — по убыванию.
 * Всегда ≥ ceil(Σ/cap).
 */
function lowerBoundL2(sizes: number[], cap: number): number {
  if (!sizes.length) return 0;
  const total = sizes.reduce((a, s) => a + s, 0);
  let best = Math.ceil(total / cap);
  const alphas = new Set<number>([0]);
  for (const s of sizes) if (s * 2 <= cap) alphas.add(s);
  for (const alpha of alphas) {
    let n1 = 0;
    let n2 = 0;
    let sum2 = 0;
    let sum3 = 0;
    for (const s of sizes) {
      if (s > cap - alpha) n1++;
      else if (s * 2 > cap) {
        n2++;
        sum2 += s;
      } else if (s >= alpha) sum3 += s;
    }
    const free2 = n2 * cap - sum2;
    const lb = n1 + n2 + Math.max(0, Math.ceil((sum3 - free2) / cap));
    if (lb > best) best = lb;
  }
  return best;
}

/**
 * Локальное улучшение: пытаемся опустошить наименее заполненную планку,
 * раскладывая её куски по остальным (best fit), при необходимости меняя
 * кусок на меньший из другой планки. Повторяем, пока получается.
 */
function improvePacking(packing: Packing, items: Item[], cap: number, lb: number): Packing {
  let bins = packing.map((b) => [...b]);
  const maxSteps = 10 * items.length + 10;
  while (bins.length > lb) {
    const loads = loadsOf(bins, items);
    // Кандидаты на опустошение — от наименее заполненной.
    const order = bins.map((_, i) => i).sort((p, q) => loads[p] - loads[q] || p - q);
    let improved: Packing | null = null;
    for (const target of order.slice(0, IMPROVE_TARGETS)) {
      improved = tryEmptyBin(bins, loads, target, items, cap, maxSteps);
      if (improved) break;
    }
    if (!improved) break;
    bins = improved;
  }
  return bins;
}

function tryEmptyBin(
  bins: Packing,
  loads: number[],
  target: number,
  items: Item[],
  cap: number,
  maxSteps: number,
): Packing | null {
  const others = bins.filter((_, i) => i !== target).map((b) => [...b]);
  const oLoads = loads.filter((_, i) => i !== target);
  const pool = [...bins[target]];
  const bySizeDesc = (p: number, q: number) => items[q].size - items[p].size || p - q;
  pool.sort(bySizeDesc);
  let steps = 0;
  while (pool.length) {
    if (++steps > maxSteps) return null;
    const p = pool.shift()!;
    const size = items[p].size;
    // 1) Best fit в другую планку.
    let fit = -1;
    for (let b = 0; b < others.length; b++) {
      if (oLoads[b] + size <= cap && (fit < 0 || oLoads[b] > oLoads[fit])) fit = b;
    }
    if (fit >= 0) {
      others[fit].push(p);
      oLoads[fit] += size;
      continue;
    }
    // 2) Обмен на меньший кусок: p встаёт на место q, q уходит в очередь.
    let swapBin = -1;
    let swapPos = -1;
    let swapLoad = -1;
    for (let b = 0; b < others.length; b++) {
      for (let j = 0; j < others[b].length; j++) {
        const q = others[b][j];
        const qs = items[q].size;
        if (qs >= size) continue;
        const nl = oLoads[b] - qs + size;
        if (nl <= cap && nl > swapLoad) {
          swapBin = b;
          swapPos = j;
          swapLoad = nl;
        }
      }
    }
    if (swapBin < 0) return null;
    const q = others[swapBin][swapPos];
    others[swapBin][swapPos] = p;
    oLoads[swapBin] = swapLoad;
    pool.push(q);
    pool.sort(bySizeDesc);
  }
  return others;
}

/**
 * Точный поиск ветвей и границ для малых задач. packing — упаковка меньше
 * чем в ub планок (или null, если такой нет / не нашли). proven — перебор
 * завершён полностью, т. е. результат (или ub) доказанно оптимален.
 * sizes — по убыванию.
 */
function exactPack(
  sizes: number[],
  cap: number,
  ub: number,
  lb: number,
): { packing: Packing | null; proven: boolean } {
  const m = sizes.length;
  const suffix = new Array<number>(m + 1).fill(0);
  for (let i = m - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sizes[i];
  const loads: number[] = [];
  const assign = new Array<number>(m).fill(0);
  // Лучшее найденное назначение (объект — чтобы TS видел запись из замыкания).
  const best: { assign: number[] | null; bins: number } = { assign: null, bins: ub };
  let free = 0;
  let nodes = 0;

  // true — прекратить поиск (найден оптимум или кончился бюджет).
  const dfs = (k: number): boolean => {
    if (++nodes > EXACT_NODE_BUDGET) return true;
    if (k === m) {
      best.assign = [...assign];
      best.bins = loads.length;
      return best.bins <= lb;
    }
    const need = suffix[k] - free;
    if (loads.length + (need > 0 ? Math.ceil(need / cap) : 0) >= best.bins) return false;
    const s = sizes[k];
    // Одинаковые куски кладём в планки с неубывающими номерами (симметрия).
    const start = k > 0 && sizes[k - 1] === s ? assign[k - 1] : 0;
    for (let b = start; b < loads.length; b++) {
      if (loads[b] + s > cap) continue;
      // Планки с одинаковой загрузкой взаимозаменяемы — пробуем одну.
      let dup = false;
      for (let c = start; c < b; c++) {
        if (loads[c] === loads[b]) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      loads[b] += s;
      free -= s;
      assign[k] = b;
      if (dfs(k + 1)) return true;
      loads[b] -= s;
      free += s;
    }
    if (loads.length + 1 < best.bins) {
      loads.push(s);
      free += cap - s;
      assign[k] = loads.length - 1;
      if (dfs(k + 1)) return true;
      loads.pop();
      free -= cap - s;
    }
    return false;
  };
  dfs(0);

  const proven = nodes <= EXACT_NODE_BUDGET;
  if (!best.assign) return { packing: null, proven };
  const bins: Packing = Array.from({ length: best.bins }, () => []);
  best.assign.forEach((b, i) => bins[b].push(i));
  return { packing: bins, proven };
}

/**
 * Одномерный раскрой. Пропил: ёмкость L+kerf, размер куска length+kerf
 * (n кусков → n−1 резов). FFD и BFD → лучший; затем локальное улучшение
 * и точный перебор для малых задач. Детерминирован. Кусок длиннее L — Error.
 */
export function optimizeCuts(pieces: Piece[], stockLength: number, kerf: number): CutPlan {
  if (!(stockLength > 0 && Number.isFinite(stockLength))) {
    throw new Error("Длина планки должна быть конечным числом больше нуля");
  }
  const k = Number.isFinite(kerf) && kerf > 0 ? kerf : 0;
  const stockU = toUnits(stockLength);
  const kerfU = toUnits(k);
  const cap = stockU + kerfU;

  const valid = pieces.filter((p) => p.length > 0);
  for (const p of valid) {
    if (p.length > stockLength + LEN_TOL) {
      throw new Error(
        `Кусок «${p.label}» длиной ${p.length.toFixed(3)} м длиннее планки ${stockLength} м`,
      );
    }
  }
  // Кусок в пределах допуска LEN_TOL сверх планки — шум: считаем его ровно в планку.
  const items: Item[] = valid
    .map((p, idx) => ({ idx, size: Math.min(toUnits(p.length), stockU) + kerfU }))
    .sort((a, b) => b.size - a.size || a.idx - b.idx);
  const sizes = items.map((it) => it.size);
  let lowerBound = lowerBoundL2(sizes, cap);

  let packing = betterPacking(greedyPack(items, cap, false), greedyPack(items, cap, true), items);
  if (packing.length > lowerBound) packing = improvePacking(packing, items, cap, lowerBound);
  if (packing.length > lowerBound) {
    const exact = tryExact(packing, items, cap);
    packing = exact.packing;
    // Полный перебор — тоже доказательство: меньше планок не бывает.
    if (exact.proven) lowerBound = packing.length;
  }

  const drafts = packing.map((bin) => {
    // Внутри планки — от длинного к короткому, при равенстве — по порядку входа.
    const order = bin
      .map((i) => items[i].idx)
      .sort((a, b) => valid[b].length - valid[a].length || a - b);
    const bp = order.map((i) => valid[i]);
    const sum = bp.reduce((acc, p) => acc + p.length, 0);
    const rest = stockLength - sum - (bp.length - 1) * k;
    // Последний рез отделяет обрезок; если остаток ≤ пропила — он уходит в опилки.
    const waste = rest - k > LEN_TOL ? rest - k : 0;
    return { first: order[0], sum, bar: { index: 0, pieces: bp, used: stockLength - waste, waste } };
  });
  // Сначала самые заполненные; при равенстве — по длинам кусков, затем по входу.
  drafts.sort(
    (a, b) =>
      b.bar.used - a.bar.used ||
      b.sum - a.sum ||
      compareLengths(a.bar.pieces, b.bar.pieces) ||
      a.first - b.first,
  );
  const bars: CutBar[] = drafts.map((d, i) => ({ ...d.bar, index: i }));

  const piecesLength = valid.reduce((acc, p) => acc + p.length, 0);
  const totalWaste = bars.reduce((acc, b) => acc + b.waste, 0);
  return {
    stockLength,
    kerf: k,
    bars,
    piecesLength,
    totalWaste,
    efficiency: bars.length ? piecesLength / (bars.length * stockLength) : 0,
    lowerBound,
    optimal: bars.length === lowerBound,
  };
}

/** Лексикографически по убыванию длин (куски внутри планки уже по убыванию). */
function compareLengths(a: Piece[], b: Piece[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = b[i].length - a[i].length;
    if (d) return d;
  }
  return b.length - a.length;
}

/**
 * Точный перебор только по «нетривиальным» кускам: кусок, который не делит
 * планку ни с одним другим (например, целая планка), занимает её один.
 * proven — возвращённая упаковка доказанно оптимальна.
 */
function tryExact(packing: Packing, items: Item[], cap: number): { packing: Packing; proven: boolean } {
  const m = items.length;
  if (m < 2) return { packing, proven: true };
  const min1 = items[m - 1].size;
  const min2 = items[m - 2].size;
  const solo: number[] = [];
  const rest: number[] = [];
  items.forEach((it, i) => {
    const smallestOther = i === m - 1 ? min2 : min1;
    (it.size + smallestOther > cap ? solo : rest).push(i);
  });
  // Все куски «одиночки» (кроме, может быть, одного) — жадная упаковка уже оптимальна.
  if (rest.length < 2) return { packing, proven: true };
  if (rest.length > EXACT_MAX_ITEMS) return { packing, proven: false };
  const restSizes = rest.map((i) => items[i].size);
  const ub = packing.length - solo.length;
  const found = exactPack(restSizes, cap, ub, lowerBoundL2(restSizes, cap));
  if (!found.packing) return { packing, proven: found.proven };
  return {
    packing: [...solo.map((i) => [i]), ...found.packing.map((bin) => bin.map((j) => rest[j]))],
    proven: found.proven,
  };
}

/**
 * Склейка раскроев (например, по комнатам без обмена обрезками) в один план:
 * планки пересортированы по заполненности и перенумерованы.
 */
export function mergeCutPlans(plans: CutPlan[], stockLength: number, kerf: number): CutPlan {
  const bars = plans
    .flatMap((p) => p.bars)
    .map((b, order) => ({ b, order }))
    .sort((x, y) => y.b.used - x.b.used || x.order - y.order)
    .map(({ b }, i) => ({ ...b, index: i }));
  const piecesLength = plans.reduce((acc, p) => acc + p.piecesLength, 0);
  const lowerBound = plans.reduce((acc, p) => acc + p.lowerBound, 0);
  return {
    stockLength,
    kerf,
    bars,
    piecesLength,
    totalWaste: plans.reduce((acc, p) => acc + p.totalWaste, 0),
    efficiency: bars.length ? piecesLength / (bars.length * stockLength) : 0,
    lowerBound,
    optimal: plans.every((p) => p.optimal),
  };
}
