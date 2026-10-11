/** Центральная область: вкладки комнат, переключатель План / 3D / Оба, сами виды. */
import { lazy, Suspense } from "react";
import { useAppStore, type ViewMode } from "../state/store";
import { PlanView } from "../plan/PlanView";
import { Segmented, useIsMobile } from "../ui/kit";
import { RoomTabs } from "./RoomTabs";

// three.js (~600 КБ) грузится только когда пользователь открыл 3D.
const Scene3D = lazy(() => import("../scene3d/Scene3D"));

export function Stage() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const isMobile = useIsMobile();
  const effective: ViewMode = isMobile && view === "split" ? "plan" : view;

  const options = [
    { value: "plan" as const, label: "План", icon: "plan" as const },
    { value: "3d" as const, label: "3D", icon: "cube" as const },
    ...(isMobile
      ? []
      : [{ value: "split" as const, label: "Оба", icon: "split" as const, title: "План и 3D рядом" }]),
  ];

  return (
    <main className="stage">
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
      <div className={`stage__views stage__views--${effective}`}>
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
      </div>
    </main>
  );
}
