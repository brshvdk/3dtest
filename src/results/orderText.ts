/**
 * Текст списка покупок для буфера обмена / мессенджера / заметок.
 * Без таблиц и форматирования — читается в любом чате и на телефоне.
 */
import type { OrderLine, ProductEstimate, ProjectEstimate } from "../domain/estimate";
import type { Project } from "../domain/types";
import { formatMoney, formatNumber } from "../domain/units";
import { countText, meters, pctText, stockText, unitForms } from "./format";

function lineText(n: number, l: OrderLine): string {
  const qty = `${formatNumber(l.qty, 2, { trim: true })} ${l.unit}`;
  const price = l.unitPrice > 0 ? ` × ${formatMoney(l.unitPrice)} = ${formatMoney(l.total)}` : "";
  // Двоеточие, а не тире: в названии плинтуса тире уже есть («2,5 м — Белый»).
  return `${n}. ${l.name}: ${qty}${price}`;
}

function roomsText(pe: ProductEstimate): string {
  return pe.rooms
    .filter((r) => r.netLength > 0)
    .map((r) => `${r.roomName} (${meters(r.netLength)})`)
    .join(", ");
}

function roomsHeading(pe: ProductEstimate): string {
  const n = pe.rooms.filter((r) => r.netLength > 0).length;
  return `${n > 1 ? "Комнаты" : "Комната"}: ${roomsText(pe)}`;
}

/** Пояснение к числу планок: «15,25 м по стенам, раскрой — 7 планок по 2,5 м, плюс 1 в запас (5 %)». */
function planksNote(pe: ProductEstimate, reservePct: number): string {
  const forms = unitForms(pe.product);
  const reserve =
    pe.reservePlanks > 0 ? `, плюс ${formatNumber(pe.reservePlanks, 0)} в запас (${pctText(reservePct)})` : "";
  return (
    `${meters(pe.netLength)} плинтуса по стенам, раскрой — ${countText(pe.planksMin, forms)} ` +
    `по ${stockText(pe.product.length)}${reserve}`
  );
}

export function buildOrderText(estimate: ProjectEstimate, project: Project): string {
  const out: string[] = [`Плинтус — «${project.name}»`];
  const products = estimate.products.filter((p) => p.lines.length > 0);
  const reservePct = project.skirting.reservePct;

  if (!products.length) {
    out.push(
      "",
      estimate.products.length
        ? "Плинтус не нужен: весь периметр занят проёмами и мебелью."
        : "Расчёт плинтуса выключен во всех комнатах.",
    );
    return out.join("\n");
  }

  const multi = products.length > 1;
  let n = 0;
  for (const pe of products) {
    out.push("");
    if (multi) out.push(`${pe.product.shortName} — ${roomsText(pe)}`);
    else out.push(roomsHeading(pe));
    for (const l of pe.lines) out.push(lineText(++n, l));
    if (multi) out.push(`Сумма: ${formatMoney(pe.cost)}`);
  }

  out.push("", `Итого: ${formatMoney(estimate.totalCost)}`, "");
  for (const pe of products) {
    out.push(multi ? `${pe.product.shortName}: ${planksNote(pe, reservePct)}.` : `Расчёт: ${planksNote(pe, reservePct)}.`);
  }

  const skipped = project.rooms.filter((r) => !r.skirtingEnabled).map((r) => r.name);
  if (skipped.length) out.push(`Без плинтуса: ${skipped.join(", ")}.`);
  out.push("Цены ориентировочные. Посчитано в «Мерке».");
  return out.join("\n");
}
