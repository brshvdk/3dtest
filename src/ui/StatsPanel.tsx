import { useMemo } from "react";
import { useRoomStore } from "../state/useRoomStore";
import {
  calcPaint,
  calcPlanks,
  calcSkirting,
} from "../lib/calculations";
import "./StatsPanel.css";

function fmt(v: number, digits = 2) {
  return v.toLocaleString("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function StatsPanel() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);
  const height = useRoomStore((s) => s.height);
  const plankLength = useRoomStore((s) => s.plankLength);
  const plankWidth = useRoomStore((s) => s.plankWidth);
  const reservePct = useRoomStore((s) => s.reservePct);
  const paintCoverage = useRoomStore((s) => s.paintCoverage);
  const paintCoats = useRoomStore((s) => s.paintCoats);

  const paint = useMemo(
    () => calcPaint(length, width, height, paintCoverage, paintCoats),
    [length, width, height, paintCoverage, paintCoats],
  );
  const skirting = useMemo(() => calcSkirting(length, width), [length, width]);
  const planks = useMemo(
    () =>
      calcPlanks(length, width, plankLength, plankWidth, reservePct),
    [length, width, plankLength, plankWidth, reservePct],
  );

  return (
    <aside className="panel panel-right">
      <h2>Расчёт материалов</h2>

      <div className="stat">
        <div className="stat-row">
          <span>Площадь пола</span>
          <b>{fmt(planks.floorArea)} м²</b>
        </div>
        <div className="stat-row">
          <span>Площадь стен</span>
          <b>{fmt(paint.wallArea)} м²</b>
        </div>
      </div>

      <h3>Краска</h3>
      <div className="stat">
        <div className="stat-row">
          <span>Расход</span>
          <b>{fmt(paintCoverage, 0)} м²/л × {paintCoats} сл.</b>
        </div>
        <div className="stat-row hero">
          <span>Нужно купить</span>
          <b>{fmt(paint.litres)} л</b>
        </div>
      </div>

      <h3>Плинтус</h3>
      <div className="stat">
        <div className="stat-row hero">
          <span>Погонаж</span>
          <b>{fmt(skirting)} пог. м</b>
        </div>
      </div>

      <h3>Ламинат / паркет</h3>
      <div className="stat">
        <div className="stat-row">
          <span>Размер плашки</span>
          <b>
            {Math.round(plankLength * 1000)}×{Math.round(plankWidth * 1000)} мм
          </b>
        </div>
        <div className="stat-row">
          <span>Плашек (чистое)</span>
          <b>{planks.base} шт</b>
        </div>
        <div className="stat-row hero">
          <span>С запасом {reservePct}%</span>
          <b>{planks.withReserve} шт</b>
        </div>
      </div>

      <div className="footnote">
        Расход краски и запас плашек настраиваются в коде / слайдерами; см.
        README → «Допущения».
      </div>
    </aside>
  );
}
