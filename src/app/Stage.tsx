/** Центральная область: вкладки комнат, переключатель План / 3D / Оба, сами виды. */
import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { useAppStore, type ViewMode } from "../state/store";
import { PlanView } from "../plan/PlanView";
import { Icon, Segmented, useIsMobile } from "../ui/kit";
import { RoomTabs } from "./RoomTabs";
import { splitLayout } from "./splitLayout";

// three.js (~600 КБ) грузится только когда пользователь открыл 3D.
const Scene3D = lazy(() => import("../scene3d/Scene3D"));

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Stage({ mini = false, onRestore }: { mini?: boolean; onRestore?: () => void }) {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const isMobile = useIsMobile();
  const [viewsRef, size] = useSize<HTMLDivElement>();
  const split = isMobile ? null : splitLayout(size.w, size.h);
  const effective: ViewMode = !split && view === "split" ? "plan" : view;

  const options = [
    { value: "plan" as const, label: "План", icon: "plan" as const },
    { value: "3d" as const, label: "3D", icon: "cube" as const },
    ...(split
      ? [{ value: "split" as const, label: "Оба", icon: "split" as const, title: "План и 3D рядом" }]
      : []),
  ];

  return (
    <main className={`stage${mini ? " is-mini" : ""}`}>
      <div className="stage__bar">
        <RoomTabs />
        <div className="stage__view-switch">
          <Segmented<ViewMode>
            value={effective}
            options={options}
            onChange={setView}
            size="sm"
            ariaLabel="Вид"
          />
        </div>
      </div>
      <div
        ref={viewsRef}
        className={`stage__views stage__views--${effective}${
          effective === "split" && split ? ` stage__views--${split}` : ""
        }`}
      >
        {effective !== "3d" ? (
          <div className="stage__pane stage__pane--plan">
            <PlanView />
          </div>
        ) : null}
        {effective !== "plan" ? (
          <div className="stage__pane stage__pane--3d">
            <Suspense fallback={<div className="stage__loading">Загружаем 3D…</div>}>
              <Scene3D />
            </Suspense>
          </div>
        ) : null}
        {mini && onRestore ? (
          // Полоса плана над развёрнутой панелью: тап возвращает обычный вид.
          <button type="button" className="stage__restore" onClick={onRestore} aria-label="Показать план">
            <span className="stage__restore-label">
              <Icon name="chevron-down" size={16} />
              Показать план
            </span>
          </button>
        ) : null}
      </div>
    </main>
  );
}
