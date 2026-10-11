/**
 * Схема раскроя планок: каждая планка — полоса пропорционально длине,
 * куски подписаны (A, B2, откос), обрезок заштрихован.
 *
 * Связь с планом и 3D — через hoverSegmentId в сторе: наведение на кусок
 * подсвечивает участок плинтуса, наведение на участок на плане — куски здесь.
 * Каждый кусок подписан на стор сам (булев селектор), поэтому при наведении
 * перерисовываются только два-три куска, а не вся схема.
 */
import { memo, useMemo, useState, type FocusEvent, type PointerEvent } from "react";
import type { CutBar, Piece } from "../domain/cutting";
import type { ProductEstimate } from "../domain/estimate";
import type { SkirtingSegment } from "../domain/skirtingCalc";
import { formatNumber, pluralize } from "../domain/units";
import { useAppStore } from "../state/store";
import { Badge, Icon, useMediaQuery } from "../ui/kit";
import {
  NBSP,
  countText,
  describePiece,
  meters,
  numberRanges,
  partText,
  pctText,
  shortLen,
  splitPieceLabel,
  stockText,
  unitForms,
} from "./format";

/** м: обрезок от этой длины «пригодится» (подойдёт на короткий участок). */
export const USEFUL_OFFCUT = 0.3;
/** Сколько оттенков для комнат (дальше — по кругу). */
const ROOM_TINTS = 8;

/**
 * flex-grow пропорционально длине. В миллиметрах, а не метрах: при сумме
 * flex-grow < 1 флекс раздаёт только часть места, и планка короче 1 м
 * (керамика 0,6 м) рисовалась бы недозаполненной.
 */
export const growOf = (m: number): number => Math.max(1, Math.round(m * 1000));

interface PieceRef {
  piece: Piece;
  /** Номер планки, с 1. */
  bar: number;
}

interface SegmentInfo {
  segment: SkirtingSegment;
  roomName: string;
}

interface PlanData {
  fullBars: CutBar[];
  cutBars: CutBar[];
  /** Номер (с 1) каждой планки по ссылке. */
  barNo: Map<CutBar, number>;
  roomTint: Map<string, number>;
  bySegment: Map<string, PieceRef[]>;
  segments: Map<string, SegmentInfo>;
  usefulOffcuts: number;
  multiRoom: boolean;
  /** «Планка» / «Элемент» — для подписей и подсказок. */
  unit: string;
}

function buildData(pe: ProductEstimate): PlanData {
  const { bars } = pe.cutPlan;
  const fullBars: CutBar[] = [];
  const cutBars: CutBar[] = [];
  const barNo = new Map<CutBar, number>();
  const bySegment = new Map<string, PieceRef[]>();
  bars.forEach((b, i) => {
    barNo.set(b, i + 1);
    if (b.pieces.length === 1 && b.pieces[0].full) fullBars.push(b);
    else cutBars.push(b);
    for (const piece of b.pieces) {
      for (const id of piece.segmentIds) {
        const list = bySegment.get(id);
        if (list) list.push({ piece, bar: i + 1 });
        else bySegment.set(id, [{ piece, bar: i + 1 }]);
      }
    }
  });
  const segments = new Map<string, SegmentInfo>();
  for (const r of pe.rooms) for (const s of r.segments) segments.set(s.id, { segment: s, roomName: r.roomName });
  const roomTint = new Map(pe.roomIds.map((id, i) => [id, i % ROOM_TINTS]));
  return {
    fullBars,
    cutBars,
    barNo,
    roomTint,
    bySegment,
    segments,
    usefulOffcuts: bars.filter((b) => b.waste >= USEFUL_OFFCUT - 1e-9).length,
    multiRoom: pe.roomIds.length > 1,
    unit: capitalize(unitForms(pe.product)[0]),
  };
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------- Кусок -------------------------------- */

/** Тип последнего указателя: касание переключает подсветку, мышь — наводит. */
let lastPointer = "mouse";
const rememberPointer = (e: PointerEvent) => {
  lastPointer = e.pointerType;
};

function useHotPiece(piece: Piece): boolean {
  return useAppStore((s) => s.hoverSegmentId !== null && piece.segmentIds.includes(s.hoverSegmentId));
}

function pieceHandlers(piece: Piece) {
  const seg = piece.segmentIds[0];
  const ours = () => {
    const h = useAppStore.getState().hoverSegmentId;
    return h !== null && piece.segmentIds.includes(h);
  };
  return {
    onPointerDown: rememberPointer,
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") useAppStore.getState().setHoverSegment(seg);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse" && ours()) useAppStore.getState().setHoverSegment(null);
    },
    // Только фокус с клавиатуры: фокус от касания пришёл бы раньше click и тут же снялся бы им.
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(":focus-visible")) useAppStore.getState().setHoverSegment(seg);
    },
    onBlur: () => {
      if (ours()) useAppStore.getState().setHoverSegment(null);
    },
    onClick: () => {
      const s = useAppStore.getState();
      // Кусок другой комнаты — показываем эту комнату на плане.
      if (piece.roomId !== s.activeRoomId) s.setActiveRoom(piece.roomId);
      if (lastPointer === "mouse") s.setHoverSegment(seg);
      else s.setHoverSegment(ours() ? null : seg);
    },
  };
}

const PieceBlock = memo(function PieceBlock({
  piece,
  tint,
  bar,
  unit,
  roomName,
}: {
  piece: Piece;
  tint: number | null;
  bar: number;
  unit: string;
  roomName: string | null;
}) {
  const hot = useHotPiece(piece);
  const { main, part, reveal } = splitPieceLabel(piece.label);
  const handlers = useMemo(() => pieceHandlers(piece), [piece]);
  const where = `${roomName ? `${roomName}, ` : ""}${describePiece(piece.label)}`;
  return (
    <button
      type="button"
      className={`rs-pc${tint !== null ? ` rs-tint-${tint}` : ""}${hot ? " is-hot" : ""}`}
      style={{ flexGrow: growOf(piece.length) }}
      aria-label={`${unit} ${bar}: ${where} — ${meters(piece.length)}`}
      title={`${where} — ${meters(piece.length)}`}
      {...handlers}
    >
      <span className="rs-pc__label">
        {reveal ? "откос " : ""}
        {main}
        {/* На узком куске номер части прячется (CSS): «B» и длины достаточно, подробности — в подсказке. */}
        {part ? <small className="rs-pc__part"> {partText(part)}</small> : null}
      </span>
      <span className="rs-pc__len">{shortLen(piece.length)}</span>
    </button>
  );
});

const PieceChip = memo(function PieceChip({
  piece,
  tint,
  bar,
  unit,
  roomName,
}: {
  piece: Piece;
  tint: number | null;
  bar: number;
  unit: string;
  roomName: string | null;
}) {
  const hot = useHotPiece(piece);
  const { main, part, reveal } = splitPieceLabel(piece.label);
  const handlers = useMemo(() => pieceHandlers(piece), [piece]);
  const where = `${roomName ? `${roomName}, ` : ""}${describePiece(piece.label)}`;
  return (
    <button
      type="button"
      className={`rs-chip${tint !== null ? ` rs-tint-${tint}` : ""}${hot ? " is-hot" : ""}`}
      aria-label={`${unit} ${bar} целиком: ${where}`}
      title={`${unit} ${bar} целиком — ${where}`}
      {...handlers}
    >
      <span>
        {reveal ? "откос " : ""}
        {main}
        {part ? <small> {partText(part)}</small> : null}
      </span>
    </button>
  );
});

/* ------------------------------ Планка -------------------------------- */

const BarRow = memo(function BarRow({
  bar,
  no,
  data,
  stock,
}: {
  bar: CutBar;
  no: number;
  data: PlanData;
  stock: number;
}) {
  const useful = bar.waste >= USEFUL_OFFCUT - 1e-9;
  const roomName = (p: Piece) => (data.multiRoom ? data.segments.get(p.segmentIds[0])?.roomName ?? null : null);
  const tint = (p: Piece) => (data.multiRoom ? data.roomTint.get(p.roomId) ?? 0 : null);
  return (
    <li className="rs-bar-row">
      <span className="rs-bar-row__no" aria-hidden>
        {no}
      </span>
      <div className="rs-bar" role="group" aria-label={`${data.unit} ${no}`}>
        {bar.pieces.map((p) => (
          <PieceBlock key={p.id} piece={p} tint={tint(p)} bar={no} unit={data.unit} roomName={roomName(p)} />
        ))}
        {bar.waste > stock * 0.004 ? (
          <span
            className={`rs-waste${useful ? " is-useful" : ""}`}
            style={{ flexGrow: growOf(bar.waste) }}
            title={`Обрезок ${meters(bar.waste)}${useful ? " — пригодится" : ""}`}
          >
            <span className="rs-waste__len">
              {useful ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
              {shortLen(bar.waste)}
            </span>
            {useful ? <span className="rs-waste__tag">пригодится</span> : null}
          </span>
        ) : null}
      </div>
    </li>
  );
});

/* --------------------------- Подсказка снизу --------------------------- */

function segmentName(s: SkirtingSegment): string {
  if (s.isReveal) return `откос у стены ${s.wallLabel}`;
  if (s.label === s.wallLabel) return `стена ${s.wallLabel}`;
  return `стена ${s.wallLabel}, участок ${s.label.slice(s.wallLabel.length)}`;
}

const HoverInfo = memo(function HoverInfo({ data }: { data: PlanData }) {
  const hoverId = useAppStore((s) => s.hoverSegmentId);
  const touch = useMediaQuery("(hover: none)");
  const info = hoverId ? data.segments.get(hoverId) : undefined;
  const refs = hoverId ? data.bySegment.get(hoverId) : undefined;
  if (!info || !refs?.length) {
    return (
      <p className="rs-cut__hint">
        <Icon name="info" size={14} />
        {touch ? "Нажмите на кусок — он подсветится на плане" : "Наведите на кусок — он подсветится на плане и в 3D"}
      </p>
    );
  }
  const s = info.segment;
  const parts = refs.map((r) => `${shortLen(r.piece.length)}${NBSP}м (${data.unit.toLowerCase()}${NBSP}${r.bar})`);
  const name = segmentName(s);
  const head = `${data.multiRoom ? `${info.roomName} · ` : ""}${name[0].toUpperCase()}${name.slice(1)} · ${meters(s.length)}`;
  return (
    <p className="rs-cut__hint is-active" aria-live="polite">
      <Icon name="skirting" size={14} />
      <span>
        <b>{head}</b>
        {refs.length === 1
          ? ` — кусок ${parts[0]}`
          : ` — ${refs.length} ${pluralize(refs.length, ["кусок", "куска", "кусков"])}: ${parts.join(" + ")}`}
      </span>
    </p>
  );
});

/* ------------------------------- Схема -------------------------------- */

/** Длинный раскрой (большая квартира) сворачиваем: показываем первые планки. */
const COLLAPSE_AFTER = 12;
const COLLAPSED_ROWS = 8;

export const CutPlan = memo(function CutPlan({ estimate }: { estimate: ProductEstimate }) {
  const data = useMemo(() => buildData(estimate), [estimate]);
  const [expanded, setExpanded] = useState(false);
  const { cutPlan, product } = estimate;
  const forms = unitForms(product);
  const eff = Math.round(cutPlan.efficiency * 100);
  const L = cutPlan.stockLength;
  const collapsible = data.cutBars.length > COLLAPSE_AFTER;
  const visibleBars = collapsible && !expanded ? data.cutBars.slice(0, COLLAPSED_ROWS) : data.cutBars;
  const hiddenBars = data.cutBars.length - visibleBars.length;
  const bought = cutPlan.bars.length * L;
  const wastePct = bought > 0 ? Math.round((cutPlan.totalWaste / bought) * 100) : 0;

  if (!cutPlan.bars.length) {
    return <p className="rs-empty-line">Резать нечего — плинтус в этих комнатах не нужен.</p>;
  }

  const tintOf = (p: Piece) => (data.multiRoom ? data.roomTint.get(p.roomId) ?? 0 : null);
  const roomOf = (p: Piece) => (data.multiRoom ? data.segments.get(p.segmentIds[0])?.roomName ?? null : null);

  return (
    <div className="rs-cut">
      <div className="rs-cut__summary">
        <span>
          {countText(cutPlan.bars.length, forms)} по {stockText(L)}
        </span>
        <Badge
          tone={cutPlan.optimal ? "success" : eff >= 80 ? "primary" : "neutral"}
          title={
            cutPlan.optimal
              ? "Доля плинтуса в купленных планках. Меньше планок не получится — раскрой оптимален."
              : "Доля плинтуса в купленных планках, остальное — обрезки и пропилы."
          }
        >
          {cutPlan.optimal ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
          {pctText(eff, 0)} в дело
        </Badge>
      </div>

      {data.fullBars.length ? (
        <div className="rs-cut__full">
          <div className="rs-cut__caption">
            Целиком, без резки
            <span className="faint">
              {" "}
              · {countText(data.fullBars.length, forms)}, №{NBSP}
              {numberRanges(data.fullBars.map((b) => data.barNo.get(b) ?? 0))}
            </span>
          </div>
          <div className="rs-chips">
            {data.fullBars.map((b) => {
              const p = b.pieces[0];
              return <PieceChip
                  key={p.id}
                  piece={p}
                  tint={tintOf(p)}
                  bar={data.barNo.get(b) ?? 0}
                  unit={data.unit}
                  roomName={roomOf(p)}
                />;
            })}
          </div>
        </div>
      ) : null}

      {data.cutBars.length ? (
        <div className="rs-cut__cuts">
          <div className="rs-cut__caption">
            С резкой
            <span className="faint"> · длины в метрах</span>
          </div>
          <ol className="rs-bars">
            {visibleBars.map((b) => (
              <BarRow key={data.barNo.get(b)} bar={b} no={data.barNo.get(b) ?? 0} data={data} stock={L} />
            ))}
          </ol>
          {hiddenBars > 0 || expanded ? (
            <button type="button" className="rs-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
              {expanded ? "Свернуть" : `Показать ещё ${countText(hiddenBars, forms)}`}
            </button>
          ) : null}
        </div>
      ) : null}

      <HoverInfo data={data} />

      <div className="rs-legend" aria-hidden>
        {data.multiRoom ? null : (
          <span className="rs-legend__item">
            <i className="rs-legend__sw rs-legend__sw--piece" /> кусок
          </span>
        )}
        <span className="rs-legend__item">
          <i className="rs-legend__sw rs-legend__sw--waste" /> обрезок
        </span>
        <span className="rs-legend__item">
          <i className="rs-legend__sw rs-legend__sw--useful" /> пригодится (от {formatNumber(USEFUL_OFFCUT * 100, 0)} см)
        </span>
        {data.multiRoom
          ? estimate.rooms.map((r) => (
              <span key={r.roomId} className="rs-legend__item">
                <i className={`rs-legend__sw rs-legend__sw--room rs-tint-${data.roomTint.get(r.roomId) ?? 0}`} /> {r.roomName}
              </span>
            ))
          : null}
      </div>

      <p className="rs-cut__foot faint">
        В обрезки уходит {meters(cutPlan.totalWaste)} ({pctText(wastePct, 0)})
        {cutPlan.kerf > 0 ? `, пропил ${formatNumber(cutPlan.kerf * 1000, 1, { trim: true })}${NBSP}мм учтён` : ""}.
        {data.usefulOffcuts > 0
          ? ` ${data.usefulOffcuts === 1 ? "Длинный обрезок" : "Длинные обрезки"} не выбрасывайте — пригодятся при подгонке.`
          : ""}
      </p>
    </div>
  );
});
