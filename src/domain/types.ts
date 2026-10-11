/**
 * Доменная модель сервиса замеров.
 *
 * Единицы: ВСЕ длины в доменном слое — метры (number). Деньги — рубли.
 * Перевод в см/мм — только в UI (см. units.ts).
 *
 * Система координат плана: x → вправо (восток), y → вниз (юг), как в SVG.
 * В 3D план (x, y) отображается в мир (x, 0, y): ось Y мира смотрит вверх.
 *
 * Ориентация многоугольника комнаты — каноническая: площадь по формуле
 * шнуровки (signedArea) > 0. На экране (y вниз) такой обход идёт ПО часовой
 * стрелке. Для стены с направлением d = (dx, dy) внутренняя нормаль
 * (в комнату) равна (-dy, dx), внешняя — (dy, -dx).
 *
 * Если встать внутри комнаты лицом к стене, направление стены (от её начала
 * к концу) указывает ВПРАВО. Поэтому `Opening.offset` — это расстояние от
 * ЛЕВОГО (если смотреть изнутри) угла стены до левого края проёма.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Вершина многоугольника комнаты (по внутренней грани стен). */
export interface Point extends Vec2 {
  id: string;
  /**
   * Толщина стены, которая НАЧИНАЕТСЯ в этой точке (идёт к следующей), м.
   * undefined → используется Room.wallThickness.
   */
  thickness?: number;
}

export type OpeningKind = "door" | "window" | "passage" | "balcony" | "furniture";

/**
 * Проём / объект на стене. Все поля обязательны — фабрика createOpening()
 * (domain/openings.ts) заполняет дефолты для каждого вида, поэтому код
 * не должен проверять undefined.
 */
export interface Opening {
  id: string;
  kind: OpeningKind;
  /** id стены = id точки, с которой стена начинается. */
  wallId: string;
  /** м, от начала стены (левый угол, если смотреть изнутри) до левого края проёма. */
  offset: number;
  /** м, ширина проёма в стене в свету (для мебели — длина вдоль стены). */
  width: number;
  /** м, высота проёма (для мебели — высота мебели). */
  height: number;
  /** м, низ проёма над полом (подоконник окна). 0 для двери/проёма/балкона/мебели. */
  elevation: number;
  /** id стандартного размера из пресетов; null — свой размер. */
  presetId: string | null;

  /**
   * м, ширина наличника (0 — без наличника). Используется дверью и проёмом
   * («портал» с наличниками). Наличник перекрывает проём на CASING_INSET и
   * выступает на стену на (casing − CASING_INSET) с каждой стороны — плинтус
   * упирается в наличник.
   */
  casing: number;
  /** Сторона петель двери, если смотреть изнутри комнаты. */
  hinge: "left" | "right";
  /** in — дверь открывается в комнату, out — из комнаты. */
  swing: "in" | "out";
  /** Число створок двери. */
  leaves: 1 | 2;

  /** Проём без двери: плинтус огибает откосы (+2 × толщина стены). */
  wrapReveals: boolean;
  /** Проём без двери: арка (только визуал). */
  arch: boolean;

  /** Балконный блок: ширина дверной части, м (≤ width). */
  balconyDoorWidth: number;
  /** Балконный блок: с какой стороны дверь (если смотреть изнутри). */
  balconyDoorSide: "left" | "right";
  /** Балконный блок: высота подоконника оконной части, м. */
  balconySillHeight: number;

  /** Мебель: глубина, м. */
  depth: number;
  /** Пользовательская подпись (например «Кухонный гарнитур»). */
  label: string;
}

export type RoomShapeId =
  | "rect"
  | "L"
  | "U"
  | "T"
  | "corner-box"
  | "bay"
  | "trapezoid"
  | "custom";

export interface Room {
  id: string;
  name: string;
  /** ≥ 3 точек, каноническая ориентация (signedArea > 0). */
  points: Point[];
  /** м, высота потолка. */
  height: number;
  /** м, толщина стен по умолчанию (визуал, откосы). */
  wallThickness: number;
  openings: Opening[];
  /** Шаблон, из которого создана комната (для UI), 'custom' после ручной правки. */
  shape: RoomShapeId;
  /** Учитывать комнату в расчёте плинтуса. */
  skirtingEnabled: boolean;
  /** Плинтус для этой комнаты; null — плинтус проекта по умолчанию. */
  productId: string | null;
}

/* ------------------------------------------------------------------ */
/* Плинтус                                                              */
/* ------------------------------------------------------------------ */

export type SkirtingMaterial =
  | "pvc"
  | "mdf"
  | "wood"
  | "polyurethane"
  | "aluminum"
  | "shadow"
  | "ceramic";

/** Как стыкуются углы: фурнитурой (уголки, заглушки) или запилом под 45°. */
export type CornerMethod = "fittings" | "miter";

export type FasteningKind =
  | "dowels" // дюбель-гвозди прямо через плинтус (ПВХ)
  | "clips" // клипсы + дюбели (МДФ, алюминий)
  | "nails" // гвозди/саморезы (дерево)
  | "glue" // монтажный клей (полиуретан, дюрополимер)
  | "adhesive"; // плиточный клей (керамика)

export interface AccessoryPrices {
  innerCorner: number;
  outerCorner: number;
  endCap: number;
  connector: number;
  /** цена 1 крепежа (дюбель/клипса/гвоздь) */
  fastener: number;
  /** цена 1 тубы клея / 1 кг плиточного клея */
  glue: number;
}

export interface SkirtingColor {
  name: string;
  hex: string;
}

export interface SkirtingProduct {
  id: string;
  /** Полное название: «ПВХ с кабель-каналом, 55 мм». */
  name: string;
  /** Короткое: «ПВХ 55». */
  shortName: string;
  material: SkirtingMaterial;
  /** 1–2 предложения: где применяется, плюсы. */
  description: string;
  /** Доступные длины планки, м (первая — типичная). */
  lengths: number[];
  /** Выбранная длина планки, м. */
  length: number;
  /** Высота, м. */
  height: number;
  /** Толщина (вылет от стены), м. */
  depth: number;
  /**
   * Сечение профиля: замкнутый многоугольник в ММ, точки [d, h]:
   * d — от стены (0) в комнату (0..depth·1000), h — от пола (0..height·1000).
   * Используется и для иконки, и для 3D-выдавливания.
   */
  profile: Array<[number, number]>;
  colors: SkirtingColor[];
  /** Выбранный цвет (hex). */
  color: string;
  cornerMethods: CornerMethod[];
  cornerMethod: CornerMethod;
  /** Заглушки бывают левые/правые (ПВХ) или универсальные. */
  handedEndCaps: boolean;
  fastening: FasteningKind;
  /** м между точками крепежа (для glue/adhesive — не используется). */
  fastenerStep: number;
  /** Название крепежа для списка покупок. */
  fastenerName: string;
  /** Для glue: пог. м на 1 тубу; для adhesive: кг на 1 пог. м. */
  glueRate: number;
  /** ₽ за 1 планку. */
  price: number;
  prices: AccessoryPrices;
  paintable: boolean;
  cableChannel: boolean;
}

/** Пользовательские правки продукта из каталога (храним только изменённое). */
export type ProductOverride = Partial<
  Pick<
    SkirtingProduct,
    | "length"
    | "height"
    | "depth"
    | "color"
    | "cornerMethod"
    | "fastenerStep"
    | "glueRate"
    | "price"
    | "prices"
    | "name"
  >
>;

export interface SkirtingSettings {
  /** Плинтус проекта по умолчанию. */
  productId: string;
  /** Запас на брак/ошибки, % (применяется к числу планок после раскроя). */
  reservePct: number;
  /** м, минимальная длина куска при наращивании длинной стены (эстетика). */
  minPiece: number;
  /** м, пропил (потери на рез). */
  kerf: number;
  /** Использовать обрезки из одной комнаты в другой. */
  shareOffcuts: boolean;
}

export type FloorPattern = "deck" | "herringbone" | "tile" | "plain";

export interface Appearance {
  wallColor: string;
  floorPattern: FloorPattern;
  floorTint: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  rooms: Room[];
  skirting: SkirtingSettings;
  productOverrides: Record<string, ProductOverride>;
  appearance: Appearance;
}

/* ------------------------------------------------------------------ */
/* Производные геометрические сущности (вычисляются в geometry.ts)      */
/* ------------------------------------------------------------------ */

export interface Wall {
  /** = id стартовой точки */
  id: string;
  index: number;
  /** Буквенная метка: A, B, C, … */
  label: string;
  /** Концы по внутренней грани. */
  a: Vec2;
  b: Vec2;
  length: number;
  /** Единичный вектор a → b. */
  dir: Vec2;
  /** Единичная нормаль в комнату. */
  normalIn: Vec2;
  /** Единичная нормаль наружу. */
  normalOut: Vec2;
  thickness: number;
  startPointId: string;
  endPointId: string;
  /** Концы по внешней грани (с учётом сопряжения в углах). */
  outerA: Vec2;
  outerB: Vec2;
}

export type CornerKind = "inner" | "outer" | "straight";

export interface Corner {
  /** Индекс точки. Угол между стеной index-1 и стеной index. */
  index: number;
  pointId: string;
  position: Vec2;
  kind: CornerKind;
  /** Внутренний угол комнаты, градусы (90 — обычный угол, 270 — выступ). */
  angle: number;
  prevWallIndex: number;
  nextWallIndex: number;
}
