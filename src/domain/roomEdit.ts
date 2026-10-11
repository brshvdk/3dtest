/**
 * Редактирование комнаты: стены, вершины, проёмы, шаблоны.
 *
 * Все функции чистые (Room → Room). Если операция ничего не меняет или дала
 * бы недопустимую геометрию (самопересечение, стена короче MIN_WALL,
 * вывернутая стена), возвращается ИСХОДНЫЙ объект — по ссылке, чтобы
 * вызывающий код (история правок) дёшево понял, что изменений нет.
 *
 * Привязка проёмов при изменении геометрии: offset отсчитывается от начала
 * стены, но если двигалось только начало стены (конец на месте), проём
 * сохраняет расстояние от конца — он остаётся на месте в плане, а не «едет»
 * вместе с соседней стеной.
 */
import {
  EPS,
  STRAIGHT_TOL_DEG,
  add,
  bbox,
  clamp,
  cornerAt,
  cross,
  distance,
  dot,
  getWall,
  getWalls,
  inwardNormal,
  lineIntersection,
  normalize,
  polygonArea,
  polygonSelfIntersects,
  projectToSegment,
  roundCoord,
  scale,
  signedArea,
  sub,
  toDeg,
  toRad,
  vecEquals,
  wallIndexOf,
} from "./geometry";
import { createId } from "./ids";
import {
  applyPreset,
  casingExtension,
  changeKind,
  createOpening,
  DEFAULT_PRESET_ID,
  footprint,
  getPreset,
  getPresets,
} from "./openings";
import { buildTemplatePoints } from "./roomTemplates";
import type { Opening, OpeningKind, Point, Room, RoomShapeId, Vec2, Wall } from "./types";

/** м, минимальная длина стены. */
export const MIN_WALL = 0.1;
/** м², минимальная площадь комнаты. */
export const MIN_ROOM_AREA = 0.5;
/**
 * Предел числа вершин комнаты. Проверка пересечений квадратична, а комнаты
 * приходят и из чужих ссылок — без предела ссылка с тысячами точек
 * «вешает» вкладку.
 */
export const MAX_ROOM_POINTS = 256;
/**
 * м, предел габарита комнаты (ширина и высота bbox). Защищает от опечаток
 * («4500» вместо «4,5») — стена в километры дала бы тысячи планок в раскрое.
 */
export const MAX_ROOM_EXTENT = 100;
/** м, координаты дальше от начала — мусор (теряется точность roundCoord). */
const MAX_COORD = 10_000;
/** Предел числа проёмов в комнате (данные из ссылок — недоверенные). */
export const MAX_ROOM_OPENINGS = 200;
/** м, предел ширины наличника. */
const MAX_CASING = 0.5;
/** м, минимальный зазор между несмежными стенами (иначе считаем касанием). */
const MIN_GAP = 0.01;
/** Градусы: углы острее считаем «шипом» (стена сложилась сама на себя). */
const MIN_CORNER_DEG = 5;
/** Синус допуска, при котором соседние стены считаются параллельными. */
const PARALLEL_SIN = Math.sin(toRad(STRAIGHT_TOL_DEG));
/** м, зазор между проёмами при автоматической расстановке. */
export const FREE_GAP = 0.05;
/** м, минимальная ширина проёма. */
export const MIN_OPENING_WIDTH = 0.05;
/** м, допустимые толщины стен. */
export const MIN_WALL_THICKNESS = 0.02;
export const MAX_WALL_THICKNESS = 1;
/** м, стены короче — «нулевые» (удаляются normalizeRoom). */
const ZERO_WALL = 1e-3;
/** м, мебель короче не ставим при подгонке ширины. */
const MIN_FURNITURE_WIDTH = 0.3;

/* ----------------------------- Проверки ----------------------------- */

const isParallel = (d1: Vec2, d2: Vec2): boolean => Math.abs(cross(d1, d2)) < PARALLEL_SIN;

const isSaneCoord = (v: number): boolean => Number.isFinite(v) && Math.abs(v) <= MAX_COORD;

/** Квадрат расстояния от точки до отрезка (без аллокаций: горячий цикл проверки). */
function pointSegmentDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1) : 0;
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  return dx * dx + dy * dy;
}

/**
 * Непересекающиеся отрезки ab и cd ближе gap. Для них расстояние между
 * отрезками — минимум расстояний от концов до другого отрезка.
 */
function segmentsCloserThan(a: Vec2, b: Vec2, c: Vec2, d: Vec2, gap: number): boolean {
  // Быстрый отказ по габаритам — большинство пар стен далеко друг от друга.
  if (
    Math.min(a.x, b.x) - Math.max(c.x, d.x) >= gap ||
    Math.min(c.x, d.x) - Math.max(a.x, b.x) >= gap ||
    Math.min(a.y, b.y) - Math.max(c.y, d.y) >= gap ||
    Math.min(c.y, d.y) - Math.max(a.y, b.y) >= gap
  ) {
    return false;
  }
  const g2 = gap * gap;
  return (
    pointSegmentDist2(a, c, d) < g2 ||
    pointSegmentDist2(b, c, d) < g2 ||
    pointSegmentDist2(c, a, b) < g2 ||
    pointSegmentDist2(d, a, b) < g2
  );
}

/**
 * Многоугольник пригоден как комната: 3…MAX_ROOM_POINTS точек, конечные
 * координаты, габарит ≤ MAX_ROOM_EXTENT, все стены ≥ MIN_WALL, площадь >
 * MIN_ROOM_AREA, нет самопересечений, касаний несмежных стен и «шипов»
 * (стена, сложенная обратно на соседнюю).
 * Ориентация не проверяется — её приводит normalizeRoom.
 */
export function isValidPolygon(points: readonly Vec2[]): boolean {
  const n = points.length;
  if (n < 3 || n > MAX_ROOM_POINTS) return false;
  if (!points.every((p) => isSaneCoord(p.x) && isSaneCoord(p.y))) return false;
  const box = bbox(points);
  if (box.width > MAX_ROOM_EXTENT || box.height > MAX_ROOM_EXTENT) return false;
  for (let i = 0; i < n; i++) {
    if (distance(points[i], points[(i + 1) % n]) < MIN_WALL - 1e-6) return false;
  }
  if (polygonArea(points) <= MIN_ROOM_AREA) return false;
  if (polygonSelfIntersects(points)) return false;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    // Несмежные стены не должны касаться друг друга.
    for (let j = i + 2; j < n; j++) {
      if ((j + 1) % n === i) continue;
      if (segmentsCloserThan(a, b, points[j], points[(j + 1) % n], MIN_GAP)) return false;
    }
    // Угол в вершине b между стенами i и i+1.
    const d1 = normalize(sub(b, a));
    const d2 = normalize(sub(points[(i + 2) % n], b));
    const turn = Math.abs(toDeg(Math.atan2(cross(d1, d2), dot(d1, d2))));
    if (turn > 180 - MIN_CORNER_DEG) return false;
  }
  return true;
}

/** Валидно и в канонической ориентации — условие для всех правок. */
const isValidRoomShape = (points: readonly Vec2[]): boolean =>
  isValidPolygon(points) && signedArea(points) > 0;

/* --------------------------- Вспомогательное -------------------------- */

/** roundCoord без «−0» (иначе в UI «−0,00», а JSON-копия не равна оригиналу). */
const roundPos = (v: number): number => roundCoord(v) || 0;
const roundPoint = <T extends Vec2>(p: T): T => ({ ...p, x: roundPos(p.x), y: roundPos(p.y) });

const wallDir = (pts: readonly Vec2[], i: number): Vec2 =>
  normalize(sub(pts[(i + 1) % pts.length], pts[i]));

/** Начало и конец стены с данным id в списке точек. */
function wallEnds(points: readonly Point[], wallId: string): [Vec2, Vec2] | null {
  const i = points.findIndex((p) => p.id === wallId);
  if (i < 0) return null;
  return [points[i], points[(i + 1) % points.length]];
}

/**
 * Перепривязывает проёмы к новой геометрии (id стен совпадают со старыми).
 * Если сдвинулось только начало стены — сохраняем расстояние от конца.
 */
function reanchorOpenings(before: Room, points: Point[]): Opening[] {
  return before.openings.map((o) => {
    const oldEnds = wallEnds(before.points, o.wallId);
    const newEnds = wallEnds(points, o.wallId);
    if (!oldEnds || !newEnds) return o;
    const startMoved = !vecEquals(oldEnds[0], newEnds[0], 1e-6);
    const endMoved = !vecEquals(oldEnds[1], newEnds[1], 1e-6);
    if (!startMoved || endMoved) return o;
    const delta = distance(newEnds[0], newEnds[1]) - distance(oldEnds[0], oldEnds[1]);
    return { ...o, offset: o.offset + delta };
  });
}

/** Стены, существующие до и после правки, не должны развернуться. */
function keepsDirections(before: readonly Point[], after: readonly Point[]): boolean {
  for (let i = 0; i < before.length; i++) {
    const j = after.findIndex((p) => p.id === before[i].id);
    if (j < 0) continue;
    if (dot(wallDir(before, i), wallDir(after, j)) <= 0) return false;
  }
  return true;
}

/** Собирает комнату с новыми точками: проверка, перепривязка и clamp проёмов. */
function withPoints(
  room: Room,
  points: Point[],
  opts: { keepDirections?: boolean; shape?: RoomShapeId } = {},
): Room {
  const rounded = points.map(roundPoint);
  if (!isValidRoomShape(rounded)) return room;
  if (opts.keepDirections && !keepsDirections(room.points, rounded)) return room;
  const next: Room = {
    ...room,
    points: rounded,
    openings: reanchorOpenings(room, rounded),
    shape: opts.shape ?? room.shape,
  };
  return clampOpenings(next);
}

/* --------------------------- Нормализация --------------------------- */

/**
 * Разворот обхода с сохранением стен: стена p_i→p_{i+1} становится
 * p_{i+1}→p_i, её id — id новой стартовой точки, толщина переезжает туда же,
 * offset проёмов отсчитывается от другого конца.
 */
function reverseRoom(room: Room): Room {
  const pts = room.points;
  const n = pts.length;
  const walls = getWalls(room);
  // id стены после разворота и её толщина
  const newWallId = new Map<string, string>();
  const thicknessByStart = new Map<string, number | undefined>();
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    newWallId.set(pts[i].id, next.id);
    thicknessByStart.set(next.id, pts[i].thickness);
  }
  // Первая точка остаётся первой: [p0, p_{n-1}, …, p1].
  const order = [pts[0], ...pts.slice(1).reverse()];
  const points: Point[] = order.map((p) => {
    const { thickness: _old, ...rest } = p;
    const t = thicknessByStart.get(p.id);
    return t === undefined ? rest : { ...rest, thickness: t };
  });
  const lengthById = new Map(walls.map((w) => [w.id, w.length]));
  const openings = room.openings.map((o) => {
    const L = lengthById.get(o.wallId);
    const wallId = newWallId.get(o.wallId);
    if (L === undefined || wallId === undefined) return o;
    return { ...o, wallId, offset: L - o.offset - o.width };
  });
  return { ...room, points, openings };
}

/** Удаляет стены короче 1 мм; их проёмы переезжают на следующую стену. */
function removeZeroWalls(room: Room): Room {
  let points = room.points;
  let openings = room.openings;
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const next = points[(i + 1) % n];
      if (distance(points[i], next) >= ZERO_WALL) continue;
      const removedId = points[i].id;
      points = points.filter((_, k) => k !== i);
      openings = openings.map((o) => (o.wallId === removedId ? { ...o, wallId: next.id } : o));
      changed = true;
      break;
    }
  }
  return points === room.points ? room : { ...room, points, openings };
}

/**
 * Приводит комнату к канонике: округление координат, удаление нулевых стен,
 * каноническая ориентация, clamp проёмов.
 */
export function normalizeRoom(room: Room): Room {
  let next: Room = { ...room, points: room.points.map(roundPoint) };
  next = removeZeroWalls(next);
  if (next.points.length >= 3 && signedArea(next.points) < 0) next = reverseRoom(next);
  return clampOpenings(next);
}

/* ------------------------------ Проёмы ------------------------------ */

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** roundCoord, но без выхода за max (округление вверх могло бы вытолкнуть проём за стену). */
function roundWithin(v: number, max: number): number {
  const r = roundCoord(v);
  return r <= max ? r : Math.floor(max * 10000 + 1e-6) / 10000;
}

/** Длины стен по id (без расчёта нормалей и внешнего контура). */
function wallLengths(room: Room): Map<string, number> {
  const pts = room.points;
  return new Map(pts.map((p, i) => [p.id, distance(p, pts[(i + 1) % pts.length])]));
}

function clampToWall(o: Opening, L: number): Opening {
  const width = roundWithin(clamp(finiteOr(o.width, 0.9), Math.min(MIN_OPENING_WIDTH, L), L), L);
  const maxOffset = Math.max(0, L - width);
  const offset = roundWithin(clamp(finiteOr(o.offset, 0), 0, maxOffset), maxOffset);
  // Остальные числа тоже чистим: NaN в наличнике дал бы NaN в расчёте плинтуса.
  const fixed = {
    width,
    offset,
    height: Math.max(0.05, finiteOr(o.height, 2.1)),
    elevation: Math.max(0, finiteOr(o.elevation, 0)),
    casing: clamp(finiteOr(o.casing, 0), 0, MAX_CASING),
    balconyDoorWidth: clamp(finiteOr(o.balconyDoorWidth, 0.7), 0, width),
    balconySillHeight: Math.max(0, finiteOr(o.balconySillHeight, 0.8)),
    depth: Math.max(0, finiteOr(o.depth, 0)),
  };
  if ((Object.keys(fixed) as Array<keyof typeof fixed>).every((k) => fixed[k] === o[k])) return o;
  return {
    ...o,
    ...fixed,
    // Размер подрезан под стену — это уже не стандартный проём.
    presetId: Math.abs(width - o.width) < 1e-6 ? o.presetId : null,
  };
}

/**
 * Проём в пределах стены: MIN_OPENING_WIDTH ≤ width ≤ L, 0 ≤ offset ≤ L − width.
 * Наличники могут выходить за край стены — их не ограничиваем.
 * Возвращает тот же объект, если правка не нужна.
 */
export function clampOpening(room: Room, o: Opening): Opening {
  const L = wallLengths(room).get(o.wallId);
  return L === undefined ? o : clampToWall(o, L);
}

/** clampOpening для всех проёмов + удаление проёмов, чья стена исчезла. */
export function clampOpenings(room: Room): Room {
  const lengths = wallLengths(room);
  let changed = false;
  const openings: Opening[] = [];
  for (const o of room.openings) {
    const L = lengths.get(o.wallId);
    if (L === undefined) {
      changed = true;
      continue;
    }
    const c = clampToWall(o, L);
    if (c !== o) changed = true;
    openings.push(c);
  }
  return changed ? { ...room, openings } : room;
}

export function roomOpeningsOnWall(room: Room, wallId: string): Opening[] {
  return room.openings.filter((o) => o.wallId === wallId).sort((a, b) => a.offset - b.offset);
}

export interface FreeSpotOptions {
  /** Желаемый offset; по умолчанию — центр (или начало, если preferCenter=false). */
  near?: number;
  /** Выступ наличников нового проёма с каждой стороны, м. */
  extension?: number;
  /** Зазор до соседних проёмов, м. */
  gap?: number;
  /** Не учитывать проём с этим id (перемещение/копирование). */
  excludeId?: string;
  /** Наличники обязаны помещаться в стену (иначе при нехватке места проём ставится по центру). */
  strict?: boolean;
}

/** Свободные диапазоны offset (замкнутые отрезки) для проёма ширины width. */
function freeOffsetRanges(room: Room, wall: Wall, width: number, opts: FreeSpotOptions): Array<[number, number]> {
  const L = wall.length;
  if (!(width > 0) || width > L + 1e-9) return [];
  const ext = Math.max(0, opts.extension ?? 0);
  const gap = opts.gap ?? FREE_GAP;
  // Наличники по возможности тоже внутри стены (иначе — проём по центру).
  if (opts.strict && width + 2 * ext > L + 1e-9) return [];
  const margin = Math.min(ext, (L - width) / 2);
  let ranges: Array<[number, number]> = [[margin, L - width - margin]];
  for (const o of room.openings) {
    if (o.wallId !== wall.id || o.id === opts.excludeId) continue;
    const fp = footprint(o);
    // Запрещённые offset: footprint нового проёма пересекает (fp ± gap).
    const lo = fp.from - gap - width - ext;
    const hi = fp.to + gap + ext;
    const next: Array<[number, number]> = [];
    for (const [s, e] of ranges) {
      if (hi <= s || lo >= e) {
        next.push([s, e]);
        continue;
      }
      if (lo > s) next.push([s, lo]);
      if (hi < e) next.push([hi, e]);
    }
    ranges = next;
  }
  return ranges;
}

/**
 * offset, при котором проём ширины width (с наличниками opts.extension) не
 * пересекает другие проёмы стены с зазором FREE_GAP; ближайший к желаемому.
 * null — места нет.
 */
export function findFreeSpot(
  room: Room,
  wallId: string,
  width: number,
  preferCenter = true,
  opts: FreeSpotOptions = {},
): number | null {
  const wall = getWall(room, wallId);
  if (!wall) return null;
  const ranges = freeOffsetRanges(room, wall, width, opts);
  if (!ranges.length) return null;
  const target = opts.near ?? (preferCenter ? (wall.length - width) / 2 : ranges[0][0]);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const [s, e] of ranges) {
    const x = clamp(target, s, e);
    const dist = Math.abs(x - target);
    if (dist < bestDist - 1e-9) {
      best = x;
      bestDist = dist;
    }
  }
  return best === null ? null : roundCoord(best);
}

/** С какими видами проёмов вид «не дружит» при выборе стены. */
const CONFLICTS: Record<OpeningKind, OpeningKind[]> = {
  door: ["window", "balcony"],
  passage: ["window", "balcony"],
  window: ["door", "passage"],
  balcony: ["door", "passage"],
  furniture: ["door", "passage", "balcony"],
};

/** Стены в порядке предпочтения для нового проёма: без конфликтов, затем длиннее. */
function rankWalls(room: Room, kind: OpeningKind, excludeWallId?: string): Wall[] {
  const conflicts = CONFLICTS[kind];
  const hasConflict = (w: Wall) =>
    room.openings.some((o) => o.wallId === w.id && conflicts.includes(o.kind));
  return getWalls(room)
    .filter((w) => w.id !== excludeWallId)
    .map((w) => ({ w, c: hasConflict(w) ? 1 : 0 }))
    .sort((a, b) => a.c - b.c || b.w.length - a.w.length || a.w.index - b.w.index)
    .map(({ w }) => w);
}

/** Пресеты-кандидаты: выбранный, затем стандартные поуже того же вида (кроме мебели). */
function presetCandidates(kind: OpeningKind, presetId?: string): string[] {
  const requested = presetId && getPreset(presetId)?.kind === kind ? presetId : undefined;
  const main = requested ?? DEFAULT_PRESET_ID[kind];
  // Явно выбранный размер и мебель (у неё разный смысл пресетов) не подменяем.
  if (requested || kind === "furniture") return [main];
  const width = getPreset(main)?.width ?? Infinity;
  const narrower = getPresets(kind)
    .filter((p) => p.width < width && !p.extra)
    .sort((a, b) => b.width - a.width)
    .map((p) => p.id);
  return [main, ...narrower];
}

/** Виды, которым мебель в углу перекрыла бы проход боковиной. */
const BLOCKED_BY_FURNITURE: OpeningKind[] = ["door", "passage", "balcony"];

/**
 * offset мебели в углу стены: у начала (0) или у конца (L − width), если
 * угол внутренний, место на стене свободно, а боковина (глубина + зазор)
 * не загораживает дверь или проём на соседней стене. null — свободного угла нет.
 */
function cornerSpot(room: Room, walls: Wall[], wall: Wall, o: Opening): number | null {
  const n = walls.length;
  const ends = [
    { offset: 0, corner: wall.index, adj: walls[(wall.index - 1 + n) % n], adjAtEnd: true },
    { offset: wall.length - o.width, corner: (wall.index + 1) % n, adj: walls[(wall.index + 1) % n], adjAtEnd: false },
  ];
  for (const e of ends) {
    if (e.offset < -1e-9 || cornerAt(room, e.corner).kind !== "inner") continue;
    const spot = findFreeSpot(room, wall.id, o.width, true, { near: e.offset, strict: true });
    if (spot === null || Math.abs(spot - e.offset) > 1e-4) continue;
    const reach = Math.max(0, o.depth) + FREE_GAP;
    const [from, to] = e.adjAtEnd ? [e.adj.length - reach, e.adj.length] : [0, reach];
    const blocked = room.openings.some((x) => {
      if (x.wallId !== e.adj.id || !BLOCKED_BY_FURNITURE.includes(x.kind)) return false;
      const fp = footprint(x);
      return fp.from < to && fp.to > from;
    });
    if (!blocked) return spot;
  }
  return null;
}

const appendOpening = (room: Room, o: Opening): { room: Room; openingId: string } => {
  const placed = clampOpening(room, o);
  return { room: { ...room, openings: [...room.openings, placed] }, openingId: placed.id };
};

/**
 * Добавляет проём со стандартным размером. Если wallId задан — на эту стену
 * (в opts.offset или по центру, иначе в ближайшее свободное место); иначе —
 * на самую длинную подходящую стену (окну — стену без дверей, двери — без окон).
 * Если стандартный размер не влезает — пробует размеры поуже; мебель
 * подгоняется по ширине свободного места. Нет места — openingId = null.
 */
export function addOpening(
  room: Room,
  kind: OpeningKind,
  opts: { wallId?: string; presetId?: string; offset?: number } = {},
): { room: Room; openingId: string | null } {
  if (room.openings.length >= MAX_ROOM_OPENINGS) return { room, openingId: null };
  const walls = opts.wallId ? getWalls(room).filter((w) => w.id === opts.wallId) : rankWalls(room, kind);
  if (!walls.length) return { room, openingId: null };
  const near = opts.wallId && opts.offset !== undefined && Number.isFinite(opts.offset) ? opts.offset : undefined;

  // Сначала ищем место, где проём помещается вместе с наличниками, затем — без них.
  const presets = presetCandidates(kind, opts.presetId);
  if (kind === "furniture" && near === undefined) {
    // Гарнитур и шкафы стоят в углу, а не посреди стены с обрезками плинтуса по бокам.
    const proto = createOpening(kind, walls[0].id, 0, presets[0]);
    const all = getWalls(room);
    for (const wall of walls) {
      const offset = cornerSpot(room, all, wall, proto);
      if (offset !== null) return appendOpening(room, { ...proto, wallId: wall.id, offset });
    }
  }
  for (const strict of [true, false]) {
    for (const presetId of presets) {
      const proto = createOpening(kind, walls[0].id, 0, presetId);
      const extension = casingExtension(proto);
      for (const wall of walls) {
        const offset = findFreeSpot(room, wall.id, proto.width, true, { extension, near, strict });
        if (offset !== null) return appendOpening(room, { ...proto, wallId: wall.id, offset });
      }
    }
  }

  if (kind === "furniture") {
    // Мебель подгоняем под самый большой свободный участок.
    const proto = createOpening(kind, walls[0].id, 0, opts.presetId ?? DEFAULT_PRESET_ID.furniture);
    let best: { wall: Wall; offset: number; width: number } | null = null;
    for (const wall of walls) {
      for (const [s, e] of freeOffsetRanges(room, wall, MIN_FURNITURE_WIDTH, {})) {
        const span = e - s + MIN_FURNITURE_WIDTH;
        const width = Math.min(proto.width, span);
        if (!best || width > best.width + 1e-9) best = { wall, offset: s + (span - width) / 2, width };
      }
    }
    if (best) {
      return appendOpening(room, {
        ...proto,
        wallId: best.wall.id,
        offset: roundCoord(best.offset),
        width: roundCoord(best.width),
        presetId: null,
      });
    }
  }
  return { room, openingId: null };
}

/** Размеры проёма совпадают с его пресетом. */
function matchesPreset(o: Opening): boolean {
  const p = getPreset(o.presetId);
  if (!p) return false;
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return eq(p.width, o.width) && eq(p.height, o.height) && eq(p.elevation, o.elevation);
}

/** Применяет пресет, сохраняя центр проёма. */
function applyPresetCentered(o: Opening, presetId: string): Opening {
  const applied = applyPreset(o, presetId);
  if (applied === o) return o;
  const center = o.offset + o.width / 2;
  return { ...applied, offset: Math.max(0, center - applied.width / 2) };
}

/**
 * Правка проёма + clamp. Смена вида — через changeKind (стандартный размер
 * нового вида, центр сохраняется); смена presetId — размеры пресета
 * (центр сохраняется). Ручная правка размеров сбрасывает presetId.
 */
export function updateOpening(room: Room, openingId: string, patch: Partial<Opening>): Room {
  const idx = room.openings.findIndex((o) => o.id === openingId);
  if (idx < 0) return room;
  const cur = room.openings[idx];
  let o = cur;
  if (patch.kind && patch.kind !== o.kind) o = changeKind(o, patch.kind);
  // Выбор пресета применяет его размеры, даже если id тот же, а размеры разошлись.
  if (typeof patch.presetId === "string" && (patch.presetId !== o.presetId || !matchesPreset(o))) {
    o = applyPresetCentered(o, patch.presetId);
  }
  // Явные undefined в patch — «поле не меняется», а не «стереть значение».
  const rest = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<Opening>;
  delete rest.id;
  delete rest.kind;
  delete rest.presetId;
  if (rest.wallId !== undefined && wallIndexOf(room, rest.wallId) < 0) delete rest.wallId;
  let next: Opening = { ...o, ...rest };
  if (patch.presetId === null) next.presetId = null;
  const resized = rest.width !== undefined || rest.height !== undefined || rest.elevation !== undefined;
  if (resized && next.presetId && !matchesPreset(next)) next = { ...next, presetId: null };
  next = clampOpening(room, next);
  // Ничего не изменилось — та же комната (иначе пустая запись в истории).
  if (sameOpening(next, cur)) return room;
  const openings = room.openings.slice();
  openings[idx] = next;
  return { ...room, openings };
}

function sameOpening(a: Opening, b: Opening): boolean {
  const keys = Object.keys(a) as Array<keyof Opening>;
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** Перенос проёма (в т.ч. на другую стену) + clamp. */
export function moveOpening(room: Room, openingId: string, wallId: string, offset: number): Room {
  const idx = room.openings.findIndex((o) => o.id === openingId);
  if (idx < 0 || wallIndexOf(room, wallId) < 0 || !Number.isFinite(offset)) return room;
  const cur = room.openings[idx];
  const next = clampOpening(room, { ...cur, wallId, offset });
  if (next.wallId === cur.wallId && next.offset === cur.offset && next.width === cur.width) return room;
  const openings = room.openings.slice();
  openings[idx] = next;
  return { ...room, openings };
}

export function removeOpening(room: Room, openingId: string): Room {
  if (!room.openings.some((o) => o.id === openingId)) return room;
  return { ...room, openings: room.openings.filter((o) => o.id !== openingId) };
}

/** Копия проёма рядом (справа, если есть место), иначе на другой стене. */
export function duplicateOpening(room: Room, openingId: string): { room: Room; openingId: string | null } {
  const src = room.openings.find((o) => o.id === openingId);
  if (!src || room.openings.length >= MAX_ROOM_OPENINGS) return { room, openingId: null };
  const extension = casingExtension(src);
  const copy: Opening = { ...src, id: createId("op") };
  const near = src.offset + src.width + 2 * extension + FREE_GAP;
  const sameWall = findFreeSpot(room, src.wallId, src.width, true, { extension, near });
  if (sameWall !== null) return appendOpening(room, { ...copy, offset: sameWall });
  for (const wall of rankWalls(room, src.kind, src.wallId)) {
    const offset = findFreeSpot(room, wall.id, src.width, true, { extension });
    if (offset !== null) return appendOpening(room, { ...copy, wallId: wall.id, offset });
  }
  return { room, openingId: null };
}

/* ------------------------------ Стены ------------------------------- */

/**
 * Новая длина стены с сохранением направлений всех стен: прямая следующей
 * стены сдвигается вдоль стены на Δ, новые вершины — пересечения прямых.
 * Прямоугольник: меняем A — так же меняется C.
 */
export function setWallLength(room: Room, wallId: string, length: number): Room {
  const pts = room.points;
  const n = pts.length;
  const i = wallIndexOf(room, wallId);
  if (i < 0 || !Number.isFinite(length) || length < MIN_WALL - 1e-6) return room;
  const a = pts[i];
  const b = pts[(i + 1) % n];
  const L = distance(a, b);
  const delta = length - L;
  if (L < EPS || Math.abs(delta) < 1e-6) return room;
  const d = wallDir(pts, i);
  const shift = scale(d, delta);
  const pos: Vec2[] = pts.map((p) => ({ x: p.x, y: p.y }));

  // Конец стены скользит вдоль её прямой.
  let k = (i + 1) % n;
  pos[k] = add(b, shift);
  // Если следующая стена лежит на той же прямой, её прямая не меняется —
  // изменение длины «съедает» она сама. Иначе переносим прямую следующей
  // стены (вместе с коллинеарным продолжением) и ищем пересечение.
  if (!isParallel(wallDir(pts, k), d)) {
    for (;;) {
      const kNext = (k + 1) % n;
      if (kNext === i) return room; // обошли весь контур — вырождение
      const dk = wallDir(pts, k);
      const dNext = wallDir(pts, kNext);
      if (isParallel(dk, dNext)) {
        pos[kNext] = add(pts[kNext], shift);
        k = kNext;
        continue;
      }
      const x = lineIntersection(add(pts[kNext], shift), dk, pts[kNext], dNext);
      if (!x) return room;
      pos[kNext] = x;
      break;
    }
  }
  const points = pts.map((p, idx) => ({ ...p, x: pos[idx].x, y: pos[idx].y }));
  return withPoints(room, points, { keepDirections: true });
}

/** Новая вершина перемычки; толщину берём у сдвигаемой стены. */
function bridgePoint(pos: Vec2, wallStart: Point): Point {
  const p: Point = { id: createId("pt"), x: pos.x, y: pos.y };
  if (wallStart.thickness !== undefined) p.thickness = wallStart.thickness;
  return p;
}

/**
 * Сдвиг прямой стены вдоль её внутренней нормали на delta (+ внутрь комнаты).
 * Соседние вершины — пересечения с прямыми соседних стен. Если соседняя стена
 * лежит на той же прямой (стену разделили точкой), вставляется перпендикулярная
 * перемычка — так из участка стены получается ниша или выступ.
 */
export function moveWall(room: Room, wallId: string, delta: number): Room {
  const pts = room.points;
  const n = pts.length;
  const i = wallIndexOf(room, wallId);
  if (i < 0 || !Number.isFinite(delta) || Math.abs(delta) < 1e-6) return room;
  const iPrev = (i - 1 + n) % n;
  const iNext = (i + 1) % n;
  const a = pts[i];
  const b = pts[iNext];
  const d = wallDir(pts, i);
  const shift = scale(inwardNormal(d), delta);
  const a2 = add(a, shift);
  const b2 = add(b, shift);

  const dPrev = wallDir(pts, iPrev);
  const dNext = wallDir(pts, iNext);
  const bridgeStart = isParallel(dPrev, d);
  const bridgeEnd = isParallel(dNext, d);
  const newA = bridgeStart ? a2 : lineIntersection(a2, d, pts[iPrev], dPrev);
  const newB = bridgeEnd ? b2 : lineIntersection(b2, d, pts[(iNext + 1) % n], dNext);
  if (!newA || !newB) return room;

  const result: Point[] = [];
  let tail: Point | null = null; // перемычка перед точкой 0 уходит в конец списка
  for (let idx = 0; idx < n; idx++) {
    const p = pts[idx];
    if (idx === i) {
      if (bridgeStart) {
        // Новая точка на старом месте замыкает соседнюю стену; стена i (её id) уезжает.
        const corner = bridgePoint(a, a);
        if (idx === 0) tail = corner;
        else result.push(corner);
      }
      result.push({ ...p, x: newA.x, y: newA.y });
      if (bridgeEnd) result.push(bridgePoint(b2, a));
    } else if (idx === iNext && !bridgeEnd) {
      result.push({ ...p, x: newB.x, y: newB.y });
    } else {
      result.push(p);
    }
  }
  if (tail) result.push(tail);
  const inserted = bridgeStart || bridgeEnd;
  return withPoints(room, result, { keepDirections: true, shape: inserted ? "custom" : room.shape });
}

/** Перемещение вершины в точку плана (отказ при самопересечении и т.п.). */
export function moveVertex(room: Room, pointId: string, pos: Vec2): Room {
  const idx = room.points.findIndex((p) => p.id === pointId);
  if (idx < 0 || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return room;
  const cur = room.points[idx];
  if (Math.abs(cur.x - pos.x) < 1e-6 && Math.abs(cur.y - pos.y) < 1e-6) return room;
  const points = room.points.map((p, k) => (k === idx ? { ...p, x: pos.x, y: pos.y } : p));
  return withPoints(room, points, { shape: "custom" });
}

/**
 * Делит стену точкой на расстоянии at от начала. Проёмы правее точки
 * переезжают на новую стену (offset − at); проём, пересекающий точку,
 * остаётся на левой части и прижимается к ней.
 */
export function splitWall(room: Room, wallId: string, at: number): Room {
  const pts = room.points;
  const n = pts.length;
  const i = wallIndexOf(room, wallId);
  if (i < 0 || !Number.isFinite(at) || n >= MAX_ROOM_POINTS) return room;
  const a = pts[i];
  const b = pts[(i + 1) % n];
  const L = distance(a, b);
  if (at < MIN_WALL - 1e-6 || L - at < MIN_WALL - 1e-6) return room;
  const pos = add(a, scale(wallDir(pts, i), at));
  const point: Point = { id: createId("pt"), x: roundPos(pos.x), y: roundPos(pos.y) };
  if (a.thickness !== undefined) point.thickness = a.thickness;
  const points = [...pts.slice(0, i + 1), point, ...pts.slice(i + 1)];
  const openings = room.openings.map((o) =>
    o.wallId === wallId && o.offset >= at - 1e-9 ? { ...o, wallId: point.id, offset: o.offset - at } : o,
  );
  return clampOpenings({ ...room, points, openings, shape: "custom" });
}

/**
 * Удаляет вершину (останется ≥ 3): две стены сливаются в одну с id
 * предыдущей. Проёмы обеих стен переносятся проекцией центра.
 */
export function removePoint(room: Room, pointId: string): Room {
  const pts = room.points;
  const n = pts.length;
  const k = pts.findIndex((p) => p.id === pointId);
  if (k < 0 || n <= 3) return room;
  const prev = pts[(k - 1 + n) % n];
  const next = pts[(k + 1) % n];
  const points = pts.filter((_, idx) => idx !== k);
  if (!isValidRoomShape(points)) return room;
  const walls = getWalls(room);
  const merged = new Set([prev.id, pointId]);
  const openings = room.openings.map((o) => {
    if (!merged.has(o.wallId)) return o;
    const w = walls.find((x) => x.id === o.wallId);
    if (!w) return o;
    const center = add(w.a, scale(w.dir, o.offset + o.width / 2));
    const along = projectToSegment(center, prev, next).along;
    return { ...o, wallId: prev.id, offset: along - o.width / 2 };
  });
  return clampOpenings({ ...room, points, openings, shape: "custom" });
}

/** Толщина отдельной стены (визуал, откосы). */
export function setWallThickness(room: Room, wallId: string, t: number): Room {
  const idx = wallIndexOf(room, wallId);
  if (idx < 0 || !Number.isFinite(t)) return room;
  const thickness = roundCoord(clamp(t, MIN_WALL_THICKNESS, MAX_WALL_THICKNESS));
  // Та же фактическая толщина (в т.ч. унаследованная от комнаты) — правки нет.
  if ((room.points[idx].thickness ?? room.wallThickness) === thickness) return room;
  const points = room.points.map((p, k) => (k === idx ? { ...p, thickness } : p));
  return { ...room, points };
}

/* ----------------------------- Шаблоны ------------------------------ */

/**
 * Перестраивает комнату по шаблону. При том же числе стен id точек,
 * толщины и проёмы сохраняются по индексу стены. Иначе стены новые, а
 * проёмы расставляются заново: на стену с тем же индексом (если есть и
 * свободно), иначе умным размещением; не влезающие удаляются.
 */
export function applyTemplate(
  room: Room,
  templateId: RoomShapeId,
  params?: Partial<Record<string, number>>,
): Room {
  if (templateId === "custom") return room;
  const fresh = buildTemplatePoints(templateId, params);
  if (fresh.length === room.points.length) {
    const same =
      room.shape === templateId && fresh.every((p, i) => p.x === room.points[i].x && p.y === room.points[i].y);
    // Тот же шаблон с теми же размерами — комната не меняется.
    if (same) return room;
    const points = fresh.map((p, i) => {
      const old = room.points[i];
      const q: Point = { ...p, id: old.id };
      if (old.thickness !== undefined) q.thickness = old.thickness;
      return q;
    });
    const next = clampOpenings({ ...room, points, shape: templateId });
    // Проём, который не поместился на прежнее место, — не к краю стены, а в свободное место по центру.
    const before = new Map(room.openings.map((o) => [o.id, o]));
    let moved = next;
    for (const o of next.openings) {
      const old = before.get(o.id);
      if (!old || (Math.abs(o.offset - old.offset) < 1e-6 && Math.abs(o.width - old.width) < 1e-6)) continue;
      const offset = findFreeSpot(moved, o.wallId, o.width, true, {
        extension: casingExtension(o),
        excludeId: o.id,
        strict: true,
      });
      if (offset !== null && offset !== o.offset) {
        moved = { ...moved, openings: moved.openings.map((x) => (x.id === o.id ? { ...x, offset } : x)) };
      }
    }
    return moved;
  }

  const oldWalls = getWalls(room);
  let next: Room = { ...room, points: fresh, openings: [], shape: templateId };
  const newWalls = getWalls(next);
  for (const o of room.openings) {
    const oldIndex = oldWalls.find((w) => w.id === o.wallId)?.index ?? -1;
    const target = newWalls[oldIndex];
    const extension = casingExtension(o);
    let placed: Opening | null = null;
    if (target) {
      // Прежнее место — только если проём встаёт туда целиком, с наличниками;
      // иначе — по центру стены, а не вплотную к углу (наличник за углом).
      const keep = findFreeSpot(next, target.id, o.width, true, { extension, near: o.offset, strict: true });
      const offset =
        keep !== null && Math.abs(keep - o.offset) < 1e-6
          ? keep
          : (findFreeSpot(next, target.id, o.width, true, { extension, strict: true }) ??
            findFreeSpot(next, target.id, o.width, true, { extension, near: o.offset }));
      if (offset !== null) placed = { ...o, wallId: target.id, offset };
    }
    if (!placed) {
      const ranked = rankWalls(next, o.kind);
      for (const strict of [true, false]) {
        for (const w of ranked) {
          const offset = findFreeSpot(next, w.id, o.width, true, { extension, strict });
          if (offset !== null) {
            placed = { ...o, wallId: w.id, offset };
            break;
          }
        }
        if (placed) break;
      }
    }
    if (placed) next = appendOpening(next, placed).room;
  }
  return next;
}
