import { useRoomStore } from "../state/useRoomStore";
import "./ControlPanel.css";

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  display?: (v: number) => string;
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  display,
}: SliderRowProps) {
  const shown = display ? display(value) : value.toFixed(2);
  return (
    <div className="row">
      <div className="row-head">
        <span className="row-label">{label}</span>
        <span className="row-value">
          {shown} {unit}
        </span>
      </div>
      <div className="row-controls">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

export function ControlPanel() {
  const s = useRoomStore();

  return (
    <aside className="panel panel-left">
      <h2>Параметры комнаты</h2>

      <SliderRow
        label="Длина"
        value={s.length}
        onChange={s.setLength}
        min={1.5}
        max={15}
        step={0.1}
        unit="м"
      />
      <SliderRow
        label="Ширина"
        value={s.width}
        onChange={s.setWidth}
        min={1.5}
        max={15}
        step={0.1}
        unit="м"
      />
      <SliderRow
        label="Высота"
        value={s.height}
        onChange={s.setHeight}
        min={2}
        max={4.5}
        step={0.05}
        unit="м"
      />

      <h2>Раскладка пола</h2>

      <div className="row">
        <div className="row-head">
          <span className="row-label">Тип</span>
        </div>
        <div className="seg">
          <button
            className={s.pattern === "herringbone" ? "active" : ""}
            onClick={() => s.setPattern("herringbone")}
          >
            Ёлочка
          </button>
          <button
            className={s.pattern === "deck" ? "active" : ""}
            onClick={() => s.setPattern("deck")}
          >
            Палуба
          </button>
        </div>
      </div>

      <SliderRow
        label="Зазор (шов)"
        value={s.gap * 1000}
        onChange={(v) => s.setGap(v / 1000)}
        min={0}
        max={5}
        step={0.5}
        unit="мм"
        display={(v) => v.toFixed(1)}
      />

      <SliderRow
        label="Запас плашек"
        value={s.reservePct}
        onChange={s.setReservePct}
        min={0}
        max={25}
        step={1}
        unit="%"
        display={(v) => v.toFixed(0)}
      />

      <h2>Цвета</h2>

      <div className="row">
        <div className="row-head">
          <span className="row-label">Стены</span>
          <span className="row-value">{s.wallColor}</span>
        </div>
        <input
          type="color"
          value={s.wallColor}
          onChange={(e) => s.setWallColor(e.target.value)}
        />
      </div>

      <div className="row">
        <div className="row-head">
          <span className="row-label">Оттенок дерева</span>
          <span className="row-value">{s.woodTint}</span>
        </div>
        <input
          type="color"
          value={s.woodTint}
          onChange={(e) => s.setWoodTint(e.target.value)}
        />
      </div>
    </aside>
  );
}
