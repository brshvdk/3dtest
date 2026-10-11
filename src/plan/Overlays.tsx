/**
 * Оверлеи плана поверх SVG: кнопки масштаба, масштабная линейка,
 * подсказка для новичка, сводка комнаты.
 */
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import type { Room } from "../domain/types";
import { formatArea, formatLength } from "../domain/units";
import { useRoomMetrics } from "../state/hooks";
import { Icon, IconButton } from "../ui/kit";
import { usePlanUi } from "./planUi";
import { niceScaleLength } from "./viewport";

export const ZoomControls = memo(function ZoomControls({
  onFit,
  onZoom,
  canIn,
  canOut,
}: {
  onFit: () => void;
  onZoom: (factor: number) => void;
  canIn: boolean;
  canOut: boolean;
}) {
  return (
    <div className="pl-zoom" role="group" aria-label="Масштаб плана">
      <IconButton icon="zoom-in" label="Приблизить" onClick={() => onZoom(1.4)} disabled={!canIn} />
      <IconButton icon="zoom-out" label="Отдалить" onClick={() => onZoom(1 / 1.4)} disabled={!canOut} />
      <span className="pl-zoom__sep" />
      <IconButton icon="fit" label="Вписать комнату в экран" onClick={onFit} />
    </div>
  );
});

export const ScaleBar = memo(function ScaleBar({ s }: { s: number }) {
  const m = niceScaleLength(s);
  const px = Math.round(m * s);
  const label = m >= 1 ? formatLength(m, "m", 0) : formatLength(m, "cm", 0);
  return (
    <div className="pl-scale" aria-hidden>
      <span className="pl-scale__label num">{label}</span>
      <span className="pl-scale__bar" style={{ width: px }} />
    </div>
  );
});

export type HintMode = "center" | "left" | "stacked";

function hintItems(coarse: boolean): Array<[string, string]> {
  return coarse
    ? [
        ["Тяните стену", "меняется размер"],
        ["Двойной тап по стене", "новый угол"],
        ["Щипок", "масштаб"],
      ]
    : [
        ["Тяните стену", "меняется размер"],
        ["Двойной клик по стене", "новый угол"],
        ["Колесо", "масштаб"],
      ];
}

function HintText({ items, stacked }: { items: Array<[string, string]>; stacked: boolean }) {
  return (
    <>
      {items.map(([act, res], i) => (
        <Fragment key={i}>
          <span className="pl-hint__item">
            <b>{act}</b> — {res}
          </span>
          {!stacked && i < items.length - 1 ? <span className="pl-hint__dot">{"\u00a0· "}</span> : null}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Подсказка новичку. Одной строкой, где помещается: center — по центру между
 * линейкой масштаба и кнопками, left — от левого края (линейка на это время
 * скрыта); stacked — столбиком, по пункту в строке (в одну строку с
 * переносами точка-разделитель повисала бы в конце строки).
 *
 * Рядом — невидимая копия в одну строку: её ширину (onMeasure) план берёт,
 * чтобы выбрать режим по настоящему тексту и шрифту, а не по порогам ширины.
 */
export function Hint({
  coarse,
  mode,
  leaving,
  onClose,
  onMeasure,
}: {
  coarse: boolean;
  mode: HintMode;
  /** Скрыта — плавно исчезает (затем план её убирает). */
  leaving: boolean;
  onClose: () => void;
  /** Ширина подсказки в одну строку, px. */
  onMeasure: (px: number) => void;
}) {
  const items = hintItems(coarse);
  const measureRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measure = () => onMeasure(Math.ceil(el.getBoundingClientRect().width));
    measure();
    // Шрифт догрузился, сменился ввод (мышь/палец) — ширина другая.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);
  const stacked = mode === "stacked";
  return (
    <>
      <div
        className={`pl-hint${stacked ? " is-stacked" : mode === "left" ? " is-left" : ""}${leaving ? " is-leaving" : ""}`}
        role="note"
        aria-hidden={leaving || undefined}
      >
        <Icon name="info" size={15} className="pl-hint__icon" />
        <p className="pl-hint__text">
          <HintText items={items} stacked={stacked} />
        </p>
        <button
          type="button"
          className="pl-hint__close"
          onClick={onClose}
          aria-label="Скрыть подсказку"
          title="Понятно, скрыть"
          tabIndex={leaving ? -1 : undefined}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div ref={measureRef} className="pl-hint pl-hint--measure" aria-hidden>
        <Icon name="info" size={15} className="pl-hint__icon" />
        <p className="pl-hint__text">
          <HintText items={items} stacked={false} />
        </p>
        <span className="pl-hint__close" />
      </div>
    </>
  );
}

/** мс тишины после правки, прежде чем скринридер прочитает новую сводку. */
const ANNOUNCE_DELAY = 900;

/**
 * Сводка для скринридера: читается один раз, когда правка закончилась
 * (не на каждом кадре перетаскивания или шаге стрелкой), и не при открытии плана.
 */
function SummaryAnnouncer({ text }: { text: string }) {
  const busy = usePlanUi((u) => !!u.drag && u.drag.kind !== "pan");
  const [spoken, setSpoken] = useState("");
  const last = useRef(text);
  useEffect(() => {
    if (busy || text === last.current) return;
    const t = window.setTimeout(() => {
      last.current = text;
      setSpoken(text);
    }, ANNOUNCE_DELAY);
    return () => window.clearTimeout(t);
  }, [text, busy]);
  return (
    <span className="visually-hidden" aria-live="polite">
      {spoken}
    </span>
  );
}

export const Summary = memo(function Summary({ room, result }: { room: Room; result?: RoomSkirtingResult }) {
  const m = useRoomMetrics(room.id);
  const skirt = room.skirtingEnabled && result ? `плинтус ${formatLength(result.netLength)}` : "плинтус не считается";
  return (
    <div className="pl-summary">
      <SummaryAnnouncer text={`${room.name}: пол ${formatArea(m.floorArea, 1)}, ${skirt}`} />
      <span className="pl-summary__name">{room.name}</span>
      <span className="pl-summary__sep" />
      <span className="num">{formatArea(m.floorArea, 1)}</span>
      <span className="pl-summary__sep" />
      {room.skirtingEnabled && result ? (
        <span className="pl-summary__skirt" title="Чистая длина плинтуса в комнате (без запаса)">
          <span className="pl-summary__swatch" />
          <span className="num">{formatLength(result.netLength)}</span>
        </span>
      ) : (
        <span className="pl-summary__off">плинтус не считается</span>
      )}
    </div>
  );
});
