/**
 * Проёмы: виды, стандартные размеры, фабрика, правила прерывания плинтуса.
 *
 * Термины:
 *  - «Проём» (width × height) — отверстие в стене в свету.
 *  - Дверная коробка занимает DOOR_FRAME с каждой стороны проёма
 *    (монтажный зазор + брус коробки), поэтому ширина полотна ≈ width − 2·DOOR_FRAME.
 *    Отсюда стандарт «проём = полотно + 70 мм».
 *  - Наличник шириной `casing` заходит на коробку на CASING_INSET, а на стену
 *    выступает на casing − CASING_INSET. Плинтус упирается в наличник.
 */
import { createId } from "./ids";
import type { Opening, OpeningKind } from "./types";

/** м, зазор + брус коробки с каждой стороны дверного проёма. */
export const DOOR_FRAME = 0.035;
/** м, на сколько наличник перекрывает коробку (заходит внутрь проёма). */
export const CASING_INSET = 0.03;
/** м, стандартная ширина наличника. */
export const DEFAULT_CASING = 0.07;
/** м, стандартная высота подоконника. */
export const DEFAULT_SILL = 0.85;

export interface OpeningKindMeta {
  kind: OpeningKind;
  name: string;
  /** Для кнопки «+ Дверь» */
  addLabel: string;
  /** Короткая подсказка, что это и как влияет на плинтус. */
  hint: string;
}

export const OPENING_KINDS: OpeningKindMeta[] = [
  {
    kind: "door",
    name: "Дверь",
    addLabel: "Дверь",
    hint: "Плинтус прерывается и упирается в наличник.",
  },
  {
    kind: "window",
    name: "Окно",
    addLabel: "Окно",
    hint: "Обычно выше плинтуса и не влияет на него. Панорамное (в пол) — прерывает.",
  },
  {
    kind: "passage",
    name: "Проём",
    addLabel: "Проём",
    hint: "Проём без двери или арка. Плинтус можно завести в откосы.",
  },
  {
    kind: "balcony",
    name: "Балконный блок",
    addLabel: "Балкон",
    hint: "Балконная дверь + окно. Плинтус прерывается на ширину двери.",
  },
  {
    kind: "furniture",
    name: "Без плинтуса",
    addLabel: "Мебель",
    hint: "Кухня, встроенный шкаф, ванна — участок стены, где плинтус не нужен.",
  },
];

export const OPENING_KIND_META: Record<OpeningKind, OpeningKindMeta> =
  Object.fromEntries(OPENING_KINDS.map((m) => [m.kind, m])) as Record<
    OpeningKind,
    OpeningKindMeta
  >;

export interface OpeningPreset {
  id: string;
  kind: OpeningKind;
  /** «Межкомнатная 80» */
  name: string;
  /** «полотно 800×2000 мм» */
  hint: string;
  width: number;
  height: number;
  elevation: number;
  /** Дополнительные поля, специфичные для пресета. */
  extra?: Partial<Opening>;
}

/**
 * Межкомнатные двери по ГОСТ 475-2016 / 6629-88: полотно 600–900 × 2000 мм,
 * рекомендуемый проём = полотно + 70 мм по ширине, высота ≈ 2070 мм.
 * Входные — по размеру блока (860 / 960 мм).
 */
export const DOOR_PRESETS: OpeningPreset[] = [
  { id: "door-60", kind: "door", name: "Межкомнатная 60", hint: "полотно 600×2000 мм — санузел, кладовая", width: 0.67, height: 2.07, elevation: 0 },
  { id: "door-70", kind: "door", name: "Межкомнатная 70", hint: "полотно 700×2000 мм — кухня, ванная", width: 0.77, height: 2.07, elevation: 0 },
  { id: "door-80", kind: "door", name: "Межкомнатная 80", hint: "полотно 800×2000 мм — жилые комнаты", width: 0.87, height: 2.07, elevation: 0 },
  { id: "door-90", kind: "door", name: "Межкомнатная 90", hint: "полотно 900×2000 мм — широкая", width: 0.97, height: 2.07, elevation: 0 },
  { id: "door-2x60", kind: "door", name: "Двустворчатая 120", hint: "2 полотна по 600×2000 мм", width: 1.27, height: 2.07, elevation: 0, extra: { leaves: 2 } },
  { id: "door-2x70", kind: "door", name: "Двустворчатая 140", hint: "2 полотна по 700×2000 мм", width: 1.47, height: 2.07, elevation: 0, extra: { leaves: 2 } },
  { id: "door-entry-86", kind: "door", name: "Входная 860", hint: "блок 860×2050 мм", width: 0.9, height: 2.1, elevation: 0 },
  { id: "door-entry-96", kind: "door", name: "Входная 960", hint: "блок 960×2050 мм", width: 1.0, height: 2.1, elevation: 0 },
];

/** Типовые оконные проёмы жилых домов; подоконник 850 мм от пола. */
export const WINDOW_PRESETS: OpeningPreset[] = [
  { id: "win-70x140", kind: "window", name: "Одностворчатое", hint: "700×1400 мм", width: 0.7, height: 1.4, elevation: DEFAULT_SILL },
  { id: "win-130x140", kind: "window", name: "Двустворчатое", hint: "1300×1400 мм", width: 1.3, height: 1.4, elevation: DEFAULT_SILL },
  { id: "win-145x145", kind: "window", name: "Двустворчатое П-44", hint: "1450×1450 мм", width: 1.45, height: 1.45, elevation: DEFAULT_SILL },
  { id: "win-205x145", kind: "window", name: "Трёхстворчатое", hint: "2050×1450 мм", width: 2.05, height: 1.45, elevation: DEFAULT_SILL },
  { id: "win-pano", kind: "window", name: "Панорамное (в пол)", hint: "2000×2400 мм, прерывает плинтус", width: 2.0, height: 2.4, elevation: 0 },
];

export const PASSAGE_PRESETS: OpeningPreset[] = [
  { id: "pass-80", kind: "passage", name: "Проём 80", hint: "800×2100 мм", width: 0.8, height: 2.1, elevation: 0 },
  { id: "pass-90", kind: "passage", name: "Проём 90", hint: "900×2100 мм", width: 0.9, height: 2.1, elevation: 0 },
  { id: "pass-120", kind: "passage", name: "Проём 120", hint: "1200×2100 мм", width: 1.2, height: 2.1, elevation: 0 },
  { id: "pass-150", kind: "passage", name: "Широкий проём 150", hint: "1500×2100 мм", width: 1.5, height: 2.1, elevation: 0 },
  { id: "arch-90", kind: "passage", name: "Арка 90", hint: "900×2100 мм, полукруглый верх", width: 0.9, height: 2.1, elevation: 0, extra: { arch: true } },
  { id: "arch-120", kind: "passage", name: "Арка 120", hint: "1200×2200 мм, полукруглый верх", width: 1.2, height: 2.2, elevation: 0, extra: { arch: true } },
];

export const BALCONY_PRESETS: OpeningPreset[] = [
  { id: "balc-70-130", kind: "balcony", name: "Дверь 70 + окно 130", hint: "блок 2000×2100 мм", width: 2.0, height: 2.1, elevation: 0, extra: { balconyDoorWidth: 0.7 } },
  { id: "balc-70-145", kind: "balcony", name: "Дверь 70 + окно 145", hint: "блок 2150×2150 мм (П-44)", width: 2.15, height: 2.15, elevation: 0, extra: { balconyDoorWidth: 0.7 } },
  { id: "balc-80-120", kind: "balcony", name: "Дверь 80 + окно 120", hint: "блок 2000×2100 мм", width: 2.0, height: 2.1, elevation: 0, extra: { balconyDoorWidth: 0.8 } },
];

export const FURNITURE_PRESETS: OpeningPreset[] = [
  { id: "furn-kitchen", kind: "furniture", name: "Кухонный гарнитур", hint: "2400 мм, у гарнитура свой цоколь", width: 2.4, height: 0.9, elevation: 0, extra: { depth: 0.6, label: "Кухня" } },
  { id: "furn-wardrobe", kind: "furniture", name: "Шкаф-купе", hint: "2000 мм", width: 2.0, height: 2.4, elevation: 0, extra: { depth: 0.6, label: "Шкаф-купе" } },
  { id: "furn-closet", kind: "furniture", name: "Встроенный шкаф", hint: "1200 мм", width: 1.2, height: 2.4, elevation: 0, extra: { depth: 0.6, label: "Шкаф" } },
  { id: "furn-bath", kind: "furniture", name: "Ванна", hint: "1700 мм", width: 1.7, height: 0.6, elevation: 0, extra: { depth: 0.7, label: "Ванна" } },
  { id: "furn-other", kind: "furniture", name: "Другое", hint: "участок без плинтуса", width: 1.0, height: 0.8, elevation: 0, extra: { depth: 0.4, label: "Без плинтуса" } },
];

export const PRESETS_BY_KIND: Record<OpeningKind, OpeningPreset[]> = {
  door: DOOR_PRESETS,
  window: WINDOW_PRESETS,
  passage: PASSAGE_PRESETS,
  balcony: BALCONY_PRESETS,
  furniture: FURNITURE_PRESETS,
};

export const DEFAULT_PRESET_ID: Record<OpeningKind, string> = {
  door: "door-80",
  window: "win-130x140",
  passage: "pass-90",
  balcony: "balc-70-130",
  furniture: "furn-kitchen",
};

const ALL_PRESETS: OpeningPreset[] = Object.values(PRESETS_BY_KIND).flat();

export function getPreset(id: string | null | undefined): OpeningPreset | undefined {
  if (!id) return undefined;
  return ALL_PRESETS.find((p) => p.id === id);
}

export function getPresets(kind: OpeningKind): OpeningPreset[] {
  return PRESETS_BY_KIND[kind];
}

function baseDefaults(kind: OpeningKind): Omit<Opening, "id" | "wallId" | "offset"> {
  return {
    kind,
    width: 0.9,
    height: 2.1,
    elevation: 0,
    presetId: null,
    casing: kind === "door" ? DEFAULT_CASING : 0,
    hinge: "left",
    swing: "in",
    leaves: 1,
    wrapReveals: kind === "passage",
    arch: false,
    balconyDoorWidth: 0.7,
    balconyDoorSide: "left",
    balconySillHeight: 0.8,
    depth: kind === "furniture" ? 0.6 : 0,
    label: "",
  };
}

/** Применяет размеры пресета, сохраняя положение левого края. */
export function applyPreset(opening: Opening, presetId: string): Opening {
  const p = getPreset(presetId);
  if (!p || p.kind !== opening.kind) return opening;
  const next: Opening = {
    ...opening,
    width: p.width,
    height: p.height,
    elevation: p.elevation,
    presetId: p.id,
  };
  // Сбрасываем специфичные для пресета поля к дефолтам вида, затем extra.
  const d = baseDefaults(opening.kind);
  if (opening.kind === "door") next.leaves = 1;
  if (opening.kind === "passage") next.arch = false;
  if (opening.kind === "balcony") next.balconyDoorWidth = d.balconyDoorWidth;
  if (opening.kind === "furniture") {
    next.depth = d.depth;
  }
  return { ...next, ...(p.extra ?? {}) };
}

/**
 * Новый проём вида `kind` со стандартным размером (presetId или дефолт вида).
 * offset — левый край; roomEdit сам проверит, что проём помещается в стену.
 */
export function createOpening(
  kind: OpeningKind,
  wallId: string,
  offset = 0,
  presetId: string = DEFAULT_PRESET_ID[kind],
): Opening {
  const base: Opening = {
    id: createId("op"),
    wallId,
    offset,
    ...baseDefaults(kind),
  };
  return applyPreset(base, presetId);
}

/** Смена вида с сохранением центра проёма; размер — стандартный для нового вида. */
export function changeKind(opening: Opening, kind: OpeningKind): Opening {
  if (opening.kind === kind) return opening;
  const center = opening.offset + opening.width / 2;
  const fresh = createOpening(kind, opening.wallId, 0);
  return {
    ...fresh,
    id: opening.id,
    offset: Math.max(0, center - fresh.width / 2),
  };
}

/** Выступ наличника на стену с каждой стороны, м. */
export function casingExtension(o: Opening): number {
  if (o.casing <= 0) return 0;
  if (o.kind !== "door" && o.kind !== "passage") return 0;
  return Math.max(0, o.casing - CASING_INSET);
}

export interface Interval {
  from: number;
  to: number;
}

/**
 * Участок стены, который проём занимает визуально (вместе с наличниками).
 * Используется для проверки пересечений и ограничения перетаскивания.
 */
export function footprint(o: Opening): Interval {
  const ext = casingExtension(o);
  return { from: o.offset - ext, to: o.offset + o.width + ext };
}

/** Окно считается «в пол», если подоконник ниже верха плинтуса. */
export function isFloorLevelWindow(o: Opening, skirtingHeight: number): boolean {
  return o.kind === "window" && o.elevation < skirtingHeight + 0.005;
}

/**
 * Участок вдоль стены, где плинтуса НЕТ из-за этого проёма, или null.
 * Значения не обрезаются по длине стены — это делает расчёт.
 */
export function skirtingBlock(o: Opening, skirtingHeight: number): Interval | null {
  switch (o.kind) {
    case "door":
    case "passage": {
      const ext = casingExtension(o);
      return { from: o.offset - ext, to: o.offset + o.width + ext };
    }
    case "window":
      return isFloorLevelWindow(o, skirtingHeight)
        ? { from: o.offset, to: o.offset + o.width }
        : null;
    case "balcony": {
      if (o.balconySillHeight < skirtingHeight + 0.005) {
        return { from: o.offset, to: o.offset + o.width };
      }
      const dw = Math.min(o.balconyDoorWidth, o.width);
      return o.balconyDoorSide === "left"
        ? { from: o.offset, to: o.offset + dw }
        : { from: o.offset + o.width - dw, to: o.offset + o.width };
    }
    case "furniture":
      return { from: o.offset, to: o.offset + o.width };
  }
}

export function affectsSkirting(o: Opening, skirtingHeight: number): boolean {
  return skirtingBlock(o, skirtingHeight) !== null;
}

/** Плинтус заводится в откосы этого проёма. */
export function wrapsReveals(o: Opening): boolean {
  return o.kind === "passage" && o.wrapReveals && o.casing <= 0;
}

/** Площадь проёма, вычитаемая из площади стен (покраска/обои), м². */
export function openingWallArea(o: Opening): number {
  switch (o.kind) {
    case "door":
    case "window":
      return o.width * o.height;
    case "passage":
      // Арка: прямоугольник + полукруг сверху уже входит в height; уменьшаем
      // на «уголки» над полукругом: (1 − π/4)·w²/4.
      return o.arch
        ? o.width * o.height - (1 - Math.PI / 4) * (o.width * o.width) / 4
        : o.width * o.height;
    case "balcony": {
      const dw = Math.min(o.balconyDoorWidth, o.width);
      const ww = o.width - dw;
      return dw * o.height + ww * Math.max(0, o.height - o.balconySillHeight);
    }
    case "furniture":
      return 0;
  }
}

/** Ширина полотна двери (визуал). */
export function doorLeafWidth(o: Opening): number {
  return Math.max(0.2, o.width - 2 * DOOR_FRAME);
}

/** Число створок окна (визуал) по ширине. */
export function windowSashCount(width: number): number {
  if (width < 0.95) return 1;
  if (width < 1.75) return 2;
  return 3;
}

/** «Дверь 87×207 см» */
export function describeOpening(o: Opening): string {
  const name =
    o.kind === "furniture" && o.label ? o.label : OPENING_KIND_META[o.kind].name;
  const w = Math.round(o.width * 100);
  const h = Math.round(o.height * 100);
  return `${name} ${w}×${h} см`;
}
