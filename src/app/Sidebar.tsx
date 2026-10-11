/**
 * Левая панель — пошаговый сценарий: 1 Комната → 2 Проёмы → 3 Плинтус
 * (→ 4 Итог на узких экранах, где нет правой колонки). На узких экранах над
 * шагами — строка итога (сколько планок и сколько стоит), на телефоне в ней
 * же ручка: панель можно развернуть, ужав план до полосы.
 */
import { useEffect, useRef } from "react";
import { useAppStore, type PanelTab } from "../state/store";
import { useEstimate } from "../state/hooks";
import { formatMoney, plural } from "../domain/units";
import { RoomPanel } from "../panels/RoomPanel";
import { OpeningsPanel } from "../panels/OpeningsPanel";
import { SkirtingPanel } from "../panels/SkirtingPanel";
import { ResultsPanel } from "../results/ResultsPanel";
import { Button, Icon, rovingKeyDown, type IconName } from "../ui/kit";

const TABS: Array<{ id: PanelTab; label: string; icon: IconName }> = [
  { id: "room", label: "Комната", icon: "room" },
  { id: "openings", label: "Проёмы", icon: "door" },
  { id: "skirting", label: "Плинтус", icon: "skirting" },
  { id: "result", label: "Итог", icon: "cart" },
];

const PLANK_FORMS: [string, string, string] = ["планка", "планки", "планок"];

/** «8 планок · 2 116 ₽» — главный результат, виден на любом шаге. */
function SummaryBar({
  current,
  onOpen,
  expandable,
  expanded,
  onToggleExpanded,
}: {
  current: PanelTab;
  onOpen: () => void;
  expandable: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const estimate = useEstimate();
  const swipe = useRef<{ y: number; done: boolean } | null>(null);
  const onResult = current === "result";
  const text =
    estimate.planksToOrder > 0
      ? `${plural(estimate.planksToOrder, PLANK_FORMS)} · ${formatMoney(estimate.totalCost)}`
      : "Плинтус не нужен";

  return (
    <div
      className={`sidebar__summary${expandable ? " is-handle" : ""}`}
      // Свайп по строке вверх — развернуть панель, вниз — вернуть план.
      onPointerDown={(e) => {
        if (expandable && e.pointerType !== "mouse") swipe.current = { y: e.clientY, done: false };
      }}
      onPointerMove={(e) => {
        const s = swipe.current;
        if (!s || s.done) return;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) < 24) return;
        s.done = true;
        if ((dy < 0) !== expanded) onToggleExpanded();
      }}
      onPointerUp={() => {
        // Клик после свайпа не должен открывать «Итог».
        window.setTimeout(() => (swipe.current = null));
      }}
      onPointerCancel={() => (swipe.current = null)}
    >
      {expandable ? <span className="sidebar__grabber" aria-hidden /> : null}
      <button
        type="button"
        className="sidebar__summary-btn"
        onClick={() => {
          if (swipe.current?.done) return;
          onOpen();
        }}
        disabled={onResult}
        aria-label={onResult ? `Итог: ${text}` : `Итог: ${text}. Открыть итог`}
      >
        <Icon name="cart" size={16} className="sidebar__summary-icon" />
        <span className="sidebar__summary-text num">{text}</span>
        {!onResult ? (
          <span className="sidebar__summary-more">
            Итог
            <Icon name="chevron-right" size={15} />
          </span>
        ) : null}
      </button>
      {expandable ? (
        <button
          type="button"
          className="sidebar__expand"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Показать план" : "Развернуть панель"}
          title={expanded ? "Показать план" : "Развернуть панель"}
        >
          <Icon name="chevron-down" size={18} className={expanded ? "" : "is-up"} />
        </button>
      ) : null}
    </div>
  );
}

export function Sidebar({
  showResultTab,
  expandable = false,
  expanded = false,
  onToggleExpanded = () => {},
}: {
  showResultTab: boolean;
  /** Телефон: панель можно развернуть. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const tab = useAppStore((s) => s.panelTab);
  const setTab = useAppStore((s) => s.setPanelTab);
  const openingsCount = useAppStore(
    (s) => s.project.rooms.find((r) => r.id === s.activeRoomId)?.openings.length ?? 0,
  );

  const tabs = showResultTab ? TABS : TABS.filter((t) => t.id !== "result");
  const current: PanelTab = tabs.some((t) => t.id === tab) ? tab : "skirting";
  const idx = tabs.findIndex((t) => t.id === current);
  const prev = idx > 0 ? tabs[idx - 1] : null;
  const next = idx < tabs.length - 1 ? tabs[idx + 1] : null;

  // Прокрутка панели наверх при смене шага.
  useEffect(() => {
    document.getElementById("sidebar-body")?.scrollTo({ top: 0 });
  }, [current]);

  return (
    <aside className="sidebar" aria-label="Параметры">
      {showResultTab ? (
        <SummaryBar
          current={current}
          onOpen={() => setTab("result")}
          expandable={expandable}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
        />
      ) : null}

      <nav className="steps" role="tablist" aria-label="Шаги" onKeyDown={rovingKeyDown}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`step-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === current}
            aria-controls="sidebar-body"
            tabIndex={t.id === current ? 0 : -1}
            className={`step${t.id === current ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="step__top">
              <span className="step__num">{i + 1}</span>
              <Icon name={t.icon} size={17} className="step__icon" />
              {t.id === "openings" && openingsCount > 0 ? (
                <span className="step__count" aria-label={`${openingsCount} шт.`}>
                  {openingsCount}
                </span>
              ) : null}
            </span>
            <span className="step__label">{t.label}</span>
          </button>
        ))}
      </nav>

      <div
        id="sidebar-body"
        className="sidebar__body scroll"
        role="tabpanel"
        aria-labelledby={`step-tab-${current}`}
      >
        {current === "room" ? <RoomPanel /> : null}
        {current === "openings" ? <OpeningsPanel /> : null}
        {current === "skirting" ? <SkirtingPanel /> : null}
        {current === "result" ? <ResultsPanel /> : null}

        <div className="step-nav">
          {prev ? (
            <Button variant="ghost" icon="chevron-left" onClick={() => setTab(prev.id)}>
              {prev.label}
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button variant="primary" iconRight="chevron-right" onClick={() => setTab(next.id)}>
              Далее: {next.label.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
