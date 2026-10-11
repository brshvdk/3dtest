/**
 * Лист для печати / PDF (A4): шапка, что купить, список покупок, схема
 * каждой комнаты с расчётом, упрощённый раскрой. Читается и в ч/б.
 *
 * На экране лист скрыт (.print-only), поэтому содержимое рендерится только
 * когда оно видно: перед печатью (beforeprint → flushSync) или в превью
 * песочницы (.print-preview). Иначе при каждом движении стены пересчитывались
 * бы невидимые планы всех комнат.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CutBar, CutPlan } from "../domain/cutting";
import type { ProductEstimate, ProjectEstimate } from "../domain/estimate";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import { getColorName } from "../domain/skirtingCatalog";
import type { Project, Room } from "../domain/types";
import { formatArea, formatLength, formatMoney, formatNumber, pluralize } from "../domain/units";
import { PlanSvg } from "../plan/PlanSvg";
import { getEstimate, getRoomMetrics } from "../state/hooks";
import { useAppStore } from "../state/store";
import { Icon } from "../ui/kit";
import { USEFUL_OFFCUT, growOf } from "./CutPlan";
import { countText, formatDateRu, joinRu, meters, pctText, pieceText, shortLen, splitPieceLabel, stockText, unitForms, wasteLen } from "./format";
import "./results.css";

/* ------------------------------- Итог -------------------------------- */

function BuyCard({ pe, reservePct }: { pe: ProductEstimate; reservePct: number }) {
  const p = pe.product;
  const forms = unitForms(p);
  if (pe.netLength <= 0) {
    return (
      <div className="rs-sheet__buy">
        <div className="rs-sheet__buy-main">Плинтус не нужен</div>
        <div className="rs-sheet__buy-facts">{joinRu(pe.rooms.map((r) => r.roomName))}: весь периметр занят проёмами и мебелью.</div>
      </div>
    );
  }
  return (
    <div className="rs-sheet__buy">
      <div className="rs-sheet__buy-main">
        <span className="rs-sheet__big">{formatNumber(pe.planksToOrder, 0)}</span> {pluralize(pe.planksToOrder, forms)} по{" "}
        {stockText(p.length)} <span className="rs-sheet__muted">({stockText(pe.lengthToOrder)})</span>
      </div>
      <div className="rs-sheet__buy-product">
        {p.name} · {getColorName(p)} · {p.cornerMethod === "miter" ? "углы — запил 45°" : "углы — фурнитура"}
      </div>
      <div className="rs-sheet__buy-facts">
        {joinRu(pe.rooms.map((r) => r.roomName))}: плинтус по стенам {meters(pe.netLength)} → по раскрою{" "}
        {countText(pe.planksMin, forms)}
        {pe.reservePlanks > 0 ? ` + ${formatNumber(pe.reservePlanks, 0)} запас (${pctText(reservePct)})` : ""}.
      </div>
    </div>
  );
}

function OrderSheetTable({ estimate }: { estimate: ProjectEstimate }) {
  const products = estimate.products.filter((pe) => pe.lines.length > 0);
  const multi = products.length > 1;
  let n = 0;
  return (
    <table className="rs-sheet__table">
      <thead>
        <tr>
          <th className="rs-sheet__no">№</th>
          <th>Наименование</th>
          <th className="rs-sheet__n">Кол-во</th>
          <th className="rs-sheet__n">Цена</th>
          <th className="rs-sheet__n">Сумма</th>
        </tr>
      </thead>
      {products.map((pe) => (
        <tbody key={pe.product.id}>
          {multi ? (
            <tr className="rs-sheet__group">
              <td colSpan={5}>
                {pe.product.shortName} — {joinRu(pe.rooms.map((r) => r.roomName))}
              </td>
            </tr>
          ) : null}
          {pe.lines.map((l) => (
            <tr key={l.id}>
              <td className="rs-sheet__no">{++n}</td>
              <td>
                {l.name}
                {l.note ? <div className="rs-sheet__note">{l.note}</div> : null}
              </td>
              <td className="rs-sheet__n">
                {formatNumber(l.qty, 2, { trim: true })} {l.unit}
              </td>
              <td className="rs-sheet__n">{formatMoney(l.unitPrice)}</td>
              <td className="rs-sheet__n">{formatMoney(l.total)}</td>
            </tr>
          ))}
        </tbody>
      ))}
      <tfoot>
        <tr>
          <td />
          <td colSpan={3}>Итого</td>
          <td className="rs-sheet__n">{formatMoney(estimate.totalCost)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ------------------------------ Комнаты ------------------------------ */

/** Схема комнаты на листе, px. Подобрано так, чтобы одна комната с раскроем помещалась на 1 лист A4. */
const PLAN_W = 310;
const PLAN_H = 212;

function RoomBlock({ room, result, no }: { room: Room; result: RoomSkirtingResult | undefined; no: number | null }) {
  const m = getRoomMetrics(room);
  return (
    <section className="rs-sheet__room">
      <div className="rs-sheet__plan">
        <PlanSvg room={room} result={result} width={PLAN_W} height={PLAN_H} showDims showSkirting={!!result} />
      </div>
      <div className="rs-sheet__calc">
        <h3>
          {no !== null ? <span className="rs-sheet__rno">{no}</span> : null}
          {room.name}
        </h3>
        <div className="rs-sheet__facts">
          Пол {formatArea(m.floorArea, 1)} · высота {meters(room.height)} · {m.walls}{" "}
          {pluralize(m.walls, ["стена", "стены", "стен"])}
        </div>
        {result ? (
          <table className="rs-sheet__calc-table">
            <tbody>
              <tr>
                <td>Периметр</td>
                <td className="rs-sheet__n">{meters(result.perimeter)}</td>
              </tr>
              {result.deductions.map((d) => (
                <tr key={d.openingId}>
                  <td>
                    − {d.label}, стена {d.wallLabel}
                  </td>
                  <td className="rs-sheet__n">−{formatLength(d.length)}</td>
                </tr>
              ))}
              {result.reveals.map((rv) => (
                <tr key={rv.openingId}>
                  <td>
                    + откосы: {rv.label}, стена {rv.wallLabel}
                  </td>
                  <td className="rs-sheet__n">+{formatLength(rv.length)}</td>
                </tr>
              ))}
              <tr className="rs-sheet__calc-total">
                <td>= Плинтус по стенам</td>
                <td className="rs-sheet__n">{meters(result.netLength)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="rs-sheet__muted">Плинтус в этой комнате не считается.</p>
        )}
        {result && result.netLength > 0 ? (
          <div className="rs-sheet__facts">
            Углы: внутр. {result.corners.inner}
            {result.corners.outer ? `, наруж. ${result.corners.outer}` : ""} · торцы: {result.endCaps.left + result.endCaps.right}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------ Раскрой ------------------------------ */

/** Номер комнаты (в порядке проекта) — для ч/б печати, где цвета комнат не видны. */
type RoomNo = (roomId: string) => number | null;

function SheetBar({ bar, no, stock, roomNo }: { bar: CutBar; no: number; stock: number; roomNo: RoomNo }) {
  return (
    <div className="rs-sheet__bar-row">
      <span className="rs-sheet__bar-no">{no}</span>
      <div className="rs-sheet__bar">
        {bar.pieces.map((p) => {
          const { main, part, reveal } = splitPieceLabel(p.label);
          const rn = roomNo(p.roomId);
          const mark = rn !== null ? <span className="rs-sheet__rno">{rn}</span> : null;
          return (
            <span key={p.id} className="rs-sheet__pc" style={{ flexGrow: growOf(p.length) }}>
              <span className="rs-sheet__t-long">
                {mark}
                {pieceText(p.label)} · {shortLen(p.length)}
              </span>
              {/* Средний кусок: «A 1/2 · 1,45» — короче «кусок 1 из 2», а дробь с участком «A2» не спутать. */}
              <span className="rs-sheet__t-mid">
                {mark}
                {reveal ? "откос " : ""}
                {main}
                {part ? ` ${part}` : ""} · {shortLen(p.length)}
              </span>
              <span className="rs-sheet__t-short">
                {mark}
                {main}
              </span>
            </span>
          );
        })}
        {bar.waste > stock * 0.004 ? (
          <span className="rs-sheet__waste" style={{ flexGrow: growOf(bar.waste) }}>
            <span className="rs-sheet__t-long">
              {wasteLen(bar.waste)}
              {bar.waste >= USEFUL_OFFCUT - 1e-9 ? " ✓" : ""}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SheetCut({ pe, title, roomNo }: { pe: ProductEstimate; title: string | null; roomNo: RoomNo }) {
  const plan: CutPlan = pe.cutPlan;
  const forms = unitForms(pe.product);
  const multiRoom = pe.rooms.length > 1;
  const markOf: RoomNo = multiRoom ? roomNo : () => null;
  const full: Array<{ bar: CutBar; no: number }> = [];
  const cut: Array<{ bar: CutBar; no: number }> = [];
  plan.bars.forEach((b, i) => (b.pieces.length === 1 && b.pieces[0].full ? full : cut).push({ bar: b, no: i + 1 }));
  // Целые планки — по комнатам: «Гостиная — A 1/2, B 1/2; Спальня — B».
  const fullByRoom = pe.rooms
    .map((r) => ({
      room: r,
      names: full.filter(({ bar }) => bar.pieces[0].roomId === r.roomId).map(({ bar }) => pieceText(bar.pieces[0].label)),
    }))
    .filter((g) => g.names.length > 0);
  return (
    <div className="rs-sheet__cut">
      {title ? <h3>{title}</h3> : null}
      <p className="rs-sheet__facts">
        {countText(plan.bars.length, forms)} по {stockText(plan.stockLength)} · в дело {pctText(Math.round(plan.efficiency * 100), 0)} ·
        длины в метрах · ✓ — обрезок пригодится
        {multiRoom ? " · цифра в рамке — номер комнаты" : ""}
      </p>
      {full.length ? (
        <p className="rs-sheet__full">
          <b>Целиком ({full.length}):</b>{" "}
          {multiRoom
            ? fullByRoom.map((g, i) => (
                <span key={g.room.roomId}>
                  {i > 0 ? "; " : ""}
                  <span className="rs-sheet__rno">{roomNo(g.room.roomId)}</span>
                  {g.room.roomName} — {g.names.join(", ")}
                </span>
              ))
            : full.map(({ bar }) => pieceText(bar.pieces[0].label)).join(", ")}
        </p>
      ) : null}
      <div className="rs-sheet__bars">
        {cut.map(({ bar, no }) => (
          <SheetBar key={no} bar={bar} no={no} stock={plan.stockLength} roomNo={markOf} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- Лист -------------------------------- */

function SheetContent() {
  const project: Project = useAppStore((s) => s.project);
  const estimate = getEstimate(project);
  const products = estimate.products;
  const withBars = products.filter((pe) => pe.cutPlan.bars.length > 0);
  const results = new Map(estimate.rooms.map((r) => [r.roomId, r]));
  const date = formatDateRu(new Date(project.updatedAt || Date.now()));
  const warnings = [...new Set(estimate.warnings)];
  // Номера комнат на листе (в порядке проекта) — общие для схем и раскроя.
  const numbered = project.rooms.length > 1;
  const roomIndex = new Map(project.rooms.map((r, i) => [r.id, i + 1]));
  const roomNo: RoomNo = (id) => (numbered ? roomIndex.get(id) ?? null : null);
  const allCeramic = withBars.length > 0 && withBars.every((pe) => pe.product.material === "ceramic");

  return (
    <article className="rs-sheet">
      <header className="rs-sheet__head">
        <div className="rs-sheet__brand">
          <span className="rs-sheet__mark" aria-hidden>
            <Icon name="ruler" size={16} strokeWidth={2} />
          </span>
          <div>
            <div className="rs-sheet__brand-name">Мерка</div>
            <div className="rs-sheet__brand-sub">Расчёт плинтуса</div>
          </div>
        </div>
        <div className="rs-sheet__meta">
          <div className="rs-sheet__project">{project.name}</div>
          <div className="rs-sheet__muted">{date}</div>
        </div>
      </header>

      <section className="rs-sheet__summary">
        <h2>Нужно купить</h2>
        {products.length ? (
          products.map((pe) => <BuyCard key={pe.product.id} pe={pe} reservePct={project.skirting.reservePct} />)
        ) : (
          <p>Расчёт плинтуса выключен во всех комнатах.</p>
        )}
        {estimate.totalCost > 0 ? (
          <div className="rs-sheet__total">
            <span>Итого, примерно</span>
            <b>{formatMoney(estimate.totalCost)}</b>
          </div>
        ) : null}
      </section>

      {estimate.lines.length ? (
        <section className="rs-sheet__section">
          <h2>Список покупок</h2>
          <OrderSheetTable estimate={estimate} />
        </section>
      ) : null}

      {warnings.length ? (
        <section className="rs-sheet__section rs-sheet__warn">
          {warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </section>
      ) : null}

      <section className="rs-sheet__section">
        {/* Заголовок не отрываем от первой комнаты при переносе страницы. */}
        <div className="rs-sheet__keep">
          <h2>{project.rooms.length > 1 ? "Комнаты" : "Комната"}</h2>
          {project.rooms.slice(0, 1).map((room) => (
            <RoomBlock key={room.id} room={room} result={results.get(room.id)} no={roomNo(room.id)} />
          ))}
        </div>
        {project.rooms.slice(1).map((room) => (
          <RoomBlock key={room.id} room={room} result={results.get(room.id)} no={roomNo(room.id)} />
        ))}
      </section>

      {withBars.length ? (
        <section className="rs-sheet__section rs-sheet__cut-section">
          <h2>{allCeramic ? "Раскрой элементов" : "Раскрой планок"}</h2>
          {withBars.map((pe) => (
            <SheetCut
              key={pe.product.id}
              pe={pe}
              title={withBars.length > 1 ? pe.product.shortName : null}
              roomNo={roomNo}
            />
          ))}
        </section>
      ) : null}

      <footer className="rs-sheet__foot">
        Цены ориентировочные — уточните их в магазине. Длина плинтуса посчитана по внутренним граням стен за вычетом
        дверей и проёмов (с наличниками); запас и раскрой учтены. Мерка · {date}
      </footer>
    </article>
  );
}

export function PrintSheet(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    const visible = () => {
      const el = ref.current;
      return !!el && getComputedStyle(el).display !== "none";
    };
    if (visible()) setActive(true);
    // Перед печатью — синхронно, иначе браузер снимет пустой лист.
    const before = () => flushSync(() => setActive(true));
    const after = () => {
      if (!visible()) setActive(false);
    };
    const mq = window.matchMedia?.("print");
    const onMedia = (e: MediaQueryListEvent) => (e.matches ? before() : after());
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    mq?.addEventListener?.("change", onMedia);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      mq?.removeEventListener?.("change", onMedia);
    };
  }, []);

  return (
    <div ref={ref} className="print-only rs-print">
      {active ? <SheetContent /> : null}
    </div>
  );
}
