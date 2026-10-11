/**
 * Итоговая смета по проекту: группировка комнат по плинтусу, раскрой,
 * запас, фурнитура, крепёж и строки заказа на русском.
 */
import { FIT_TOLERANCE, mergeCutPlans, planCuts } from "./cutting";
import type { CutPlan, CutResult, Piece } from "./cutting";
import {
  ACRYLIC_SEALANT,
  ADHESIVE_BAG_KG,
  CLIP_DOWEL_NAME,
  CLIP_DOWEL_PRICE,
  GROUT,
  JOINT_GLUE,
  SANITARY_SEALANT,
  getColorName,
  resolveProduct,
} from "./skirtingCatalog";
import { computeRoomSkirting, nonRightCorners } from "./skirtingCalc";
import type { CornerInfo, RoomSkirtingResult } from "./skirtingCalc";
import type { Project, Room, SkirtingProduct, SkirtingSettings } from "./types";
import { formatLength, formatNumber, plural } from "./units";

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
  | "glue"
  | "jointGlue"
  | "grout"
  | "sealant";

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
/** м: кусок короче не крепим отдельно (держится на фурнитуре или клее). */
const MIN_FASTENED_RUN = 0.1;
/** м: в кусок короче помещается одна точка крепежа. */
const SINGLE_FASTENER_RUN = 0.3;

/** ceil с защитой от 21.000000000000004 → 22. */
const ceilSafe = (x: number): number => Math.ceil(x - 1e-9);
const money = (v: number): number => Math.round(v * 100) / 100;

/**
 * Крепёж на один прямой участок: шаг + по точке на краях, минимум 2.
 * Короткий кусок (< 30 см) держит одна точка, совсем короткий (< 10 см) —
 * фурнитура или клей. Стыки планок внутри участка добавляет countAccessories.
 */
export function fastenersForRun(length: number, step: number): number {
  if (length < MIN_FASTENED_RUN || !(step > 0)) return 0;
  if (length < SINGLE_FASTENER_RUN) return 1;
  return Math.max(2, ceilSafe(length / step) + 1);
}

/**
 * Пропил при раскрое. Керамику режут плиткорезом (без пропила), а неточность
 * в 2–3 мм уходит в шов затирки: две половины 0,3 м выходят из одного
 * элемента 0,6 м.
 */
function effectiveKerf(product: SkirtingProduct, kerf: number): number {
  return product.material === "ceramic" ? 0 : Math.max(0, kerf || 0);
}

/**
 * Заглушки и соединители при запиле: у ПВХ с кабель-каналом полый торец
 * выступает за наличник, а стык по длине стены делают соединителем —
 * запил заменяет только уголки.
 */
const keepsEndFittings = (product: SkirtingProduct): boolean => product.cableChannel;

/** Ванна или душ в комнате — шов «плинтус — пол/ванна» нужно герметизировать. */
const BATH_RE = /ванн|душ/i;
export function hasBath(room: Room): boolean {
  return room.openings.some((o) => o.kind === "furniture" && (o.presetId === "furn-bath" || BATH_RE.test(o.label)));
}

/** Угол для покупателя: 135° у эркера — и внутренний, и наружный (360° − 225°). */
const shownAngle = (c: CornerInfo): number => Math.round(c.kind === "outer" ? 360 - c.angle : c.angle);
/** Угол запила от поперечного реза: 45° для 90°, 22,5° для 135°. */
const miterAngle = (c: CornerInfo): number => Math.round(Math.abs(180 - c.angle)) / 2;
const degList = (xs: number[]): string =>
  [...new Set(xs)]
    .sort((a, b) => a - b)
    .map((x) => `${formatNumber(x, 1, { trim: true })}°`)
    .join(", ");

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
  const fittings = product.cornerMethod === "fittings";
  if (fittings) {
    for (const r of rooms) {
      acc.innerCorners += r.corners.inner;
      acc.outerCorners += r.corners.outer;
    }
  }
  if (fittings || keepsEndFittings(product)) {
    for (const r of rooms) {
      acc.endCapsLeft += r.endCaps.left;
      acc.endCapsRight += r.endCaps.right;
    }
    acc.connectors = joints;
  }
  switch (product.fastening) {
    case "dowels":
    case "nails":
    case "clips": {
      // Каждую планку крепят у обоих торцов: стык — ещё одна точка (у МДФ — клипса под каждым концом).
      const perRuns = straightRuns.reduce((s, l) => s + fastenersForRun(l, product.fastenerStep), 0);
      const raw = perRuns > 0 ? perRuns + joints : 0;
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

interface LineContext {
  product: SkirtingProduct;
  acc: AccessoryCounts;
  rooms: RoomSkirtingResult[];
  netLength: number;
  joints: number;
  planksMin: number;
  reservePlanks: number;
  reservePct: number;
  /** В комнатах группы есть ванна или душ. */
  bath: boolean;
}

function buildLines(c: LineContext): OrderLine[] {
  const { product, acc, rooms, planksMin, reservePlanks, reservePct } = c;
  const lines: OrderLine[] = [];
  const color = getColorName(product);
  const push = (
    kind: OrderLineKind,
    name: string,
    qty: number,
    unit: OrderLine["unit"],
    unitPrice: number,
    note?: string,
    variant?: string,
  ) => {
    if (!(qty > 0)) return;
    const line: OrderLine = {
      id: `${product.id}:${kind}${variant ? `:${variant}` : ""}`,
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

  const fittings = product.cornerMethod === "fittings";
  const odd = rooms.flatMap(nonRightCorners);
  const L = formatLength(product.length, "m", 2, { trim: true });
  let miterNote = "";
  if (!fittings) {
    // Эркер 135°: запил не 45°, а 22,5° — пилить под половину отклонения от прямой.
    const byMiter = new Map<number, number[]>();
    for (const corner of odd) {
      const list = byMiter.get(miterAngle(corner)) ?? [];
      list.push(shownAngle(corner));
      byMiter.set(miterAngle(corner), list);
    }
    const extra = [...byMiter.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([miter, angles]) => `углы ${degList(angles)} — запил ${degList([miter])}`);
    miterNote = ["углы — запил 45°", ...extra].join("; ");
  }
  const plankNote = [
    reservePlanks > 0
      ? `${planksMin} по раскрою + ${reservePlanks} запас (${formatNumber(reservePct, 1, { trim: true })} %)`
      : `${planksMin} по раскрою`,
    miterNote,
  ]
    .filter(Boolean)
    .join("; ");
  push("plank", `${product.name}, ${L} — ${color}`, planksMin + reservePlanks, "шт", product.price, plankNote);

  // Стандартный уголок садится только на прямой угол; на эркер и скос — регулируемый.
  const fitNote = `в цвет «${color}»`;
  const oddInner = fittings ? odd.filter((x) => x.kind === "inner") : [];
  const oddOuter = fittings ? odd.filter((x) => x.kind === "outer") : [];
  const oddNote = (list: CornerInfo[]) =>
    `${fitNote}; ${plural(list.length, ["угол", "угла", "углов"])} ${degList(list.map(shownAngle))} — обычный уголок не встанет`;
  push("innerCorner", "Угол внутренний", acc.innerCorners - oddInner.length, "шт", product.prices.innerCorner, fitNote);
  push(
    "innerCorner",
    "Угол внутренний регулируемый",
    oddInner.length,
    "шт",
    product.prices.innerCorner,
    oddNote(oddInner),
    "flex",
  );
  push("outerCorner", "Угол наружный", acc.outerCorners - oddOuter.length, "шт", product.prices.outerCorner, fitNote);
  push(
    "outerCorner",
    "Угол наружный регулируемый",
    oddOuter.length,
    "шт",
    product.prices.outerCorner,
    oddNote(oddOuter),
    "flex",
  );
  if (product.handedEndCaps) {
    push("endCapLeft", "Заглушка левая", acc.endCapsLeft, "шт", product.prices.endCap, fitNote);
    push("endCapRight", "Заглушка правая", acc.endCapsRight, "шт", product.prices.endCap, fitNote);
  } else {
    push("endCap", "Заглушка торцевая", acc.endCapsLeft + acc.endCapsRight, "шт", product.prices.endCap, fitNote);
  }
  push("connector", "Соединитель", acc.connectors, "шт", product.prices.connector, "на стыки планок по длине стены");

  const stepNote = `шаг ≈ ${formatLength(product.fastenerStep, "cm")} и у каждого стыка, +${FASTENER_RESERVE * 100} % запас`;
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
    case "adhesive": {
      // Плиточный клей продаётся мешками: расход 2–3 кг — это один мешок 5 кг.
      const bags = ceilSafe(acc.glue / ADHESIVE_BAG_KG);
      const bagKg = formatNumber(ADHESIVE_BAG_KG, 0);
      push(
        "glue",
        `${product.fastenerName} (мешок ${bagKg} кг)`,
        bags,
        "шт",
        money(product.prices.glue * ADHESIVE_BAG_KG),
        `расход ≈ ${formatNumber(acc.glue, 0)} кг (${formatNumber(product.glueRate, 2, { trim: true })} кг на пог. м)`,
      );
      break;
    }
  }

  if (product.material === "ceramic") {
    const kg = c.netLength * GROUT.kgPerMeter;
    push("grout", GROUT.name, ceilSafe(kg / GROUT.packKg), "шт", GROUT.price, `швы между элементами и стык с полом, в цвет плинтуса`);
    if (c.bath) {
      push(
        "sealant",
        SANITARY_SEALANT.name,
        ceilSafe(c.netLength / SANITARY_SEALANT.metersPerTube),
        "туб",
        SANITARY_SEALANT.price,
        "шов «плинтус — пол» и у ванны: вода не затечёт под плитку",
      );
    }
  }
  if (product.paintable && product.fastening === "glue") {
    // Полимерную лепнину склеивают и между собой: стыки и запилы — отдельным клеем.
    const seams = c.joints + rooms.reduce((s, r) => s + r.corners.inner + r.corners.outer, 0);
    if (product.material === "polyurethane") {
      push(
        "jointGlue",
        JOINT_GLUE.name,
        seams > 0 ? Math.ceil(seams / JOINT_GLUE.jointsPerTube) : 0,
        "туб",
        JOINT_GLUE.price,
        "склеить стыки и запилы между собой",
      );
    }
    push(
      "sealant",
      ACRYLIC_SEALANT.name,
      ceilSafe(c.netLength / ACRYLIC_SEALANT.metersPerTube),
      "туб",
      ACRYLIC_SEALANT.price,
      "заполнить щель у стены и швы перед покраской",
    );
  }
  return lines;
}

/** Нарезка и раскрой группы комнат одного плинтуса. */
function cutGroup(
  product: SkirtingProduct,
  rooms: RoomSkirtingResult[],
  settings: SkirtingSettings,
): CutResult {
  const L = product.length;
  const kerf = effectiveKerf(product, settings.kerf);
  const minPiece = Math.max(0, settings.minPiece || 0);
  const opts = { fitTolerance: product.cornerMethod === "fittings" ? FIT_TOLERANCE : 0 };
  const perRoom = rooms.map((r) => planCuts([r], L, kerf, minPiece, opts));
  const separate: CutResult = {
    pieces: perRoom.flatMap((x) => x.pieces),
    joints: perRoom.reduce((s, x) => s + x.joints, 0),
    straightRuns: perRoom.flatMap((x) => x.straightRuns),
    cutPlan: perRoom.length === 1 ? perRoom[0].cutPlan : mergeCutPlans(perRoom.map((x) => x.cutPlan), L, kerf),
  };
  if (!settings.shareOffcuts || rooms.length < 2) return separate;
  const shared = planCuts(rooms, L, kerf, minPiece, opts);
  // Стыки в каждой комнате подобраны под её обрезки — бывает, это лучше общего подбора.
  return separate.cutPlan.bars.length < shared.cutPlan.bars.length ? separate : shared;
}

function estimateProduct(
  product: SkirtingProduct,
  rooms: RoomSkirtingResult[],
  settings: SkirtingSettings,
  bath: boolean,
): ProductEstimate {
  const L = product.length;
  const reservePct = Number.isFinite(settings.reservePct) ? Math.max(0, settings.reservePct) : 0;

  const { pieces, joints, straightRuns, cutPlan } = cutGroup(product, rooms, settings);
  const netLength = rooms.reduce((s, r) => s + r.netLength, 0);
  const planksMin = cutPlan.bars.length;
  const planksToOrder = netLength > 0 ? ceilSafe(planksMin * (1 + reservePct / 100)) : 0;
  const reservePlanks = Math.max(0, planksToOrder - planksMin);
  const accessories = countAccessories(product, rooms, joints, straightRuns, netLength);
  const lines =
    netLength > 0
      ? buildLines({ product, acc: accessories, rooms, netLength, joints, planksMin, reservePlanks, reservePct, bath })
      : [];

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
  const groups = new Map<string, { product: SkirtingProduct; rooms: RoomSkirtingResult[]; bath: boolean }>();
  const rooms: RoomSkirtingResult[] = [];

  for (const room of project.rooms) {
    if (!room.skirtingEnabled) continue;
    const product = resolveProduct(room.productId ?? settings.productId, overrides);
    const result = computeRoomSkirting(room, product);
    rooms.push(result);
    const bath = hasBath(room);
    const g = groups.get(product.id);
    if (g) {
      g.rooms.push(result);
      g.bath ||= bath;
    } else {
      groups.set(product.id, { product, rooms: [result], bath });
    }
  }

  const products = [...groups.values()].map((g) => estimateProduct(g.product, g.rooms, settings, g.bath));
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
