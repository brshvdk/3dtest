/**
 * Форматирование и разбор величин для русского UI.
 * Домен хранит метры; UI показывает м / см / мм по контексту:
 *  - стены комнаты — метры («4,20 м»)
 *  - проёмы — сантиметры («87 см»)
 *  - сечение плинтуса — миллиметры («55 мм»)
 */

export type LengthUnit = "m" | "cm" | "mm";

export const UNIT_LABEL: Record<LengthUnit, string> = {
  m: "м",
  cm: "см",
  mm: "мм",
};

const UNIT_FACTOR: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

const DEFAULT_DIGITS: Record<LengthUnit, number> = { m: 2, cm: 0, mm: 0 };

const NBSP = " ";

/**
 * Форматтеры по (digits, trim): Intl.NumberFormat дорог в создании, а
 * formatNumber зовут плашки, поля и строки сметы на каждом кадре перетаскивания.
 */
const FORMATTERS = new Map<string, Intl.NumberFormat>();

function formatterFor(digits: number, trim: boolean): Intl.NumberFormat {
  const key = `${digits}|${trim ? 1 : 0}`;
  let f = FORMATTERS.get(key);
  if (!f) {
    f = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: trim ? 0 : digits,
      maximumFractionDigits: digits,
    });
    FORMATTERS.set(key, f);
  }
  return f;
}

/** Число по-русски: «1 234,5». */
export function formatNumber(
  v: number,
  digits = 2,
  opts: { trim?: boolean } = {},
): string {
  if (!Number.isFinite(v)) return "—";
  // ru-RU делит тысячи узким неразрывным пробелом (U+202F) — приводим к обычному NBSP.
  return formatterFor(digits, !!opts.trim).format(v).replace(/\u202f/g, NBSP);
}

/** Метры → значение в единице. */
export const fromMeters = (m: number, unit: LengthUnit): number =>
  m / UNIT_FACTOR[unit];
/** Значение в единице → метры. */
export const toMeters = (v: number, unit: LengthUnit): number =>
  v * UNIT_FACTOR[unit];

/** «4,20 м», «87 см», «55 мм». */
export function formatLength(
  meters: number,
  unit: LengthUnit = "m",
  digits = DEFAULT_DIGITS[unit],
  opts: { trim?: boolean; noUnit?: boolean } = {},
): string {
  const v = fromMeters(meters, unit);
  const n = formatNumber(roundTo(v, digits), digits, { trim: opts.trim });
  return opts.noUnit ? n : `${n}${NBSP}${UNIT_LABEL[unit]}`;
}

/** «12,5 м²» */
export function formatArea(m2: number, digits = 2): string {
  return `${formatNumber(m2, digits)}${NBSP}м²`;
}

/** «32,4 м³» */
export function formatVolume(m3: number, digits = 1): string {
  return `${formatNumber(m3, digits)}${NBSP}м³`;
}

/** «2 950 ₽» */
export function formatMoney(rub: number): string {
  return `${formatNumber(Math.round(rub), 0)}${NBSP}₽`;
}

export function roundTo(v: number, digits: number): number {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

const UNIT_ALIASES: Array<[RegExp, LengthUnit]> = [
  [/^(мм|mm)$/i, "mm"],
  [/^(см|cm)$/i, "cm"],
  [/^(м|m|метр|метра|метров)$/i, "m"],
];

function aliasToUnit(s: string): LengthUnit | null {
  for (const [re, u] of UNIT_ALIASES) if (re.test(s)) return u;
  return null;
}

/**
 * Разбирает ввод длины пользователя → метры.
 * Понимает: «4,2», «4.2», «4,2 м», «420 см», «4200мм», «4 м 20 см»,
 * «1 200» (пробел как разделитель тысяч). Без единицы — defaultUnit.
 * Возвращает null для пустого/некорректного ввода и отрицательных чисел.
 */
export function parseLength(
  input: string,
  defaultUnit: LengthUnit = "m",
): number | null {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .toLowerCase()
    .replace(/[  ]/g, " ")
    .replace(/,/g, ".");
  if (!s) return null;

  // Составная запись «4 м 20 см».
  const compound = s.match(
    /^(\d+(?:\.\d+)?)\s*(м|m)\s+(\d+(?:\.\d+)?)\s*(см|cm|мм|mm)$/,
  );
  if (compound) {
    const m = parseFloat(compound[1]);
    const rest = parseFloat(compound[3]);
    const u = aliasToUnit(compound[4]) ?? "cm";
    return m + toMeters(rest, u);
  }

  // Число + необязательная единица. Пробелы внутри числа — разделители тысяч.
  const m = s.match(/^([\d\s]*\.?\d+)\s*([a-zа-яё]*)\.?$/i);
  if (!m) return null;
  const numStr = m[1].replace(/\s+/g, "");
  const v = parseFloat(numStr);
  if (!Number.isFinite(v) || v < 0) return null;
  const unit = m[2] ? aliasToUnit(m[2]) : defaultUnit;
  if (!unit) return null;
  return toMeters(v, unit);
}

/** Разбор обычного числа (цена, проценты): «1 200,50» → 1200.5. */
export function parseNumber(input: string): number | null {
  const s = String(input ?? "")
    .trim()
    .replace(/[\s  ]/g, "")
    .replace(/,/g, ".")
    .replace(/[₽%]$/, "");
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** pluralize(5, ['планка', 'планки', 'планок']) → 'планок' */
export function pluralize(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.trunc(n));
  const n10 = a % 10;
  const n100 = a % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

/** «5 планок» */
export function plural(n: number, forms: [string, string, string]): string {
  return `${formatNumber(n, 0)}${NBSP}${pluralize(n, forms)}`;
}
