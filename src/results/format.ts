/**
 * Форматирование для итога: слова «планка/элемент», короткие длины,
 * разбор подписей кусков раскроя. Чистые функции (используются и в тексте заказа).
 */
import type { CutPlan } from "../domain/cutting";
import type { SkirtingProduct } from "../domain/types";
import { formatLength, formatNumber, pluralize } from "../domain/units";

export const NBSP = "\u00a0";

export type Forms = [string, string, string];

/** Как называть единицу товара: керамика — «элемент», остальное — «планка». */
export function unitForms(product: Pick<SkirtingProduct, "material">): Forms {
  return product.material === "ceramic"
    ? ["элемент", "элемента", "элементов"]
    : ["планка", "планки", "планок"];
}

/** Падежи слова-единицы для фраз «длина планки», «из одной планки», «стыки планок». */
export interface UnitWords {
  forms: Forms;
  /** Род. ед.: «планки» / «элемента». */
  gen: string;
  /** Род. мн.: «планок» / «элементов». */
  genPl: string;
  /** Предл. мн.: «(в) планках» / «(в) элементах». */
  prepPl: string;
  /** «из одной планки» / «из одного элемента». */
  fromOne: string;
}

export function unitWords(product: Pick<SkirtingProduct, "material">): UnitWords {
  const forms = unitForms(product);
  return product.material === "ceramic"
    ? { forms, gen: "элемента", genPl: "элементов", prepPl: "элементах", fromOne: "из одного элемента" }
    : { forms, gen: "планки", genPl: "планок", prepPl: "планках", fromOne: "из одной планки" };
}

/** Номера планок диапазонами: [1,2,3,4,7] → «1–4, 7». */
export function numberRanges(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}

/** «5 планок» без разделителя тысяч в малых числах. */
export function countText(n: number, forms: Forms): string {
  return `${formatNumber(n, 0)}${NBSP}${pluralize(n, forms)}`;
}

/**
 * Типографика строк: неразрывный пробел между числом и единицей («80 мм», «2,5 м», «5 %»)
 * и перед тире — чтобы тире не начинало строку.
 */
export function typo(text: string): string {
  return text
    .replace(/(\d) (мм|см|м²|м³|м|₽|%|шт|кг)(?=$|[\s,.;:)—])/g, `$1${NBSP}$2`)
    .replace(/ — /g, `${NBSP}— `);
}

/** «15,25 м» */
export const meters = (m: number): string => formatLength(m, "m", 2);

/** «2,5 м» — длина планки без лишних нулей. */
export const stockText = (m: number): string => formatLength(m, "m", 2, { trim: true });

/** «2,00» — длина куска без единицы (для подписей на схеме раскроя). */
export const shortLen = (m: number): string => formatNumber(m, 2);

/**
 * Длина обрезка — с округлением вниз до сантиметра: обрезок 0,297 м не должен
 * выглядеть как «0,30» рядом с порогом «пригодится от 30 см».
 */
export const wasteLen = (m: number): string => formatNumber(Math.floor(m * 100 + 1e-6) / 100, 2);

/** «5 %» */
export const pctText = (v: number, digits = 1): string =>
  `${formatNumber(v, digits, { trim: true })}${NBSP}%`;

/**
 * Подпись куска: «A 1/2» → { main: «A», part: «1/2» }, «A+B» → { main: «A+B» },
 * «B·откос» → { main: «B», reveal: true }.
 */
export function splitPieceLabel(label: string): { main: string; part: string; reveal: boolean } {
  const m = label.match(/^(.*?)\s+(\d+\/\d+)$/);
  const head = m ? m[1] : label;
  const part = m ? m[2] : "";
  const reveal = /·откос/.test(head);
  return { main: reveal ? head.replace(/·откос/g, "") : head, part, reveal };
}

/** «C2» → { wall: «C», part: 2 }; «C» → { wall: «C», part: 1 }. */
function wallPart(label: string): { wall: string; part: number } {
  const m = label.match(/^([A-Z]+)(\d+)$/);
  return m ? { wall: m[1], part: Number(m[2]) } : { wall: label, part: 1 };
}

/**
 * Стены, разбитые проёмами на несколько участков («A», «A2»…). У такой стены
 * первый участок тоже называем номером — «участок 1», иначе «стена A» читается как вся стена.
 */
export type SplitWalls = ReadonlySet<string>;

/** «стена C», «стена C, участок 2» (участок — кусок стены между проёмами). */
function wallText(label: string, split?: SplitWalls): string {
  const { wall, part } = wallPart(label);
  return part > 1 || split?.has(wall) ? `стена ${wall}, участок ${part}` : `стена ${wall}`;
}

/** «C2» → «C (участок 2)» — для перечислений. */
function wallShort(label: string, split?: SplitWalls): string {
  const { wall, part } = wallPart(label);
  return part > 1 || split?.has(wall) ? `${wall} (участок ${part})` : wall;
}

/** Часть куска: «1/2» → «1 из 2». */
export const partText = (part: string): string => part.replace("/", " из ");

/**
 * Подпись куска для печати и перечислений: «A2», «A2 кусок 1 из 2», «откос B».
 * Слово «кусок» обязательно: «A 2 из 2» (половина участка A) легко спутать с «A2» (второй участок стены A).
 */
export function pieceText(label: string): string {
  const { main, part, reveal } = splitPieceLabel(label);
  return `${reveal ? "откос " : ""}${main}${part ? ` кусок ${partText(part)}` : ""}`;
}

/**
 * Человекочитаемое описание куска: «стена A, кусок 1 из 2», «стена C, участок 2»,
 * «откос у стены B», «стены A и B (одна линия)». split — стены этой комнаты с несколькими участками.
 */
export function describePiece(label: string, split?: SplitWalls): string {
  const { main, part, reveal } = splitPieceLabel(label);
  const walls = main.split("+");
  const where = reveal
    ? `откос у стены ${wallPart(walls[0]).wall}`
    : walls.length > 1
      ? `стены ${joinRu(walls.map((w) => wallShort(w, split)))} (одна линия)`
      : wallText(main, split);
  if (!part) return where;
  return `${where}, кусок ${partText(part)}`;
}

/**
 * Раскрой минимален по-настоящему: меньше планок не хватило бы даже по длине материала.
 * cutPlan.optimal доказывает минимум лишь для уже нарезанных кусков и ничего не говорит
 * о том, удачно ли нарезаны стены, — «оптимален» по нему писать нельзя.
 */
export function isMinimalCut(plan: Pick<CutPlan, "bars" | "piecesLength" | "stockLength">): boolean {
  return plan.bars.length <= Math.ceil(plan.piecesLength / plan.stockLength - 1e-6);
}

/** Список через запятую с «и» перед последним: «A, B и C». */
export function joinRu(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

/** Дата для шапки печати: «11 октября 2026». */
export function formatDateRu(d: Date): string {
  try {
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
