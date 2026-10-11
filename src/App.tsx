import { useEffect, useState } from "react";
import { useAppStore } from "./state/store";
import { Header } from "./app/Header";
import { Sidebar } from "./app/Sidebar";
import { Stage } from "./app/Stage";
import { useHotkeys } from "./app/useHotkeys";
import { usePanelTyping } from "./app/usePanelTyping";
import { useCrossTabSync } from "./app/useCrossTabSync";
import { ResultsPanel } from "./results/ResultsPanel";
import { PrintSheet } from "./results/PrintSheet";
import { DialogHost, ToastHost, useIsCompact, useIsMobile, useMediaQuery } from "./ui/kit";

export default function App() {
  useHotkeys();
  useCrossTabSync();
  const compact = useIsCompact();
  const mobile = useIsMobile();
  const touch = useMediaQuery("(pointer: coarse)");
  // Телефон: панель шагов можно развернуть (план — полоса сверху), и так же
  // она разворачивается сама, пока пользователь печатает в её поле.
  const [expanded, setExpanded] = useState(false);
  // «Итог» — длинный список: на телефоне открываем его развёрнутым, остальные
  // шаги — рядом с планом. Дальше пользователь переключает сам.
  const panelTab = useAppStore((s) => s.panelTab);
  useEffect(() => {
    setExpanded(panelTab === "result");
  }, [panelTab]);
  const typing = usePanelTyping(mobile && touch);
  const panelExpanded = mobile && (expanded || typing);

  return (
    <div className="app">
      <Header />
      <div
        className={`workspace${compact ? " is-compact" : ""}${panelExpanded ? " is-panel-expanded" : ""}${
          typing ? " is-typing" : ""
        }`}
      >
        <Sidebar
          showResultTab={compact}
          expandable={mobile}
          expanded={panelExpanded}
          onToggleExpanded={() => setExpanded(!panelExpanded)}
        />
        <Stage
          mini={panelExpanded}
          onRestore={() => {
            // Поле в панели теряет фокус — клавиатура закрывается, план возвращается.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            setExpanded(false);
          }}
        />
        {!compact ? (
          <aside className="results-col scroll" aria-label="Расчёт">
            <ResultsPanel />
          </aside>
        ) : null}
      </div>
      <ToastHost />
      <DialogHost />
      <PrintSheet />
    </div>
  );
}
