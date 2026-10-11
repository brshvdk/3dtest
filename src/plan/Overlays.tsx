/**
 * Оверлеи плана поверх SVG: кнопки масштаба, масштабная линейка,
 * подсказка для новичка, сводка комнаты.
 */
import { Fragment, memo, useCallback, useState } from "react";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import type { Room } from "../domain/types";
import { formatArea, formatLength } from "../domain/units";
import { useRoomMetrics } from "../state/hooks";
import { Icon, IconButton } from "../ui/kit";
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

const HINT_KEY = "merka:plan-hint-hidden";

function readHintHidden(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Подсказка новичку скрыта (запоминается в localStorage). */
export function useHintHidden(): [boolean, () => void] {
  const [hidden, setHidden] = useState(readHintHidden);
  const hide = useCallback(() => {
    setHidden(true);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // приватный режим — просто скрываем до перезагрузки
    }
  }, []);
  return [hidden, hide];
}

/**
 * Подсказка новичку. stacked — столбиком (узкий план): в одну строку с
 * точками при переносе точка повисала бы в конце строки.
 */
export function Hint({
  coarse,
  stacked,
  fromLeft,
  onClose,
}: {
  coarse: boolean;
  stacked: boolean;
  /** Одной строкой от левого края (линейка масштаба на это время скрыта). */
  fromLeft: boolean;
  onClose: () => void;
}) {
  const items: Array<[string, string]> = coarse
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
  return (
    <div className={`pl-hint${stacked ? " is-stacked" : fromLeft ? " is-left" : ""}`} role="note">
      <Icon name="info" size={15} className="pl-hint__icon" />
      <p className="pl-hint__text">
        {items.map(([act, res], i) => (
          <Fragment key={i}>
            <span className="pl-hint__item">
              <b>{act}</b> — {res}
            </span>
            {!stacked && i < items.length - 1 ? <span className="pl-hint__dot">{"\u00a0· "}</span> : null}
          </Fragment>
        ))}
      </p>
      <button type="button" className="pl-hint__close" onClick={onClose} aria-label="Скрыть подсказку" title="Понятно, скрыть">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export const Summary = memo(function Summary({ room, result }: { room: Room; result?: RoomSkirtingResult }) {
  const m = useRoomMetrics(room.id);
  return (
    <div className="pl-summary" aria-live="polite">
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
