/** Тема интерфейса: auto (системная) / light / dark. */
import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";
const KEY = "merka:theme";

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

/** Вызывается до рендера, чтобы не мигала светлая тема. */
export function initTheme() {
  applyTheme(readMode());
}

export function isDarkActive(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [dark, setDark] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isDarkActive(),
  );

  useEffect(() => {
    applyTheme(mode);
    setDark(isDarkActive());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(isDarkActive());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode]);

  const toggle = useCallback(() => {
    const next: ThemeMode = isDarkActive() ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* приватный режим */
    }
    setModeState(next);
  }, []);

  return { mode, dark, toggle };
}
