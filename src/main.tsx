// Стили дизайн-системы — первыми, чтобы стили модулей могли их переопределять.
import "./styles/tokens.css";
import "./styles/base.css";
import "./ui/kit/kit.css";
import "./app/app.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "./app/theme";
import { initFromUrl } from "./state/store";
import { toast } from "./ui/kit";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Проект из ссылки «Поделиться» (#p=…).
initFromUrl().then((loaded) => {
  if (loaded) toast("Проект открыт по ссылке. Предыдущий можно вернуть — «Отменить».", "info");
});
