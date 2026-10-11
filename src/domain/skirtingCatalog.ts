/**
 * Каталог плинтусов: типовые изделия рынка РФ (2025–2026) с реалистичными
 * размерами, фурнитурой, крепежом и примерными ценами. Пользователь правит
 * цены/длину/цвет через ProductOverride — см. resolveProduct().
 *
 * Профиль сечения — в ММ, точки [d, h]: d — от стены в комнату, h — от пола.
 * Многоугольник замкнут неявно, обход против часовой в осях (d вправо, h вверх),
 * первая точка (0, 0) — у стены на полу. max h = height·1000, max d = depth·1000.
 */
import type {
  AccessoryPrices,
  ProductOverride,
  SkirtingMaterial,
  SkirtingProduct,
} from "./types";

export const DEFAULT_PRODUCT_ID = "pvc-55";
export const CUSTOM_PRODUCT_ID = "custom";

/** Дюбель для клипс: отдельной цены в AccessoryPrices нет — берём типовую. */
export const CLIP_DOWEL_NAME = "Дюбель-гвоздь для клипс 6×40";
export const CLIP_DOWEL_PRICE = 3;

/** Плиточный клей продаётся мешками; prices.glue у керамики — цена 1 кг. */
export const ADHESIVE_BAG_KG = 5;

/**
 * Расходники без своей цены в AccessoryPrices — типовые цены (как у дюбеля
 * для клипс). Количество считает estimate.ts.
 */
export const GROUT = {
  name: "Затирка для швов (упаковка 2 кг)",
  price: 300,
  /** кг на пог. м плинтуса: швы между элементами и стык с полом. */
  kgPerMeter: 0.1,
  packKg: 2,
} as const;
export const SANITARY_SEALANT = {
  name: "Герметик силиконовый санитарный (туба 280 мл)",
  price: 350,
  /** пог. м шва на тубу. */
  metersPerTube: 12,
} as const;
export const JOINT_GLUE = {
  name: "Клей для стыков и запилов (туба 290 мл)",
  price: 450,
  /** Стыков и углов на тубу. */
  jointsPerTube: 15,
} as const;
export const ACRYLIC_SEALANT = {
  name: "Герметик акриловый под покраску (туба 310 мл)",
  price: 250,
  /** пог. м шва на тубу. */
  metersPerTube: 15,
} as const;

export const MATERIAL_META: Record<
  SkirtingMaterial,
  { name: string; short: string; description: string }
> = {
  pvc: {
    name: "ПВХ (пластик)",
    short: "ПВХ",
    description:
      "Недорогой и влагостойкий, провода прячутся в кабель-канал. Углы и торцы закрываются готовой фурнитурой.",
  },
  mdf: {
    name: "МДФ",
    short: "МДФ",
    description:
      "Плотная древесная плита в плёнке или под покраску. Выглядит дороже пластика, но боится воды.",
  },
  wood: {
    name: "Массив дерева",
    short: "Дерево",
    description:
      "Натуральный материал: можно шлифовать, тонировать и красить. Углы запиливаются под 45°.",
  },
  polyurethane: {
    name: "Полиуретан и дюрополимер",
    short: "Полимер",
    description:
      "Лёгкая лепнина под покраску: не гниёт, не боится влаги, клеится на монтажный клей.",
  },
  aluminum: {
    name: "Алюминий",
    short: "Алюминий",
    description:
      "Прочный металлический профиль для современных интерьеров, офисов и влажных зон.",
  },
  shadow: {
    name: "Теневой профиль",
    short: "Теневой",
    description:
      "Скрытый плинтус заподлицо со стеной. Ставится до шпаклёвки — планировать нужно заранее.",
  },
  ceramic: {
    name: "Керамика",
    short: "Керамика",
    description:
      "Плиточный плинтус для санузла, кухни и прихожей: моется и не боится воды.",
  },
};

const NO_ACCESSORIES: AccessoryPrices = {
  innerCorner: 0,
  outerCorner: 0,
  endCap: 0,
  connector: 0,
  fastener: 0,
  glue: 0,
};

const CATALOG: SkirtingProduct[] = [
  {
    id: "pvc-55",
    name: "Плинтус ПВХ 55 мм с кабель-каналом",
    shortName: "ПВХ 55",
    material: "pvc",
    description:
      "Самый популярный вариант: недорогой, влагостойкий, провода прячутся в кабель-канал. Углы и торцы — готовая фурнитура.",
    lengths: [2.5, 2.2, 3.0],
    length: 2.5,
    height: 0.055,
    depth: 0.022,
    profile: [
      [0, 0], [19, 0], [22, 3], [22, 28], [20.5, 30], [20.5, 34],
      [19.5, 41], [17, 47], [13.5, 51.5], [8, 54.5], [0, 55],
    ],
    colors: [
      { name: "Белый", hex: "#f5f5f2" },
      { name: "Дуб светлый", hex: "#cfae84" },
      { name: "Дуб серый", hex: "#9c958c" },
      { name: "Орех", hex: "#7b5638" },
      { name: "Венге", hex: "#3e2c23" },
      { name: "Серый", hex: "#8e8f8c" },
      { name: "Чёрный", hex: "#2a2a2a" },
    ],
    color: "#f5f5f2",
    cornerMethods: ["fittings", "miter"],
    cornerMethod: "fittings",
    handedEndCaps: true,
    fastening: "dowels",
    fastenerStep: 0.5,
    fastenerName: "Дюбель-гвоздь 6×40",
    glueRate: 0,
    price: 200,
    prices: { innerCorner: 45, outerCorner: 45, endCap: 35, connector: 35, fastener: 3, glue: 0 },
    paintable: false,
    cableChannel: true,
  },
  {
    id: "pvc-85",
    name: "Плинтус ПВХ 85 мм с кабель-каналом",
    shortName: "ПВХ 85",
    material: "pvc",
    description:
      "Высокий пластиковый плинтус для просторных комнат и высоких потолков. Вмещает больше кабелей.",
    lengths: [2.5, 2.2],
    length: 2.5,
    height: 0.085,
    depth: 0.023,
    profile: [
      [0, 0], [20, 0], [23, 3], [23, 52], [21.5, 54], [21.5, 58],
      [20.5, 67], [18, 75], [14, 80.5], [8, 84], [0, 85],
    ],
    colors: [
      { name: "Белый", hex: "#f5f5f2" },
      { name: "Дуб белёный", hex: "#e3d8c6" },
      { name: "Дуб натуральный", hex: "#b98c5a" },
      { name: "Ясень серый", hex: "#a7a29b" },
      { name: "Венге", hex: "#3e2c23" },
      { name: "Антрацит", hex: "#3b3d40" },
    ],
    color: "#f5f5f2",
    cornerMethods: ["fittings", "miter"],
    cornerMethod: "fittings",
    handedEndCaps: true,
    fastening: "dowels",
    fastenerStep: 0.5,
    fastenerName: "Дюбель-гвоздь 6×40",
    glueRate: 0,
    price: 330,
    prices: { innerCorner: 65, outerCorner: 65, endCap: 50, connector: 50, fastener: 3, glue: 0 },
    paintable: false,
    cableChannel: true,
  },
  {
    id: "mdf-80",
    name: "Плинтус МДФ 80 мм ламинированный",
    shortName: "МДФ 80",
    material: "mdf",
    description:
      "Ламинированный МДФ под цвет двери или пола — выглядит богаче пластика. Крепится на скрытые клипсы.",
    lengths: [2.4, 2.07, 2.8],
    length: 2.4,
    height: 0.08,
    depth: 0.016,
    profile: [
      [0, 0], [16, 0], [16, 64], [15, 69], [13, 73.5], [10, 77], [6, 79.3], [0, 80],
    ],
    colors: [
      { name: "Дуб светлый", hex: "#d2b48c" },
      { name: "Дуб натуральный", hex: "#b5895a" },
      { name: "Орех", hex: "#6f4a2f" },
      { name: "Венге", hex: "#3b2a21" },
      { name: "Белый", hex: "#f3f2ee" },
      { name: "Ясень серый", hex: "#9f9a93" },
    ],
    color: "#d2b48c",
    cornerMethods: ["fittings", "miter"],
    cornerMethod: "fittings",
    handedEndCaps: true,
    fastening: "clips",
    fastenerStep: 0.5,
    fastenerName: "Клипса для плинтуса МДФ",
    glueRate: 0,
    price: 550,
    prices: { innerCorner: 120, outerCorner: 120, endCap: 90, connector: 90, fastener: 10, glue: 0 },
    paintable: false,
    cableChannel: false,
  },
  {
    id: "mdf-100-paint",
    name: "Плинтус МДФ 100 мм под покраску",
    shortName: "МДФ 100",
    material: "mdf",
    description:
      "Высокий белый плинтус, красится в цвет стен или дверей. Углы запиливаются под 45°, монтаж на клей.",
    lengths: [2.4, 2.8],
    length: 2.4,
    height: 0.1,
    depth: 0.016,
    profile: [
      [0, 0], [16, 0], [16, 80], [14, 82], [14, 86], [12.5, 90.5],
      [10, 94.5], [6.5, 97.8], [0, 100],
    ],
    colors: [
      { name: "Белый грунт", hex: "#f4f4f0" },
      { name: "Слоновая кость", hex: "#eee5d1" },
      { name: "Светло-серый", hex: "#d3d3cf" },
      { name: "Графит", hex: "#4a4c50" },
    ],
    color: "#f4f4f0",
    cornerMethods: ["miter", "fittings"],
    cornerMethod: "miter",
    handedEndCaps: false,
    fastening: "glue",
    fastenerStep: 0.5,
    fastenerName: "Клей монтажный «жидкие гвозди» (туба 310 мл)",
    glueRate: 7,
    price: 750,
    prices: { innerCorner: 160, outerCorner: 160, endCap: 120, connector: 120, fastener: 0, glue: 450 },
    paintable: true,
    cableChannel: false,
  },
  {
    id: "wood-pine-45",
    name: "Плинтус деревянный 45 мм (сосна)",
    shortName: "Сосна 45",
    material: "wood",
    description:
      "Натуральная сосна: экологично, можно покрыть лаком, морилкой или краской. Углы — запил.",
    lengths: [2.5, 2.0, 3.0],
    length: 2.5,
    height: 0.045,
    depth: 0.02,
    profile: [
      [0, 0], [20, 0], [20, 6], [18.5, 7.5], [18.5, 15], [16.8, 23],
      [14, 30], [10.2, 36], [5.5, 41.2], [0, 45],
    ],
    colors: [
      { name: "Сосна натуральная", hex: "#e3c48f" },
      { name: "Сосна под лаком", hex: "#d1a15f" },
      { name: "Шлифованная под покраску", hex: "#ead8b5" },
      { name: "Морёная (орех)", hex: "#6e4b2e" },
    ],
    color: "#e3c48f",
    cornerMethods: ["miter"],
    cornerMethod: "miter",
    handedEndCaps: false,
    fastening: "nails",
    fastenerStep: 0.5,
    fastenerName: "Саморез с дюбелем 6×40 (или финишный гвоздь)",
    glueRate: 0,
    price: 250,
    prices: { ...NO_ACCESSORIES, fastener: 4 },
    paintable: true,
    cableChannel: false,
  },
  {
    id: "duropolymer-100",
    name: "Плинтус дюрополимерный 100 мм под покраску",
    shortName: "Дюрополимер 100",
    material: "polyurethane",
    description:
      "Твёрдый полимер под покраску: не боится влаги и ударов, идеально ровная геометрия. Монтаж на клей.",
    lengths: [2.0, 2.4],
    length: 2.0,
    height: 0.1,
    depth: 0.013,
    profile: [
      [0, 0], [13, 0], [13, 72], [11, 74], [11, 84], [9.6, 89],
      [7.5, 93.5], [4.8, 97.2], [0, 100],
    ],
    colors: [
      { name: "Белый грунт", hex: "#f4f4f0" },
      { name: "Слоновая кость", hex: "#eee5d1" },
      { name: "Светло-серый", hex: "#cfd0cc" },
      { name: "Графит", hex: "#45474b" },
      { name: "Чёрный", hex: "#222222" },
    ],
    color: "#f4f4f0",
    cornerMethods: ["miter"],
    cornerMethod: "miter",
    handedEndCaps: false,
    fastening: "glue",
    fastenerStep: 0.5,
    fastenerName: "Клей монтажный (туба 290 мл)",
    glueRate: 8,
    price: 900,
    prices: { ...NO_ACCESSORIES, glue: 550 },
    paintable: true,
    cableChannel: false,
  },
  {
    id: "polyurethane-120",
    name: "Плинтус полиуретановый 120 мм",
    shortName: "Полиуретан 120",
    material: "polyurethane",
    description:
      "Декоративная лепнина для классических интерьеров. Гибкий, повторяет неровности стен, красится.",
    lengths: [2.0],
    length: 2.0,
    height: 0.12,
    depth: 0.022,
    profile: [
      [0, 0], [22, 0], [22, 9], [19.5, 11.5], [19.5, 66], [17.5, 68],
      [17.5, 78], [15, 81], [15, 89], [12.5, 97], [9.5, 105], [6, 112],
      [2.5, 117.5], [0, 120],
    ],
    colors: [
      { name: "Белый", hex: "#f6f6f2" },
      { name: "Слоновая кость", hex: "#efe6d3" },
      { name: "Бежевый", hex: "#ddd0b5" },
      { name: "Светло-серый", hex: "#d2d2ce" },
    ],
    color: "#f6f6f2",
    cornerMethods: ["miter"],
    cornerMethod: "miter",
    handedEndCaps: false,
    fastening: "glue",
    fastenerStep: 0.5,
    fastenerName: "Клей монтажный для лепнины (туба 290 мл)",
    glueRate: 6,
    price: 1300,
    prices: { ...NO_ACCESSORIES, glue: 600 },
    paintable: true,
    cableChannel: false,
  },
  {
    id: "aluminum-60",
    name: "Плинтус алюминиевый 60 мм",
    shortName: "Алюминий 60",
    material: "aluminum",
    description:
      "Прочный металлический плинтус для современных интерьеров и коммерческих помещений. Не боится влаги.",
    lengths: [2.5, 3.0],
    length: 2.5,
    height: 0.06,
    depth: 0.01,
    profile: [
      [0, 0], [10, 0], [10, 57], [9.6, 58.5], [8.5, 59.6], [7, 60], [0, 60],
    ],
    colors: [
      { name: "Серебро (анодированный)", hex: "#c9cbcd" },
      { name: "Шампань", hex: "#d5c4a1" },
      { name: "Бронза", hex: "#8c6c4a" },
      { name: "Чёрный матовый", hex: "#222324" },
      { name: "Белый", hex: "#f2f2f0" },
      { name: "Нержавеющая сталь", hex: "#b3b6b9" },
    ],
    color: "#c9cbcd",
    cornerMethods: ["fittings"],
    cornerMethod: "fittings",
    handedEndCaps: false,
    fastening: "clips",
    fastenerStep: 0.4,
    fastenerName: "Клипса для алюминиевого плинтуса",
    glueRate: 0,
    price: 1100,
    prices: { innerCorner: 180, outerCorner: 180, endCap: 120, connector: 110, fastener: 15, glue: 0 },
    paintable: false,
    cableChannel: false,
  },
  {
    id: "shadow-alu",
    name: "Теневой плинтус 60 мм (алюминий)",
    shortName: "Теневой 60",
    material: "shadow",
    description:
      "Скрытый плинтус заподлицо со стеной — эффект «парящих» стен. Монтируется до шпаклёвки и покраски.",
    lengths: [2.5, 2.0, 3.0],
    length: 2.5,
    height: 0.06,
    depth: 0.006,
    // Видимая полка 50 мм + тонкая монтажная полка, уходящая под штукатурку.
    profile: [[0, 0], [6, 0], [6, 50], [2, 50], [2, 60], [0, 60]],
    colors: [
      { name: "Серебро (анодированный)", hex: "#c9cbcd" },
      { name: "Чёрный матовый", hex: "#222324" },
      { name: "Белый", hex: "#f2f2f0" },
      { name: "Грунт под покраску", hex: "#dcdcd7" },
    ],
    color: "#c9cbcd",
    cornerMethods: ["fittings", "miter"],
    cornerMethod: "fittings",
    handedEndCaps: false,
    fastening: "dowels",
    fastenerStep: 0.4,
    fastenerName: "Дюбель-гвоздь 6×40",
    glueRate: 0,
    price: 1600,
    prices: { innerCorner: 450, outerCorner: 450, endCap: 250, connector: 200, fastener: 3, glue: 0 },
    paintable: false,
    cableChannel: false,
  },
  {
    id: "ceramic-80",
    name: "Плинтус керамический 80 мм",
    shortName: "Керамика 80",
    material: "ceramic",
    description:
      "Плинтус из плитки для санузла, кухни и прихожей: моется, не боится воды. Клеится на плиточный клей.",
    lengths: [0.6, 0.3, 1.2],
    length: 0.6,
    height: 0.08,
    depth: 0.009,
    profile: [
      [0, 0], [9, 0], [9, 72], [8.6, 75], [7.5, 77.5], [5.6, 79.2], [3, 80], [0, 80],
    ],
    colors: [
      { name: "Белый глянец", hex: "#f2f1ec" },
      { name: "Бежевый", hex: "#dcc9a8" },
      { name: "Серый", hex: "#9c9b97" },
      { name: "Графит", hex: "#4c4c4e" },
      { name: "Терракота", hex: "#b4643c" },
      { name: "Под дерево", hex: "#a57b53" },
    ],
    color: "#f2f1ec",
    cornerMethods: ["miter"],
    cornerMethod: "miter",
    handedEndCaps: false,
    fastening: "adhesive",
    fastenerStep: 0.5,
    fastenerName: "Клей плиточный",
    glueRate: 0.4,
    price: 250,
    // ₽ за кг; в списке покупок — мешками по ADHESIVE_BAG_KG.
    prices: { ...NO_ACCESSORIES, glue: 60 },
    paintable: false,
    cableChannel: false,
  },
  {
    id: CUSTOM_PRODUCT_ID,
    name: "Свой плинтус",
    shortName: "Свой",
    material: "pvc",
    description:
      "Задайте свои параметры: длину планки, размеры, цены и способ стыковки углов.",
    lengths: [2.5, 2.0, 2.2, 2.4, 2.7, 3.0],
    length: 2.5,
    height: 0.06,
    depth: 0.015,
    profile: [[0, 0], [15, 0], [15, 52], [13.5, 56], [10, 59], [6, 60], [0, 60]],
    colors: [
      { name: "Белый", hex: "#f5f5f2" },
      { name: "Дуб светлый", hex: "#cfae84" },
      { name: "Серый", hex: "#8e8f8c" },
      { name: "Венге", hex: "#3e2c23" },
    ],
    color: "#f5f5f2",
    cornerMethods: ["fittings", "miter"],
    cornerMethod: "fittings",
    handedEndCaps: false,
    fastening: "dowels",
    fastenerStep: 0.5,
    fastenerName: "Дюбель-гвоздь 6×40",
    glueRate: 0,
    price: 300,
    prices: { innerCorner: 50, outerCorner: 50, endCap: 40, connector: 40, fastener: 3, glue: 450 },
    paintable: false,
    cableChannel: false,
  },
];

/** Глубокая заморозка: каталог — общий справочник, мутировать его нельзя. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Порядок = порядок показа в UI. */
export const SKIRTING_CATALOG: SkirtingProduct[] = deepFreeze(CATALOG);

const BY_ID = new Map(SKIRTING_CATALOG.map((p) => [p.id, p]));

export function getCatalogProduct(id: string): SkirtingProduct | undefined {
  return BY_ID.get(id);
}

/* ------------------------- Правки пользователя ------------------------ */

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Допустимые диапазоны правок (защита от мусора в localStorage/URL). */
const LIMITS = {
  length: [0.1, 12],
  height: [0.01, 0.5],
  depth: [0.002, 0.1],
  fastenerStep: [0.05, 5],
  glueRate: [0.01, 100],
} as const;

function inRange(v: unknown, [min, max]: readonly [number, number]): v is number {
  return isNum(v) && v >= min && v <= max;
}

function mergePrices(base: AccessoryPrices, patch: Partial<AccessoryPrices> | undefined): AccessoryPrices {
  if (!patch || typeof patch !== "object") return base;
  const out: AccessoryPrices = { ...base };
  for (const key of Object.keys(base) as Array<keyof AccessoryPrices>) {
    const v = patch[key];
    if (isNum(v) && v >= 0) out[key] = v;
  }
  return out;
}

/** Масштабирует профиль под новые высоту/глубину (мм, округление до 0,1). */
function scaleProfile(
  profile: Array<[number, number]>,
  kd: number,
  kh: number,
): Array<[number, number]> {
  const r = (v: number) => Math.round(v * 10) / 10;
  return profile.map(([d, h]) => [r(d * kd), r(h * kh)]);
}

/**
 * Цена планки длины length по цене погонного метра каталожной планки,
 * до рубля. Своя длина — своя цена: иначе длинная планка «дешевле», и
 * смета зависит от длины в разы (керамика 0,3 / 0,6 / 1,2 м).
 */
export function priceForLength(base: SkirtingProduct, length: number): number {
  if (!(length > 0) || Math.abs(length - base.length) < 1e-9) return base.price;
  return Math.round((base.price / base.length) * length);
}

/** ₽ за погонный метр (для подписи «550 ₽/шт · 229 ₽/м»). */
export function pricePerMeter(product: SkirtingProduct): number {
  return product.length > 0 ? product.price / product.length : 0;
}

/**
 * Каталог + правки пользователя (prices мёржатся поштучно). Неизвестный id → DEFAULT.
 * Некорректные значения правок игнорируются; при смене высоты/глубины
 * профиль сечения масштабируется, чтобы оставаться согласованным с размерами.
 * Цена планки без правки пересчитывается под выбранную длину (priceForLength);
 * правка цены — цена именно этой планки, её не трогаем.
 */
export function resolveProduct(
  productId: string,
  overrides: Record<string, ProductOverride>,
): SkirtingProduct {
  const base = getCatalogProduct(productId) ?? getCatalogProduct(DEFAULT_PRODUCT_ID)!;
  const o = overrides?.[base.id];
  if (!o || typeof o !== "object") return base;

  const next: SkirtingProduct = { ...base };
  if (inRange(o.length, LIMITS.length)) next.length = o.length;
  if (inRange(o.height, LIMITS.height)) next.height = o.height;
  if (inRange(o.depth, LIMITS.depth)) next.depth = o.depth;
  if (inRange(o.fastenerStep, LIMITS.fastenerStep)) next.fastenerStep = o.fastenerStep;
  if (inRange(o.glueRate, LIMITS.glueRate)) next.glueRate = o.glueRate;
  if (isNum(o.price) && o.price >= 0) next.price = o.price;
  else next.price = priceForLength(base, next.length);
  if (typeof o.color === "string" && HEX_RE.test(o.color)) next.color = o.color.toLowerCase();
  if (typeof o.name === "string" && o.name.trim()) next.name = o.name.trim();
  if (o.cornerMethod && base.cornerMethods.includes(o.cornerMethod)) {
    next.cornerMethod = o.cornerMethod;
  }
  next.prices = mergePrices(base.prices, o.prices);
  if (next.height !== base.height || next.depth !== base.depth) {
    next.profile = scaleProfile(base.profile, next.depth / base.depth, next.height / base.height);
  }
  return next;
}

/* ------------------------------ Хелперы ------------------------------ */

/** Название цвета продукта по hex (по умолчанию — выбранного). */
export function getColorName(product: SkirtingProduct, hex: string = product.color): string {
  const h = hex.toLowerCase();
  return product.colors.find((c) => c.hex.toLowerCase() === h)?.name ?? `цвет ${hex}`;
}

/** Доступные длины планки + текущая (если пользователь задал свою). */
export function getProductLengths(product: SkirtingProduct): number[] {
  return product.lengths.includes(product.length)
    ? [...product.lengths]
    : [...product.lengths, product.length];
}

/** Продукт уже отредактирован пользователем. */
export function hasOverride(
  productId: string,
  overrides: Record<string, ProductOverride>,
): boolean {
  const o = overrides?.[productId];
  return !!o && Object.keys(o).length > 0;
}
