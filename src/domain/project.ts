/**
 * Проект: фабрики, демо-проект, копирование комнат и защитная миграция
 * данных из localStorage / ссылки (любой JSON → валидный Project или null).
 */
import { clamp, getWalls } from "./geometry";
import { createId } from "./ids";
import { createOpening, getPreset } from "./openings";
import {
  MAX_ROOM_OPENINGS,
  MAX_ROOM_POINTS,
  clampOpenings,
  isValidPolygon,
  normalizeRoom,
} from "./roomEdit";
import { buildTemplatePoints, getTemplate } from "./roomTemplates";
import { DEFAULT_PRODUCT_ID, getCatalogProduct } from "./skirtingCatalog";
import type {
  AccessoryPrices,
  Appearance,
  CornerMethod,
  FloorPattern,
  Opening,
  OpeningKind,
  Point,
  ProductOverride,
  Project,
  Room,
  RoomShapeId,
  SkirtingSettings,
} from "./types";

export const SCHEMA_VERSION = 1;
export const DEFAULT_ROOM_HEIGHT = 2.7;
export const DEFAULT_WALL_THICKNESS = 0.15;
export const DEFAULT_PROJECT_NAME = "Мой проект";

/** Допустимые диапазоны параметров комнаты, м. */
export const ROOM_HEIGHT_RANGE = { min: 1.8, max: 10 } as const;
export const WALL_THICKNESS_RANGE = { min: 0.02, max: 1 } as const;

/** Длина пользовательских названий (проект, комната, подписи). */
export const MAX_NAME_LENGTH = 120;
/** Предел числа комнат в проекте (данные из ссылок — недоверенные). */
export const MAX_PROJECT_ROOMS = 100;

export function defaultSkirtingSettings(): SkirtingSettings {
  return {
    productId: DEFAULT_PRODUCT_ID,
    reservePct: 5,
    minPiece: 0.3,
    kerf: 0.003,
    shareOffcuts: true,
  };
}

export function defaultAppearance(): Appearance {
  return { wallColor: "#e9e4da", floorPattern: "deck", floorTint: "#c89567" };
}

export function createRoom(
  opts: {
    name?: string;
    shape?: RoomShapeId;
    params?: Partial<Record<string, number>>;
    height?: number;
    wallThickness?: number;
  } = {},
): Room {
  const shape = opts.shape && getTemplate(opts.shape) ? opts.shape : "rect";
  return {
    id: createId("room"),
    name: opts.name ?? "Комната",
    points: buildTemplatePoints(shape, opts.params),
    height: opts.height ?? DEFAULT_ROOM_HEIGHT,
    wallThickness: opts.wallThickness ?? DEFAULT_WALL_THICKNESS,
    openings: [],
    shape,
    skirtingEnabled: true,
    productId: null,
  };
}

export function createProject(opts: { name?: string } = {}): Project {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("prj"),
    name: opts.name ?? DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    rooms: [createRoom({ name: "Комната 1" })],
    skirting: defaultSkirtingSettings(),
    productOverrides: {},
    appearance: defaultAppearance(),
  };
}

/**
 * Демо для первого запуска: гостиная 4,5×3,6 м, дверь 80 на стене C ближе
 * к углу (петли со стороны угла) и двустворчатое окно по центру стены A.
 */
export function createDemoProject(): Project {
  const project = createProject({ name: "Моя квартира" });
  const room = createRoom({ name: "Гостиная", params: { length: 4.5, width: 3.6 } });
  const [wallA, , wallC] = getWalls(room);
  const win = createOpening("window", wallA.id, 0, "win-130x140");
  win.offset = Math.round(((wallA.length - win.width) / 2) * 1000) / 1000;
  const door = createOpening("door", wallC.id, 0, "door-80");
  door.offset = Math.round((wallC.length - door.width - 0.25) * 1000) / 1000;
  door.hinge = "right";
  return { ...project, rooms: [clampOpenings({ ...room, openings: [win, door] })] };
}

/** Копия комнаты с новыми id комнаты, точек и проёмов. */
export function cloneRoom(room: Room, name?: string): Room {
  const ids = new Map(room.points.map((p) => [p.id, createId("pt")]));
  return {
    ...room,
    id: createId("room"),
    name: name ?? `${room.name} (копия)`,
    points: room.points.map((p) => ({ ...p, id: ids.get(p.id)! })),
    openings: room.openings
      .filter((o) => ids.has(o.wallId))
      .map((o) => ({ ...o, id: createId("op"), wallId: ids.get(o.wallId)! })),
  };
}

/* ----------------------------- Миграция ----------------------------- */

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const HEX_RE = /^#[0-9a-f]{6}$/i;

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  isNum(v) ? clamp(v, min, max) : fallback;
const str = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v.slice(0, MAX_NAME_LENGTH) : fallback;
/** Название: пустое или из одних пробелов заменяем дефолтом. */
const name = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() ? v.slice(0, MAX_NAME_LENGTH) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const color = (v: unknown, fallback: string): string =>
  typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : fallback;
/** id плинтуса из каталога; неизвестный расчёт всё равно подменил бы плинтусом по умолчанию. */
const productIdOr = <T extends string | null>(v: unknown, fallback: T): string | T =>
  typeof v === "string" && getCatalogProduct(v) ? v : fallback;

const OPENING_KINDS: readonly OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];
const SHAPES: readonly RoomShapeId[] = ["rect", "L", "U", "T", "corner-box", "bay", "trapezoid", "custom"];
const FLOOR_PATTERNS: readonly FloorPattern[] = ["deck", "herringbone", "tile", "plain"];
const CORNER_METHODS: readonly CornerMethod[] = ["fittings", "miter"];
const PRICE_KEYS: ReadonlyArray<keyof AccessoryPrices> = [
  "innerCorner",
  "outerCorner",
  "endCap",
  "connector",
  "fastener",
  "glue",
];

function migratePoints(raw: unknown): Point[] | null {
  // Сверх предела комната всё равно невалидна, а проверка квадратична — отсекаем сразу.
  if (!Array.isArray(raw) || raw.length > MAX_ROOM_POINTS) return null;
  const seen = new Set<string>();
  const points: Point[] = [];
  for (const p of raw) {
    if (!isRecord(p) || !isNum(p.x) || !isNum(p.y)) return null;
    // id точки = id стены; дубликаты сломали бы стены — выдаём новый.
    const id = typeof p.id === "string" && p.id && !seen.has(p.id) ? p.id : createId("pt");
    seen.add(id);
    const point: Point = { id, x: p.x, y: p.y };
    if (isNum(p.thickness)) {
      point.thickness = clamp(p.thickness, WALL_THICKNESS_RANGE.min, WALL_THICKNESS_RANGE.max);
    }
    points.push(point);
  }
  return points.length >= 3 ? points : null;
}

function migrateOpening(raw: unknown, wallIds: Set<string>): Opening | null {
  if (!isRecord(raw) || !OPENING_KINDS.includes(raw.kind as OpeningKind)) return null;
  if (typeof raw.wallId !== "string" || !wallIds.has(raw.wallId)) return null;
  const kind = raw.kind as OpeningKind;
  // Пресет — только существующий и того же вида.
  const presetId =
    typeof raw.presetId === "string" && getPreset(raw.presetId)?.kind === kind ? raw.presetId : null;
  // Дефолты вида (и пресета) + валидные поля из JSON.
  const d = createOpening(kind, raw.wallId, 0, presetId ?? undefined);
  return {
    ...d,
    id: typeof raw.id === "string" && raw.id ? raw.id : d.id,
    offset: num(raw.offset, 0, 0),
    width: num(raw.width, d.width, 0.05, 50),
    height: num(raw.height, d.height, 0.05, 20),
    elevation: num(raw.elevation, d.elevation, 0, 20),
    presetId,
    casing: num(raw.casing, d.casing, 0, 0.5),
    hinge: oneOf(raw.hinge, ["left", "right"] as const, d.hinge),
    swing: oneOf(raw.swing, ["in", "out"] as const, d.swing),
    leaves: oneOf(raw.leaves, [1, 2] as const, d.leaves),
    wrapReveals: bool(raw.wrapReveals, d.wrapReveals),
    arch: bool(raw.arch, d.arch),
    balconyDoorWidth: num(raw.balconyDoorWidth, d.balconyDoorWidth, 0, 50),
    balconyDoorSide: oneOf(raw.balconyDoorSide, ["left", "right"] as const, d.balconyDoorSide),
    balconySillHeight: num(raw.balconySillHeight, d.balconySillHeight, 0, 20),
    depth: num(raw.depth, d.depth, 0, 10),
    label: str(raw.label, d.label),
  };
}

function migrateRoom(raw: unknown, index: number): Room | null {
  if (!isRecord(raw)) return null;
  const points = migratePoints(raw.points);
  if (!points) return null;
  const wallIds = new Set(points.map((p) => p.id));
  const openingIds = new Set<string>();
  const openings: Opening[] = [];
  for (const o of Array.isArray(raw.openings) ? raw.openings : []) {
    if (openings.length >= MAX_ROOM_OPENINGS) break;
    const m = migrateOpening(o, wallIds);
    if (!m) continue;
    if (openingIds.has(m.id)) m.id = createId("op");
    openingIds.add(m.id);
    openings.push(m);
  }
  const room = normalizeRoom({
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("room"),
    name: name(raw.name, `Комната ${index + 1}`),
    points,
    height: num(raw.height, DEFAULT_ROOM_HEIGHT, ROOM_HEIGHT_RANGE.min, ROOM_HEIGHT_RANGE.max),
    wallThickness: num(raw.wallThickness, DEFAULT_WALL_THICKNESS, WALL_THICKNESS_RANGE.min, WALL_THICKNESS_RANGE.max),
    openings,
    shape: oneOf(raw.shape, SHAPES, "custom"),
    skirtingEnabled: bool(raw.skirtingEnabled, true),
    productId: productIdOr(raw.productId, null),
  });
  return isValidPolygon(room.points) ? room : null;
}

function migrateSkirting(raw: unknown): SkirtingSettings {
  const d = defaultSkirtingSettings();
  if (!isRecord(raw)) return d;
  return {
    productId: productIdOr(raw.productId, d.productId),
    reservePct: num(raw.reservePct, d.reservePct, 0, 100),
    minPiece: num(raw.minPiece, d.minPiece, 0, 5),
    kerf: num(raw.kerf, d.kerf, 0, 0.05),
    shareOffcuts: bool(raw.shareOffcuts, d.shareOffcuts),
  };
}

function migrateOverride(raw: unknown, base: AccessoryPrices): ProductOverride | null {
  if (!isRecord(raw)) return null;
  const o: ProductOverride = {};
  for (const key of ["length", "height", "depth", "fastenerStep", "glueRate", "price"] as const) {
    const v = raw[key];
    if (isNum(v) && v >= 0) o[key] = v;
  }
  if (typeof raw.color === "string" && HEX_RE.test(raw.color)) o.color = raw.color.toLowerCase();
  if (typeof raw.name === "string" && raw.name.trim()) o.name = raw.name.slice(0, MAX_NAME_LENGTH);
  if (CORNER_METHODS.includes(raw.cornerMethod as CornerMethod)) o.cornerMethod = raw.cornerMethod as CornerMethod;
  if (isRecord(raw.prices)) {
    const src = raw.prices;
    // Недостающие цены — из каталога.
    const prices = { ...base };
    for (const k of PRICE_KEYS) {
      const v = src[k];
      if (isNum(v) && v >= 0) prices[k] = v;
    }
    if (PRICE_KEYS.some((k) => prices[k] !== base[k])) o.prices = prices;
  }
  return Object.keys(o).length ? o : null;
}

function migrateAppearance(raw: unknown): Appearance {
  const d = defaultAppearance();
  if (!isRecord(raw)) return d;
  return {
    wallColor: color(raw.wallColor, d.wallColor),
    floorPattern: oneOf(raw.floorPattern, FLOOR_PATTERNS, d.floorPattern),
    floorTint: color(raw.floorTint, d.floorTint),
  };
}

/**
 * Защитная валидация JSON (localStorage/URL): недостающие поля — дефолты,
 * мусор отбрасывается, комнаты нормализуются; комнаты с невалидной
 * геометрией удаляются. null — если это вообще не проект.
 */
export function migrateProject(raw: unknown): Project | null {
  if (!isRecord(raw) || !Array.isArray(raw.rooms)) return null;
  const now = Date.now();
  const roomIds = new Set<string>();
  const rooms: Room[] = [];
  raw.rooms.slice(0, MAX_PROJECT_ROOMS).forEach((r, i) => {
    const room = migrateRoom(r, i);
    if (!room) return;
    rooms.push(roomIds.has(room.id) ? { ...room, id: createId("room") } : room);
    roomIds.add(room.id);
  });
  if (!rooms.length) rooms.push(createRoom({ name: "Комната 1" }));

  const productOverrides: Record<string, ProductOverride> = {};
  if (isRecord(raw.productOverrides)) {
    for (const [id, o] of Object.entries(raw.productOverrides)) {
      // Правки неизвестных продуктов не применимы — отбрасываем.
      const product = getCatalogProduct(id);
      const m = product ? migrateOverride(o, product.prices) : null;
      if (m) productOverrides[id] = m;
    }
  }
  const createdAt = num(raw.createdAt, now, 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof raw.id === "string" && raw.id ? raw.id : createId("prj"),
    name: name(raw.name, DEFAULT_PROJECT_NAME),
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt, 0),
    rooms,
    skirting: migrateSkirting(raw.skirting),
    productOverrides,
    appearance: migrateAppearance(raw.appearance),
  };
}
