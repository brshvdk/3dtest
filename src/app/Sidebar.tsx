/**
 * Левая панель — пошаговый сценарий: 1 Комната → 2 Проёмы → 3 Плинтус
 * (→ 4 Итог на узких экранах, где нет правой колонки).
 */
import { useEffect } from "react";
import { useAppStore, type PanelTab } from "../state/store";
import { RoomPanel } from "../panels/RoomPanel";
import { OpeningsPanel } from "../panels/OpeningsPanel";
import { SkirtingPanel } from "../panels/SkirtingPanel";
import { ResultsPanel } from "../results/ResultsPanel";
import { Button, Icon, type IconName } from "../ui/kit";

const TABS: Array<{ id: PanelTab; label: string; icon: IconName }> = [
  { id: "room", label: "Комната", icon: "room" },
  { id: "openings", label: "Проёмы", icon: "door" },
  { id: "skirting", label: "Плинтус", icon: "skirting" },
  { id: "result", label: "Итог", icon: "cart" },
];

export function Sidebar({ showResultTab }: { showResultTab: boolean }) {
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
      <nav className="steps" role="tablist" aria-label="Шаги">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === current}
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

      <div id="sidebar-body" className="sidebar__body scroll">
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
