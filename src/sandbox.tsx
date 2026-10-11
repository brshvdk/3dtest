/**
 * Песочница для разработки: рендерит ОДИН модуль UI изолированно,
 * чтобы ошибка в другом модуле не мешала. Только для dev-сервера:
 *   /sandbox.html?m=plan | scene3d | room | openings | skirting | results | print
 * Доп. параметры: &w=360 — ширина колонки для панелей; &dark — тёмная тема.
 */
import "./styles/tokens.css";
import "./styles/base.css";
import "./ui/kit/kit.css";
import "./app/app.css";
import React, { Suspense, lazy, type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { initTheme } from "./app/theme";
import { DialogHost, ToastHost } from "./ui/kit";

const q = new URLSearchParams(location.search);
const m = q.get("m") ?? "plan";
if (q.has("dark")) document.documentElement.setAttribute("data-theme", "dark");
else initTheme();

type Loader = () => Promise<{ default: ComponentType }>;
const LOADERS: Record<string, Loader> = {
  plan: () => import("./plan/PlanView").then((x) => ({ default: x.PlanView })),
  scene3d: () => import("./scene3d/Scene3D"),
  room: () => import("./panels/RoomPanel").then((x) => ({ default: x.RoomPanel })),
  openings: () => import("./panels/OpeningsPanel").then((x) => ({ default: x.OpeningsPanel })),
  skirting: () => import("./panels/SkirtingPanel").then((x) => ({ default: x.SkirtingPanel })),
  results: () => import("./results/ResultsPanel").then((x) => ({ default: x.ResultsPanel })),
  print: () => import("./results/PrintSheet").then((x) => ({ default: x.PrintSheet })),
};
const isView = m === "plan" || m === "scene3d";
const isPrint = m === "print";
const C = lazy(LOADERS[m] ?? LOADERS.plan);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<div style={{ padding: 20 }}>Загрузка модуля «{m}»…</div>}>
      {isView ? (
        <div style={{ position: "fixed", inset: 0, background: "var(--plan-bg)" }}>
          <C />
        </div>
      ) : isPrint ? (
        <div className="print-preview">
          <C />
        </div>
      ) : (
        <div
          className="scroll"
          style={{
            width: Number(q.get("w") ?? 360),
            height: "100vh",
            padding: 12,
            background: "var(--surface-2)",
            borderRight: "1px solid var(--border)",
          }}
        >
          <C />
        </div>
      )}
    </Suspense>
    <ToastHost />
      <DialogHost />
  </React.StrictMode>,
);
