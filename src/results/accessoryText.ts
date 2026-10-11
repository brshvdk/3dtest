/**
 * Строки раздела «Углы, стыки, крепёж»: что и сколько, с пояснением, откуда число.
 * Чистая функция (тестируется без React). Что есть в списке покупок, а чего нет
 * (заглушки и соединители у ПВХ при запиле, регулируемые уголки), берём из pe.lines —
 * пояснение не может разойтись со списком.
 */
import { FASTENER_RESERVE, type OrderLineKind, type ProductEstimate } from "../domain/estimate";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import { ADHESIVE_BAG_KG } from "../domain/skirtingCatalog";
import { formatLength, formatNumber, pluralize } from "../domain/units";
import { pctText, stockText, unitWords } from "./format";

export interface AccessoryRow {
  /** Ключ для React. */
  id: string;
  k: string;
  hint: string;
  v: string;
}

const CAP_KINDS: OrderLineKind[] = ["endCap", "endCapLeft", "endCapRight"];

export function accessoryRows(pe: ProductEstimate): AccessoryRow[] {
  if (pe.netLength <= 0) return [];
  const p = pe.product;
  const acc = pe.accessories;
  const inList = (kinds: OrderLineKind[]) => pe.lines.some((l) => kinds.includes(l.kind));
  const fittings = p.cornerMethod === "fittings";
  const sum = (f: (r: RoomSkirtingResult) => number) => pe.rooms.reduce((s, r) => s + f(r), 0);
  const inner = sum((r) => r.corners.inner);
  const outer = sum((r) => r.corners.outer);
  const nonRight = sum((r) => r.corners.nonRight);
  const left = sum((r) => r.endCaps.left);
  const right = sum((r) => r.endCaps.right);
  const ends = left + right;
  // Заглушки и соединители есть в списке и при запиле, если их требует профиль (ПВХ с кабель-каналом).
  const caps = inList(CAP_KINDS);
  const connectors = inList(["connector"]);
  const pcs = (n: number) => `${formatNumber(n, 0)} шт`;
  const words = unitWords(p);
  const rows: AccessoryRow[] = [];

  rows.push({
    id: "inner",
    k: "Внутренние углы",
    hint: fittings ? "по уголку на каждый угол комнаты" : "запил 45° — уголки не нужны",
    v: pcs(inner),
  });
  if (outer > 0) {
    rows.push({
      id: "outer",
      k: "Наружные углы",
      hint: fittings ? "выступы стен, короба, откосы проёмов" : "запил 45°: кусок берём длиннее на толщину плинтуса",
      v: pcs(outer),
    });
  }
  if (nonRight > 0) {
    rows.push({
      id: "nonRight",
      k: "Из них не 90°",
      hint: fittings ? "обычный уголок не встанет — в списке регулируемый" : "запил под половину угла",
      v: pcs(nonRight),
    });
  }

  // Плинтус обрывается и у мебели вдоль стены (ванна, шкаф) — там наличника нет.
  const atFurniture = pe.rooms.some((r) => r.deductions.some((d) => d.kind === "furniture"));
  const where = atFurniture ? "у дверей, проёмов и мебели" : "у дверей и проёмов";
  let endsHint: string;
  if (ends === 0) endsHint = "плинтус идёт кольцом без разрывов";
  else if (!caps) endsHint = `${where}: торец подрезается ${atFurniture ? "вплотную" : "к наличнику"}`;
  else if (p.handedEndCaps) {
    endsHint = `${where}: ${left} ${pluralize(left, ["левая", "левые", "левых"])} и ${right} ${pluralize(right, ["правая", "правые", "правых"])}`;
  } else endsHint = `${where} — по заглушке на каждый конец`;
  rows.push({ id: "ends", k: caps || fittings ? "Заглушки" : "Торцы", hint: endsHint, v: pcs(ends) });

  rows.push({
    id: "joints",
    k: `Стыки ${words.genPl}`,
    hint:
      pe.joints === 0
        ? "все стены короче планки — стыков нет"
        : connectors
          ? `стены длиннее ${stockText(p.length)} — по соединителю на стык`
          : p.material === "ceramic"
            ? `стены длиннее ${stockText(p.length)} — элементы кладутся встык со швом`
            : `стены длиннее ${stockText(p.length)} — стык встык или на ус (45°)`,
    v: pcs(pe.joints),
  });

  // Как в домене: по каждому участку — шаг плюс точки на краях, ещё по точке на стык, +10 %.
  const fastenerHint = `шаг ≈ ${formatLength(p.fastenerStep, "cm")}, по краям участков и у каждого стыка, +${pctText(FASTENER_RESERVE * 100, 0)} запас`;
  switch (p.fastening) {
    case "dowels":
    case "nails":
      rows.push({ id: "fastener", k: p.fastenerName, hint: fastenerHint, v: pcs(acc.fasteners) });
      break;
    case "clips":
      rows.push({ id: "fastener", k: p.fastenerName, hint: fastenerHint, v: pcs(acc.fasteners) });
      rows.push({ id: "dowel", k: "Дюбели для клипс", hint: "по одному на клипсу", v: pcs(acc.dowels) });
      break;
    case "glue": {
      const rate = formatNumber(p.glueRate, 1, { trim: true });
      rows.push({
        id: "glue",
        k: p.fastenerName,
        hint: `≈ ${rate} пог. м на тубу: ${formatNumber(pe.netLength, 2)} ÷ ${rate} → вверх`,
        v: `${formatNumber(acc.glue, 0)} туб`,
      });
      break;
    }
    case "adhesive": {
      const rate = formatNumber(p.glueRate, 2, { trim: true });
      // В списке клей — мешками: расход 7 кг → 2 мешка по 5 кг.
      const bags = pe.lines.find((l) => l.kind === "glue")?.qty ?? 0;
      const bagsText =
        bags > 0 ? `; в списке — ${bags} ${pluralize(bags, ["мешок", "мешка", "мешков"])} по ${formatNumber(ADHESIVE_BAG_KG, 0)} кг` : "";
      rows.push({
        id: "glue",
        k: p.fastenerName,
        hint: `≈ ${rate} кг на пог. м: ${formatNumber(pe.netLength, 2)} × ${rate} → вверх${bagsText}`,
        v: `${formatNumber(acc.glue, 0)} кг`,
      });
      break;
    }
  }
  return rows;
}
