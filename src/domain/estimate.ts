/**
 * Итоговая смета по проекту: группировка комнат по плинтусу, раскрой,
 * запас, фурнитура, крепёж и строки заказа на русском.
 */
import { mergeCutPlans, optimizeCuts, splitIntoPieces } from "./cutting";
import type { CutPlan, Piece } from "./cutting";
import { CLIP_DOWEL_NAME, CLIP_DOWEL_PRICE, getColorName, resolveProduct } from "./skirtingCatalog";
import { computeRoomSkirting } from "./skirtingCalc";
import type { RoomSkirtingResult } from "./skirtingCalc";
import type { Project, SkirtingProduct, SkirtingSettings } from "./types";
import { formatLength, formatNumber } from "./units";

export type OrderLineKind =
  | "plank"
  | "innerCorner"
  | "outerCorner"
  | "endCapLeft"
  | "endCapRight"
  | "endCap"
  | "connector"
  | "fastener"
  | "dowel"
  | "glue";

export interface OrderLine {
  id: string;
  productId: string;
  kind: OrderLineKind;
  name: string;
  qty: number;
  unit: "шт" | "туб" | "кг";
  unitPrice: number;
  total: number;
  note?: string;
}

export interface AccessoryCounts {
  innerCorners: number;
  outerCorners: number;
  endCapsLeft: number;
  endCapsRight: number;
  connectors: number;
  fasteners: number;
  dowels: number;
  glue: number;
}

export interface ProductEstimate {
  /** С учётом правок. */
  product: SkirtingProduct;
  roomIds: string[];
  rooms: RoomSkirtingResult[];
  pieces: Piece[];
  /** Общий раскрой (shareOffcuts) или склейка раскроев по комнатам. */
  cutPlan: CutPlan;
  /** Чистая длина плинтуса, м. */
  netLength: number;
  joints: number;
  /** = cutPlan.bars.length */
  planksMin: number;
  /** ceil(netLength / L) — «без учёта раскроя», для сравнения. */
  planksNaive: number;
  reservePlanks: number;
  /** ceil(planksMin·(1+reservePct/100)); 0 если netLength=0. */
  planksToOrder: number;
  /** planksToOrder·L */
  lengthToOrder: number;
  accessories: AccessoryCounts;
  lines: OrderLine[];
  cost: number;
  warnings: string[];
}

export interface ProjectEstimate {
  products: ProductEstimate[];
  rooms: RoomSkirtingResult[];
  lines: OrderLine[];
  totalCost: number;
  netLength: number;
  planksToOrder: number;
  warnings: string[];
}

/** Запас крепежа на потерю/брак. */
export const FASTENER_RESERVE = 0.1;
/** Участки короче не крепим отдельно (держатся на соседях/клее). */
const MIN_FASTENED_RUN = 0.05;

/** ceil с защитой от 21.000000000000004 → 22. */
const ceilSafe = (x: number): number => Math.ceil(x - 1e-9);
const money = (v: number): number => Math.round(v * 100) / 100;

/** Крепёж на один прямой участок: шаг + по точке на краях, минимум 2. */
export function fastenersForRun(length: number, step: number): number {
  if (length < MIN_FASTENED_RUN || !(step > 0)) return 0;
  return Math.max(2, ceilSafe(length / step) + 1);
}

function emptyAccessories(): AccessoryCounts {
  return {
    innerCorners: 0,
    outerCorners: 0,
    endCapsLeft: 0,
    endCapsRight: 0,
    connectors: 0,
    fasteners: 0,
    dowels: 0,
    glue: 0,
  };
}

function countAccessories(
  product: SkirtingProduct,
  rooms: RoomSkirtingResult[],
  joints: number,
  straightRuns: number[],
  netLength: number,
): AccessoryCounts {
  const acc = emptyAccessories();
  if (netLength <= 0) return acc;
  if (product.cornerMethod === "fittings") {
    for (const r of rooms) {
      acc.innerCorners += r.corners.inner;
      acc.outerCorners += r.corners.outer;
      acc.endCapsLeft += r.endCaps.left;
      acc.endCapsRight += r.endCaps.right;
    }
    acc.connectors = joints;
  }
  switch (product.fastening) {
    case "dowels":
    case "nails":
    case "clips": {
      const raw = straightRuns.reduce((s, l) => s + fastenersForRun(l, product.fastenerStep), 0);
      acc.fasteners = raw > 0 ? ceilSafe(raw * (1 + FASTENER_RESERVE)) : 0;
      if (product.fastening === "clips") acc.dowels = acc.fasteners;
      break;
    }
    case "glue":
      acc.glue = product.glueRate > 0 ? ceilSafe(netLength / product.glueRate) : 0;
      break;
    case "adhesive":
      acc.glue = ceilSafe(netLength * Math.max(0, product.glueRate));
      break;
  }
  return acc;
}

function buildLines(
  product: SkirtingProduct,
  acc: AccessoryCounts,
  rooms: RoomSkirtingResult[],
  planksMin: number,
  reservePlanks: number,
  reservePct: number,
): OrderLine[] {
  const lines: OrderLine[] = [];
  const color = getColorName(product);
  const push = (
    kind: OrderLineKind,
    name: string,
    qty: number,
    unit: OrderLine["unit"],
    unitPrice: number,
    note?: string,
  ) => {
    if (!(qty > 0)) return;
    const line: OrderLine = {
      id: `${product.id}:${kind}`,
      productId: product.id,
      kind,
      name,
      qty,
      unit,
      unitPrice,
      total: money(qty * unitPrice),
    };
    if (note) line.note = note;
    lines.push(line);
  };

  const L = formatLength(product.length, "m", 2, { trim: true });
  const plankNote = [
    reservePlanks > 0
      ? `${planksMin} по раскрою + ${reservePlanks} запас (${formatNumber(reservePct, 1, { trim: true })} %)`
      : `${planksMin} по раскрою`,
    product.cornerMethod === "miter" ? "углы — запил 45°" : "",
  ]
    .filter(Boolean)
    .join("; ");
  push("plank", `${product.name}, ${L} — ${color}`, planksMin + reservePlanks, "шт", product.price, plankNote);

  const nonRight = rooms.reduce((s, r) => s + r.corners.nonRight, 0);
  const fitNote = `в цвет «${color}»`;
  const cornerNote = nonRight > 0 ? `${fitNote}; углов не 90°: ${nonRight} — нужен гибкий угол` : fitNote;
  push("innerCorner", "Угол внутренний", acc.innerCorners, "шт", product.prices.innerCorner, cornerNote);
  push("outerCorner", "Угол наружный", acc.outerCorners, "шт", product.prices.outerCorner, cornerNote);
  if (product.handedEndCaps) {
    push("endCapLeft", "Заглушка левая", acc.endCapsLeft, "шт", product.prices.endCap, fitNote);
    push("endCapRight", "Заглушка правая", acc.endCapsRight, "шт", product.prices.endCap, fitNote);
  } else {
    push("endCap", "Заглушка торцевая", acc.endCapsLeft + acc.endCapsRight, "шт", product.prices.endCap, fitNote);
  }
  push("connector", "Соединитель", acc.connectors, "шт", product.prices.connector, "на стыки планок по длине стены");

  const stepNote = `шаг ≈ ${formatLength(product.fastenerStep, "cm")}, +${FASTENER_RESERVE * 100} % запас`;
  switch (product.fastening) {
    case "dowels":
    case "nails":
      push("fastener", product.fastenerName, acc.fasteners, "шт", product.prices.fastener, stepNote);
      break;
    case "clips":
      push("fastener", product.fastenerName, acc.fasteners, "шт", product.prices.fastener, stepNote);
      push("dowel", CLIP_DOWEL_NAME, acc.dowels, "шт", CLIP_DOWEL_PRICE, "по одному на клипсу");
      break;
    case "glue":
      push(
        "glue",
        product.fastenerName,
        acc.glue,
        "туб",
        product.prices.glue,
        `≈ ${formatNumber(product.glueRate, 1, { trim: true })} пог. м на тубу`,
      );
      break;
    case "adhesive":
      push(
        "glue",
        product.fastenerName,
        acc.glue,
        "кг",
        product.prices.glue,
        `≈ ${formatNumber(product.glueRate, 2, { trim: true })} кг на пог. м`,
      );
      break;
  }
  return lines;
}

function estimateProduct(
  product: SkirtingProduct,
  rooms: RoomSkirtingResult[],
  settings: SkirtingSettings,
): ProductEstimate {
  const L = product.length;
  const kerf = Math.max(0, settings.kerf || 0);
  const minPiece = Math.max(0, settings.minPiece || 0);
  const reservePct = Number.isFinite(settings.reservePct) ? Math.max(0, settings.reservePct) : 0;

  const splits = rooms.map((r) => splitIntoPieces(r, L, minPiece));
  const pieces = splits.flatMap((s) => s.pieces);
  const joints = splits.reduce((s, x) => s + x.joints, 0);
  const straightRuns = splits.flatMap((s) => s.straightRuns);
  const cutPlan = settings.shareOffcuts
    ? optimizeCuts(pieces, L, kerf)
    : mergeCutPlans(
        splits.map((s) => optimizeCuts(s.pieces, L, kerf)),
        L,
        kerf,
      );

  const netLength = rooms.reduce((s, r) => s + r.netLength, 0);
  const planksMin = cutPlan.bars.length;
  const planksToOrder = netLength > 0 ? ceilSafe(planksMin * (1 + reservePct / 100)) : 0;
  const reservePlanks = Math.max(0, planksToOrder - planksMin);
  const accessories = countAccessories(product, rooms, joints, straightRuns, netLength);
  const lines = netLength > 0 ? buildLines(product, accessories, rooms, planksMin, reservePlanks, reservePct) : [];

  const warnings = rooms.flatMap((r) => r.warnings.map((w) => `${r.roomName}: ${w}`));
  return {
    product,
    roomIds: rooms.map((r) => r.roomId),
    rooms,
    pieces,
    cutPlan,
    netLength,
    joints,
    planksMin,
    planksNaive: netLength > 0 ? ceilSafe(netLength / L) : 0,
    reservePlanks,
    planksToOrder,
    lengthToOrder: planksToOrder * L,
    accessories,
    lines,
    cost: money(lines.reduce((s, l) => s + l.total, 0)),
    warnings,
  };
}

export function estimateProject(project: Project): ProjectEstimate {
  const settings = project.skirting;
  const overrides = project.productOverrides ?? {};
  // Группировка по эффективному продукту, в порядке первого появления.
  const groups = new Map<string, { product: SkirtingProduct; rooms: RoomSkirtingResult[] }>();
  const rooms: RoomSkirtingResult[] = [];

  for (const room of project.rooms) {
    if (!room.skirtingEnabled) continue;
    const product = resolveProduct(room.productId ?? settings.productId, overrides);
    const result = computeRoomSkirting(room, product);
    rooms.push(result);
    const g = groups.get(product.id);
    if (g) g.rooms.push(result);
    else groups.set(product.id, { product, rooms: [result] });
  }

  const products = [...groups.values()].map((g) => estimateProduct(g.product, g.rooms, settings));
  const lines = products.flatMap((p) => p.lines);
  const warnings = products.flatMap((p) => p.warnings);
  if (project.rooms.length > 0 && rooms.length === 0) {
    warnings.push("Расчёт плинтуса выключен во всех комнатах — включите его в настройках комнаты.");
  }
  return {
    products,
    rooms,
    lines,
    totalCost: money(lines.reduce((s, l) => s + l.total, 0)),
    netLength: products.reduce((s, p) => s + p.netLength, 0),
    planksToOrder: products.reduce((s, p) => s + p.planksToOrder, 0),
    warnings,
  };
}
