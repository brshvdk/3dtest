/**
 * Подробности итога: «Как мы посчитали», «Углы, стыки, крепёж», «Комната».
 * Всё — простым языком и с числами, чтобы пользователь мог проверить расчёт.
 */
import { memo, useMemo, type ReactNode } from "react";
import type { ProductEstimate, ProjectEstimate } from "../domain/estimate";
import { wallLabel } from "../domain/geometry";
import { affectsSkirting, describeOpening } from "../domain/openings";
import { computeProjectMetrics } from "../domain/roomMetrics";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import type { Opening, Project, Room } from "../domain/types";
import { formatArea, formatLength, formatNumber, formatVolume, pluralize } from "../domain/units";
import { getRoomMetrics } from "../state/hooks";
import { useAppStore } from "../state/store";
import { Disclosure, Icon, KV } from "../ui/kit";
import { accessoryRows } from "./accessoryText";
import { NBSP, countText, isUsefulOffcut, joinRu, meters, pctText, stockText, unitWords } from "./format";

/* --------------------------- Как мы посчитали --------------------------- */

function Line({
  sign,
  label,
  hint,
  value,
  tone,
}: {
  sign?: "−" | "+" | "=";
  label: ReactNode;
  hint?: ReactNode;
  value: ReactNode;
  tone?: "minus" | "plus" | "total" | "zero";
}) {
  return (
    <div className={`rs-line${tone ? ` rs-line--${tone}` : ""}`}>
      <span className="rs-line__sign" aria-hidden>
        {sign ?? ""}
      </span>
      <span className="rs-line__label">
        {label}
        {hint ? <span className="rs-line__hint">{hint}</span> : null}
      </span>
      <span className="rs-line__value num">{value}</span>
    </div>
  );
}

/** Почему проём не уменьшил плинтус: окно выше плинтуса или его место уже вычтено соседним проёмом. */
function zeroReason(o: Opening, skirtingHeight: number): string {
  if (!affectsSkirting(o, skirtingHeight)) {
    return o.kind === "window" ? "выше плинтуса — не мешает" : "не мешает плинтусу";
  }
  return "перекрыт другим проёмом — уже учтён";
}

function RoomCalc({
  r,
  room,
  skirtingHeight,
  showName,
  openings,
}: {
  r: RoomSkirtingResult;
  room: Room | undefined;
  skirtingHeight: number;
  showName: boolean;
  openings: Map<string, Opening>;
}) {
  const counted = new Set([...r.deductions.map((d) => d.openingId), ...r.reveals.map((rv) => rv.openingId)]);
  const zero = room ? room.openings.filter((o) => !counted.has(o.id)) : [];
  const wallOf = room ? new Map(room.points.map((p, i) => [p.id, i])) : new Map<string, number>();
  return (
    <div className="rs-calc__room">
      {showName ? <div className="rs-calc__room-name">{r.roomName}</div> : null}
      <Line label="Периметр комнаты" hint="сумма длин всех стен" value={meters(r.perimeter)} />
      {r.deductions.map((d) => (
        <Line
          key={d.openingId}
          sign="−"
          tone="minus"
          label={d.label}
          hint={`стена ${d.wallLabel}${(openings.get(d.openingId)?.casing ?? 0) > 0 && d.kind !== "furniture" ? " · с наличниками" : ""}`}
          value={`−${formatLength(d.length)}`}
        />
      ))}
      {r.reveals.map((rv) => (
        <Line
          key={rv.openingId}
          sign="+"
          tone="plus"
          label={`Откосы: ${rv.label}`}
          hint={`стена ${rv.wallLabel} · плинтус заходит в проём`}
          value={`+${formatLength(rv.length)}`}
        />
      ))}
      {zero.map((o) => (
        <Line
          key={o.id}
          tone="zero"
          label={describeOpening(o)}
          hint={`стена ${wallOf.has(o.wallId) ? wallLabel(wallOf.get(o.wallId)!) : "?"} · ${zeroReason(o, skirtingHeight)}`}
          value={formatLength(0)}
        />
      ))}
      <Line sign="=" tone="total" label="Плинтус по стенам" value={meters(r.netLength)} />
    </div>
  );
}


function Step({ n, title, value, children }: { n: number; title: ReactNode; value: ReactNode; children?: ReactNode }) {
  return (
    <li className="rs-step">
      <span className="rs-step__n" aria-hidden>
        {n}
      </span>
      <div className="rs-step__body">
        <div className="rs-step__head">
          <span className="rs-step__title">{title}</span>
          <span className="rs-step__value num">{value}</span>
        </div>
        {children ? <p className="rs-step__text">{children}</p> : null}
      </div>
    </li>
  );
}

function ProductCalc({
  pe,
  rooms,
  reservePct,
  minPiece,
  showRooms,
  showProduct,
  openings,
}: {
  pe: ProductEstimate;
  rooms: Map<string, Room>;
  reservePct: number;
  /** м, «мин. кусок» из настроек раскроя. */
  minPiece: number;
  showRooms: boolean;
  showProduct: boolean;
  openings: Map<string, Opening>;
}) {
  const p = pe.product;
  const words = unitWords(p);
  const forms = words.forms;
  const L = p.length;
  const ratio = pe.netLength / L;
  const naive = pe.planksNaive;
  const ratioText = formatNumber(ratio, ratio < 10 ? 2 : 1, { trim: true });
  const mult = 1 + reservePct / 100;
  const roundedUp = Math.abs(ratio - Math.round(ratio)) > 1e-6;

  // Обрезки, из которых вышел бы целый кусок: значит, лишние планки — от того, как нарезаны стены.
  const longOffcuts = pe.cutPlan.bars.filter((b) => isUsefulOffcut(b.waste) && b.waste >= minPiece - 1e-6).length;

  let cutText: ReactNode;
  if (pe.planksMin > naive && p.material === "ceramic") {
    // У керамики шов между элементами — норма; дело не в склейке, а в том, что кусок режется из одного элемента.
    cutText = (
      <>
        Делением выходит {naive}, но по раскрою — {pe.planksMin}: каждый кусок вырезается из одного элемента, а
        обрезки короче нужного куска уходят в бой.
      </>
    );
  } else if (pe.planksMin > naive && longOffcuts > 0) {
    cutText = (
      <>
        Делением выходит {naive}, но по раскрою — {pe.planksMin}: каждый кусок режется {words.fromOne}, а куски,
        на которые поделены длинные стены, не укладываются в планки без остатка. Остаются длинные обрезки (
        {formatNumber(longOffcuts, 0)}{NBSP}шт.): если перенести стыки на длинных стенах или уменьшить «мин. кусок»
        ({formatLength(minPiece, "cm")}), ими можно закрыть часть стены — и {words.genPl} понадобится меньше.
      </>
    );
  } else if (pe.planksMin > naive) {
    cutText = (
      <>
        Делением выходит {naive}, но по раскрою — {pe.planksMin}: каждый кусок режется {words.fromOne}, а обрезки
        оказались короче нужных кусков. Склеивать плинтус из мелких обрезков нельзя — стык будет заметен.
      </>
    );
  } else {
    cutText = (
      <>
        {roundedUp ? `${ratioText} ${words.gen} не купить — округляем до ${naive}. ` : ""}
        Каждая стена собирается из кусков, остаются обрезки — на схеме раскроя они заштрихованы.
      </>
    );
  }

  return (
    <div className="rs-calc__product">
      {showProduct ? <div className="rs-calc__product-name">{p.name}</div> : null}
      {pe.rooms.map((r) => (
        <RoomCalc
          key={r.roomId}
          r={r}
          room={rooms.get(r.roomId)}
          skirtingHeight={p.height}
          showName={showRooms}
          openings={openings}
        />
      ))}
      {pe.rooms.length > 1 ? (
        <Line
          sign="="
          tone="total"
          label="Всего плинтуса"
          hint={pe.rooms.map((r) => formatNumber(r.netLength, 2)).join(" + ")}
          value={meters(pe.netLength)}
        />
      ) : null}

      {pe.netLength > 0 ? (
        <ol className="rs-steps">
          <Step
            n={1}
            title={`Делим на длину ${words.gen}`}
            value={`${formatNumber(pe.netLength, 2)} ÷ ${formatNumber(L, 2, { trim: true })} = ${ratioText}`}
          />
          <Step n={2} title={`Раскрой по ${p.material === "ceramic" ? "элементам" : "планкам"}`} value={countText(pe.planksMin, forms)}>
            {cutText}
          </Step>
          <Step
            n={3}
            title={reservePct > 0 ? `Добавляем запас ${pctText(reservePct)}` : "Запас"}
            value={reservePct > 0 ? `+${formatNumber(pe.reservePlanks, 0)}` : "нет"}
          >
            {reservePct > 0
              ? `${pe.planksMin} × ${formatNumber(mult, 3, { trim: true })} = ${formatNumber(pe.planksMin * mult, 2, { trim: true })} → округляем вверх. Запас — на брак и ошибку при резке.`
              : "Без запаса рискованно: одна ошибка при резке — и придётся ехать в магазин ещё раз."}
          </Step>
          <li className="rs-steps__result">
            <span>Заказать</span>
            <span className="num">
              {countText(pe.planksToOrder, forms)} · {stockText(pe.lengthToOrder)}
            </span>
          </li>
        </ol>
      ) : null}
    </div>
  );
}

export const CalcDetails = memo(function CalcDetails({
  project,
  estimate,
  defaultOpen,
}: {
  project: Project;
  estimate: ProjectEstimate;
  defaultOpen: boolean;
}) {
  const setPanelTab = useAppStore((s) => s.setPanelTab);
  const s = project.skirting;
  const multiRooms = estimate.rooms.length > 1;
  const skipped = project.rooms.filter((r) => !r.skirtingEnabled).map((r) => `«${r.name}»`);
  const openings = useMemo(() => new Map(project.rooms.flatMap((r) => r.openings.map((o) => [o.id, o] as const))), [project]);
  const rooms = useMemo(() => new Map(project.rooms.map((r) => [r.id, r] as const)), [project]);

  return (
    <section className="k-section rs-details">
      <Disclosure title="Как мы посчитали" icon="list" defaultOpen={defaultOpen}>
        <div className="rs-calc">
          {estimate.products.map((pe) => (
            <ProductCalc
              key={pe.product.id}
              pe={pe}
              rooms={rooms}
              reservePct={s.reservePct}
              minPiece={s.minPiece}
              showRooms={multiRooms}
              showProduct={estimate.products.length > 1}
              openings={openings}
            />
          ))}
          {skipped.length ? (
            <p className="rs-calc__note">
              {skipped.length > 1
                ? `Не учитываются ${joinRu(skipped)} — в этих комнатах расчёт плинтуса выключен.`
                : `Не учитывается ${skipped[0]} — в этой комнате расчёт плинтуса выключен.`}
            </p>
          ) : null}
          <div className="rs-calc__params">
            <span>
              {/* Керамику режут плиткорезом: домен считает её без пропила. */}
              {estimate.products.some((pe) => pe.product.material !== "ceramic")
                ? `Пропил ${formatNumber(s.kerf * 1000, 1, { trim: true })} мм · мин. кусок `
                : "Мин. кусок "}
              {formatLength(s.minPiece, "cm")}
              {project.rooms.length > 1
                ? s.shareOffcuts
                  ? " · обрезки переносятся между комнатами"
                  : " · обрезки между комнатами не переносятся"
                : ""}
            </span>
            <button type="button" className="rs-link" onClick={() => setPanelTab("skirting")}>
              Изменить
            </button>
          </div>
        </div>
      </Disclosure>
    </section>
  );
});

/* ------------------------- Углы, стыки, крепёж ------------------------- */

function AccessoryRows({ pe }: { pe: ProductEstimate }) {
  const rows = accessoryRows(pe);
  if (!rows.length) return <p className="rs-empty-line">Плинтус не нужен — фурнитура и крепёж тоже.</p>;
  return (
    <div className="rs-acc">
      {rows.map((r) => (
        <KV key={r.id} k={r.k} hint={r.hint} v={r.v} />
      ))}
    </div>
  );
}

/* ------------------------------- Комната ------------------------------- */

function RoomMetricsView({ project, room }: { project: Project; room: Room }) {
  const m = getRoomMetrics(room);
  const total = useMemo(
    () => (project.rooms.length > 1 ? computeProjectMetrics(project).total : null),
    [project],
  );
  return (
    <div className="rs-room">
      <dl className="rs-tiles">
        <div className="rs-tile">
          <dt>Площадь пола</dt>
          <dd className="num">{formatArea(m.floorArea, 1)}</dd>
        </div>
        <div className="rs-tile">
          <dt>Периметр</dt>
          <dd className="num">{meters(m.perimeter)}</dd>
        </div>
        <div className="rs-tile">
          <dt>Объём</dt>
          <dd className="num">{formatVolume(m.volume)}</dd>
        </div>
        <div className="rs-tile">
          <dt>Стены без проёмов</dt>
          <dd className="num">{formatArea(m.wallAreaNet, 1)}</dd>
        </div>
      </dl>
      <KV k="Высота потолка" v={meters(room.height)} />
      <KV
        k="Стены и углы"
        v={`${m.walls} ${pluralize(m.walls, ["стена", "стены", "стен"])} · ${m.innerCorners + m.outerCorners} ${pluralize(m.innerCorners + m.outerCorners, ["угол", "угла", "углов"])}`}
      />
      {m.openingsArea > 0 ? <KV k="Площадь проёмов" v={formatArea(m.openingsArea, 1)} /> : null}
      {total ? (
        <div className="rs-room__total">
          <Icon name="home" size={15} />
          <span>
            Все комнаты ({project.rooms.length}): пол {formatArea(total.floorArea, 1)}, периметр {meters(total.perimeter)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export const ExtraDetails = memo(function ExtraDetails({
  project,
  estimate,
  activeRoom,
}: {
  project: Project;
  estimate: ProjectEstimate;
  activeRoom: Room;
}) {
  // Плинтус не нужен ни в одной комнате — фурнитуры и крепежа тоже нет, раздел не показываем.
  const products = estimate.products.filter((pe) => pe.netLength > 0);
  const corners = products.reduce((s, pe) => s + pe.rooms.reduce((a, r) => a + r.corners.inner + r.corners.outer, 0), 0);
  return (
    <section className="k-section rs-details">
      {products.length ? (
        <Disclosure
          title="Углы, стыки, крепёж"
          icon="settings"
          right={corners > 0 ? `${corners} ${pluralize(corners, ["угол", "угла", "углов"])}` : undefined}
        >
          {products.map((pe) => (
            <div key={pe.product.id} className="rs-acc-group">
              {products.length > 1 ? <div className="rs-calc__product-name">{pe.product.shortName}</div> : null}
              <AccessoryRows pe={pe} />
            </div>
          ))}
        </Disclosure>
      ) : null}
      <Disclosure title="Комната" icon="room" right={activeRoom.name}>
        <RoomMetricsView project={project} room={activeRoom} />
      </Disclosure>
    </section>
  );
});

