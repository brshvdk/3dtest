import { Header } from "./app/Header";
import { Sidebar } from "./app/Sidebar";
import { Stage } from "./app/Stage";
import { useHotkeys } from "./app/useHotkeys";
import { ResultsPanel } from "./results/ResultsPanel";
import { PrintSheet } from "./results/PrintSheet";
import { ToastHost, useIsCompact } from "./ui/kit";

export default function App() {
  useHotkeys();
  const compact = useIsCompact();

  return (
    <div className="app">
      <Header />
      <div className={`workspace${compact ? " is-compact" : ""}`}>
        <Sidebar showResultTab={compact} />
        <Stage />
        {!compact ? (
          <aside className="results-col scroll" aria-label="Расчёт">
            <ResultsPanel />
          </aside>
        ) : null}
      </div>
      <ToastHost />
      <PrintSheet />
    </div>
  );
}
