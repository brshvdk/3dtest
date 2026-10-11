/**
 * Геометрия плинтуса комнаты: участки вдоль стен за вычетом проёмов,
 * откосы, стыки (углы/торцы), непрерывные цепочки и длины заготовок.
 *
 * Обход — по периметру в канонической ориентации (стена 0, 1, 2…), внутри
 * стены — от левого угла к правому (если смотреть изнутри). Все длины — метры.
 *
 * Стены, соединённые вершиной «на прямой» (straight — например, после деления
 * стены точкой), считаются одной прямой линией: наличник может заходить через
 * такую вершину на соседнюю стену, откос у неё не теряется, а участок плинтуса
 * через неё — один прямой кусок со стыком 'straight'.
 */
import {
  LEN_EPS,
  STRAIGHT_TOL_DEG,
  add,
  cross,
  dot,
  getWalls,
  isRightAngle,
  pointOnWall,
  scale,
  toDeg,
  toRad,
} from "./geometry";
import { describeOpening, skirtingBlock, wrapsReveals } from "./openings";
import type { CornerKind, Opening, OpeningKind, Room, SkirtingProduct, Vec2, Wall } from "./types";
import { formatNumber } from "./units";

export type JointKind = "inner" | "outer" | "straight" | "end";

export interface SkirtingSegment {
  /** `${room.id}:${wallId}:${n}` (для откоса `${room.id}:${openingId}:rev-l|rev-r`). */
  id: string;
  roomId: string;
  /** Для откоса — стена проёма. */
  wallId: string;
  wallIndex: number;
  /** «A» */
  wallLabel: string;
  /** Подпись куска для раскроя/UI: «A», «A2» (2-й участок стены A), «A·откос». */
  label: string;
  /** Вдоль стены, м (для откоса: 0..толщина стены). */
  from: number;
  to: number;
  /** to − from */
  length: number;
  /** Точки плана по ВНУТРЕННЕЙ грани (на стене), направление a→b = обход периметра. */
  a: Vec2;
  b: Vec2;
  startJoint: JointKind;
  endJoint: JointKind;
  /** Внутренний угол комнаты в стыке, градусы (90 — обычный угол, 270 — внешний), для straight/end = 180. */
  startAngle: number;
  endAngle: number;
  /** Длина заготовки: length + удлинение под запил на наружных углах (только cornerMethod "miter"). */
  materialLength: number;
  isReveal: boolean;
  /** Для откоса. */
  openingId: string | null;
}

export interface SkirtingRun {
  id: string;
  segmentIds: string[];
  closed: boolean;
  length: number;
}

export interface Deduction {
  openingId: string;
  label: string;
  kind: OpeningKind;
  wallLabel: string;
  length: number;
}

export interface RevealAddition {
  openingId: string;
  label: string;
  wallLabel: string;
  length: number;
}

export interface RoomSkirtingResult {
  roomId: string;
  roomName: string;
  productId: string;
  /** Сумма длин стен (внутренний периметр). */
  perimeter: number;
  /** Что вычли (без двойного счёта перекрытий; обрезано по длине стены). */
  deductions: Deduction[];
  /** Что добавили на откосы (по одной записи на проём). */
  reveals: RevealAddition[];
  /** = Σ segment.length = perimeter − Σdeductions + Σreveals */
  netLength: number;
  /** В порядке обхода периметра; внутри стены по from; откосы на своих местах. */
  segments: SkirtingSegment[];
  /** Непрерывные цепочки (через углы); closed=true — замкнутое кольцо без разрывов. */
  runs: SkirtingRun[];
  /** Стыки-углы между существующими сегментами (nonRight — угол не 90/270 ± RIGHT_ANGLE_TOL_DEG). */
  corners: { inner: number; outer: number; nonRight: number };
  /** Свободные концы: start 'end' → левая, end 'end' → правая. */
  endCaps: { left: number; right: number };
  /** По-русски, понятные пользователю. */
  warnings: string[];
}

/** Участки короче отбрасываются (поглощаются соседним проёмом), м. */
export const MIN_SEGMENT = 0.005;
/** Участки короче остаются, но с предупреждением, м. */
export const SHORT_SEGMENT = 0.05;
/** Откос не делаем, если сторона проёма ближе к углу/соседнему проёму, м. */
export const REVEAL_MIN_GAP = 0.01;
/**
 * Градусы: угол в пределах 90° ± допуск (или 270° ± допуск) — прямой.
 * Стандартные уголки ПВХ и МДФ садятся на 87–93°, а отклонение стен на
 * 1–3° есть почти в любой квартире — гибкий угол для них не нужен.
 */
export const RIGHT_ANGLE_TOL_DEG = 3;
/** Больше этого угла запил не считаем (вырожденный «шип»), градусы. */
const MAX_MITER_ANGLE = 350;
/** Стена короче не имеет направления (совпадающие точки) и в обходе пропускается, м. */
const DEGENERATE_WALL = 1e-9;
/** Отрезки короче — шум плавающей точки, м. */
const NOISE = 1e-9;

/**
 * Удлинение заготовки под запил на наружном углу: лицевая грань длиннее
 * тыльной (по стене) на depth·tan((θ−180)/2). Для внутренних углов — 0.
 */
export function miterExtension(interiorAngleDeg: number, depth: number): number {
  if (!(interiorAngleDeg > 180) || !(depth > 0)) return 0;
  const theta = Math.min(interiorAngleDeg, MAX_MITER_ANGLE);
  return depth * Math.tan(toRad((theta - 180) / 2));
}

/* ------------------------------ Внутреннее ----------------------------- */

/**
 * Прямая линия обхода: стены подряд, соединённые вершинами «на прямой».
 * Координата вдоль линии — от начала её первой стены.
 */
interface Line {
  walls: Wall[];
  /** Начало каждой стены вдоль линии, м. */
  starts: number[];
  length: number;
  /** Стык в начале линии — угол с предыдущей линией. */
  startKind: CornerKind;
  startAngle: number;
}

/** Участок линии, занятый проёмом (обрезан по линии). */
interface Block {
  opening: Opening;
  /** Стена проёма (для боковины мебели — соседняя стена, которую она закрывает). */
  wall: Wall;
  from: number;
  to: number;
  /** Боковина мебели, стоящей в углу: участок соседней стены на глубину корпуса. */
  side?: boolean;
}

/** Объединение пересекающихся/касающихся блоков. */
interface Group {
  from: number;
  to: number;
  /** Блок у левого края группы. */
  first: Block;
  /** Блок у правого края группы (с максимальным to). */
  last: Block;
}

type DraftKind = "part" | "rev-l" | "rev-r";

interface Draft {
  kind: DraftKind;
  /** Стена, на которой сегмент стоит в обходе (откос — у стены соседнего участка). */
  host: Wall;
  /** Вдоль стены host (для откоса: 0..толщина). */
  from: number;
  to: number;
  a: Vec2;
  b: Vec2;
  /** Проём откоса. */
  opening: Opening | null;
  /** Стена проёма откоса. */
  openingWall: Wall | null;
  startJoint: JointKind;
  endJoint: JointKind;
  startAngle: number;
  endAngle: number;
}

const STRAIGHT_ANGLE = 180;
/** Откос перпендикулярен стене: снаружи плинтуса это наружный угол 270°. */
const OUTER_REVEAL_ANGLE = 270;

function cm(meters: number): string {
  return formatNumber(meters * 100, 1, { trim: true });
}

/** Стык двух стен по их направлениям — та же формула, что cornerAt() в geometry. */
function jointBetween(d1: Vec2, d2: Vec2): { kind: CornerKind; angle: number } {
  const angle = 180 - toDeg(Math.atan2(cross(d1, d2), dot(d1, d2)));
  if (angle < 180 - STRAIGHT_TOL_DEG) return { kind: "inner", angle };
  if (angle > 180 + STRAIGHT_TOL_DEG) return { kind: "outer", angle };
  return { kind: "straight", angle: STRAIGHT_ANGLE };
}

/**
 * Разбивает периметр на прямые линии. Стены нулевой длины пропускаются —
 * угол считается между соседями по обе стороны от них. Если настоящих углов
 * нет вовсе (все вершины «на прямой»), линия одна и начинается со стены 0.
 */
function buildLines(walls: Wall[]): Line[] {
  const live = walls.filter((w) => w.length > DEGENERATE_WALL);
  const m = live.length;
  if (!m) return [];
  const joints = live.map((w, k) => jointBetween(live[(k - 1 + m) % m].dir, w.dir));
  const first = Math.max(0, joints.findIndex((j) => j.kind !== "straight"));
  const lines: Line[] = [];
  for (let k = 0; k < m; k++) {
    const idx = (first + k) % m;
    if (k === 0 || joints[idx].kind !== "straight") {
      lines.push({ walls: [], starts: [], length: 0, startKind: joints[idx].kind, startAngle: joints[idx].angle });
    }
    const line = lines[lines.length - 1];
    line.starts.push(line.length);
    line.walls.push(live[idx]);
    line.length += live[idx].length;
  }
  return lines;
}

/** Блоки проёмов всех стен линии, по левому краю (при равенстве — длинный раньше). */
function lineBlocks(line: Line, byWall: Map<string, Opening[]>, skirtingHeight: number): Block[] {
  const blocks: Block[] = [];
  line.walls.forEach((wall, j) => {
    for (const opening of byWall.get(wall.id) ?? []) {
      const iv = skirtingBlock(opening, skirtingHeight);
      if (!iv) continue;
      // Обрезаем по линии, а не по стене: наличник заходит через вершину «на прямой».
      const from = Math.max(0, line.starts[j] + iv.from);
      const to = Math.min(line.length, line.starts[j] + iv.to);
      if (to - from > NOISE) blocks.push({ opening, wall, from, to });
    }
  });
  return blocks.sort(byFrom);
}

/** Что закрыла боковина мебели: длина и стены (для подписи вычета). */
interface SideInfo {
  length: number;
  walls: string[];
}

/** м: мебель ближе к углу стоит «в углу» — зазор плинтусом не закрыть, боковина закрывает соседнюю стену. */
export const FURNITURE_CORNER_GAP = 0.02;

/**
 * Сколько соседней стены (от общего угла) закрывает корпус глубины depth и
 * длины width, придвинутый к углу. Внутренний угол до 90° + допуск: стена
 * идёт вдоль боковины (или в корпус, если угол острый); на тупом угле
 * (эркер) стена уходит от корпуса — плинтус за боковиной есть.
 */
function sideReach(kind: CornerKind, angle: number, depth: number, width: number): number {
  if (kind !== "inner" || !(depth > 0) || angle > 90 + RIGHT_ANGLE_TOL_DEG) return 0;
  const turn = toRad(180 - angle);
  const across = Math.sin(turn) > NOISE ? depth / Math.sin(turn) : Infinity;
  const along = Math.cos(turn) < -NOISE ? width / -Math.cos(turn) : Infinity;
  const reach = Math.min(across, along);
  return Number.isFinite(reach) ? reach : 0;
}

/**
 * Мебель, придвинутая к углу (зазор ≤ FURNITURE_CORNER_GAP), занимает угол
 * целиком, а её боковина — участок соседней линии на глубину корпуса:
 * плинтус за кухней и шкафом не нужен, заглушка встаёт у боковины.
 */
function addFurnitureSides(lines: Line[], perLine: Block[][]): void {
  const n = lines.length;
  if (n < 2) return;
  const own = perLine.map((list) => [...list]);
  own.forEach((list, k) => {
    const line = lines[k];
    for (const b of list) {
      const o = b.opening;
      if (o.kind !== "furniture" || !(o.depth > 0)) continue;
      const width = b.to - b.from;
      if (b.to >= line.length - FURNITURE_CORNER_GAP) {
        const ni = (k + 1) % n;
        const next = lines[ni];
        const reach = Math.min(sideReach(next.startKind, next.startAngle, o.depth, width), next.length);
        if (reach > NOISE) {
          b.to = line.length;
          perLine[ni].push({ opening: o, wall: next.walls[0], from: 0, to: reach, side: true });
        }
      }
      if (b.from <= FURNITURE_CORNER_GAP) {
        const pi = (k - 1 + n) % n;
        const prev = lines[pi];
        const reach = Math.min(sideReach(line.startKind, line.startAngle, o.depth, width), prev.length);
        if (reach > NOISE) {
          b.from = 0;
          const wall = prev.walls[prev.walls.length - 1];
          perLine[pi].push({ opening: o, wall, from: prev.length - reach, to: prev.length, side: true });
        }
      }
    }
  });
  for (const list of perLine) list.sort(byFrom);
}

/** По левому краю; при равенстве — длинный раньше. */
const byFrom = (p: Block, q: Block) => p.from - q.from || q.to - p.to;

/**
 * Объединяет блоки линии, считает вклад каждого проёма без двойного счёта
 * и собирает предупреждения о перекрытиях.
 */
function mergeBlocks(
  blocks: Block[],
  contrib: Map<string, number>,
  warnings: string[],
  sides: Map<string, SideInfo>,
): Group[] {
  const groups: Group[] = [];
  let members: Block[] = [];
  /** Вклад проёма копится: у мебели в углу есть ещё боковина на соседней линии. */
  const credit = (b: Block, len: number) => {
    contrib.set(b.opening.id, (contrib.get(b.opening.id) ?? 0) + len);
    if (b.side && len > NOISE) {
      const info = sides.get(b.opening.id) ?? { length: 0, walls: [] };
      info.length += len;
      if (!info.walls.includes(b.wall.label)) info.walls.push(b.wall.label);
      sides.set(b.opening.id, info);
    }
  };
  for (const b of blocks) {
    const g = groups[groups.length - 1];
    if (g && b.from <= g.to + NOISE) {
      const other = members.find((x) => x.to > b.from + LEN_EPS) ?? g.first;
      // Мебель, сомкнутая в углу с другой мебелью (угловая кухня), — не ошибка.
      const cornerFurniture =
        (b.side || other.side) && b.opening.kind === "furniture" && other.opening.kind === "furniture";
      if (b.from < g.to - LEN_EPS && !cornerFurniture) {
        warnings.push(
          `На стене ${b.wall.label} перекрываются: ${describeOpening(other.opening)} и ${describeOpening(b.opening)}. Проверьте их положение — плинтус посчитан без двойного вычета.`,
        );
      }
      // Вклад — только то, что выходит за уже занятое группой.
      credit(b, Math.max(0, b.to - g.to));
      members.push(b);
      if (b.to > g.to) {
        g.to = b.to;
        g.last = b;
      }
    } else {
      credit(b, b.to - b.from);
      groups.push({ from: b.from, to: b.to, first: b, last: b });
      members = [b];
    }
  }
  return groups;
}

/** Черновики сегментов одной линии (участки и откосы) в порядке обхода. */
function lineDrafts(
  line: Line,
  groups: Group[],
  contrib: Map<string, number>,
  reveals: Map<string, number>,
  warnings: string[],
): Draft[] {
  const drafts: Draft[] = [];
  /** Следующий участок начинается наружным углом (после правого откоса). */
  let outerStart = false;

  /** Стена линии в точке pos, если идти от неё вправо, и положение на этой стене. */
  const locate = (pos: number): { wall: Wall; along: number } => {
    const j = line.walls.findIndex((w, k) => pos < line.starts[k] + w.length);
    if (j < 0) {
      const wall = line.walls[line.walls.length - 1];
      return { wall, along: wall.length };
    }
    const c = line.starts[j];
    return { wall: line.walls[j], along: pos <= c ? 0 : pos - c };
  };

  /** Участок линии [f, t] — по куску на каждую стену, между ними стыки 'straight'. */
  const pushPart = (f: number, t: number) => {
    const len = t - f;
    if (len < SHORT_SEGMENT && groups.length > 0) {
      const { wall } = locate(f);
      const atCorner = f <= 0 || t >= line.length;
      warnings.push(
        `Короткий участок ${cm(len)} см на стене ${wall.label} — его сложно закрепить. ` +
          (atCorner
            ? "Сдвиньте проём вплотную к углу или оставьте зазор побольше."
            : "Сдвиньте проёмы вплотную друг к другу или раздвиньте их."),
      );
    }
    let prev: Draft | null = null;
    for (let j = 0; j < line.walls.length; j++) {
      const wall = line.walls[j];
      const c = line.starts[j];
      const end = c + wall.length;
      if (end <= f) continue;
      if (c >= t) break;
      const from = f <= c ? 0 : f - c;
      const to = t >= end ? wall.length : t - c;
      if (to - from <= NOISE) continue;
      const startJoint: JointKind = prev ? "straight" : outerStart ? "outer" : "end";
      const draft: Draft = {
        kind: "part",
        host: wall,
        from,
        to,
        a: pointOnWall(wall, from),
        b: pointOnWall(wall, to),
        opening: null,
        openingWall: null,
        startJoint,
        endJoint: "end",
        startAngle: startJoint === "outer" ? OUTER_REVEAL_ANGLE : STRAIGHT_ANGLE,
        endAngle: STRAIGHT_ANGLE,
      };
      if (prev) prev.endJoint = "straight";
      drafts.push(draft);
      prev = draft;
    }
    outerStart = false;
  };

  /** Свободный промежуток [from, to]; owner — проём, которому отдаём «огрызок». */
  const gap = (from: number, to: number, owner: Opening | null) => {
    const len = to - from;
    if (len <= NOISE) return;
    if (len >= MIN_SEGMENT || !owner) {
      pushPart(from, to);
    } else {
      // Огрызок < 5 мм плинтусом не закрыть — считаем его частью проёма.
      contrib.set(owner.id, (contrib.get(owner.id) ?? 0) + len);
    }
  };

  /** Откос делаем у прохода без наличника в стене ощутимой толщины. */
  const revealDepth = (b: Block): number =>
    wrapsReveals(b.opening) && b.wall.thickness >= MIN_SEGMENT ? b.wall.thickness : 0;

  if (!groups.length) {
    gap(0, line.length, null);
    return drafts;
  }

  groups.forEach((g, k) => {
    const prevEnd = k === 0 ? 0 : groups[k - 1].to;
    const nextStart = k === groups.length - 1 ? line.length : groups[k + 1].from;
    gap(prevEnd, g.from, (k === 0 ? g.first : groups[k - 1].last).opening);

    // Левый откос: от стены наружу. Зазор слева ≥ REVEAL_MIN_GAP, значит
    // участок слева только что добавлен — стыкуем его наружным углом.
    const leftDepth = revealDepth(g.first);
    if (leftDepth > 0 && g.from - prevEnd >= REVEAL_MIN_GAP) {
      const left = drafts[drafts.length - 1];
      left.endJoint = "outer";
      left.endAngle = OUTER_REVEAL_ANGLE;
      drafts.push({
        kind: "rev-l",
        host: left.host,
        from: 0,
        to: leftDepth,
        a: left.b,
        b: add(left.b, scale(left.host.normalOut, leftDepth)),
        opening: g.first.opening,
        openingWall: g.first.wall,
        startJoint: "outer",
        endJoint: "end",
        startAngle: OUTER_REVEAL_ANGLE,
        endAngle: STRAIGHT_ANGLE,
      });
      reveals.set(g.first.opening.id, (reveals.get(g.first.opening.id) ?? 0) + leftDepth);
    }
    // Правый откос: с внешней грани обратно к стене; участок справа гарантирован.
    const rightDepth = revealDepth(g.last);
    if (rightDepth > 0 && nextStart - g.to >= REVEAL_MIN_GAP) {
      const { wall, along } = locate(g.to);
      const q = pointOnWall(wall, along);
      drafts.push({
        kind: "rev-r",
        host: wall,
        from: 0,
        to: rightDepth,
        a: add(q, scale(wall.normalOut, rightDepth)),
        b: q,
        opening: g.last.opening,
        openingWall: g.last.wall,
        startJoint: "end",
        endJoint: "outer",
        startAngle: STRAIGHT_ANGLE,
        endAngle: OUTER_REVEAL_ANGLE,
      });
      reveals.set(g.last.opening.id, (reveals.get(g.last.opening.id) ?? 0) + rightDepth);
      outerStart = true;
    }
    if (k === groups.length - 1) gap(g.to, line.length, g.last.opening);
  });

  return drafts;
}

/** Стыкует конец линии с началом следующей, если плинтус доходит до угла с обеих сторон. */
function joinLines(lines: Line[], perLine: Draft[][]): void {
  lines.forEach((line, k) => {
    const nextIdx = (k + 1) % lines.length;
    const next = lines[nextIdx];
    const last = perLine[k][perLine[k].length - 1];
    const first = perLine[nextIdx][0];
    if (!last || !first || last.kind !== "part" || first.kind !== "part") return;
    const lastWall = line.walls[line.walls.length - 1];
    if (last.host !== lastWall || last.to < lastWall.length - LEN_EPS) return;
    if (first.host !== next.walls[0] || first.from > LEN_EPS) return;
    last.endJoint = next.startKind;
    last.endAngle = next.startAngle;
    first.startJoint = next.startKind;
    first.startAngle = next.startAngle;
  });
}

/* ------------------------------ Расчёт -------------------------------- */

export function computeRoomSkirting(room: Room, product: SkirtingProduct): RoomSkirtingResult {
  const warnings: string[] = [];
  const result: RoomSkirtingResult = {
    roomId: room.id,
    roomName: room.name,
    productId: product.id,
    perimeter: 0,
    deductions: [],
    reveals: [],
    netLength: 0,
    segments: [],
    runs: [],
    corners: { inner: 0, outer: 0, nonRight: 0 },
    endCaps: { left: 0, right: 0 },
    warnings,
  };
  if (room.points.length < 3) {
    warnings.push("Контур комнаты не замкнут — нужно минимум 3 стены.");
    return result;
  }

  const walls = getWalls(room);
  result.perimeter = walls.reduce((s, w) => s + w.length, 0);

  const byWall = new Map<string, Opening[]>();
  for (const o of room.openings) {
    const list = byWall.get(o.wallId);
    if (list) list.push(o);
    else byWall.set(o.wallId, [o]);
  }

  const lines = buildLines(walls);
  const contrib = new Map<string, number>();
  const revealLen = new Map<string, number>();
  const sides = new Map<string, SideInfo>();
  const lineBlockLists = lines.map((line) => lineBlocks(line, byWall, product.height));
  addFurnitureSides(lines, lineBlockLists);
  // Свои блоки проёмов (без боковин) — для записей вычетов и откосов.
  const blocks: Block[] = lineBlockLists.flat().filter((b) => !b.side);
  const perLine = lines.map((line, k) =>
    lineDrafts(line, mergeBlocks(lineBlockLists[k], contrib, warnings, sides), contrib, revealLen, warnings),
  );
  joinLines(lines, perLine);

  // Вычеты и откосы — по одной записи на проём, в порядке стен.
  const byWallIndex = (p: { wall: Wall }, q: { wall: Wall }) => p.wall.index - q.wall.index;
  for (const b of [...blocks].sort(byWallIndex)) {
    const length = contrib.get(b.opening.id) ?? 0;
    if (length <= NOISE) continue;
    const side = sides.get(b.opening.id);
    result.deductions.push({
      openingId: b.opening.id,
      label: side
        ? `${describeOpening(b.opening)} и боковина ${cm(side.length)} см на стене ${side.walls.join(", ")}`
        : describeOpening(b.opening),
      kind: b.opening.kind,
      wallLabel: b.wall.label,
      length,
    });
  }
  for (const b of [...blocks].sort(byWallIndex)) {
    const length = revealLen.get(b.opening.id);
    if (length === undefined) continue;
    result.reveals.push({ openingId: b.opening.id, label: describeOpening(b.opening), wallLabel: b.wall.label, length });
  }

  // Порядок вывода: стена 0, 1, 2…; внутри стены — порядок обхода.
  const perWall: Draft[][] = walls.map(() => []);
  for (const d of perLine.flat()) perWall[d.host.index].push(d);

  const miter = product.cornerMethod === "miter";
  walls.forEach((wall) => {
    let partNo = 0;
    for (const d of perWall[wall.index]) {
      const length = d.to - d.from;
      const ext = miter
        ? miterExtension(d.startAngle, product.depth) + miterExtension(d.endAngle, product.depth)
        : 0;
      const owner = d.openingWall ?? wall;
      let id: string;
      let label: string;
      if (d.kind === "part") {
        partNo += 1;
        id = `${room.id}:${wall.id}:${partNo}`;
        label = partNo === 1 ? wall.label : `${wall.label}${partNo}`;
      } else {
        id = `${room.id}:${d.opening!.id}:${d.kind}`;
        label = `${owner.label}·откос`;
      }
      result.segments.push({
        id,
        roomId: room.id,
        wallId: owner.id,
        wallIndex: owner.index,
        wallLabel: owner.label,
        label,
        from: d.from,
        to: d.to,
        length,
        a: d.a,
        b: d.b,
        startJoint: d.startJoint,
        endJoint: d.endJoint,
        startAngle: d.startAngle,
        endAngle: d.endAngle,
        materialLength: length + ext,
        isReveal: d.kind !== "part",
        openingId: d.opening ? d.opening.id : null,
      });
    }
  });

  for (const s of result.segments) {
    result.netLength += s.length;
    if (s.startJoint === "end") result.endCaps.left += 1;
    if (s.endJoint === "end") result.endCaps.right += 1;
    // Каждый угол — конец одного сегмента и начало следующего: считаем по концам.
    if (s.endJoint === "inner" || s.endJoint === "outer") {
      result.corners[s.endJoint] += 1;
      if (!isRightAngle(s.endAngle, RIGHT_ANGLE_TOL_DEG)) result.corners.nonRight += 1;
    }
  }

  result.runs = buildRuns(room.id, result.segments);

  if (result.corners.nonRight > 0 && product.cornerMethod === "fittings") {
    warnings.push(
      `Углов не 90°: ${result.corners.nonRight}. Стандартные уголки на них не встанут — понадобится гибкий (регулируемый) угол или запил.`,
    );
  }
  if (result.perimeter > 0 && result.segments.length === 0) {
    warnings.push("Весь периметр занят проёмами и мебелью — плинтус в этой комнате не нужен.");
  }
  return result;
}

export interface CornerInfo {
  kind: "inner" | "outer";
  /** Внутренний угол комнаты, градусы (как startAngle/endAngle сегмента). */
  angle: number;
}

/** Углы-стыки между сегментами, кроме прямых (±RIGHT_ANGLE_TOL_DEG), в порядке обхода. */
export function nonRightCorners(result: RoomSkirtingResult): CornerInfo[] {
  const out: CornerInfo[] = [];
  for (const s of result.segments) {
    if ((s.endJoint === "inner" || s.endJoint === "outer") && !isRightAngle(s.endAngle, RIGHT_ANGLE_TOL_DEG)) {
      out.push({ kind: s.endJoint, angle: s.endAngle });
    }
  }
  return out;
}

/** Непрерывные цепочки сегментов: разрыв там, где конец — торец ('end'). */
function buildRuns(roomId: string, segments: SkirtingSegment[]): SkirtingRun[] {
  const m = segments.length;
  if (!m) return [];
  const startIdx = segments.findIndex((s) => s.startJoint === "end");
  const closed = startIdx < 0;
  const runs: SkirtingRun[] = [];
  let current: SkirtingSegment[] = [];
  const flush = () => {
    if (!current.length) return;
    runs.push({
      id: `${roomId}:run${runs.length + 1}`,
      segmentIds: current.map((s) => s.id),
      closed,
      length: current.reduce((acc, s) => acc + s.length, 0),
    });
    current = [];
  };
  const base = closed ? 0 : startIdx;
  for (let k = 0; k < m; k++) {
    const s = segments[(base + k) % m];
    current.push(s);
    if (s.endJoint === "end") flush();
  }
  flush();
  return runs;
}
