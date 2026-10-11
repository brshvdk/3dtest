// Стили дизайн-системы — первыми, чтобы стили модулей могли их переопределять.
import "./styles/tokens.css";
import "./styles/base.css";
import "./ui/kit/kit.css";
import "./app/app.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "./app/theme";
import { archiveProject } from "./app/projects";
import { readShareHash } from "./domain/share";
import { initFromUrl, useAppStore } from "./state/store";
import { toast } from "./ui/kit";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * Проект из ссылки «Поделиться» (#p=…): при старте и когда ссылку открыли в
 * уже открытой вкладке (меняется только hash). Текущий проект уходит в
 * «Недавние проекты» и сразу возвращается кнопкой в уведомлении.
 */
async function openSharedProject() {
  if (!readShareHash()) return;
  const before = useAppStore.getState().project;
  if (!(await initFromUrl())) {
    toast("Не удалось открыть проект по ссылке — она повреждена или скопирована не целиком", "warning");
    return;
  }
  if (useAppStore.getState().project.id !== before.id) archiveProject(before);
  toast(`Проект открыт по ссылке. «${before.name}» — в меню проекта`, "info", {
    action: { label: "Вернуть", onClick: () => useAppStore.getState().undo() },
  });
}

void openSharedProject();
window.addEventListener("hashchange", () => void openSharedProject());
