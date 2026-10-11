/**
 * Схема раскроя планок: каждая планка — полоса пропорционально длине,
 * куски подписаны (A, B2, откос), обрезок заштрихован.
 *
 * Связь с планом и 3D — через hoverSegmentId в сторе: наведение на кусок
 * подсвечивает участок плинтуса, наведение на участок на плане — куски здесь.
 * Каждый кусок подписан на стор сам (булев селектор), поэтому при наведении
 * перерисовываются только два-три куска, а не вся схема.
 */
import { memo, useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import type { CutBar, Piece } from "../domain/cutting";
import type { ProductEstimate } from "../domain/estimate";
import type { SkirtingSegment } from "../domain/skirtingCalc";
import { formatNumber, pluralize } from "../domain/units";
import { useAppStore } from "../state/store";
import { Badge, Icon, useMediaQuery } from "../ui/kit";
import {
  NBSP,
  USEFUL_OFFCUT_CM,
  countText,
  describePiece,
  isMinimalCut,
  isUsefulOffcut,
  meters,
  numberRanges,
  partText,
  pctText,
  shortLen,
  wasteLen,
  splitPieceLabel,
  stockText,
  unitForms,
  unitWords,
  type SplitWalls,
} from "./format";

/** Сколько оттенков для комнат (дальше — по кругу, а куски помечаются номером комнаты). */
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

/** Номер комнаты (как на печатном листе) — когда оттенков на все комнаты не хватает. */
export type RoomNumbers = ReadonlyMap<string, number>;

/** Что кусок берёт от своей комнаты: оттенок, номер и название, участки её стен. Один объект на комнату. */
interface RoomCtx {
  tint: number | null;
  /** Номер в рамке — только если оттенки повторяются (комнат больше ROOM_TINTS). */
  no: number | null;
  /** Название — в подсказках, если в проекте больше одной комнаты. */
  name: string | null;
  /** Стены, разбитые проёмами на участки («A», «A2»). */
  split: SplitWalls;
}

interface PlanData {
  fullBars: CutBar[];
  cutBars: CutBar[];
  /** Номер (с 1) каждой планки по ссылке. */
  barNo: Map<CutBar, number>;
  rooms: Map<string, RoomCtx>;
  bySegment: Map<string, PieceRef[]>;
  segments: Map<string, SegmentInfo>;
  usefulOffcuts: number;
  multiRoom: boolean;
  /** «Планка» / «Элемент» — для подписей и подсказок. */
  unit: string;
}

function buildData(pe: ProductEstimate, showRoomNames: boolean, roomNumbers: RoomNumbers | undefined): PlanData {
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
  const rooms = new Map<string, RoomCtx>();
  const multiRoom = pe.roomIds.length > 1;
  const numbered = pe.roomIds.length > ROOM_TINTS;
  pe.rooms.forEach((r, i) => {
    const split = new Set<string>();
    for (const s of r.segments) {
      segments.set(s.id, { segment: s, roomName: r.roomName });
      if (!s.isReveal && s.label !== s.wallLabel) split.add(s.wallLabel);
    }
    rooms.set(r.roomId, {
      tint: multiRoom ? i % ROOM_TINTS : null,
      no: numbered ? roomNumbers?.get(r.roomId) ?? i + 1 : null,
      name: multiRoom || showRoomNames ? r.roomName : null,
      split,
    });
  });
  return {
    fullBars,
    cutBars,
    barNo,
    rooms,
    bySegment,
    segments,
    usefulOffcuts: bars.filter((b) => isUsefulOffcut(b.waste)).length,
    multiRoom,
    unit: capitalize(unitForms(pe.product)[0]),
  };
}

const NO_ROOM: RoomCtx = { tint: null, no: null, name: null, split: new Set() };
const roomOf = (data: PlanData, p: Piece): RoomCtx => data.rooms.get(p.roomId) ?? NO_ROOM;

/** «Ванная, стена A, участок 1, кусок 2 из 2» */
const pieceWhere = (piece: Piece, room: RoomCtx): string =>
  `${room.name ? `${room.name}, ` : ""}${describePiece(piece.label, room.split)}`;

const tintClass = (room: RoomCtx): string => (room.tint !== null ? ` rs-tint-${room.tint}` : "");

/** Номер комнаты в рамке (как на печати) — когда оттенков на все комнаты не хватает. */
const RoomMark = ({ no }: { no: number | null }) => (no !== null ? <span className="rs-rno">{no}</span> : null);

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
  room,
  bar,
  unit,
}: {
  piece: Piece;
  room: RoomCtx;
  bar: number;
  unit: string;
}) {
  const hot = useHotPiece(piece);
  const { main, part, reveal } = splitPieceLabel(piece.label);
  const handlers = useMemo(() => pieceHandlers(piece), [piece]);
  const where = pieceWhere(piece, room);
  return (
    <button
      type="button"
      className={`rs-pc${tintClass(room)}${hot ? " is-hot" : ""}`}
      style={{ flexGrow: growOf(piece.length) }}
      aria-label={`${unit} ${bar}: ${where} — ${meters(piece.length)}`}
      title={`${where} — ${meters(piece.length)}`}
      {...handlers}
    >
      <span className="rs-pc__label">
        <RoomMark no={room.no} />
        {reveal ? "откос " : ""}
        {main}
        {/* «кусок 1 из 2» — чтобы половину участка A не спутать с участком A2. На узком куске —
            «1/2», на совсем узком часть прячется (CSS): подробности — в подсказке. */}
        {part ? (
          <small className="rs-pc__part">
            <span className="rs-pc__part-long"> кусок {partText(part)}</span>
            <span className="rs-pc__part-short"> {part}</span>
          </small>
        ) : null}
      </span>
      <span className="rs-pc__len">{shortLen(piece.length)}</span>
    </button>
  );
});

const PieceChip = memo(function PieceChip({
  piece,
  room,
  bar,
  unit,
}: {
  piece: Piece;
  room: RoomCtx;
  bar: number;
  unit: string;
}) {
  const hot = useHotPiece(piece);
  const { main, part, reveal } = splitPieceLabel(piece.label);
  const handlers = useMemo(() => pieceHandlers(piece), [piece]);
  const where = pieceWhere(piece, room);
  return (
    <button
      type="button"
      className={`rs-chip${tintClass(room)}${hot ? " is-hot" : ""}`}
      aria-label={`${unit} ${bar} целиком: ${where}`}
      title={`${unit} ${bar} целиком — ${where}`}
      {...handlers}
    >
      <span>
        <RoomMark no={room.no} />
        {reveal ? "откос " : ""}
        {main}
        {part ? <small> кусок {partText(part)}</small> : null}
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
  // Пометка и подпись — из одного округления вниз: «0,29» без «пригодится», «0,30» — с ней.
  const useful = isUsefulOffcut(bar.waste);
  return (
    <li className="rs-bar-row">
      <span className="rs-bar-row__no" aria-hidden>
        {no}
      </span>
      <div className="rs-bar" role="group" aria-label={`${data.unit} ${no}`}>
        {bar.pieces.map((p) => (
          <PieceBlock key={p.id} piece={p} room={roomOf(data, p)} bar={no} unit={data.unit} />
        ))}
        {bar.waste > stock * 0.004 ? (
          <span
            className={`rs-waste${useful ? " is-useful" : ""}`}
            style={{ flexGrow: growOf(bar.waste) }}
            title={`Обрезок ${wasteLen(bar.waste)}${NBSP}м${useful ? " — пригодится" : ""}`}
          >
            <span className="rs-waste__len">
              {useful ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
              {wasteLen(bar.waste)}
            </span>
            {useful ? <span className="rs-waste__tag">пригодится</span> : null}
          </span>
        ) : null}
      </div>
    </li>
  );
});

/* --------------------------- Подсказка снизу --------------------------- */

function segmentName(s: SkirtingSegment, split: SplitWalls): string {
  if (s.isReveal) return `откос у стены ${s.wallLabel}`;
  if (s.label === s.wallLabel) return split.has(s.wallLabel) ? `стена ${s.wallLabel}, участок 1` : `стена ${s.wallLabel}`;
  return `стена ${s.wallLabel}, участок ${s.label.slice(s.wallLabel.length)}`;
}

/** мс тишины, прежде чем скринридер прочитает подсказку (как сводка плана в plan/Overlays). */
const ANNOUNCE_DELAY = 900;

/**
 * Скрытый live-регион: читает подсказку один раз, когда она перестала меняться. Видимая
 * подсказка обновляется на каждом кадре перетаскивания стены (длина участка) и при каждом
 * наведении — объявлять её сразу значило бы засыпать скринридер. При монтировании молчит.
 */
function HintAnnouncer({ text }: { text: string }) {
  const [spoken, setSpoken] = useState("");
  const last = useRef(text);
  useEffect(() => {
    if (text === last.current) return;
    const t = window.setTimeout(() => {
      last.current = text;
      setSpoken(text);
    }, ANNOUNCE_DELAY);
    return () => window.clearTimeout(t);
  }, [text]);
  return (
    <span className="visually-hidden" aria-live="polite">
      {spoken}
    </span>
  );
}

interface HintParts {
  head: string;
  rest: string;
  /** Подсказка «откройте комнату» — участок не из активной комнаты. */
  elsewhere: string | null;
}

function hintParts(data: PlanData, hoverId: string | null, activeRoomId: string): HintParts | null {
  const info = hoverId ? data.segments.get(hoverId) : undefined;
  const refs = hoverId ? data.bySegment.get(hoverId) : undefined;
  if (!info || !refs?.length) return null;
  const s = info.segment;
  const room = data.rooms.get(s.roomId) ?? NO_ROOM;
  const parts = refs.map((r) => `${shortLen(r.piece.length)}${NBSP}м (${data.unit.toLowerCase()}${NBSP}${r.bar})`);
  const name = segmentName(s, room.split);
  const head = `${room.name ? `${room.name} · ` : ""}${name[0].toUpperCase()}${name.slice(1)} · ${meters(s.length)}`;
  const rest =
    refs.length === 1
      ? ` — кусок ${parts[0]}`
      : ` — ${refs.length} ${pluralize(refs.length, ["кусок", "куска", "кусков"])}: ${parts.join(" + ")}`;
  // На плане и в 3D — активная комната: участок другой комнаты там не подсветится, пока её не открыть.
  const elsewhere =
    s.roomId !== activeRoomId
      ? `Эта комната сейчас не на плане — нажмите на кусок, чтобы открыть комнату «${info.roomName}».`
      : null;
  return { head, rest, elsewhere };
}

const HoverInfo = memo(function HoverInfo({ data }: { data: PlanData }) {
  const hoverId = useAppStore((s) => s.hoverSegmentId);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const touch = useMediaQuery("(hover: none)");
  const hint = hintParts(data, hoverId, activeRoomId);
  const spoken = hint ? `${hint.head}${hint.rest}.${hint.elsewhere ? ` ${hint.elsewhere}` : ""}` : "";
  return (
    <>
      {hint ? (
        <p className="rs-cut__hint is-active">
          <Icon name="skirting" size={14} />
          <span>
            <b>{hint.head}</b>
            {hint.rest}
            {hint.elsewhere ? <span className="rs-cut__elsewhere">{hint.elsewhere}</span> : null}
          </span>
        </p>
      ) : (
        <p className="rs-cut__hint">
          <Icon name="info" size={14} />
          {touch ? "Нажмите на кусок — он подсветится на плане" : "Наведите на кусок — он подсветится на плане и в 3D"}
        </p>
      )}
      <HintAnnouncer text={spoken} />
    </>
  );
});

/* ------------------------------- Схема -------------------------------- */

/** Длинный раскрой (большая квартира) сворачиваем: показываем первые планки. */
const COLLAPSE_AFTER = 12;
const COLLAPSED_ROWS = 8;

export const CutPlan = memo(function CutPlan({
  estimate,
  showRoomNames = false,
  roomNumbers,
}: {
  estimate: ProductEstimate;
  /** В проекте есть и другие комнаты — называть комнату в подсказках, даже если у этого плинтуса она одна. */
  showRoomNames?: boolean;
  /** Номера комнат как на печатном листе (для пометок на кусках, когда комнат больше, чем оттенков). */
  roomNumbers?: RoomNumbers;
}) {
  const data = useMemo(() => buildData(estimate, showRoomNames, roomNumbers), [estimate, showRoomNames, roomNumbers]);
  const [expanded, setExpanded] = useState(false);
  const { cutPlan, product } = estimate;
  const words = unitWords(product);
  const forms = words.forms;
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

  const optimal = isMinimalCut(cutPlan);

  return (
    <div className="rs-cut">
      <div className="rs-cut__summary">
        <span>
          {countText(cutPlan.bars.length, forms)} по {stockText(L)}
        </span>
        <Badge
          tone={optimal ? "success" : eff >= 80 ? "primary" : "neutral"}
          title={
            optimal
              ? `Доля плинтуса в купленных ${words.prepPl}. Меньше ${words.genPl} не получится — раскрой оптимален.`
              : `Доля плинтуса в купленных ${words.prepPl}, остальное — обрезки и пропилы.`
          }
        >
          {optimal ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
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
              return <PieceChip key={p.id} piece={p} room={roomOf(data, p)} bar={data.barNo.get(b) ?? 0} unit={data.unit} />;
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
          <i className="rs-legend__sw rs-legend__sw--useful" /> пригодится (от {USEFUL_OFFCUT_CM}{NBSP}см)
        </span>
        {data.multiRoom
          ? estimate.rooms.map((r) => {
              const room = data.rooms.get(r.roomId) ?? NO_ROOM;
              return (
                <span key={r.roomId} className="rs-legend__item">
                  <i className={`rs-legend__sw rs-legend__sw--room${tintClass(room)}`} />
                  <span>
                    <RoomMark no={room.no} />
                    {r.roomName}
                  </span>
                </span>
              );
            })
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
